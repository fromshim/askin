// askin 데스크톱 렌더러. nodeIntegration:false 라 window.askin(preload.mjs 가 노출한 두
// 함수)으로만 메인 프로세스와 오간다. 그래프 렌더 코드는
// /private/tmp/.../scratchpad/graph-real.html 프로브에서 가져왔다 — minEdgeThickness,
// 굵기·색 공식, 라벨 이중 렌더러, 리사이즈, 카메라 리셋은 거기서 이미 실측으로 고쳐진 것들이라
// 그대로 옮기고 두 가지만 더했다: 프로젝트 노드 최소 크기+forceLabel, declared 엣지 점선.
//
// Sigma 생성 순서가 프로브와 다르다: 프로브는 데이터가 이미 있는 그래프로 `new Sigma()` 를
// 부른다. 여기는 프로젝트 목록을 먼저 IPC 로 받아야 해서 첫 그래프가 비동기로 늦게 온다.
// 빈 그래프로 Sigma 를 먼저 만들고 나중에 채우면(실측) 카메라가 좌표계를 못 맞춰 아무것도
// 안 그려진다 — 그래서 첫 buildGraph() 로 실제 노드를 채운 뒤에야 Sigma 를 만든다
// (initGraphRenderer). 이후 프로젝트를 바꿀 때는 프로브처럼 clear+rebuild+animatedReset 다.

import { prettyModelName } from './model-name.mjs'

const root = document.getElementById('askin-desktop-v1')
const params = new URLSearchParams(location.search)
const isShotMode = params.get('shot') === '1'

const projectsEl = document.getElementById('ask-projects')
const addProjectBtn = document.getElementById('ask-add-project')
const graphTitleEl = document.getElementById('ask-graph-title')
const graphMetaEl = document.getElementById('ask-graph-meta')
const mapEl = document.getElementById('ask-harness-map')
const sigmaContainer = document.getElementById('ask-sigma-container')
const declaredSvg = document.getElementById('ask-declared-edges')
const zoomOutBtn = document.getElementById('ask-zoom-out')
const zoomInBtn = document.getElementById('ask-zoom-in')
const zoomLevelEl = document.getElementById('ask-zoom-level')
const popover = document.getElementById('ask-node-popover')
const popoverClose = document.getElementById('ask-popover-close')
const popoverName = document.getElementById('ask-popover-name')
const popoverType = document.getElementById('ask-popover-type')
const popoverCallsLabel = document.getElementById('ask-popover-calls-label')
const popoverCalls = document.getElementById('ask-popover-calls')
const popoverLast = document.getElementById('ask-popover-last')
const popoverCallers = document.getElementById('ask-popover-callers')
const popoverModelSummary = document.getElementById('ask-popover-model-summary')
const popoverModelList = document.getElementById('ask-popover-model-list')
const findingsEl = document.getElementById('ask-findings')
const findingsHeadingEl = document.getElementById('ask-findings-heading')
const weakCountEl = document.getElementById('ask-weak-count')
const weakMetaEl = document.getElementById('ask-weak-meta')
const detailsEl = document.getElementById('ask-details')
const detailsToggle = document.getElementById('ask-details-toggle')
const detailsSymbol = document.getElementById('ask-details-symbol')
const detailsGridEl = document.getElementById('ask-details-grid')
const summaryEl = document.getElementById('ask-summary')
const reportPeriodEl = document.getElementById('ask-report-period')

const PROJECT_MIN_SIZE = 12 // desktop/design-concept.md: 호출 수와 무관하게 최소 크기를 보장한다
const sizeFor = (calls) => 4 + Math.sqrt(calls) * 1.6
// 이 수 이하면 라벨을 전부 띄운다. 실측: 저장소 20곳의 노드 수가 중앙값 6.5, 최대 31 이고
// 그중 절반이 3개 이하다. 16 이면 중앙값 규모를 다 덮고 31개짜리에서만 임계값이 살아난다.
const LABEL_ALL_BELOW = 16
const thicknessFor = (weight) => Math.min(8, 1 + Math.sqrt(weight ?? 1) * 0.4)
const DECLARED_THICKNESS = 1.7 // Sigma minEdgeThickness 와 같은 바닥값. 시각적으로 짝을 맞춘다

let declaredEdges = []
let allEdges = [] // 팝오버의 "누가 몇 번 불렀는지" 내역용 원본. declaredEdges 는 그중 점선(declared)만 골라둔 것이다
let selectedNode = null
let hoveredNode = null
const activeNode = () => selectedNode || hoveredNode

const graph = new graphology.Graph()
let renderer = null // initGraphRenderer() 가 첫 buildGraph() 뒤에 채운다
let projects = [] // 사이드바 목록. 추가·제거 IPC 가 돌려주는 값으로 갈아 끼운다
let currentPath = null // 지금 보고 있는 프로젝트 경로. 목록이 바뀌어도 보던 것을 지키려고 둔다
let camera = null

// getComputedStyle().getPropertyValue() 는 커스텀 프로퍼티를 실제 색으로 안 풀어준다 — 값이
// `light-dark(#a, #b)` 함수 그대로 문자열로 돌아온다(실측). CSS 선언(background:var(...))에
// 쓰일 때는 브라우저가 알아서 풀지만, Canvas fillStyle/strokeStyle 은 light-dark() 를 아예 모르는
// 함수라 조용히 무시하고 이전 색(기본 검정)을 쓴다 — 그래서 그래프 노드가 새까맣게 나왔다.
// 시스템의 라이트/다크 설정을 직접 읽어 둘 중 하나를 뽑는다.
function resolveColor(name) {
  const raw = getComputedStyle(root).getPropertyValue(name).trim()
  const m = raw.match(/^light-dark\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/)
  if (!m) return raw
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? m[2] : m[1]
}

function colorForKind(kind) {
  if (kind === 'skill') return resolveColor('--ask-positive')
  if (kind === 'mcp') return resolveColor('--ask-orb-blue')
  return resolveColor('--ask-purple') // agent · project
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  const c = a.map((av, i) => Math.round(av + (b[i] - av) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

function drawNodeLabel(context, data, settings) {
  if (!data.label) return
  const size = settings.labelSize
  context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`
  context.textAlign = 'center'
  context.textBaseline = 'top'
  context.fillStyle = resolveColor(data.dim ? '--ask-faint' : '--ask-ink')
  context.globalAlpha = data.dim ? 0.55 : 1
  context.fillText(data.label, data.x, data.y + data.size + 4)
  context.globalAlpha = 1
}

// declared 엣지는 Sigma 그래프에 안 넣는다(실선으로만 그려져서). SVG 오버레이로 점선을 그린다 —
// ponytail: Sigma core 에 점선 엣지 프로그램이 없다. 커스텀 WebGL 셰이더를 새로 쓰는 대신
// 이미 네이티브로 점선을 지원하는 SVG 를 얇은 오버레이로 얹는다. declared 엣지는 실측상
// 드물다(저장소 29곳에서 8건) 이라 이 정도로 충분하다 — 늘어나면 커스텀 edge program 로 옮긴다.
function updateDeclaredEdges() {
  declaredSvg.innerHTML = ''
  if (!declaredEdges.length || !renderer) return
  const edgeColor = resolveColor('--ask-edge')
  const bg = resolveColor('--ask-bg')
  const selected = resolveColor('--ask-purple')
  const active = activeNode()
  const scale = 1 / camera.ratio // Sigma 노드/엣지와 같은 방식으로 줌에 맞춰 두께를 키운다
  for (const e of declaredEdges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue
    const a = graph.getNodeAttributes(e.source)
    const b = graph.getNodeAttributes(e.target)
    const p1 = renderer.graphToViewport({ x: a.x, y: a.y })
    const p2 = renderer.graphToViewport({ x: b.x, y: b.y })
    const touches = active && (e.source === active || e.target === active)
    const dim = active && !touches
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('x1', p1.x)
    line.setAttribute('y1', p1.y)
    line.setAttribute('x2', p2.x)
    line.setAttribute('y2', p2.y)
    line.setAttribute('stroke', dim ? lerpColor(edgeColor, bg, 0.8) : touches ? selected : edgeColor)
    line.setAttribute('stroke-width', ((touches ? 2 : DECLARED_THICKNESS) * scale).toFixed(2))
    line.setAttribute('stroke-dasharray', '5,4')
    line.setAttribute('stroke-linecap', 'round')
    declaredSvg.appendChild(line)
  }
}

function refreshAll() {
  if (!renderer) return
  renderer.refresh()
  updateDeclaredEdges()
}

function updateZoomReadout() {
  zoomLevelEl.textContent = `${Math.round(100 / camera.ratio)}%`
}

// ---------- 노드 선택 · 팝오버 ----------

function scopeLabel(kind, scope) {
  // project 는 "프로젝트"가 아니라 "메인 세션"이라고 말한다 — 팝오버가 서브에이전트·스킬·MCP
  // 와 나란히 뜨는 자리라, 이 노드가 사람이 직접 쓰는 세션이라는 걸 이름표로 바로 밝힌다.
  if (kind === 'project') return '메인 세션'
  const kindWord = { agent: '에이전트', skill: '스킬', mcp: 'MCP' }[kind] ?? kind
  const scopeWord = { repo: '저장소', global: '전역', plugin: '플러그인', builtin: '내장', unknown: null }[scope]
  return scopeWord ? `${scopeWord} ${kindWord}` : kindWord
}

// src/graph.mjs 의 MODEL_INHERITED·MODEL_UNSPECIFIED 와 같은 값이다. 그 파일을 렌더러가
// import 할 수 없어(node 내장 모듈을 쓰는 scan.mjs 를 물고 있다) 문자열로 다시 적는다 —
// PROJECT_NODE_ID 와 같은 사정.
const MODEL_INHERITED = 'model-inherited'
const MODEL_UNSPECIFIED = 'model-unspecified'
// MODEL_UNSPECIFIED 는 "알 수 없음"이 아니다. src/axes.mjs 의 model-explicit 축(scope:
// !isFork, violation: !model)이 위반으로 잡는 것과 정확히 같은 조건이라, "판정 못 함"이 아니라
// "model 파라미터를 안 적고 위임했다"는 사실이다. 실측(2026-09-01, 이 저장소): 전체 위임
// 1,052건 중 33건이 이 조건이고 전부 그 축의 위반이었다. "알 수 없음"이라고 쓰면 사용자가
// 자기 CLAUDE.md 규칙을 어긴 기록을 그냥 미상으로 읽고 넘어간다 — 그래서 무엇이 없었는지를
// 그대로 말한다. 겁주지 않되 사실은 숨기지 않는 평서문.
function modelName(model) {
  if (model === MODEL_INHERITED) return '호출 모델 상속'
  if (model === MODEL_UNSPECIFIED) return '모델 미명시'
  return prettyModelName(model)
}

// 상대 시각으로 줄인다("41분 전"·"3시간 전"·"4일 전", desktop/canvas/gen.py 목업과 같은 표현).
// 팝오버 통계 칸이 3열이던 시절엔 절대 시각(예: "2026. 9. 2. 오후 2:22")이 폭 안에 못 들어가
// 두 줄로 접혔다 — 상대 시각은 늘 한 줄이다. 절대 시각은 잃지 않고 title 속성으로 옮긴다
// (absoluteLastUsed, openPopover 에서 사용).
function lastUsedLabel(iso) {
  if (!iso) return '기록 없음'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '기록 없음'
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  return `${Math.floor(hr / 24)}일 전`
}

function absoluteLastUsed(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

// src/graph.mjs 의 PROJECT 상수와 같은 값이다. 그 파일을 렌더러가 import 할 수 없어(node
// 내장 모듈을 쓰는 scan.mjs 를 물고 있다) 문자열로 다시 적는다 — "누가 불렀는지" 내역에서
// project 를 사람이 읽을 말("메인 세션")로 바꿔 보여줄 때만 쓴다.
const PROJECT_NODE_ID = 'project'

// 프로젝트 노드 팝오버용. 사용자가 "메인 세션의 호출 횟수가 필요한 정보인가" 라고 물어서
// 뺐다(지시서 지침) — 대신 이 저장소의 하네스가 어떤 모양인지(에이전트·스킬·MCP 몇 개씩
// 쓰였는지)를 보여준다. 그래프를 보면 알 수 있는 걸 다시 세는 게 아니라, 지금 화면에 이미
// 그려진 노드를 그대로 센다. 카운트만 낸다 — "N 개 · N 개 · N 개" 한 줄로 합치는 건
// openPopover 가 renderNameCountList 로 줄바꿈해서 한다(지시서: 한 줄을 세 줄로 가르라).
function nodeComposition() {
  const counts = { agent: 0, skill: 0, mcp: 0 }
  graph.forEachNode((node, data) => {
    if (data.kind in counts) counts[data.kind]++
  })
  return counts
}

// 프로젝트 팝오버 하단의 "메인 세션이 모델별로 몇 개인지" 목록(정정 지시서, 2026-09-02).
// 사용자가 물은 것: "서브에이전트 관계없이 메인 세션을 뭐로 썼는지, 모델별로 몇 개의 세션을
// 썼는지" — 그래서 "N종류 · 이름들" 한 줄이 아니라 에이전트 모델 목록과 같은 "이름 — 수"
// 목록(renderNameCountList)으로 보여준다. src/graph.mjs 의 project 노드 sessionModelCounts
// 를 그대로 쓴다 — 그 필드는 이미 세션 단위로 접혀 있어(sessionModelDistribution 근거)
// MODEL_INHERITED·MODEL_UNSPECIFIED 같은 축 위반 값이 안 섞인다(그 값들은 위임 모델 개념이라
// 세션 모델과는 다른 축이다) — 여기서 따로 걸러낼 것이 없다.

// nodeId 로 들어오는 엣지(e.target === nodeId)를 source 별로 모은다. 스킬·MCP 팝오버의
// "누가 몇 번 불렀는지" 내역이 여기서 나온다(지시서: 엣지에서 구하라). relation:'declared' 는
// 호출이 아니라 선언이라 calls 가 null 이다 — 0 으로 뭉개지 않고 declaredOnly 로 따로 표시한다.
function callerBreakdown(nodeId) {
  return allEdges
    .filter((e) => e.target === nodeId)
    .map((e) => ({
      name: e.source === PROJECT_NODE_ID ? '메인 세션' : (graph.hasNode(e.source) ? graph.getNodeAttributes(e.source).label : e.source),
      calls: e.calls,
      declaredOnly: e.relation === 'declared',
    }))
}

// 총 호출 수 칸의 문구. 호출 기록이 하나도 없고 선언만 있으면(calls:0, 전부 declaredOnly)
// "0회"가 아니라 "기록 없음"이라고 말한다(CLAUDE.md 재는 규율 — 분모가 없다≠0). 어느
// 관계인지(선언만 됐다는 사실)는 그래프의 점선 엣지가 이미 말하고 있어 문구를 안 늘린다.
// 실제 호출이 하나라도 있으면 총합(attrs.calls)을 그대로 보여준다.
function callsSummary(attrs, callers) {
  if (attrs.calls === 0 && callers.length > 0 && callers.every((c) => c.declaredOnly)) {
    return '기록 없음'
  }
  return `${attrs.calls}회`
}

// "이름 — 횟수" 줄의 나열. 에이전트 팝오버의 모델별 호출 수, 스킬·MCP 팝오버의 호출 주체
// 내역, project 팝오버의 세션 모델 수가 같은 모양을 쓴다(지시서 지침 — 주체가 하나여도
// 그린다). target 을 안 주면 기본 목록(popoverCallers)에 그린다 — project 의 모델 목록은
// 구성 목록과 같은 자리에 못 그리니(둘 다 popoverCallers 를 쓰면 하나가 지운다)
// popoverModelList 를 따로 준다. items 가 비면 목록 자체를 숨긴다(위임 기록이 아예 없는
// declared 전용 에이전트, 또는 세션 모델 정보가 없는 프로젝트) — 없는 데이터를 빈 줄로
// 그리지 않는다. 넘칠 때는 목록을 늘리지 않고 스크롤로 받는다(index.html 의
// .ask-popover-callers 참고, 실측: 에이전트 모델은 많아야 셋, 스킬 호출 주체도 넷을 안
// 넘었다).
function renderNameCountList(items, target = popoverCallers) {
  target.innerHTML = ''
  if (!items.length) {
    target.hidden = true
    return
  }
  target.hidden = false
  for (const { name, label } of items) {
    const li = document.createElement('li')
    const count = document.createElement('span')
    count.textContent = label
    li.append(document.createTextNode(name), count)
    target.appendChild(li)
  }
}

// 프로토타입(desktop/askin-desktop-prototype.html)의 positionPopover() 를 그대로 옮긴다.
// 다른 점은 좌표 출처뿐이다 — 프로토타입은 CSS 로 배치된 DOM 버튼의 getBoundingClientRect() 를
// 읽고, 여기는 Sigma 캔버스 노드라 renderer.graphToViewport() 로 화면 좌표를 얻는다.
function positionPopover(nodeId) {
  const attrs = graph.getNodeAttributes(nodeId)
  const pt = renderer.graphToViewport({ x: attrs.x, y: attrs.y })
  const radius = (attrs.size ?? 6) / camera.ratio
  const mapRect = mapEl.getBoundingClientRect()
  const gap = 14
  popover.style.left = '0px'
  popover.style.top = '0px'
  const popRect = popover.getBoundingClientRect()
  let flip = false
  let top = pt.y - radius - gap - popRect.height
  if (top < 4) {
    flip = true
    top = pt.y + radius + gap
  }
  top = Math.max(4, Math.min(top, mapRect.height - popRect.height - 4))
  let left = pt.x - popRect.width / 2
  left = Math.max(4, Math.min(left, mapRect.width - popRect.width - 4))
  popover.dataset.flip = flip ? 'down' : 'up'
  popover.style.left = `${left}px`
  popover.style.top = `${top}px`
  const tailX = Math.max(10, Math.min(popRect.width - 10, pt.x - left))
  popover.style.setProperty('--ask-tail-x', `${tailX}px`)
}

// 팝오버는 종류마다 다른 것을 보여준다(지시서 지침 — 넷 다 같은 칸을 보여주던 것을 가른다).
//   project:   이름·"메인 세션"·노드 구성(에이전트 N·스킬 N·MCP N, 줄바꿈)·최근·하단에
//              모델별 세션 수 목록. 호출 수는 안 보여준다
//   agent:     이름·scope·모델별 호출 수 목록·호출 수·최근
//   skill/mcp: 이름·scope·호출 수(없으면 "기록 없음")·누가 몇 번 불렀는지 내역·최근
function openPopover(nodeId) {
  selectedNode = nodeId
  const attrs = graph.getNodeAttributes(nodeId)
  popoverName.textContent = attrs.label
  popoverType.textContent = scopeLabel(attrs.kind, attrs.scope)
  popoverLast.textContent = lastUsedLabel(attrs.lastUsed)
  popoverLast.title = absoluteLastUsed(attrs.lastUsed)

  if (attrs.kind === 'project') {
    // node.calls(project) 는 메인 세션이 직접 부른 횟수일 뿐이라 "프로젝트 전체 호출 수"로
    // 오해되기 쉬웠다(실측: 이 저장소에서 project 자체는 128회인데 서브에이전트가 부른
    // mcp:playwright 는 207회로 더 크다). 오해를 설명으로 덮는 대신 아예 안 보여주고, 그
    // 자리에 이 하네스의 노드 구성을 보여준다 — 그래프를 보면 알 수 있는 것과 같은 정보다.
    // "에이전트 N · 스킬 N · MCP N" 한 줄이던 것을 세 줄로 가른다(지시서, 2026-09-02) —
    // 에이전트 모델 목록·스킬 호출 주체 목록과 같은 "이름 — 수" 모양이라 renderNameCountList
    // 를 그대로 재사용한다.
    const composition = nodeComposition()
    popoverCallsLabel.textContent = '구성'
    popoverCalls.textContent = `${composition.agent + composition.skill + composition.mcp}개`
    renderNameCountList([
      { name: '에이전트', label: `${composition.agent}개` },
      { name: '스킬', label: `${composition.skill}개` },
      { name: 'MCP', label: `${composition.mcp}개` },
    ])
    // 하단에 메인 세션이 모델별로 몇 개인지(정정 지시서, 2026-09-02). renderNameCountList 의
    // 근거는 위 함수 주석 참고 — sessionModelCounts 가 비면(세션 모델 정보가 아예 없다)
    // 목록이 알아서 숨는다.
    const sessionModels = attrs.sessionModelCounts ?? []
    popoverModelSummary.hidden = sessionModels.length === 0
    renderNameCountList(
      sessionModels.map((m) => ({ name: modelName(m.model), label: `${m.count}개` })),
      popoverModelList,
    )
  } else if (attrs.kind === 'agent') {
    popoverCallsLabel.textContent = '호출'
    popoverCalls.textContent = `${attrs.calls}회`
    renderNameCountList((attrs.modelCounts ?? []).map((m) => ({ name: modelName(m.model), label: `${m.count}회` })))
    popoverModelSummary.hidden = true
  } else {
    popoverCallsLabel.textContent = '호출'
    const callers = callerBreakdown(nodeId)
    popoverCalls.textContent = callsSummary(attrs, callers)
    renderNameCountList(callers.map((c) => ({ name: c.name, label: c.declaredOnly ? '기록 없음' : `${c.calls}회` })))
    popoverModelSummary.hidden = true
  }

  popover.hidden = false
  positionPopover(nodeId)
  refreshAll()
}

function closePopover() {
  if (popover.hidden) return
  popover.hidden = true
  selectedNode = null
  refreshAll()
}

popoverClose.addEventListener('click', () => closePopover())
popover.addEventListener('click', (event) => event.stopPropagation())
// Sigma 는 캔버스라 stopPropagation 을 걸 노드가 없다 — 클릭 한 번이 Sigma 의 clickNode(팝오버를
// 염)와 이 document 핸들러(닫음) 둘 다에 닿아서 열자마자 닫혔다(실측: 실제 마우스 클릭으로만
// 재현됐다 — openPopover() 를 직접 부르는 스크린샷 모드는 이 클릭 경로를 안 타서 못 잡았다).
// mapEl(그래프 영역) 안의 클릭은 Sigma 의 clickNode/clickStage 가 이미 열고 닫는 걸 다 맡고
// 있으니, 여기서는 그 바깥(사이드바·패널 등) 클릭만 닫는다.
document.addEventListener('click', (event) => {
  if (mapEl.contains(event.target)) return
  closePopover()
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePopover()
})
zoomOutBtn.addEventListener('click', () => camera && camera.animatedUnzoom({ duration: 200 }))
zoomInBtn.addEventListener('click', () => camera && camera.animatedZoom({ duration: 200 }))

// ---------- 패널 폭 드래그 ----------
// 사이드바 ↔ 메인, 메인 ↔ 채팅 사이의 핸들로 폭을 바꾼다. 메인(그래프) 패널의 최소 폭은
// .ask-layout 의 grid-template-columns 자체(minmax(320px, ...))가 지킨다 — 여기 JS 는
// 사이드바·채팅 두 폭만 계산해서 CSS 변수로 밀어 넣으면, 남는 칸(1fr)이 알아서 그 최소를 지킨다.
const layoutEl = document.querySelector('.ask-layout')
const sidebarEl = document.querySelector('.ask-sidebar')
const chatEl = document.querySelector('.ask-chat-panel')
const HANDLE_W = 8 // index.html 의 grid-template-columns 리터럴과 같은 값(desktop/tokens.md --shell-gap)
const MAIN_MIN = 320 // index.html 의 minmax(320px, ...) 와 같은 값. 근거는 그 규칙의 주석 참고
const PANEL_LIMITS = {
  // 160: 기본값(200~220px, desktop/tokens.md)의 약 4분의 3. 사이드바 행은 이름이 길면 어차피
  // ellipsis 로 잘리므로 더 좁아져도 레이아웃이 안 깨지지만, 브랜드 마크 + "문서" 배지가
  // 서로 겹치기 시작하는 지점 아래로는 안 내려가게 여기서 멈췄다. 360: 사이드바가 메인 그래프
  // 폭을 눈에 띄게 잠식하지 않는 선.
  sidebar: { min: 160, max: 360, storageKey: 'askin.sidebarWidth', cssVar: '--ask-sidebar-w' },
  // 220: 입력 영역(.ask-composer-box, 전송 버튼 40px 포함)이 다음 줄로 안 깨지는 폭. 420:
  // 로컬 채팅 패널이 메인 그래프보다 넓어지지 않는 선.
  chat: { min: 220, max: 420, storageKey: 'askin.chatWidth', cssVar: '--ask-chat-w' },
}

function panelEl(kind) {
  return kind === 'sidebar' ? sidebarEl : chatEl
}

// CSS 변수를 아직 아무도 안 건드렸으면(드래그 전) var() 폴백이 그려낸 실제 렌더 폭을 그대로
// "지금 폭"으로 쓴다 — 920px 미만/이상 미디어쿼리가 다른 기본값을 쓰므로 상수로 가정하면 안 된다.
function currentWidth(kind) {
  const raw = getComputedStyle(root).getPropertyValue(PANEL_LIMITS[kind].cssVar).trim()
  if (raw) return parseFloat(raw)
  return panelEl(kind).getBoundingClientRect().width
}

function applyWidth(kind, px) {
  const { min, max, cssVar } = PANEL_LIMITS[kind]
  const otherKind = kind === 'sidebar' ? 'chat' : 'sidebar'
  const containerWidth = layoutEl.clientWidth
  // 메인이 최소 폭 아래로 안 눌리게, 드래그 중인 쪽의 상한을 "컨테이너 - 반대쪽 폭 - 메인 최소값"
  // 으로도 같이 잡는다.
  const ceilingForMain = containerWidth - currentWidth(otherKind) - HANDLE_W * 2 - MAIN_MIN
  const clamped = Math.max(min, Math.min(max, ceilingForMain, px))
  root.style.setProperty(cssVar, `${clamped}px`)
  return clamped
}

function saveWidth(kind, px) {
  try {
    localStorage.setItem(PANEL_LIMITS[kind].storageKey, String(px))
  } catch {
    // 프라이빗 모드 등에서 localStorage 가 막혀 있을 수 있다 — 폭 기억을 못 해도 앱은 계속 써야 한다
  }
}

function restoreWidths() {
  for (const kind of Object.keys(PANEL_LIMITS)) {
    let stored
    try {
      stored = localStorage.getItem(PANEL_LIMITS[kind].storageKey)
    } catch {
      stored = null
    }
    const n = Number(stored)
    if (stored != null && Number.isFinite(n)) applyWidth(kind, n)
  }
}

// Sigma 는 컨테이너 크기 변화를 스스로 안 본다(위 initGraphRenderer 의 ResizeObserver 참고) —
// 그 배선이 이미 mapEl 을 관찰하고 있어서, 드래그로 메인 패널 폭이 바뀌면 mapEl 도 같이
// 바뀌어 같은 ResizeObserver 가 resize()+refresh() 를 그대로 불러준다. 여기서 새로 만들 건
// 폭 계산과 저장뿐이다.
function setupResizeHandle(kind, handleEl) {
  handleEl.addEventListener('mousedown', (downEvent) => {
    downEvent.preventDefault()
    const startX = downEvent.clientX
    const startWidth = currentWidth(kind)
    handleEl.classList.add('is-dragging')
    const onMove = (moveEvent) => {
      // sidebar 핸들은 오른쪽으로 끌면 사이드바가 넓어지고, chat 핸들은 왼쪽으로 끌면(핸들
      // 기준 반대 방향) 채팅이 넓어진다 — 각자 옆에 있는 패널 쪽으로 끄는 방향이 곧 늘리는 방향이다.
      const delta = kind === 'sidebar' ? moveEvent.clientX - startX : startX - moveEvent.clientX
      applyWidth(kind, startWidth + delta)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      handleEl.classList.remove('is-dragging')
      saveWidth(kind, currentWidth(kind))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
  handleEl.addEventListener('keydown', (event) => {
    const STEP = 12
    let dir = 0
    if (event.key === 'ArrowLeft') dir = -1
    else if (event.key === 'ArrowRight') dir = 1
    else return
    event.preventDefault()
    // 위 mousedown 핸들러와 같은 방향 규칙(핸들이 그 방향으로 "움직인다"고 생각한다).
    const delta = (kind === 'sidebar' ? dir : -dir) * STEP
    const next = applyWidth(kind, currentWidth(kind) + delta)
    saveWidth(kind, next)
    handleEl.setAttribute('aria-valuenow', String(Math.round(next)))
  })
}

setupResizeHandle('sidebar', document.getElementById('ask-resize-sidebar'))
setupResizeHandle('chat', document.getElementById('ask-resize-chat'))
restoreWidths()

// ---------- 그래프 데이터 로드 · 배치 ----------

function buildGraph(data) {
  graph.clear()
  declaredEdges = []
  allEdges = data.edges
  closePopover()
  selectedNode = null
  hoveredNode = null
  for (const n of data.nodes) {
    const base = sizeFor(n.calls)
    const size = n.kind === 'project' ? Math.max(base, PROJECT_MIN_SIZE) : base
    graph.addNode(n.id, {
      label: n.name,
      kind: n.kind,
      scope: n.scope,
      model: n.model,
      modelInherited: n.modelInherited,
      modelCounts: n.modelCounts,
      sessionModelCounts: n.sessionModelCounts,
      calls: n.calls,
      lastUsed: n.lastUsed,
      size,
      x: n.x,
      y: n.y,
    })
  }
  for (const e of data.edges) {
    if (e.relation === 'declared') {
      declaredEdges.push(e)
      continue
    }
    if (graph.hasEdge(e.source, e.target) || e.source === e.target) continue
    graph.addEdge(e.source, e.target, { size: thicknessFor(e.calls) })
  }
  graphMetaEl.textContent = `노드 ${data.nodes.length}개 · 연결 ${data.edges.length}개`
}

// graph 에 노드가 이미 있는 상태에서 딱 한 번 부른다(위 상단 설명 참고). Sigma 생성자가 그
// 시점의 그래프 범위로 카메라를 맞추기 때문에, 나중에 채우면 카메라가 안 따라온다(실측).
function initGraphRenderer() {
  renderer = new Sigma(graph, sigmaContainer, {
    defaultDrawNodeLabel: drawNodeLabel,
    // Sigma 는 호버용 렌더러가 따로 있다(defaultDrawNodeHover). 안 덮으면 호버할 때마다
    // 기본 위치(노드 오른쪽)에 라벨을 하나 더 그린다 — 프로브 실측.
    defaultDrawNodeHover: drawNodeLabel,
    labelRenderedSizeThreshold: 8,
    labelDensity: 1,
    renderEdgeLabels: false,
    // Sigma 기본값(1.7) 아래로 내리면 대부분의 엣지가 서브픽셀이 되어 안 보인다(프로브 실측).
    minEdgeThickness: 1.7,
    zIndex: true,
  })
  camera = renderer.getCamera()

  renderer.setSetting('nodeReducer', (node, data) => {
    const res = { ...data }
    res.color = colorForKind(data.kind)
    res.dim = false
    if (data.kind === 'project') res.forceLabel = true // 호출 수와 무관하게 항상 라벨을 띄운다
    // 노드가 적으면 전부 이름을 띄운다. labelRenderedSizeThreshold 는 노드가 많아 라벨이
    // 서로 겹칠 때 쓸 규칙인데, 실측(2026-09-02)으로 저장소 20곳의 노드 수 중앙값이 6.5 라
    // 대부분의 그래프에서 그 규칙이 이름을 지우기만 한다. harness-bro(노드 9)에서 스킬
    // 다섯이 이름 없는 점으로 떴다. 이름 없는 점은 그래프가 아니다.
    if (graph.order <= LABEL_ALL_BELOW) res.forceLabel = true
    const active = activeNode()
    if (active) {
      if (node === active) {
        res.zIndex = 2
        res.forceLabel = true
      } else if (graph.areNeighbors(node, active)) {
        res.zIndex = 1
        res.forceLabel = true
      } else if (data.kind !== 'project') {
        res.dim = true
        res.zIndex = 0
      }
    }
    return res
  })

  renderer.setSetting('edgeReducer', (edge, data) => {
    const res = { ...data }
    const edgeColor = resolveColor('--ask-edge')
    const bg = resolveColor('--ask-bg')
    const selected = resolveColor('--ask-purple')
    res.color = edgeColor
    const active = activeNode()
    if (active) {
      const [s, t] = graph.extremities(edge)
      if (s === active || t === active) {
        res.color = selected
        res.zIndex = 1
      } else {
        res.color = lerpColor(edgeColor, bg, 0.8)
        res.zIndex = 0
      }
    }
    return res
  })

  camera.on('updated', () => {
    updateZoomReadout()
    updateDeclaredEdges()
    if (!popover.hidden) positionPopover(activeNode())
  })

  const ro = new ResizeObserver(() => {
    // resize() 만으로는 다음 마우스 이벤트까지 캔버스가 비어 보인다(프로브 실측) — refresh() 도 같이 부른다.
    renderer.resize()
    renderer.refresh()
    updateDeclaredEdges()
    if (!popover.hidden) positionPopover(activeNode())
  })
  ro.observe(mapEl)

  renderer.on('clickNode', ({ node }) => {
    if (selectedNode === node && !popover.hidden) {
      closePopover()
      return
    }
    openPopover(node)
  })
  renderer.on('clickStage', () => closePopover())
  renderer.on('enterNode', ({ node }) => {
    hoveredNode = node
    refreshAll()
  })
  renderer.on('leaveNode', () => {
    hoveredNode = null
    refreshAll()
  })

  updateZoomReadout()
}

function markActiveProject(buttonEl) {
  for (const btn of projectsEl.querySelectorAll('.ask-project')) {
    const isCurrent = btn === buttonEl
    btn.classList.toggle('is-current', isCurrent)
    if (isCurrent) btn.setAttribute('aria-current', 'page')
    else btn.removeAttribute('aria-current')
  }
}

// 프로젝트를 바꿀 때(사이드바 클릭). Sigma 는 이미 살아 있다 — 프로브의 switchTo() 와 같은
// clear+rebuild+animatedReset 패턴이다.
async function selectProject(project, buttonEl) {
  markActiveProject(buttonEl)
  currentPath = project.path
  graphTitleEl.textContent = `${project.name}의 하네스 연결`
  const data = await window.askin.loadGraph(project.path)
  buildGraph(data)
  // 첫 프로젝트를 고르는 순간이 Sigma 를 만들 유일한 때다. 목록이 비어 시작할 수 있게 되면서
  // (프로젝트를 추가해야 뭐가 생긴다) main() 이 아니라 여기가 그 자리가 됐다 — 빈 그래프로
  // 먼저 만들면 카메라가 좌표계를 못 맞춘다(파일 상단 설명).
  if (!renderer) initGraphRenderer()
  refreshAll()
  await camera.animatedReset()

  // 레포트는 그래프보다 오래 걸린다(실측 545ms ~ 5.4초). 그래프를 먼저 보여주고 뒤따른다.
  clearReport('분석 레포트를 재는 중이에요…')
  const asked = project.path
  const report = await window.askin.loadReport(project.path)
  // 재는 동안 사용자가 프로젝트를 바꿨으면 늦게 온 레포트를 붙이지 않는다.
  if (currentPath !== asked) return
  renderReport(report)
}

// ---------- 분석 레포트 ----------
//
// 첫 화면은 "아쉬운 점" 카드만 말한다. 축·분모·판정 불가 이유는 세부 분석 안에 둔다
// (desktop/design-concept.md:348). 표시 문자열은 main.mjs 가 다 만들어 보낸다 — 렌더러는
// 그 문자열을 DOM 에 앉히기만 한다. 판정(반올림·퍼센트 계산·"판정 불가"인지)을 여기서
// 다시 하면 화면과 터미널이 다른 말을 하게 된다(CLAUDE.md: 같은 판정을 두 곳에 두지 않는다).

// 사용자 파일 경로·전사 원문이 그대로 들어올 수 있는 값이라 textContent 로만 채운다.
// innerHTML 조립 중 실수로 태그가 섞여 들어가는 것을 막는 값 이스케이프.
function esc(value) {
  const div = document.createElement('div')
  div.textContent = String(value ?? '')
  return div.innerHTML
}

function summaryTile(label, value, sub) {
  const div = document.createElement('div')
  div.className = 'ask-sum-tile'
  const l = document.createElement('div')
  l.className = 'ask-sum-label'
  l.textContent = label
  const v = document.createElement('div')
  v.className = 'ask-sum-value'
  v.textContent = value
  const s = document.createElement('div')
  s.className = 'ask-sum-sub'
  s.textContent = sub
  div.append(l, v, s)
  return div
}

// 다섯 칸. 서로 더하지 않는다(desktop/canvas/gen.py SUMMARY_DEFAULT 와 같은 결).
function buildSummaryTiles(inv) {
  const tiles = []
  tiles.push(summaryTile('규칙 문서', String(inv.docs.total), `이 저장소 ${inv.docs.repo} · 전역 ${inv.docs.global}`))
  tiles.push(summaryTile('에이전트 정의', String(inv.agents.total), `전역 ${inv.agents.global} · 호출 ${inv.agents.calls}회`))
  tiles.push(
    summaryTile(
      '쓴 스킬',
      String(inv.skills.used),
      `플러그인 ${inv.skills.usedByScope.plugin} · 내장 ${inv.skills.usedByScope.builtin} · 전역 정의 ${inv.skills.definedByScope.global}개 중 ${inv.skills.usedByScope.global}`,
    ),
  )
  tiles.push(
    summaryTile(
      '쓴 MCP',
      String(inv.mcp.used),
      inv.mcp.top ? `호출 ${inv.mcp.calls}회 · ${inv.mcp.top.name} ${inv.mcp.top.calls}` : inv.mcp.used ? `호출 ${inv.mcp.calls}회` : '기록 없음',
    ),
  )
  // 훅 기록이 없으면(hooks:null) 0회가 아니라 판정 불가다 — 분모가 비면 예외 없이 판정
  // 불가라는 CLAUDE.md 재는 규율이 요약 띠에도 그대로 적용된다.
  tiles.push(
    summaryTile('훅 실행', inv.hooks ? inv.hooks.runs.toLocaleString('ko-KR') : '판정 불가', inv.hooks ? `이벤트 ${inv.hooks.events}종 · 실패 ${inv.hooks.fail}` : '훅 기록 없음'),
  )
  return tiles
}

function muteAxisRow(cls, label, why) {
  const li = document.createElement('li')
  li.className = `ask-axis-item ${cls} is-muted`
  li.innerHTML =
    `<div class="ask-axis-row"><span class="ask-axis-name">${esc(label)}</span><span class="ask-axis-value">판정 불가</span></div>` +
    `<p class="ask-axis-why">${esc(why)}</p>`
  return li
}

// 규칙 줄(rule_row). 목표가 100% 라 미터를 그린다. 위반이 있으면 is-warn.
function ruleRowEl(row) {
  if (row.shown === null) return muteAxisRow('ask-rule', row.label, row.note)
  const li = document.createElement('li')
  li.className = `ask-axis-item ask-rule${row.warn ? ' is-warn' : ''}`
  const pct = Math.round((row.rate ?? 0) * 100)
  li.innerHTML =
    `<div class="ask-axis-row"><span class="ask-axis-name">${esc(row.label)}</span><span class="ask-axis-value">${esc(row.shown)}</span></div>` +
    `<div class="ask-meter" role="img" aria-label="${pct}%"><i style="width:${pct}%"></i></div>` +
    `<p class="ask-axis-why">${esc(row.note)}</p>`
  return li
}

// 관찰값 줄(habit_row). 목표가 없다. 값·표본·설명·(있으면) 내역과 추천을 그대로 편다.
function habitRowEl(row) {
  if (row.shown === null) return muteAxisRow('ask-habit', row.label, row.note)
  const li = document.createElement('li')
  li.className = 'ask-axis-item ask-habit'
  let html =
    `<div class="ask-axis-row"><span class="ask-axis-name">${esc(row.label)}</span>` +
    `<span class="ask-axis-value">${esc(row.shown)} <small>· 표본 ${row.n ?? 0}</small></span></div>` +
    `<p class="ask-habit-note">${esc(row.note ?? '')}</p>`
  if (row.detail && Object.keys(row.detail).length) {
    html += `<ul class="ask-axis-detail">${Object.entries(row.detail)
      .map(([k, v]) => `<li><span>${esc(k)}</span><span>${esc(v)}</span></li>`)
      .join('')}</ul>`
  }
  if (row.recommend) html += `<p class="ask-habit-rec"><b>추천</b>${esc(row.recommend)}</p>`
  li.innerHTML = html
  return li
}

// 건수 줄(count_row). 0건도 그대로 적는다 — 잡을 수 있는 증상이 무엇인지가 이 줄의 몫이다.
function countRowEl(row) {
  const li = document.createElement('li')
  li.className = `ask-axis-item${row.muted ? ' is-muted' : ''}`
  const up = row.up ? '<span class="ask-chip is-up">아쉬운 점</span>' : ''
  li.innerHTML =
    `<div class="ask-axis-row"><span class="ask-axis-name">${esc(row.label)}${up}</span><span class="ask-axis-value">${esc(row.value)}</span></div>` +
    (row.note ? `<p class="ask-axis-why">${esc(row.note)}</p>` : '')
  return li
}

// 세부 분석 카드 하나(detail_card). 줄이 하나도 없으면(아직 재지 않는 축) 흐린 한 줄을 둔다 —
// 없는 숫자를 만들지 않는다.
function detailCardEl(card) {
  const section = document.createElement('section')
  section.className = 'ask-detail-section'
  if (card.fullWidth) section.style.gridColumn = '1 / -1'
  const h4 = document.createElement('h4')
  h4.textContent = card.title
  for (const src of card.sources ?? []) {
    const badge = document.createElement('span')
    badge.className = `ask-src is-${src.toLowerCase()}`
    badge.textContent = src
    h4.append(badge)
  }
  section.append(h4)
  if (card.summary) {
    const p = document.createElement('p')
    p.className = 'ask-section-sum'
    p.textContent = card.summary
    section.append(p)
  }
  const ul = document.createElement('ul')
  ul.className = 'ask-axis-list'
  if (!card.rows.length) {
    const li = document.createElement('li')
    li.className = 'ask-axis-item is-muted'
    li.innerHTML = '<p class="ask-axis-why">아직 재지 않아요</p>'
    ul.append(li)
  } else {
    for (const row of card.rows) {
      if (row.type === 'rule') ul.append(ruleRowEl(row))
      else if (row.type === 'habit') ul.append(habitRowEl(row))
      else ul.append(countRowEl(row))
    }
  }
  section.append(ul)
  if (card.footnote) {
    const p = document.createElement('p')
    p.className = 'ask-footnote'
    p.textContent = card.footnote
    section.append(p)
  }
  return section
}

// 아쉬운 점 카드 하나(weak_card). 칩(층·범위·확실성) → 제목 → 근거 → (주의) → 추천 → 행동.
function weakCardEl(card) {
  const article = document.createElement('article')
  article.className = 'ask-finding ask-weak'

  const kicker = document.createElement('div')
  kicker.className = 'ask-finding-kicker ask-chips'
  const chipTier = document.createElement('span')
  chipTier.className = 'ask-chip is-tier'
  chipTier.textContent = card.tier
  const chipScope = document.createElement('span')
  chipScope.className = 'ask-chip'
  chipScope.textContent = card.scope
  const chipSure = document.createElement('span')
  chipSure.className = `ask-chip${card.sure === '확인 필요' ? ' is-check' : ''}`
  chipSure.textContent = card.sure
  kicker.append(chipTier, chipScope, chipSure)

  const h3 = document.createElement('h3')
  h3.textContent = card.title

  const evidence = document.createElement('div')
  evidence.className = 'ask-evidence'
  for (const line of card.evidence) {
    const d = document.createElement('div')
    d.textContent = line
    evidence.append(d)
  }

  article.append(kicker, h3, evidence)

  if (card.caution) {
    const p = document.createElement('p')
    p.className = 'ask-caution'
    p.textContent = card.caution
    article.append(p)
  }

  const rec = document.createElement('p')
  rec.className = 'ask-recommend'
  const b = document.createElement('b')
  b.textContent = '추천'
  rec.append(b, document.createTextNode(card.recommend))
  article.append(rec)

  const actions = document.createElement('div')
  actions.className = 'ask-finding-actions'

  const copyBtn = document.createElement('button')
  copyBtn.className = 'ask-secondary'
  copyBtn.type = 'button'
  copyBtn.textContent = '지시서 복사'
  // 채팅 패널이 아직 없어서 "채팅에서 고치기" 대신 지시서를 클립보드에 담아 사용자가
  // 직접 붙여넣게 한다(지시서 지침). 눌렀다는 걸 2초짜리 라벨 바뀜으로만 알린다.
  copyBtn.addEventListener('click', async () => {
    const markdown = await window.askin.coachHandoff(currentPath, card.id)
    try {
      await navigator.clipboard.writeText(markdown)
    } catch (e) {
      console.error('클립보드에 못 썼다', e)
    }
    const original = copyBtn.textContent
    copyBtn.textContent = '복사됨'
    copyBtn.disabled = true
    setTimeout(() => {
      copyBtn.textContent = original
      copyBtn.disabled = false
    }, 2000)
  })

  const dismissBtn = document.createElement('button')
  dismissBtn.className = 'ask-quiet ask-dismiss'
  dismissBtn.type = 'button'
  dismissBtn.textContent = '문제 아님'
  dismissBtn.addEventListener('click', async () => {
    dismissBtn.disabled = true
    await window.askin.coachIgnore(currentPath, card.id)
    const report = await window.askin.loadReport(currentPath)
    renderReport(report)
  })

  actions.append(copyBtn, dismissBtn)
  article.append(actions)
  return article
}

function renderReport(report) {
  findingsHeadingEl.hidden = false
  detailsToggle.hidden = false
  reportPeriodEl.textContent = report.periodLabel
  weakCountEl.textContent = String(report.cards.length)
  weakMetaEl.textContent = `지키는 규칙 ${report.passing} · 판정 불가 ${report.unjudged} ›`

  findingsEl.innerHTML = ''
  if (!report.cards.length) {
    const p = document.createElement('p')
    p.className = 'ask-findings-empty'
    // 0장이 "깨끗하다"인지 "볼 문서가 없다"인지 가른다. 하네스 문서가 없으면 죽은 경로도
    // 모순 후보도 애초에 못 찾는다(CLAUDE.md: 분모가 비면 판정 불가다).
    p.textContent = report.basis.docs ? '지금은 고칠 것이 없어요' : '하네스 문서가 없어서 아직 볼 것이 없어요'
    findingsEl.append(p)
  } else {
    for (const card of report.cards) findingsEl.append(weakCardEl(card))
  }

  detailsGridEl.innerHTML = ''
  for (const card of report.details) detailsGridEl.append(detailCardEl(card))

  summaryEl.innerHTML = ''
  for (const tile of buildSummaryTiles(report.inventory)) summaryEl.append(tile)
}

// 레포트가 아직 없거나(재는 중) 볼 프로젝트가 없을 때.
function clearReport(message) {
  findingsHeadingEl.hidden = true
  detailsToggle.hidden = true
  detailsEl.classList.remove('is-open')
  detailsToggle.setAttribute('aria-expanded', 'false')
  detailsSymbol.textContent = '＋'
  findingsEl.innerHTML = ''
  weakCountEl.textContent = ''
  weakMetaEl.textContent = ''
  reportPeriodEl.textContent = ''
  detailsGridEl.innerHTML = ''
  summaryEl.innerHTML = ''
  if (message) {
    const p = document.createElement('p')
    p.className = 'ask-findings-empty'
    p.textContent = message
    findingsEl.append(p)
  }
}

detailsToggle.addEventListener('click', () => {
  const open = detailsEl.classList.toggle('is-open')
  detailsToggle.setAttribute('aria-expanded', String(open))
  detailsSymbol.textContent = open ? '−' : '＋'
  detailsToggle.lastChild.textContent = open ? ' 세부 분석 접기' : ' 세부 분석 펼치기'
})

// 목록이 비었을 때(처음 켰거나 마지막 하나를 뺐을 때). 그래프를 비우고 무엇을 해야 하는지 쓴다.
function showNoProject() {
  currentPath = null
  graphTitleEl.textContent = '그래프'
  buildGraph({ nodes: [], edges: [] })
  graphMetaEl.textContent = '' // buildGraph 가 "노드 0개 · 연결 0개"를 쓰고 끝나서 그 뒤에 비운다
  refreshAll()
  clearReport(null)
}

function projectButton(repoPath) {
  return projectsEl.querySelector(`.ask-project[data-path="${CSS.escape(repoPath)}"]`)
}

// 목록을 다시 그리고, 고를 것이 있으면 하나를 고른다. 추가·제거 뒤에 부른다.
async function applyProjects(next, preferPath = null) {
  projects = next
  renderProjectList(projects)
  const pick = projects.find((p) => p.path === preferPath) ?? projects.find((p) => p.path === currentPath) ?? projects[0]
  if (!pick) {
    showNoProject()
    return
  }
  await selectProject(pick, projectButton(pick.path))
}

async function onAddProject() {
  addProjectBtn.disabled = true // 폴더 고르기 창이 떠 있는 동안 두 번 눌리지 않게
  try {
    const { projects: next, added } = await window.askin.addProject()
    await applyProjects(next, added)
  } finally {
    addProjectBtn.disabled = false
  }
}

async function onRemoveProject(project) {
  const { projects: next } = await window.askin.removeProject(project.path)
  // 지운 것이 지금 보고 있던 것이면 currentPath 를 놓아준다 — 안 그러면 applyProjects 가
  // 이제 목록에 없는 경로를 다시 고르려 든다.
  if (currentPath === project.path) currentPath = null
  await applyProjects(next)
}

function renderProjectList(list) {
  projectsEl.innerHTML = ''
  if (!list.length) {
    const empty = document.createElement('div')
    empty.className = 'ask-sidebar-empty'
    empty.textContent = '아래에서 프로젝트를 추가해요'
    projectsEl.appendChild(empty)
    return
  }
  for (const project of list) {
    const row = document.createElement('div')
    row.className = 'ask-project-row'
    const btn = document.createElement('button')
    btn.className = 'ask-project'
    btn.type = 'button'
    btn.dataset.path = project.path
    btn.title = project.path // 이름만으로는 같은 이름의 다른 저장소를 못 가른다
    const mark = document.createElement('span')
    mark.className = 'ask-project-mark'
    mark.setAttribute('aria-hidden', 'true')
    const name = document.createElement('span')
    name.className = 'ask-project-name'
    name.textContent = project.name
    btn.append(mark, name)
    if (project.hasHarness) {
      const doc = document.createElement('span')
      doc.className = 'ask-project-harness'
      doc.textContent = '문서'
      doc.title = 'CLAUDE.md 또는 AGENTS.md 가 있어요'
      btn.append(doc)
    }
    btn.addEventListener('click', () => selectProject(project, btn))
    const remove = document.createElement('button')
    remove.className = 'ask-project-remove'
    remove.type = 'button'
    remove.textContent = '×'
    remove.setAttribute('aria-label', `${project.name} 목록에서 빼기`)
    remove.title = '목록에서 빼기 (폴더는 그대로 있어요)'
    remove.addEventListener('click', () => onRemoveProject(project))
    row.append(btn, remove)
    projectsEl.appendChild(row)
  }
}

async function main() {
  addProjectBtn.addEventListener('click', onAddProject)
  projects = await window.askin.listProjects()
  renderProjectList(projects)

  const requestedPath = params.get('project')
  const initial = projects.find((p) => p.path === requestedPath) ?? projects[0]
  if (initial) {
    // selectProject 안에 initGraphRenderer 와 animatedReset 이 들어 있다. animatedReset() 은
    // 애니메이션이 끝나야 resolve 되는 프로미스다 — await 없이 넘어가면(스크린샷 모드에서 실측)
    // 카메라가 여전히 기본값(0.5,0.5,ratio 1)인 중간 프레임을 찍어버린다.
    await selectProject(initial, projectButton(initial.path))
  } else {
    // 목록이 비었어도 여기서 빠져나가지 않는다. 아래 shot 모드 신호까지 가야 스크린샷 검증이
    // 빈 상태를 찍고 끝낼 수 있다 — 중간에 return 하면 창이 안 닫히고 매달린다.
    showNoProject()
  }

  if (isShotMode) {
    // openPopover() 를 여기서 직접 부르지 않는다. 실제 클릭 경로(Sigma clickNode → document
    // 클릭 버블링)를 안 타서 "열자마자 닫히는" 버그를 스크린샷 검증이 못 잡았다(실측). 대신
    // 노드의 창 좌표만 계산해 내주고, 진짜 클릭은 main.mjs 가 sendInputEvent 로 보낸다.
    window.__askinNodePoint = (nodeId) => {
      if (!renderer || !graph.hasNode(nodeId)) return null
      const attrs = graph.getNodeAttributes(nodeId)
      const pt = renderer.graphToViewport({ x: attrs.x, y: attrs.y })
      const mapRect = mapEl.getBoundingClientRect() // graphToViewport 는 mapEl 기준 좌표라(실측) 창 좌표로 옮긴다
      return { x: mapRect.left + pt.x, y: mapRect.top + pt.y }
    }
    document.title = 'askin:ready'
  }
}

window.addEventListener('error', (e) => console.error('renderer error', e.message, e.filename, e.lineno))
window.addEventListener('unhandledrejection', (e) => console.error('renderer unhandled rejection', e.reason))
window.addEventListener('load', () => {
  main().catch((e) => console.error('main() failed', (e && e.stack) || e))
})
