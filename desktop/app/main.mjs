// askin 데스크톱 앱의 메인 프로세스. 사이드바(프로젝트 목록) · 메인 패널의 하네스 연결
// 그래프 · 분석 레포트(내 하네스 요약 띠 + 아쉬운 점 카드 + 세부 분석 여덟 카드)를 그린다.
// 채팅 패널은 아직 자리만 있다.
//
// 여기가 src/graph.mjs · src/scan.mjs · src/refs.mjs · src/report.mjs · src/fix.mjs 를 직접
// import 하는 유일한 곳이다. 렌더러(index.html)는 nodeIntegration:false 라 이 파일들을 못
// 읽는다 — IPC 일곱으로만 오간다(projects:list · projects:add · projects:remove · graph:load ·
// report:load · coach:handoff · coach:ignore).

import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import { harnessGraph } from '../../src/graph.mjs'
import { harnessDocs, agentDefs, skillIndex } from '../../src/refs.mjs'
import { buildReport } from '../../src/report.mjs'
import { findings, counts, KIND_NAMES } from '../../src/fix.mjs'
import { formatValue } from '../../src/axes.mjs'
import { cards, inventory, handoff, loadIgnored, saveIgnored } from '../../src/coach.mjs'
import { listProjectPaths, addProjectPath, removeProjectPath } from './projects.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// desktop/tokens.md 의 --ask-bg. 콘텐츠가 그려지기 전 창 배경이 흰/검 번쩍임 없이 맞아야 한다.
function backgroundColor() {
  return nativeTheme.shouldUseDarkColors ? '#0E0E10' : '#FFFFFF'
}

// 사이드바 목록. 사용자가 고른 것만 있다(desktop/app/projects.mjs). 기본은 빈 목록이다 —
// 전에는 `~/.claude.json` 을 통째로 읽어서 한 번이라도 연 디렉터리가 전부 떴다.
//
// ASKIN_SHOT_PROJECT 는 저장 목록에 없어도 넣는다. 스크린샷 검증이 목록 파일에 뭘 넣어뒀는지에
// 딸려가면 안 된다(파일에는 안 쓴다 — 검증이 사용자 목록을 바꾸면 안 된다).
function listProjects() {
  const paths = listProjectPaths()
  const shot = process.env.ASKIN_SHOT_PROJECT
  if (shot) {
    const resolved = path.resolve(shot)
    if (!paths.includes(resolved)) paths.unshift(resolved)
  }
  return paths
    .map((p) => ({ path: p, name: path.basename(p), hasHarness: harnessDocs(p).length > 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ForceAtlas2 는 CommonJS 뿐이라 nodeIntegration:false 인 렌더러에서는 못 읽는다(조사 결론).
// 레이아웃 계산을 여기 메인 프로세스에서 하고, 계산된 x/y 를 얹은 노드 사본을 IPC 로 건넨다.
// harnessGraph() 자체의 반환 형태는 그대로 둔다 — 여기서 만드는 건 그 위에 좌표만 더한 사본이다.
function layoutGraph(repoPath) {
  // codex:true — Codex 전사(~/.codex/sessions)도 같은 그래프에 섞는다. harnessGraph 의 기본은
  // 꺼짐이라 여기서 켜지 않으면 Claude Code 전사만 보인다. 실측(2026-09-02): 이 저장소가
  // 노드 9·엣지 10 에서 11/12 로, app-a 가 32/43 에서 39/50 으로 는다.
  const { nodes, edges } = harnessGraph(repoPath, { codex: true })

  const g = new Graph()
  const rnd = mulberry32(42) // 재실행마다 배치가 안 흔들리게 결정론적 시드로 초기 좌표를 준다
  for (const n of nodes) g.addNode(n.id, { x: rnd() * 10, y: rnd() * 10 })
  // 배치엔 called·declared 둘 다 쓴다 — 선언만 된 관계도 서로 끌어당겨야 그래프가 흩어지지 않는다.
  // (렌더러는 relation 으로 실선/점선을 가르지만, 레이아웃 힘 계산은 관계 종류를 안 가린다.)
  for (const e of edges) {
    if (g.hasEdge(e.source, e.target) || e.source === e.target) continue
    g.addEdge(e.source, e.target, { weight: e.calls ?? 1 })
  }
  // 노드가 하나뿐이어도 돌린다. 프로브(graph-real.html)의 노드 1개 실측이 카메라가 가운데를
  // 잡아준 건 강한 중력(strongGravityMode)이 노드를 원점 쪽으로 당겨서다 — 건너뛰면(실측)
  // 노드가 임의 시드 좌표에 그대로 남아 리셋해도 화면 구석에 걸린다.
  const settings = forceAtlas2.inferSettings(g)
  forceAtlas2.assign(g, { iterations: 150, settings })

  const positioned = nodes.map((n) => ({ ...n, ...g.getNodeAttributes(n.id) }))
  return { nodes: positioned, edges }
}

function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function createWindow() {
  // ASKIN_THEME=dark|light 면 OS 설정과 무관하게 이 앱만 그 테마로 강제한다(nativeTheme.themeSource
  // 는 Electron 앱 안에서만 prefers-color-scheme 을 바꾼다 — 시스템 설정 자체는 안 건드린다).
  // 스크린샷 검증에서 다크/라이트를 각각 확인할 때 쓴다.
  if (process.env.ASKIN_THEME === 'dark' || process.env.ASKIN_THEME === 'light') {
    nativeTheme.themeSource = process.env.ASKIN_THEME
  }
  const win = new BrowserWindow({
    // 1680×1080. 분석 레포트가 그래프 아래에 붙으면서 세로가 모자랐다 — 1440×900 에서는
    // 그래프(260px 최소)와 "우선 고칠 것" 카드 서넛이 동시에 안 들어간다.
    width: 1680,
    height: 1080,
    backgroundColor: backgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox:true(Electron 기본값)는 preload 를 CommonJS 로만 돈다 — ESM `import` 를
      // 쓰면 "Cannot use import statement outside a module" 로 못 뜬다(실측). contextIsolation·
      // nodeIntegration 은 그대로 켜둔다 — 페이지가 격리되고 node 를 못 만지는 건 안 바뀐다.
      // preload.mjs 라는 파일 이름 자체가 ESM 을 요구하므로 여기서만 sandbox 를 끈다.
      sandbox: false,
    },
  })

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`)
  })
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[renderer gone]', details)
  })

  // ASKIN_SHOT=<png 경로> 면 창을 띄우고 데이터가 로드된 뒤 스크린샷을 찍고 종료한다.
  // 렌더러가 준비되면 document.title 을 'askin:ready' 로 바꾸는데(테스트 쿼리에서만),
  // 그 신호를 새 IPC 채널 없이 page-title-updated 로 받는다.
  const shotPath = process.env.ASKIN_SHOT
  const query = new URLSearchParams()
  if (shotPath) {
    query.set('shot', '1')
    if (process.env.ASKIN_SHOT_PROJECT) query.set('project', process.env.ASKIN_SHOT_PROJECT)
    win.webContents.on('page-title-updated', async (event, title) => {
      if (title !== 'askin:ready') return
      event.preventDefault()
      const nodeId = process.env.ASKIN_SHOT_NODE
      if (nodeId) {
        // 팝오버를 renderer 의 openPopover() 를 직접 불러 여는 대신, 진짜 마우스 클릭을 보내서
        // 연다. 직접 호출은 Sigma 캔버스 클릭이 document 로 버블링해 방금 연 팝오버를 곧장
        // 닫아버리는 버그(desktop/app/renderer.mjs 의 document 클릭 핸들러)를 절대 못 잡는다 —
        // 실측: 이 버그가 그렇게 스크린샷 검증을 통과했었다. window.__askinNodePoint() 는
        // 렌더러가 shot 모드에서만 노출하는, 노드의 창 좌표를 계산해 돌려주는 함수다.
        const point = await win.webContents.executeJavaScript(`window.__askinNodePoint(${JSON.stringify(nodeId)})`)
        if (point) {
          win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
          win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
          // 클릭 결과(팝오버 위치 계산·리페인트)가 다음 프레임에 반영되길 기다린다.
          await win.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(r))')
        }
        if (process.env.ASKIN_VERIFY_POPOVER) {
          const state = await win.webContents.executeJavaScript(
            "(() => { const p = document.getElementById('ask-node-popover'); const r = p.getBoundingClientRect(); return { hidden: p.hidden, width: r.width, height: r.height } })()",
          )
          console.log('[verify] popover state', JSON.stringify(state))
        }
      }
      // ASKIN_SHOT_CLICK=<CSS 셀렉터> 면 그 요소를 진짜 마우스로 누른다. 사이드바(프로젝트
      // 추가·빼기)를 검증하는 자리다 — 노드 클릭과 같은 이유로 핸들러를 직접 부르지 않는다.
      // opacity:0 으로 감춘 빼기 버튼이 실제로 눌리는지는 진짜 클릭으로만 알 수 있다.
      //
      // 쉼표로 여럿을 주면 순서대로 누른다. 세부 분석 안을 찍으려면 두 번이 필요하다 —
      // 토글을 열고, 그 안의 요소로 스크롤한다(둘째부터는 누르는 것보다 보이게 하는 것이
      // 목적일 수 있다. <p> 를 누르면 아무 일도 안 일어난다).
      for (const clickSelector of (process.env.ASKIN_SHOT_CLICK ?? '').split(',').filter(Boolean)) {
        const point = await win.webContents.executeJavaScript(
          // 스크롤해서 보이게 한 뒤 좌표를 잰다. 레포트가 붙으면서 결과 칸에 스크롤이 생겼고,
          // 화면 밖 요소의 rect 로 sendInputEvent 를 쏘면 엉뚱한 곳이 눌린다.
          `(() => { const el = document.querySelector(${JSON.stringify(clickSelector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
        )
        if (!point) throw new Error(`ASKIN_SHOT_CLICK 셀렉터에 맞는 요소가 없다: ${clickSelector}`)
        win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y }) // hover 로만 보이는 것이 있다
        win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        // 클릭이 IPC 왕복(projects:remove → graph:load)을 태우므로 프레임 하나로는 부족하다.
        await win.webContents.executeJavaScript('new Promise((r) => setTimeout(r, 400))')
      }

      // capturePage 는 마지막으로 그려진 프레임을 준다. 방금 바꾼 DOM 이 아직 페인트를
      // 안 탔으면 옛 화면이 찍힌다 — 실측(2026-09-03): 레포트를 다 그린 뒤에도 "재는 중"
      // 화면이 세 번 연속 찍혔다. 로그로는 DOM 에 카드 4개가 들어간 것이 확인됐는데도
      // 그랬다. 노드 클릭 분기에만 있던 프레임 대기를 여기로 올린다.
      await win.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
      const img = await win.webContents.capturePage()
      fs.mkdirSync(path.dirname(shotPath), { recursive: true })
      fs.writeFileSync(shotPath, img.toPNG())
      app.quit()
    })
  }

  const search = query.toString()
  win.loadFile(path.join(__dirname, 'index.html'), search ? { search: `?${search}` } : undefined)
  return win
}

ipcMain.handle('projects:list', () => listProjects())
// 추가·제거는 바뀐 목록을 그대로 돌려준다. 렌더러가 projects:list 를 다시 부르는 왕복을 아낀다.
ipcMain.handle('projects:add', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const picked = await dialog.showOpenDialog(win, {
    title: '프로젝트 폴더 고르기',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (picked.canceled || !picked.filePaths.length) return { projects: listProjects(), added: null }
  const added = addProjectPath(picked.filePaths[0])
  return { projects: listProjects(), added }
})
ipcMain.handle('projects:remove', (event, repoPath) => {
  if (!repoPath) throw new Error('projects:remove 는 저장소 경로가 있어야 한다')
  removeProjectPath(repoPath)
  return { projects: listProjects() }
})
// 규칙 줄(rule_row, desktop/canvas/gen.py). 값 문자열도 여기서 만든다 — "0/24" 가 아니라
// "24건 중 0건 위반 · 100%" 다. 렌더러는 계산하지 않는다.
function ruleDetailRow(c) {
  const muted = c.shown === null
  return { type: 'rule', label: c.label, shown: c.shown, rate: c.rate, warn: !muted && c.violations > 0, note: muted ? c.why : c.rule }
}

// 관찰값 줄(habit_row). note 는 값이 있든 없든 늘 보인다(gen.py 와 같은 결 — 옛 렌더러는
// title 툴팁에만 숨겨뒀었다).
function habitDetailRow(o) {
  const muted = o.shown === null
  return { type: 'habit', label: o.label, shown: o.shown, n: o.n, note: muted ? o.why : o.note, detail: o.detail ?? null, recommend: o.recommend ?? null }
}

function countDetailRow(label, value, note, { up = false, muted = false } = {}) {
  return { type: 'count', label, value, note, up, muted }
}

// 턴 마무리 훅 시간의 detail 은 무거운 순으로 이미 정렬돼 있다(src/axes.mjs stop-hook-time).
// 첫 항목이 가장 무거운 훅이다.
function stopHookRecommend(detail) {
  if (!detail) return null
  const [name, value] = Object.entries(detail)[0] ?? []
  if (!name) return null
  const ms = /^(\d+ms)/.exec(value)?.[1] ?? value
  return `가장 무거운 ${name} 를 가볍게 하면 턴마다 최대 ${ms} 를 아껴요.`
}

const FINDING_KIND_IDS = ['dead-path', 'broken-skill', 'dangling-skill', 'citation', 'contradiction']

// src/coach.mjs 의 cards() 는 tier 를 영문 코드('rule'|'broken'|'repeat')로, sure 를 불리언으로
// 낸다(판정은 그쪽 몫). 화면에 앉힐 한국어 문구로 바꾸는 것은 판정이 아니라 표시일 뿐이지만,
// 그 변환도 "표시 문자열은 메인이 만든다" 규칙을 따라 여기서 한다 — 렌더러는 그대로 찍기만 한다.
const TIER_LABEL = { rule: '규칙', broken: '깨진 것', repeat: '반복' }
function scopeChip(tier, scope) {
  if (tier === 'rule') return scope === 'global' ? '전역 규칙' : '이 저장소 규칙'
  if (scope === 'repo') return '이 저장소'
  if (scope === 'global') return '전역'
  return '전역·저장소' // 'mixed' — 모순 후보가 전역·저장소 문서를 같이 근거로 들 때
}
function presentCard(c) {
  return { ...c, tier: TIER_LABEL[c.tier] ?? c.tier, scope: scopeChip(c.tier, c.scope), sure: c.sure ? '확실' : '확인 필요' }
}

// 분석 레포트. buildReport() 가 낸 것을 렌더러가 바로 그릴 형태로 편다.
//
// 표시 문자열을 여기서 만든다. 렌더러는 nodeIntegration:false 라 src/axes.mjs 의
// formatValue 를 못 부른다 — 그 판정을 렌더러에 베껴 넣으면 화면과 터미널이 다른 말을
// 하게 된다(CLAUDE.md: "같은 판정을 두 곳에 두지 않는다").
//
// 실측(2026-09-03, 이 저장소): 캐시를 켜고 545ms, 옛 캐시를 버릴 때 5.4초다. 그래프
// (graph:load)와 채널을 나눈 이유가 이것이다 — 그래프를 먼저 그리고 레포트는 뒤따른다.
function loadReport(repoPath) {
  const report = buildReport({ repo: repoPath })

  const compliance = report.compliance.map((a) => {
    let shown = null
    if (a.broken) shown = '고장'
    else if (a.total) {
      const pct = `${(a.rate * 100).toFixed(1)}%`.replace('.0%', '%')
      shown = `${a.total}건 중 ${a.violations}건 위반 · ${pct}`
    }
    return {
      id: a.id,
      label: a.label,
      rule: a.rule,
      total: a.total,
      violations: a.violations,
      shown,
      rate: a.rate,
      why: a.broken ?? a.unavailable ?? null,
      concentration: a.concentration ?? [],
    }
  })
  const complianceById = Object.fromEntries(compliance.map((c) => [c.id, c]))

  const observation = report.observation.map((o) => ({
    id: o.id,
    label: o.label,
    note: o.note,
    shown: o.broken ? '고장' : formatValue(o.value, o.unit),
    why: o.broken ?? o.unavailable ?? o.note,
    n: o.n ?? 0,
    detail: o.detail ?? null,
    recommend: o.id === 'stop-hook-time' ? stopHookRecommend(o.detail) : null,
  }))
  const observationById = Object.fromEntries(observation.map((o) => [o.id, o]))

  const ignored = loadIgnored()
  const rawCards = cards(report, { ignored })
  const upKinds = new Set(rawCards.filter((c) => c.kind).map((c) => c.kind))
  const cardsList = rawCards.map(presentCard)

  const findingsByKind = new Map()
  for (const f of findings(report)) {
    if (!findingsByKind.has(f.kind)) findingsByKind.set(f.kind, [])
    findingsByKind.get(f.kind).push(f)
  }
  const kindCounts = counts(report)

  // 규칙 축만 "지키는 규칙 · 판정 불가"를 센다(관찰값은 목표가 없어 지킨다는 개념이 없다).
  const compliancePassing = compliance.filter((c) => c.shown !== null && c.violations === 0).length
  const complianceUnjudged = compliance.filter((c) => c.shown === null).length

  // 규칙·모델 카드
  const modelRows = [complianceById['model-explicit'], complianceById['chore-model']].filter(Boolean)
  const modelJudged = modelRows.filter((c) => c.shown !== null)
  const modelUnavail = modelRows.length - modelJudged.length
  const modelSummary = modelUnavail
    ? `${modelRows.length}개 중 ${modelJudged.filter((c) => c.violations === 0).length}개 지키는 중 · ${modelUnavail}개는 잴 수 없었어요`
    : `${modelRows.length}개 중 ${modelJudged.filter((c) => c.violations === 0).length}개 지키는 중이에요`

  // 깨진 링크와 정의 카드. 잡을 수 있는 증상 7가지 = 종류 5 + 규칙 축 2(하네스 활용·스킬 선언 무결성).
  const linkRuleAxes = [complianceById['agent-used'], complianceById['skill-declared-exists']].filter(Boolean)
  const linkTypesFound =
    FINDING_KIND_IDS.filter((k) => (findingsByKind.get(k)?.length ?? 0) > 0).length + linkRuleAxes.filter((c) => c.violations > 0).length
  const linkTypesTotal = FINDING_KIND_IDS.length + linkRuleAxes.length

  const weeks = report.weekly?.length ?? 0
  const obsFootnote =
    weeks >= 2
      ? null
      : `주별 추세는 위임이 2주 이상 쌓이면 병렬 비율·평균 갈래·서브에이전트 결말에 그려요. 지금은 ${weeks === 0 ? '아직 없어요' : '한 주뿐이에요'}.`

  const inv = inventory(repoPath, harnessGraph(repoPath, { codex: true }), { hooks: report.hookTotals })

  const details = [
    {
      title: '규칙 · 모델',
      sources: ['Claude'],
      summary: modelRows.length ? modelSummary : null,
      rows: modelRows.map(ruleDetailRow),
    },
    {
      title: '관찰값 · 위임과 세션',
      sources: ['Claude'],
      summary: '목표가 없는 값이에요. 추세로만 봐요',
      footnote: obsFootnote,
      rows: ['parallel-ratio', 'parallel-width', 'delegation-share', 'subagent-outcome', 'guard-denials', 'active-sessions']
        .map((id) => observationById[id])
        .filter(Boolean)
        .map(habitDetailRow),
    },
    {
      title: '캐싱',
      sources: ['Claude'],
      footnote: 'Codex 기록은 아직 안 섞였어요. 섞으면 축의 뜻이 바뀌어 옛 레포트와 비교하지 않아요.',
      rows: [observationById['cache-hit']].filter(Boolean).map(habitDetailRow),
    },
    {
      title: '훅',
      sources: ['Claude'],
      // 요약 줄은 report.hookTotals(report.mjs 의 합)에서 온다. 여기서 세션을 다시 훑지 않는다.
      // 훅 기록이 없으면 null 이라 요약 줄을 안 그린다(0 으로 뭉개지 않는다).
      summary: inv.hooks ? `실행 ${inv.hooks.runs.toLocaleString('en-US')}회 · 이벤트 ${inv.hooks.events}종 · 실패 ${inv.hooks.fail}` : null,
      rows: [complianceById['hook-integrity'] && ruleDetailRow(complianceById['hook-integrity']), observationById['stop-hook-time'] && habitDetailRow(observationById['stop-hook-time'])].filter(
        Boolean,
      ),
    },
    // 손으로 되풀이한 명령은 아직 재지 않는 축이다. 없는 숫자를 만들지 않는다.
    { title: '반복 행동', sources: ['Claude'], rows: [] },
    {
      title: '깨진 링크와 정의',
      sources: [],
      summary: `잡을 수 있는 증상 ${linkTypesTotal}가지 중 ${linkTypesFound}가지가 나왔어요`,
      rows: [
        ...FINDING_KIND_IDS.map((kind) => {
          const name = KIND_NAMES[kind]
          const list = findingsByKind.get(kind) ?? []
          return countDetailRow(name, `${kindCounts[name] ?? list.length}건`, list.length ? list[0].title : null, {
            up: upKinds.has(kind),
            muted: list.length === 0,
          })
        }),
        ...linkRuleAxes.map(ruleDetailRow),
      ],
    },
    // 계정 단위 한도(Codex rate_limits)는 아직 재지 않는 축이다.
    { title: '한도', sources: ['Codex'], rows: [] },
    {
      title: '무엇을 봤나',
      sources: ['Claude', 'Codex'],
      fullWidth: true,
      rows: [
        countDetailRow('Claude', `세션 ${report.scope.sessions}개 · 위임 ${report.scope.delegations}건 · 전사 ${(report.files?.read ?? 0) + (report.files?.reused ?? 0)}개`),
        countDetailRow('하네스', `에이전트 정의 ${inv.agents.total}개 · 스킬 ${inv.skills.defined}개(전역 포함) · 하네스 문서 ${inv.docs.total}개 · 기간 전체`),
      ],
    },
  ]

  return {
    scope: report.scope,
    periodLabel: report.scope.since ? `${report.scope.since.slice(0, 10)} – ${report.scope.until ? report.scope.until.slice(0, 10) : '지금'}` : '전체 기간',
    compliance,
    observation,
    cards: cardsList,
    passing: compliancePassing,
    unjudged: complianceUnjudged,
    details,
    inventory: inv,
    kindNames: KIND_NAMES,
    ignoredCount: ignored.length,
    // 무엇을 근거로 쟀는지. 분모가 어디서 왔는지 안 보이면 숫자를 믿을 수가 없다.
    basis: {
      sessions: report.scope.sessions,
      delegations: report.scope.delegations,
      agents: agentDefs(repoPath).length,
      skills: skillIndex(repoPath).size,
      docs: report.refDocs,
    },
  }
}

ipcMain.handle('report:load', (event, repoPath) => {
  if (!repoPath) throw new Error('report:load 는 저장소 경로가 있어야 한다')
  return loadReport(repoPath)
})
ipcMain.handle('graph:load', (event, repoPath) => {
  if (!repoPath) throw new Error('graph:load 는 저장소 경로가 있어야 한다')
  return layoutGraph(repoPath)
})
// 카드 하나를 지시서 마크다운으로. 렌더러가 클립보드에 담는다(채팅 패널이 아직 없다).
ipcMain.handle('coach:handoff', (event, repoPath, cardId) => {
  if (!repoPath || !cardId) throw new Error('coach:handoff 는 저장소 경로와 카드 id 가 있어야 한다')
  const report = buildReport({ repo: repoPath })
  const card = cards(report, { ignored: loadIgnored() }).find((c) => c.id === cardId)
  if (!card) throw new Error(`카드를 못 찾았다: ${cardId}`)
  return handoff(card, report, { repo: repoPath })
})
// "문제 아님". 카드 id 를 전역 무시 목록에 쌓는다(loadIgnored/saveIgnored 는 저장소를 안 가린다 —
// src/coach.mjs 인터페이스 계약).
ipcMain.handle('coach:ignore', (event, repoPath, cardId) => {
  if (!repoPath || !cardId) throw new Error('coach:ignore 는 저장소 경로와 카드 id 가 있어야 한다')
  const ids = loadIgnored()
  if (!ids.includes(cardId)) ids.push(cardId)
  saveIgnored(ids) // src/coach.mjs 의 saveIgnored 는 값을 안 돌려준다. 쓴 목록을 직접 낸다.
  return ids
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
