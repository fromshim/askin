import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { pathLike } from './refs.mjs'

// 판정 축.
//
// 여기 있는 것이 기본이고, `~/.harness-bro/axes.mjs` 가 있으면 거기서 더하거나 끌 수 있다.
// report.mjs 는 배열만 보고 돌아서, 축을 더할 때 report 를 고칠 일이 없다.
//
// 두 종류를 섞지 않는다.
//   compliance: 기준이 이미 내가 쓴 규칙이다. 목표는 100%
//   observation: "얼마가 좋은가"의 기준이 없다. 추세로만 본다
//
// scope 가 분모, violation 이 위반이다. 측정 함정이 여기서 한 줄로 보이는 게 핵심이다.

// source 는 축이 무엇을 한 건으로 세는지다. 축마다 단위가 다르다.
//   delegations: 위임 한 건
//   agents:      에이전트 정의 한 개
export const compliance = [
  {
    id: 'model-explicit',
    label: '모델 명시',
    rule: '~/.claude/CLAUDE.md  `model` 파라미터를 항상 명시한다',
    source: 'delegations',
    // 함정 1. fork 는 정의상 부모 모델을 상속한다. model 이 무시되는 타입이라 위반이 아니다.
    // 이 한 줄을 빼면 90.8% 가 나오고 넣으면 98.1% 가 나온다. 7.3%p 차이다.
    //
    // src/graph.mjs 의 MODEL_UNSPECIFIED 가 그래프에서 정확히 이 조건(scope 안 + violation)을
    // 가리킨다 — 거기서는 "판정 불가"가 아니라 이 축의 위반이라고 표시한다. 이 조건을 고치면
    // 그래프도 같이 봐야 한다. 두 곳이 달라지면 화면과 리포트가 다른 말을 하게 된다.
    scope: (r) => !r.isFork,
    violation: (r) => !r.model,
  },
  {
    id: 'chore-model',
    label: '잡무 모델',
    rule: '~/.claude/CLAUDE.md  판단이 필요 없는 잡무는 haiku 로 보낸다',
    source: 'delegations',
    scope: (r) => r.agentType === 'runner',
    violation: (r) => r.model !== 'haiku',
  },
  {
    id: 'agent-used',
    label: '하네스 활용',
    rule: '~/.claude/CLAUDE.md  안 쓰이는 규칙은 걷어낸다 (이 축만 전체 기간으로 본다)',
    source: 'agents',
    // 이 축만 리포트 창을 안 쓰고 저장소의 전체 기간으로 본다.
    // "정의가 죽었나"는 리포트 창이 아니라 그 질문 고유의 시간 축을 가진다.
    // 한 달에 한 번 쓰는 에이전트도 살아 있다.
    //
    // 위임 기록이 없는 저장소에서는 "호출 0회"가 당연히 참이라 판정이 무의미하다.
    // 실측: 하네스가 있는 저장소 6곳 중 4곳이 위임 0건이었고, 그대로 두면
    // 정의를 다 지우라는 뜻으로 읽힌다. 표본이 없으면 0% 가 아니라 판정 불가다.
    // 축이 전체 기간을 보므로 전제도 전체 기간을 본다.
    // 전제도 정의마다 갈린다. 전역 정의는 전 프로젝트 기록으로, 저장소 정의는
    // 이 저장소 기록으로 잰다. 하나라도 잴 근거가 있으면 축은 살아 있다.
    precondition: (sources) => sources.agents.some((a) => a.basis > 0),
    unavailable: '호출 기록이 없어 판정할 수 없다',
    scope: (a) => a.basis > 0,
    violation: (a) => a.calls === 0,
    describe: (a) => `${a.name} (${a.scope}) 호출 ${a.calls}회`,
  },
  {
    id: 'skill-declared-exists',
    label: '스킬 선언 무결성',
    rule: '에이전트가 선언한 스킬이 실재해야 한다',
    source: 'declaredSkills',
    scope: () => true,
    violation: (s) => !s.exists,
    // 전역 에이전트의 선언은 저장소마다 같은 위반으로 잡힌다. 판정은 맞지만
    // 어디 것인지 말해야 이 저장소를 고치는 일로 안 읽는다.
    describe: (s) => `${s.agent}${s.scope === 'global' ? ' (global)' : ''} → ${s.skill}${s.exists ? '' : ' (없음)'}`,
  },
  {
    id: 'hook-integrity',
    label: '훅 무결성',
    rule: '훅이 조용히 실패하면 규칙이 안 지켜져도 아무도 모른다',
    source: 'hooks',
    scope: () => true,
    violation: (h) => h.fail > 0,
    // 왜 실패했는지 같이 준다. 없으면 여러 줄이 서로 다른 문제처럼 보인다.
    // 실측: 실패 11건 중 9건이 `node: command not found` 하나였다.
    describe: (h) =>
      `${h.name}  ${h.fail}회 실패 / ${h.ok + h.fail}회 실행  (${h.project})` +
      (h.why?.length ? `\n        ${h.why.join('\n        ')}` : ''),
  },
]

// 관찰값 축. 목표값이 없다. 추세로만 본다.
//
// source: 'delegations' 가 붙은 축만 주별 추세를 낼 수 있다. 위임에는 줄마다 ts 가 있어서다.
// 세션이나 토큰이 필요한 축은 못 낸다. 그때는 추세를 그리는 대신 왜 못 그리는지 말한다.
// rows 에 dispatchId 가 붙어 있어야 한다(scan.mjs 의 withDispatch).
//
// 여기서 세는 단위는 위임 한 건이 아니라 디스패치 한 번이다.
// 한 번에 세 갈래를 띄웠으면 위임은 3건이고 디스패치는 1번이다.
export const observation = [
  {
    id: 'parallel-ratio',
    // 위임만 있으면 계산된다. 그래서 주별 추세를 낼 수 있다(series.mjs).
    source: 'delegations',
    label: '병렬 비율',
    note: '한 번 띄울 때 두 갈래 이상으로 나눈 비율',
    compute: ({ delegations }) => {
      const sizes = dispatchSizes(delegations)
      if (sizes.length === 0) return null
      return { value: sizes.filter((s) => s >= 2).length / sizes.length, unit: 'ratio', n: sizes.length }
    },
  },
  {
    id: 'parallel-width',
    // 위임만 있으면 계산된다. 그래서 주별 추세를 낼 수 있다(series.mjs).
    source: 'delegations',
    label: '평균 갈래',
    note: '디스패치 한 번당 평균 갈래 수. 1.0 이면 병렬을 전혀 안 쓴 것',
    compute: ({ delegations }) => {
      const sizes = dispatchSizes(delegations)
      if (sizes.length === 0) return null
      return { value: sizes.reduce((a, b) => a + b, 0) / sizes.length, unit: 'count', n: sizes.length }
    },
  },
  {
    id: 'guard-denials',
    label: '가드 차단',
    unavailable: '이 범위에 세션 기록이 없거나 턴이 0이다',
    // 누적 건수로 두면 창을 넓힐 때마다 그냥 커진다. 실측에서 7일 18건, 14일 42건, 30일 71건이었다.
    // 그러면 두 리포트를 비교할 수도 없고 추세로 읽을 수도 없다. 관찰값은 비율이어야 한다.
    //
    // 분모는 턴으로 잡는다. 세션은 길이가 제각각이라 세션당으로 재면 긴 세션 하나가 묻힌다.
    // 턴은 일 한 번 단위다. 같은 데이터로 100턴당 2.67 / 3.46 / 1.89 로 창과 무관하게 머문다.
    note: '100턴당 몇 번 막혔나. user-rejected 는 사람이, 나머지는 자동 가드가 막은 것',
    compute: ({ sessions }) => {
      if (!sessions?.length) return null
      const kinds = {}
      let turns = 0
      for (const s of sessions) {
        turns += s.turns
        for (const [k, v] of Object.entries(s.denials)) kinds[k] = (kinds[k] ?? 0) + v
      }
      // 턴이 없으면 분모가 없다. 0 이 아니라 판정 불가다.
      if (turns === 0) return null
      const total = Object.values(kinds).reduce((a, b) => a + b, 0)
      return { value: (total / turns) * 100, unit: 'count', n: turns, detail: { 합계: `${total}건`, ...kinds } }
    },
  },
  {
    id: 'delegation-share',
    label: '위임률',
    unavailable: '이 범위에 토큰 기록이 없다',
    // 2: scan.mjs 가 토큰 함정 셋을 고친 뒤. 이 저장소 12.05% → 23.51%, 전 프로젝트 24.19% → 44.57%.
    // compute 는 안 바뀌었으니 이걸 안 올리면 옛 스냅샷과 견줘 "나빠졌다"고 말한다.
    measure: 2,
    // 설계 문서에 "샘플 1건에서 86%"로만 적혀 있고 재는 법이 없었다.
    // 2026-08-27 에 후보를 다 재봤다. 도구 호출 기준 7.0%, 토큰 기준 22.5%.
    // 어느 것도 86% 가 아니고, 세션별 분포가 0.2%~80.3%(중앙값 30.3%)로 대단히 넓다.
    // 한 세션 표본으로는 아무것도 말할 수 없다. 병렬 수치와 같은 부류의 오류였다.
    //
    // 토큰으로 재되 캐시는 뺀다. 캐시 읽기는 같은 문맥을 다시 읽는 것이지 새 일이 아니다.
    // 캐시를 넣으면 문맥이 긴 메인 세션이 실제보다 많이 일한 것처럼 보인다.
    note: '서브에이전트가 쓴 토큰 비율. 높다고 잘 쓴 게 아니다. 계획과 통합은 메인이 하는 일이다',
    compute: ({ tokens }) => {
      if (!tokens?.size) return null
      let sub = 0
      let total = 0
      for (const t of tokens.values()) {
        sub += t.sub.in + t.sub.out
        total += t.main.in + t.main.out + t.sub.in + t.sub.out
      }
      if (total === 0) return null
      const used = [...tokens.values()].filter((t) => t.sub.in + t.sub.out > 0).length
      return { value: sub / total, unit: 'ratio', n: tokens.size, detail: { '위임을 쓴 세션': `${used}/${tokens.size}` } }
    },
  },
  {
    id: 'cache-hit',
    label: '캐시 적중률',
    unavailable: '이 범위에 토큰 기록이 없다',
    // 2: scan.mjs 가 토큰 함정 셋을 고친 뒤. 이 저장소 97.37% → 98.15%, 전 프로젝트 95.37% → 96.61%.
    measure: 2,
    note: '다시 읽은 문맥의 비율. 낮아지면 문맥이 자주 깨지고 있다는 뜻이다',
    compute: ({ tokens }) => {
      if (!tokens?.size) return null
      let read = 0
      let create = 0
      let fresh = 0
      for (const t of tokens.values()) {
        for (const side of [t.main, t.sub]) {
          read += side.cacheRead
          create += side.cacheCreate
          fresh += side.in
        }
      }
      const denom = read + create + fresh
      if (denom === 0) return null
      return { value: read / denom, unit: 'ratio', n: tokens.size }
    },
  },
  {
    id: 'subagent-outcome',
    // 위임만 있으면 계산된다. 그래서 주별 추세를 낼 수 있다(series.mjs).
    source: 'delegations',
    label: '서브에이전트 결말',
    // 상태는 부모 전사의 queue-operation 줄에 있고 tool-use-id 로 위임과 잇는다.
    // 그렇게 이으면 위임 한 건당 상태 하나가 되어 함정 3 이 저절로 풀린다.
    // 문서의 completed 3,782 / failed 75 는 그 이음 없이 줄을 센 값이라 두 배쯤 부풀려져 있었다.
    //
    // 상태를 못 잇는 위임이 있다. workflow-subagent 81건은 toolUseId 자체가 없다.
    // 워크플로 스크립트가 띄운 것이라 Agent 도구 호출이 아니다. 분모에서 빠진다.
    note: '끝난 상태를 아는 위임만 센다. 워크플로가 띄운 것은 알림이 없어 빠진다',
    compute: ({ delegations }) => {
      const known = delegations.filter((r) => r.status)
      if (known.length === 0) return null
      const kinds = {}
      for (const r of known) kinds[r.status] = (kinds[r.status] ?? 0) + 1
      const bad = known.length - (kinds.completed ?? 0)
      return { value: bad / known.length, unit: 'ratio', n: known.length, detail: kinds }
    },
  },
  {
    id: 'active-sessions',
    label: '지금 도는 세션',
    unavailable: '이 범위에 세션이 없다',
    // 실측(2026-08-26): 5분 1개, 15분 7개, 30분 8개, 60분 13개.
    // 5분은 너무 짧다. 서브에이전트가 도는 동안이나 사람이 읽는 동안에는 메인 파일이 안 자란다.
    note: '최근 15분 안에 전사가 자란 세션. 프로세스가 떠 있는 것과는 다르다',
    // 이건 시점 값이다. 지나간 주에 몇 개가 돌았는지는 물음 자체가 성립하지 않는다.
    noTrend: '지금 몇 개가 도는지는 시점 값이라 추세가 성립하지 않는다',
    compute: ({ sessions, now = Date.now() }) => {
      if (!sessions?.length) return null
      const cut = new Date(now - 15 * 60 * 1000).toISOString()
      return { value: sessions.filter((s) => s.mtime && s.mtime >= cut).length, unit: 'count', n: sessions.length }
    },
  },
  {
    id: 'stop-hook-time',
    label: '턴 마무리 훅 시간',
    unavailable: '이 범위에 턴 마무리 훅 기록이 없다',
    // 훅 전체가 아니다. subtype:'stop_hook_summary' 줄에만 durationMs 가 있어서 Stop 계열만
    // 잰다. 실측(2026-09-03, 전 프로젝트): attachment.hookName 은 169종 68,137건인데 그쪽엔
    // 시간도, 어느 스크립트가 돌았는지도 안 담긴다. stop_hook_summary 는 2,992줄이고 그 안의
    // command 는 9종이다. 반쪽을 전부인 것처럼 부르지 않으려고 이름을 "턴 마무리 훅"으로 뒀다.
    //
    // 누적이 아니라 한 번당 평균이다. 누적 ms 로 두면 창을 넓힐 때마다 커져서 두 리포트를
    // 비교할 수 없다(guard-denials 가 같은 이유로 100턴당을 쓴다). 실측: 전 프로젝트 누적이
    // 25.5분인데, 그 값은 "얼마나 오래 일했나"만 말하고 훅이 무거운지는 안 말한다.
    note: '턴이 끝날 때 Stop 훅 묶음이 먹는 평균 시간. 훅 전체가 아니라 Stop 계열만이다',
    compute: ({ sessions }) => {
      if (!sessions?.length) return null
      let runs = 0
      let ms = 0
      const byCommand = {}
      for (const s of sessions) {
        const h = s.stopHooks
        if (!h) continue // 옛 캐시로 읽힌 세션. 필드가 없으면 못 센다
        runs += h.runs
        ms += h.ms
        for (const [cmd, e] of Object.entries(h.byCommand ?? {})) {
          const t = (byCommand[cmd] ??= { runs: 0, ms: 0 })
          t.runs += e.runs
          t.ms += e.ms
        }
      }
      // 턴 마무리 훅이 한 번도 안 돌았으면 분모가 없다. 0ms 가 아니라 판정 불가다.
      if (runs === 0) return null
      // 오래 먹는 것부터. 훅 하나가 전체를 끌어올리는 일이 흔해서 합계만으로는 어디를
      // 손볼지 모른다 — 실측: stop-review-gate-hook 하나가 평균 162ms 로 가장 무거웠다.
      // 이름이 겹치면 순번을 붙인다. 합치지 않는 이유: 실측 11종 중 셋 쌍이 같은 이름으로
      // 갈린다(claude-hook.sh 4개, stop.py 2개). 따옴표만 다른 같은 스크립트일 수도, 다른
      // 플러그인의 같은 이름일 수도 있는데 command 문자열만 보고는 못 가른다
      // (${CLAUDE_PLUGIN_ROOT} 가 안 풀린 채 남는다). 합쳐서 하나로 보이면 그 사실을 잃는다.
      const detail = {}
      const used = new Map()
      for (const [cmd, e] of Object.entries(byCommand).sort((a, b) => b[1].ms - a[1].ms)) {
        const base = hookCommandName(cmd)
        const nth = (used.get(base) ?? 0) + 1
        used.set(base, nth)
        detail[nth === 1 ? base : `${base} (${nth})`] = `${Math.round(e.ms / e.runs)}ms × ${e.runs}회`
      }
      return { value: ms / runs, unit: 'ms', n: runs, detail }
    },
  },
]

// 훅 command 원문에서 사람이 읽을 이름을 뽑는다. 원문은 셸 한 줄이라 길다 — 실측 9종 중
// 가장 긴 것이 217자다(orca 훅의 존재 확인 분기). 스크립트 경로의 파일 이름이 가장 잘 가른다.
//
// 못 뽑으면 원문 앞부분을 그대로 낸다. 억지로 예쁘게 만들면 그게 어느 훅인지 흐려진다
// (desktop/app/model-name.mjs 의 prettyModelName 과 같은 결이다).
export function hookCommandName(cmd) {
  // cmd 를 후보에서 뺐다. orca 훅 래퍼는 Windows 분기(claude-hook.cmd)를 앞에 두고 뒤에서
  // claude-hook.sh 를 부른다 — 실측: .cmd 가 187번째 글자, .sh 가 1,625번째다. 첫 매치를
  // 쓰면 macOS 에서 실제로 도는 파일과 다른 이름이 나온다. Windows 기록에서는 이 규칙이
  // 반대로 틀린다. 문자열만 보고는 못 가른다.
  const script = cmd.match(/[\w.-]+\.(mjs|js|py|sh|ts)/)
  if (script) return script[0]
  // 따옴표로 감싼 절대경로 실행 파일. 실측 11종 중 GitKrakenCLI 의 gk 하나가 이 꼴이다
  // (경로에 공백이 있어 따옴표가 필수다). 확장자가 없어 위 규칙으로는 안 잡힌다.
  const quoted = cmd.match(/^"(\/[^"]+)"/)
  if (quoted) return quoted[1].split('/').pop()
  const bare = cmd.match(/^([\w-]+)\s/)
  if (bare) return bare[1]
  return cmd.length > 40 ? `${cmd.slice(0, 40)}…` : cmd
}

// 관찰값 하나를 사람이 읽을 문자열로. 같은 판정이 render.mjs 와 report.mjs 두 곳에 복사돼
// 있었다(CLAUDE.md: "같은 판정을 두 곳에 두지 않는다"). unit 을 하나 늘릴 때마다 두 곳을
// 고쳐야 했고, 한쪽만 고치면 화면과 터미널이 다른 말을 한다.
export function formatValue(value, unit) {
  if (value === null || value === undefined) return null
  if (unit === 'ratio') return `${(value * 100).toFixed(1)}%`
  if (unit === 'ms') return `${Math.round(value)}ms`
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

// 함정 2 와 함정 3 이 여기서 같이 걸린다.
//   묶는 키가 dispatchId 여야 한다. 배열 길이로 세면 항상 1.00 이 나온다
//   세는 대상이 meta.json 한 건이어야 한다. 전사의 tool_use 블록을 세면
//   부모 블록이 자식 전사에 복사돼 갈래가 1.6배로 부푼다
//
// 실측: 복사본을 세면 병렬 52.8% 평균 2.30, 중복을 빼면 33% 평균 1.6.
function dispatchSizes(rows) {
  const groups = new Map()
  for (const r of rows) {
    // dispatchId 가 없는 것은 Agent 도구 호출이 아니었다는 뜻이다.
    // 실측하면 workflow-subagent 81건이 그렇다. 워크플로 스크립트가 직접 띄운 것이라
    // toolUseId 자체가 없다. fork 는 여기 안 든다. fork 82건은 전부 dispatchId 가 있다.
    if (!r.dispatchId) continue
    groups.set(r.dispatchId, (groups.get(r.dispatchId) ?? 0) + 1)
  }
  return [...groups.values()]
}

// 사용자 축을 얹는다. 없으면 기본만 쓴다.
//
// 축 정의 문법을 새로 만들지 않는다. 내 기계에서 내가 쓰는 도구라 JS 모듈이면 충분하다.
// `~/.harness-bro/axes.mjs` 가 이렇게 생기면 된다.
//
//   export const compliance = [
//     { id: 'my-rule', label: '내 규칙', rule: '...', source: 'delegations',
//       scope: (r) => true, violation: (r) => !r.model }
//   ]
//   export const disable = ['chore-model']   // 기본 축 끄기
//
// 규칙이 바뀌면 앱이 아니라 이 파일만 고친다.
export async function loadAxes({ file = userAxesPath(), onError = console.error } = {}) {
  let extra = null
  if (fs.existsSync(file)) {
    try {
      extra = await import(pathToFileURL(file).href)
    } catch (e) {
      // 조용히 넘어가면 안 된다. 사용자는 자기 축이 도는 줄 알고 있다.
      onError(`축 파일을 못 읽었다: ${file}\n  ${e.message}\n  기본 축으로 돈다.`)
    }
  }
  const off = new Set(extra?.disable ?? [])
  const kinds = {
    compliance: compliance.filter((a) => !off.has(a.id)),
    observation: observation.filter((a) => !off.has(a.id)),
  }

  // id 는 준수율과 관찰값을 가로질러 전역이다. 스냅샷과 주별 추세가 id 로만 축을 찾는다.
  //   snapshot.mjs  Object.fromEntries(report.compliance.map((c) => [c.id, ...]))
  //   series.mjs    준수율과 관찰값을 한 맵에 같이 담는다
  //
  // 그래서 겹치면 나중 것이 앞 것을 덮는다. 실측(2026-08-28): 기본 축 model-explicit 과
  // 같은 id 로 사용자 축을 얹으니 화면이 "모델 명시 97.7%" 라고 하면서 그 아래 추세는
  // 남의 축 값인 0% 를 다섯 주 내리 그렸다. 표시값과 추세가 다른 축을 말한다.
  //
  // 기본 축이 먼저 자리를 잡는다. 사용자 오타 하나가 멀쩡한 기본 축을 지우면 안 된다.
  // 준수율 축에 cache-hit 이라고 적었더니 기본 관찰값 캐시 적중률이 사라졌다.
  //
  // 덮어쓰기를 뜻으로 삼지 않는다. 기본 축을 바꾸는 길은 이미 disable 로 있다.
  // 조용히 넘어가지 않는다. 사용자는 자기 축이 도는 줄 알고 있다.
  const seen = new Map([...kinds.compliance, ...kinds.observation].map((a) => [a.id, '기본 축']))
  for (const kind of ['compliance', 'observation']) {
    for (const axis of extra?.[kind] ?? []) {
      if (seen.has(axis.id)) {
        onError(`축 id 가 겹친다: ${axis.id} (이미 ${seen.get(axis.id)}에 있다). 이 축을 뺐다.\n  기본 축을 바꾸려면 disable 로 끄고 같은 id 를 다시 쓰면 된다.`)
        continue
      }
      seen.set(axis.id, '사용자 축')
      kinds[kind].push(axis)
    }
  }
  return { ...kinds, from: extra ? file : null }
}

export function userAxesPath() {
  return process.env.HARNESS_BRO_AXES ?? path.join(os.homedir(), '.harness-bro', 'axes.mjs')
}

// 축의 근거가 아직 그 줄을 가리키나.
//
// 근거를 `~/.claude/CLAUDE.md:9` 처럼 줄 번호로 적어뒀는데, 그 파일을 편집하면
// 줄 번호가 조용히 어긋난다. 리포트는 계속 9번 줄이 근거라고 말하지만 실제로는 딴 줄이다.
//
// 이 앱이 남의 하네스에서 찾아주는 죽은 참조와 똑같은 모양이다. 자기 것부터 본다.
// 근거는 `파일  문구` 다. 줄 번호는 박지 않고 읽을 때 찾는다.
//
// 박아뒀다가 실제로 어긋났다. 전역 CLAUDE.md 가 네 줄 자라면서 어느 축의
// 53번 줄이 빈 줄이 됐다. 남의 홈에서는 더 심하다. 앞에 여섯 줄만 덧붙인
// CLAUDE.md 로 재보니 줄을 가리키는 축 세 개가 전부 어긋났다. 문구는 그
// 파일에 그대로 있는데도. 줄 번호는 파생값이라 근거가 될 수 없다.
//
// 파일 이름은 pathLike 로 가른다. 사용자 축은 남이 쓰는 것이라 rule 형태를
// 예측할 수 없다. 두 칸 공백이 든 산문이 오면 첫 단어를 파일로 읽으려 든다.
const CITE = /^(\S+)\s{2,}(.+)$/

function locate(rule) {
  const m = String(rule ?? '').match(CITE)
  if (!m) return null // 줄을 안 가리키는 근거는 검사 대상이 아니다
  const [, where, text] = m
  const file = pathLike(where)
  if (!file) return null // 파일 이름이 아니면 그냥 산문이다
  // 내가 덧붙인 괄호 설명은 원문에 없다. 떼고 찾는다
  const quote = text.replace(/\s*\([^)]*\)\s*$/, '').trim()
  let lines
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n')
  } catch {
    return { where, file, quote, reason: `${where} 를 못 읽어 판정할 수 없다` }
  }
  const at = lines.findIndex((l) => l.includes(quote))
  if (at === -1) return { where, file, quote, reason: `${where} 에 그 규칙이 없어 판정할 수 없다: ${quote.slice(0, 40)}` }
  return { where, file, quote, line: at + 1 }
}

// 근거를 한 번 읽어 둘을 낸다. 표시할 줄 번호와, 못 찾았으면 그 이유.
//
// 못 찾았을 때 그냥 경고만 띄우고 계속 재면 리포트가 거짓말한다. 기본 축 다섯 중
// 셋이 내 전역 CLAUDE.md 문구에 걸려 있어서, 그 규칙을 안 쓰는 사람에게도
// "98.1% 준수"라고 말해버린다. 그건 내 규칙에 대한 준수율이다. 분모가 비면
// 판정 불가인 것과 같은 결로, 근거가 없으면 판정 불가다.
export function citation(rule) {
  const at = locate(rule)
  return {
    rule: at?.line ? rule.replace(at.where, `${at.where}:${at.line}`) : rule,
    missing: at?.reason ?? null,
  }
}

export function checkCitations(axes = compliance) {
  const out = []
  for (const axis of axes) {
    const at = locate(axis.rule)
    if (at?.reason) out.push({ axis: axis.id, cite: at.where, file: at.file, reason: at.reason })
  }
  return out
}

// 축이 무엇을 재는지의 지문.
//
// 스냅샷은 축 id 로 옛 값과 견준다. 그런데 축의 뜻이 바뀌면 같은 id 로 다른 것을
// 재게 된다. 실측(2026-08-27): guard-denials 를 누적 건수에서 100턴당으로 바꿨는데
// delta 가 `74 → 3.95, diff -70.05` 를 내며 "엄청 좋아졌다"고 말했다. 단위가 바뀐
// 것을 습관 변화로 읽는다. 서브에이전트 훅을 분모에 넣었을 때도 "0.04%p 나빠졌다"고
// 했다. 도구가 정확해진 것인데.
//
// 재는 방식만 넣는다. label·rule·note·describe 는 표시용이라 바뀌어도 뜻이 같다.
// 주석과 공백은 뗀다. 안 떼면 주석 한 줄 고칠 때마다 비교를 잃는다.
const strip = (v) =>
  String(v ?? '')
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    .replace(/\s+/g, '')

// compute 는 그대로인데 뜻이 바뀌는 축이 있다. 축이 읽는 사실을 scan.mjs 가 다르게 뽑으면
// 여기 소스는 한 글자도 안 바뀌는데 값이 뛴다. 실측(2026-09-13): 토큰 함정 셋(한 턴 안에서
// usage 가 줄마다 복사됨 / 같은 message.id 가 파일 경계를 넘어 겹침 / <synthetic> 줄)을
// 고치자 이 저장소 캐시 적중률이 97.37% → 98.15%, 위임률이 12.05% → 23.51% 로 움직였다.
// 지문이 그대로면 watch·snapshot 이 옛 스냅샷과 견줘 "나빠졌다"고 말한다. 도구가 정확해진 건데.
//
// 그래서 축이 자기 재는 방식의 판 번호를 들 수 있게 했다. `measure` 를 올리면 그 축만
// 비교가 끊긴다. 안 든 축은 parts 가 글자 그대로라 지문도 그대로다 — 한 축 고치자고
// 전체 비교를 잃지 않으려고 앞이 아니라 뒤에 붙인다.
export function axisFingerprint(axis) {
  const parts = [axis.id, axis.source ?? '', axis.unit ?? '', axis.scope, axis.violation, axis.precondition, axis.compute]
  if (axis.measure) parts.push(`measure:${axis.measure}`)
  return createHash('sha1').update(parts.map(strip).join('\u0000')).digest('hex').slice(0, 8)
}
