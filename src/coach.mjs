// 레포트 카드의 데이터 층. 판정은 여기서 안 한다 — report.mjs·axes.mjs·fix.mjs 가 이미
// 값·분모·위반을 냈다. 이 파일이 하는 일은 셋뿐이다.
//   1. inventory()   그래프·정의를 "내 하네스 요약 띠" 모양으로 편다
//   2. cards()        findings()·compliance 를 카드(층·범위·문구)로 묶는다. 새 위반 기준을
//                      만들지 않는다 — report 에 있는 값·분모만 옮긴다(CLAUDE.md "판정의 결")
//   3. handoff()      카드 하나를 채팅으로 보낼 마크다운으로 편다. broken 은 fix.mjs 의
//                      instruction()/plan() 을 그대로 쓰고, rule 은 여기서 처음 만든다
//                      (findings 만 다루는 fix.mjs 에는 준수율 위반용 지시서가 없다)
//
// desktop/design-concept.md "아쉬운 점 카드"·desktop/wireframe.md 4.0-D/E/G,
// desktop/canvas/gen.py 의 weak_card()·WEAK_DEFAULT·HANDOFF_CARD·HANDOFF_PAYLOAD 가 정본이다.
// 문구는 거기 실측 예시를 그대로 옮기되 건수·이름은 인자로 받은 report 데이터로 채운다.

import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findings, plan, KIND_NAMES } from './fix.mjs'
import { harnessDocs, agentDefs, skillIndex } from './refs.mjs'
import { NO_DEFINITION } from './graph.mjs'

// ── inventory: 하네스 요약 띠 ──────────────────────────────────────────

function scopedDocs(repo) {
  const docs = harnessDocs(repo)
  const inRepo = (f) => repo && (f === repo || f.startsWith(`${repo}/`))
  const repoCount = docs.filter(inRepo).length
  return { total: docs.length, repo: repoCount, global: docs.length - repoCount }
}

function scopedAgents(repo, graph) {
  const defs = agentDefs(repo)
  // 그래프 agent 노드의 calls 는 "정의가 있는 것만" 더한다. scope 가 NO_DEFINITION(builtin) 인
  // 것(general-purpose 같은 내장 타입)은 정의 파일이 없어 이 합계에서 뺀다 — agentDefs 의
  // total 과 짝이 안 맞는 숫자를 더하면 "정의 1개인데 호출 40회"처럼 읽는 사람이 오해한다.
  // codex-agent: 노드도 scope 가 UNKNOWN_SCOPE 라 이 필터에서 자동으로 빠진다.
  const calls = graph.nodes
    .filter((n) => n.kind === 'agent' && (n.scope === 'repo' || n.scope === 'global'))
    .reduce((n, a) => n + a.calls, 0)
  return {
    total: defs.length,
    global: defs.filter((d) => d.scope === 'global').length,
    repo: defs.filter((d) => d.scope === 'repo').length,
    calls,
  }
}

function scopedSkills(repo, graph) {
  const usedByScope = { plugin: 0, builtin: 0, repo: 0, global: 0 }
  const skillNodes = graph.nodes.filter((n) => n.kind === 'skill')
  // 스킬 노드의 scope 는 항상 repo/global/plugin/builtin(NO_DEFINITION) 넷 중 하나다
  // (graph.mjs: kind==='skill' 이면 UNKNOWN_SCOPE 로 안 빠진다). 넷 다 미리 채워둬서
  // 실측에 없는 갈래도 0으로 보인다 — 조용히 키가 빠지면 "그 갈래가 아예 없다"와
  // "0건이다"를 못 가른다.
  for (const n of skillNodes) usedByScope[n.scope] = (usedByScope[n.scope] ?? 0) + 1
  const index = skillIndex(repo)
  const definedByScope = { global: 0, plugin: 0, repo: 0 }
  // 별칭(`<플러그인>:<스킬>`) 항목도 그대로 센다. defined 가 index.size 그대로라, 여기서
  // 별칭을 빼면 definedByScope 의 합이 defined 보다 작아져 둘이 어긋난다.
  for (const hit of index.values()) definedByScope[hit.scope] = (definedByScope[hit.scope] ?? 0) + 1
  return { used: skillNodes.length, usedByScope, defined: index.size, definedByScope }
}

function scopedMcp(graph) {
  const mcpNodes = graph.nodes.filter((n) => n.kind === 'mcp')
  const calls = mcpNodes.reduce((n, m) => n + m.calls, 0)
  const top = mcpNodes.length ? mcpNodes.reduce((a, b) => (b.calls > a.calls ? b : a)) : null
  return { used: mcpNodes.length, calls, top: top ? { name: top.name, calls: top.calls } : null }
}

// 내 하네스 요약 띠. graph 는 harnessGraph(repo, { codex: true }) 의 { nodes, edges }.
//
// hooks 는 늘 null 이다. 이 함수의 인자는 repo·graph 뿐이라 report.hookRows 를 볼 길이
// 없다(지시서의 필드 주석은 "report 가 있다면"을 전제하는데 이 시그니처엔 report 가 안
// 온다). 게다가 실측해보니 buildReport() 자체가 top-level `hookRows` 를 안 낸다 — 훅 실행
// 기록은 report.mjs 내부에서 sources.hooks 로만 쓰이고 hook-integrity 축을 거쳐
// report.compliance 에만 녹아든다. 없는 값을 지어 채우지 않는다(CLAUDE.md "고치기 전에
// 묻는다"). report 를 받는 통로가 생기면 그때 채운다.
// hooks 는 report.hookTotals(report.mjs 의 hookTotals(), { runs, events, fail } 또는 null)를 그대로
// 받는다. 여기서 세션을 다시 훑어 세면 같은 합을 두 곳에서 내게 된다. 안 넘기면 null = 판정 불가.
export function inventory(repo, graph, { hooks = null } = {}) {
  return {
    docs: scopedDocs(repo),
    agents: scopedAgents(repo, graph),
    skills: scopedSkills(repo, graph),
    mcp: scopedMcp(graph),
    hooks: hooks ? { runs: hooks.runs, events: hooks.events, fail: hooks.fail } : null,
  }
}

// ── cards: 아쉬운 점 카드 ──────────────────────────────────────────────

// 전역/저장소를 가른다. finding 의 파일이 report.scope.repo 밖이면 global. 파일이 하나도
// 없으면(citation 이 rule 문구만 갖고 file 을 못 채운 드문 경우) global 로 둔다 — 기본 축의
// 근거는 거의 다 ~/.claude/CLAUDE.md 라 이 저장소 밖일 확률이 높다.
function scopeOf(finding, repo) {
  const files = (finding.files ?? []).filter(Boolean)
  if (!files.length || !repo) return 'global'
  const inRepo = files.map((f) => f === repo || f.startsWith(`${repo}/`))
  if (inRepo.every(Boolean)) return 'repo'
  if (inRepo.every((x) => !x)) return 'global'
  return 'mixed' // 예: 모순 후보 하나가 전역 CLAUDE.md 와 저장소 CLAUDE.md 를 같이 근거로 든다
}

function scopePrefix(scope) {
  if (scope === 'global') return '전역 '
  if (scope === 'mixed') return '전역·저장소 '
  return ''
}

// 카드 근거 한 줄. fix.mjs 의 title(어디서)·detail(무엇을, 원문 첫 줄)을 그대로 잇는다.
// 새로 찾지 않는다 — findings() 가 이미 뽑은 사실만 옮긴다.
function coreFact(f) {
  const first = String(f.detail ?? '')
    .split('\n')[0]
    .trim()
  return first ? `${f.title} — ${first}` : f.title
}

// 최대 3줄, 넘치면 "외 N건"으로 접는다(지시서: "최대 3줄, 넘치면 외 N건").
function withOverflow(lines, total) {
  const shown = lines.slice(0, 3)
  if (total > shown.length) shown.push(`외 ${total - shown.length}건`)
  return shown
}

// gen.py 의 카드 문구 표. n===1 이면 fix.mjs 의 원래 문장(titleOne)을 그대로 쓰고(원문과
// 어긋나지 않게), 여럿이면 건수로 뭉뚱그린 문장(titleMany)을 쓴다. dangling-skill 은
// gen.py 실측 카드가 n=3 에서도 이미 일반형 문장이라 titleOne 이 따로 없다.
const BROKEN = {
  'dead-path': {
    titleOne: (f) => f.title,
    titleMany: (n) => `문서가 가리키는데 없는 경로 ${n}건`,
    // 실측(fix.mjs 근거 주석): "git 이 아는 경로 어디에도 없음" 14건 중 거짓 5건(36%),
    // "절대 경로가 없음" 7건 중 거짓 1건(14%) — 합쳐서 대략 셋에 하나(gen.py 문구 그대로).
    caution: () => '경로가 아닐 수도 있어요. 실측으로 이런 건 셋에 하나가 경로가 아니었어요.',
    recommend: (n) => `경로인지 확인하고 옮겨진 것이면 새 경로로 고쳐요. 문서에서 헛길 ${n}건이 없어져요.`,
  },
  'broken-skill': {
    titleOne: (f) => f.title,
    titleMany: (n) => `선언했는데 없는 스킬 ${n}건`,
    recommend: (n) => `선언을 지우거나 그 스킬을 만들면 못 찾는 선언 ${n}건이 없어져요.`,
  },
  'dangling-skill': {
    titleOne: null,
    titleMany: (n) => `스킬 심링크 ${n}개가 없는 곳을 가리킨다`,
    recommend: (n, scope) =>
      `실물이 있는 저장소에서 옮겨 오거나 링크를 지우면, 못 읽는 항목 ${n}개가 없어져요.` +
      (scope === 'global' ? ' 전역이라 모든 프로젝트에서 같이 사라져요.' : ''),
  },
  citation: {
    titleOne: (f) => f.title,
    titleMany: (n) => `축 ${n}개의 근거를 이 하네스에서 못 찾는다`,
    caution: () => '축을 일부러 바꿨을 수도 있다. 문구가 사라진 건지 규칙을 고친 건지 읽고 판단해야 해요.',
    recommend: (n) => `문구를 되살리거나 축의 rule 을 지금 문구로 고치면 판정 불가 ${n}개가 풀려요.`,
  },
  contradiction: {
    titleOne: (f) => f.title,
    titleMany: (n) => `문서가 반대로 말하는 곳 ${n}건`,
    caution: () => '기계는 후보만 좁혔다. 실제로 어긋나는지 읽고 판단해야 해요.',
    recommend: (n) => `두 문서를 맞추면 모순 후보 ${n}건이 없어져요.`,
  },
}

// dead-path·citation·contradiction 은 판정에 사람 확인이 필요하다(지시서 그대로). 나머지
// 둘(broken-skill·dangling-skill)은 fs.existsSync 로 확정한 사실이라 확실이다 — fix.mjs 도
// 이 둘에는 needsJudgement 를 안 단다.
const SURE = { 'dead-path': false, 'broken-skill': true, 'dangling-skill': true, citation: false, contradiction: false }

const SCOPE_ORDER = ['repo', 'global', 'mixed']

function brokenCard(kind, scope, group) {
  const n = group.length
  const spec = BROKEN[kind]
  const title = n === 1 && spec.titleOne ? `${scopePrefix(scope)}${spec.titleOne(group[0])}` : `${scopePrefix(scope)}${spec.titleMany(n)}`
  return {
    // kind+scope 로만 만든다. 건수·문구가 안 들어가야 다음 실행에서도 같은 발견이면 같은
    // id 가 나온다 — ignored.json 이 이 id 로 카드를 지운다.
    id: `broken:${kind}:${scope}`,
    tier: 'broken',
    scope,
    sure: SURE[kind],
    kind,
    axisId: null,
    title,
    evidence: withOverflow(group.slice(0, 3).map(coreFact), n),
    caution: spec.caution ? spec.caution() : null,
    recommend: spec.recommend(n, scope),
    count: n,
    files: [...new Set(group.flatMap((f) => f.files ?? []))],
    findings: group,
  }
}

// 축 id → { how(사람 말로 재는 방식), recommend }. 몰라도 되게 기본값을 둔다 — 사용자가
// ~/.harness-bro/axes.mjs 로 축을 더할 수 있어서(axes.mjs 의 loadAxes), 이 표에 없는
// 축 id 가 위반을 낼 수 있다. 축을 새로 판정하지 않으면서도 카드가 안 죽어야 한다.
const RULE_META = {
  'model-explicit': {
    how: '분모는 fork 를 뺀 위임, 위반은 model 없음',
    recommend: (n) => `model 을 명시하면 위반 ${n}건이 없어져요.`,
  },
  'chore-model': {
    how: '분모는 runner 로 위임한 것, 위반은 model 이 haiku 가 아님',
    recommend: (n) => `haiku 로 보내면 위반 ${n}건이 없어져요.`,
  },
  'agent-used': {
    how: '분모는 호출 기록을 잴 수 있는 에이전트 정의(전역은 전 프로젝트, 저장소는 이 저장소 전체 기간), 위반은 호출 0회',
    recommend: (n) => `안 쓰는 정의를 걷어내거나 다시 쓰면 정의 ${n}개가 판정에서 또렷해져요.`,
  },
  'skill-declared-exists': {
    how: '분모는 에이전트가 선언한 스킬, 위반은 그 스킬이 실재하지 않음',
    recommend: (n) => `선언을 지우거나 스킬을 만들면 위반 ${n}건이 없어져요.`,
  },
  'hook-integrity': {
    how: '분모는 이 범위의 훅 실행, 위반은 실패 1회 이상',
    recommend: (n) => `실패 원인을 고치면 위반 ${n}건이 없어져요.`,
  },
}
const RULE_DEFAULT_META = {
  how: '분모·위반 정의는 이 축 정의(축 파일의 scope·violation)를 봐야 한다.',
  recommend: (n) => `규칙을 지키면 위반 ${n}건이 없어져요.`,
}

// 규칙 원문 맨 앞 토큰이 파일 경로면 그 파일을, 아니면(예: "에이전트가 선언한 스킬이
// 실재해야 한다"처럼 근거 파일이 없는 축) null 을 낸다. axes.mjs 의 citation() 이 이미
// rule 문자열에 줄 번호를 박아 넣으므로(`~/.claude/CLAUDE.md:9  …`) 그 줄 번호만 뗀다.
function citeFileOf(rule) {
  const m = String(rule ?? '').match(/^(\S+)\s{2,}/)
  if (!m) return null
  let file = m[1].replace(/:\d+(-\d+)?$/, '')
  if (file.startsWith('~/')) file = path.join(os.homedir(), file.slice(2))
  return file.includes('/') ? file : null
}

function ruleScope(rule, repo) {
  const file = citeFileOf(rule)
  if (!file) return 'repo' // 근거 파일이 없는 규칙(스킬 선언·훅)은 이 저장소의 정의·실행을 잰다
  if (repo && (file === repo || file.startsWith(`${repo}/`))) return 'repo'
  return 'global'
}

function ruleFiles(rule, repo) {
  const file = citeFileOf(rule)
  return file ? [file] : harnessDocs(repo)
}

// 비용 차액 문장은 이번에 안 넣는다. 위반 위임의 실제 모델·토큰을 위임 단위로 묶는 집계가
// 아직 없다(desktop/wireframe.md 4.0-D "규칙 카드의 비용 차액" — scan.mjs 는 세션 단위
// main/sub 합계만 있고 위임 하나하나에 토큰을 못 붙인다). 그 집계가 생기면 model-explicit·
// chore-model 의 recommend 뒤에 "이번 달 API 요금 환산 $X 를 아껴요" 를 이어 붙이면 된다.
function ruleCard(axis, repo) {
  const meta = RULE_META[axis.id] ?? RULE_DEFAULT_META
  const scope = ruleScope(axis.rule, repo)
  const n = axis.violations
  return {
    id: `rule:${axis.id}`,
    tier: 'rule',
    scope,
    sure: true, // 준수율 위반은 report.compliance 가 이미 측정을 확정한 사실이다
    kind: null,
    axisId: axis.id,
    title: `${scopePrefix(scope)}${axis.label} ${axis.total}건 중 ${n}건 위반`,
    evidence: withOverflow([...(axis.samples ?? [])], n),
    caution: null,
    recommend: meta.recommend(n),
    count: n,
    files: ruleFiles(axis.rule, repo),
    findings: axis.samples ?? [],
  }
}

// 아쉬운 점 카드. tier: 'repeat' | 'rule' | 'broken' 고정 순서 — repeat 는 손으로 되풀이한
// 명령을 세는 수집기가 아직 없어(desktop/wireframe.md 4.0-D "반복 카드의 재료") 이번엔 안
// 낸다. 타입에는 남겨 나중에 그 수집기가 생기면 여기 한 갈래만 더하면 되게 한다.
//
// 순위·점수는 계산하지 않는다(CLAUDE.md "종합 점수도, 프로젝트를 가로지르는 평균도 만들지
// 않는다"). 카드 순서는 층 순서 안에서 rule 은 report.compliance 순서(axes.mjs 축 순서
// 그대로), broken 은 fix.mjs KIND_NAMES 의 키 순서(= KINDS 배열 순서)를 그대로 쓴다 — 이
// 파일이 그 순서를 또 정의하면 fix.mjs 가 종류를 늘릴 때 두 곳을 같이 고쳐야 한다.
export function cards(report, { ignored = [] } = {}) {
  const ignoredSet = new Set(ignored)
  const out = []

  for (const axis of report.compliance) {
    if (!(axis.violations > 0) || axis.unavailable) continue // 분모가 비어 판정 불가면 카드가 아니다
    const card = ruleCard(axis, report.scope.repo)
    if (!ignoredSet.has(card.id)) out.push(card)
  }

  const byKind = new Map()
  for (const f of findings(report)) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, [])
    byKind.get(f.kind).push(f)
  }
  for (const kind of Object.keys(KIND_NAMES)) {
    const list = byKind.get(kind)
    if (!list?.length) continue
    const byScope = new Map()
    for (const f of list) {
      const scope = scopeOf(f, report.scope.repo)
      if (!byScope.has(scope)) byScope.set(scope, [])
      byScope.get(scope).push(f)
    }
    for (const scope of SCOPE_ORDER) {
      const group = byScope.get(scope)
      if (!group?.length) continue
      const card = brokenCard(kind, scope, group)
      if (!ignoredSet.has(card.id)) out.push(card)
    }
  }
  return out
}

// ── handoff: 카드 하나를 채팅 마크다운으로 ──────────────────────────────

const HEADER_NOTE = 'askin 이 전사를 실측해 만든 문서다. 수정 전에 무엇을 바꿀지 먼저 물어라.'

function header(card) {
  return [`# ${card.title}`, '', `추천: ${card.recommend}`, '', HEADER_NOTE, '']
}

// broken: fix.mjs 의 plan(report) 이 만든 갈래 중 이 카드의 findings 를 담은 것들을 그대로
// 잇는다. instruction() 을 다시 안 만든다(CLAUDE.md "같은 판정을 두 곳에 두지 않는다") —
// 지시서 본문(저장소·고칠 것·건드릴 파일·건드리지 말 것·형제·거부 조건·끝나면)은 전부
// fix.mjs 몫이다. 한 카드가 여러 갈래에 걸칠 수 있다 — lanes() 는 파일 겹침으로만 묶어서,
// 같은 kind·scope 라도 파일이 안 겹치면 다른 갈래로 갈린다.
function brokenHandoff(card, report) {
  const p = plan(report)
  const isMine = (f) => card.findings.some((cf) => cf.kind === f.kind && cf.title === f.title && cf.detail === f.detail)
  const lanes = p.lanes.filter((l) => l.findings.some(isMine))
  const body = lanes.length
    ? lanes.map((l) => l.prompt).join('\n\n---\n\n')
    : '(이 카드의 findings 를 담은 갈래를 못 찾았다 — report 가 cards() 를 만들 때와 다르다)'
  return [...header(card), body].join('\n')
}

// rule: instruction() 이 없다(fix.mjs 는 findings 만 다룬다, desktop/wireframe.md 4.0-G).
// 여기서 처음 만든다. 규칙 인용·재는 방식·몰린 곳·표본·건드릴 파일·지킬 것·끝나면·출처 순.
function ruleHandoff(card, report, repo) {
  const axis = report.compliance.find((a) => a.id === card.axisId)
  const meta = RULE_META[card.axisId] ?? RULE_DEFAULT_META
  const docs = harnessDocs(repo)
  const rel = (f) => (repo && f.startsWith(`${repo}/`) ? path.relative(repo, f) : f)
  const outsideRepo = docs.filter((f) => !(repo && f.startsWith(`${repo}/`)))

  const lines = [
    ...header(card),
    '## 규칙',
    '',
    axis?.rule ?? '(규칙 원문을 report.compliance 에서 못 찾았다)',
    '',
    '## 이 축이 재는 방식',
    '',
    meta.how,
    '',
  ]
  if (axis?.concentration?.length) {
    lines.push('## 몰린 곳', '', ...axis.concentration.map((c) => `- ${c.key}  ${c.count}/${c.of}`), '')
  }
  lines.push(
    '## 표본',
    '',
    ...(axis?.samples?.length ? axis.samples.map((s) => `- ${s}`) : ['(표본 없음)']),
    '',
    '## 건드릴 파일',
    '',
    ...docs.map((f) => `- \`${rel(f)}\``),
  )
  if (outsideRepo.length) lines.push('', '**전역 문서가 섞여 있다. 고치면 다른 저장소에도 같이 반영된다.**')
  lines.push(
    '',
    '## 지킬 것',
    '',
    '- 수정 전에 무엇을 바꿀지 먼저 물어라',
    '- 커밋 전에 `git status --short` 로 내 파일만 올라가는지 확인해라',
    '',
    '## 끝나면',
    '',
    '```bash',
    // fix.mjs 의 verify 명령과 같은 자리에서 같은 방식으로 만든다(report.mjs 를 이 파일과
    // 나란히 둔 경로로 찾는다) — 범위가 리포트와 달라지면 받는 쪽이 딴 범위를 재고
    // "안 줄었다"고 읽는다(fix.mjs instruction() 의 같은 주석 참고).
    `node ${path.join(path.dirname(fileURLToPath(import.meta.url)), 'report.mjs')} ${repo ? `--repo ${repo}` : '--all'}`,
    '```',
    '',
    '이 축의 위반이 0 이어야 한다.',
    '',
    '## 출처',
    '',
    'askin 이 전사를 실측해 만든 문서다. Claude 와 Codex 에 같은 마크다운이 간다 — 도구 이름을 전제하지 마라.',
  )
  return lines.join('\n')
}

export function handoff(card, report, { repo } = {}) {
  const scopeRepo = repo ?? report.scope.repo
  return card.tier === 'rule' ? ruleHandoff(card, report, scopeRepo) : brokenHandoff(card, report)
}

// ── 문제 아님 ──────────────────────────────────────────────────────────

export function ignoredPath() {
  return process.env.HARNESS_BRO_IGNORED ?? path.join(os.homedir(), '.harness-bro', 'ignored.json')
}

export function loadIgnored(file = ignoredPath()) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return [] // 파일이 없거나 깨졌으면 아무것도 무시하지 않은 것으로 본다
  }
}

export function saveIgnored(ids, file = ignoredPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(ids, null, 2))
}
