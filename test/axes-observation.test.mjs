// 관찰값은 추세로 읽는 값이다. 그러려면 창을 넓혔을 때 그냥 커지면 안 된다.
// 누적 건수는 그 조건을 못 지킨다.
//   node --test test/axes-observation.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observation, compliance, hookCommandName, formatValue } from '../src/axes.mjs'
import { agentRows, measure, observe } from '../src/report.mjs'

const guard = observation.find((a) => a.id === 'guard-denials')
const session = (turns, denials) => ({ turns, denials })

test('가드 차단은 건수가 아니라 비율이다', () => {
  // 같은 밀도의 데이터가 두 배로 늘어도 값이 그대로여야 창을 넘어 비교된다.
  const small = guard.compute({ sessions: [session(100, { 'user-rejected': 2 })] })
  const big = guard.compute({
    sessions: [session(100, { 'user-rejected': 2 }), session(100, { 'user-rejected': 2 })],
  })
  assert.equal(small.value, big.value)
  assert.equal(small.value, 2) // 100턴당 2회
})

test('진짜로 자주 막히면 값이 오른다', () => {
  const calm = guard.compute({ sessions: [session(100, { 'permission-rule': 1 })] })
  const noisy = guard.compute({ sessions: [session(100, { 'permission-rule': 5 })] })
  assert.ok(noisy.value > calm.value)
})

test('턴이 없으면 0 이 아니라 판정 불가다', () => {
  // 분모가 없는 것과 한 번도 안 막힌 것은 다르다.
  assert.equal(guard.compute({ sessions: [session(0, {})] }), null)
  assert.equal(guard.compute({ sessions: [] }), null)
})

test('막은 주체를 종류별로 남긴다', () => {
  const r = guard.compute({ sessions: [session(100, { 'user-rejected': 1, 'permission-rule': 3 })] })
  assert.equal(r.detail['user-rejected'], 1)
  assert.equal(r.detail['permission-rule'], 3)
  assert.equal(r.detail['합계'], '4건')
})

test('지금 도는 세션은 15분으로 가른다', () => {
  const axis = observation.find((a) => a.id === 'active-sessions')
  const now = Date.parse('2026-08-27T12:00:00Z')
  const at = (min) => ({ mtime: new Date(now - min * 60000).toISOString() })
  // 실측에서 경계가 깨끗하게 갈렸다. 6.1분 전이 마지막이고 그다음이 21.3분 전이었다.
  const r = axis.compute({ sessions: [at(0.4), at(6.1), at(14.9), at(15.1), at(21.3)], now })
  assert.equal(r.value, 3)
  assert.equal(r.n, 5)
})

// 준수율 쪽에도 같은 검사를 한다. 창을 좁혔을 때 판정이 뒤집히면 안 된다.

const used = compliance.find((a) => a.id === 'agent-used')

test('하네스 활용은 리포트 창이 아니라 전체 기간으로 본다', () => {
  // 실측: app-a 의 frontend-reviewer 가 14일 창에서 "호출 0회"로 잡혔는데
  // 30일 창에서는 쓰였다. 짧은 창으로 돌리면 살아 있는 정의를 지우라고 말하게 된다.
  // 한 달에 한 번 쓰는 에이전트도 살아 있다.
  const agents = [{ name: 'reviewer', scope: 'repo', calls: 3, basis: 3 }]
  const sources = {
    delegations: [], // 이 창 안에는 위임이 없다
    delegationsAllTime: [{ agentType: 'reviewer' }, { agentType: 'reviewer' }, { agentType: 'reviewer' }],
    agents,
  }
  const [m] = measure(sources, [used])
  assert.equal(m.unavailable, undefined) // 판정 불가가 아니다
  assert.equal(m.violations, 0) // 죽었다고 하지 않는다
})

test('저장소에 위임 이력이 아예 없으면 그때는 판정 불가다', () => {
  // 창이 비어 있는 것과 이력이 없는 것은 다르다.
  const sources = { delegations: [], delegationsAllTime: [], agents: [{ name: 'x', scope: 'repo', calls: 0, basis: 0 }] }
  const [m] = measure(sources, [used])
  assert.match(m.unavailable, /호출 기록이 없어/)
})

test('전체 기간에도 호출이 0이면 죽은 정의다', () => {
  const sources = {
    delegations: [],
    delegationsAllTime: [{ agentType: 'other' }],
    agents: [{ name: 'dead', scope: 'repo', calls: 0, basis: 1 }],
  }
  const [m] = measure(sources, [used])
  assert.equal(m.violations, 1)
  assert.match(m.samples[0], /dead/)
})

test('전역 정의는 다른 저장소에서 쓰였으면 살아 있다', () => {
  // 이 축이 기간을 안 좁히는 것과 같은 이유다. 다른 저장소에서만 쓰는 전역
  // 에이전트도 살아 있다. 범위를 좁히면 멀쩡한 정의를 지우라고 말하게 된다.
  // 실측: general-purpose 가 harness-bro 에서 0회인데 전 프로젝트로는 594회다.
  const defs = [
    { name: 'shared', scope: 'global' },
    { name: 'local', scope: 'repo' },
  ]
  const here = [] // 이 저장소에는 위임이 없다
  const anywhere = [{ agentType: 'shared' }, { agentType: 'shared' }]
  const rows = agentRows(null, here, anywhere, defs)

  const shared = rows.find((a) => a.name === 'shared')
  assert.equal(shared.calls, 2) // 다른 저장소 호출이 잡힌다
  assert.equal(shared.basis, 2)

  const local = rows.find((a) => a.name === 'local')
  assert.equal(local.calls, 0)
  assert.equal(local.basis, 0) // 저장소 정의는 잴 근거가 없다

  // 잴 근거가 없는 정의는 분모에서 빠지고, 전역 정의만 판정된다
  const [m] = measure({ delegations: [], delegationsAllTime: [], agents: rows }, [used])
  assert.equal(m.total, 1)
  assert.equal(m.violations, 0) // 살아 있는 정의를 지우라고 하지 않는다
})

// 실측(2026-08-28, 이 저장소): 위임 0건이라 관찰값 3개가 판정 불가였는데
// 셋 다 "표본이 없거나 분모가 모자라다"였다. 같은 상황에서 준수율 축은
// "이 범위에 위임 기록이 없다"고 단위 이름을 말하고 있었다.
test('관찰값도 무엇이 없어서 못 쟀는지 단위 이름으로 말한다', () => {
  const rows = observe({ delegations: [], sessions: [], tokens: new Map() })

  // 하나도 빠짐없이 이유가 있어야 한다. 하나만 비어도 그 축이 "해당 없음"이 된다.
  const nulls = rows.filter((o) => o.value === null || o.value === undefined)
  assert.equal(nulls.length, rows.length)
  for (const o of nulls) assert.ok(o.unavailable, `${o.id} 가 이유를 안 남겼다`)

  // 단위를 안 적은 축을 위임으로 떠넘기면 세션 축이 거짓말한다
  assert.match(rows.find((o) => o.id === 'parallel-ratio').unavailable, /위임/)
  assert.match(rows.find((o) => o.id === 'guard-denials').unavailable, /세션/)
  assert.match(rows.find((o) => o.id === 'delegation-share').unavailable, /토큰/)
})

test('축이 이유를 안 적어도 위임 기록 탓으로 돌리지 않는다', () => {
  // 사용자 축은 source 도 unavailable 도 안 적을 수 있다.
  const [o] = observe({ delegations: [{ ts: 'x' }] }, [{ id: 'mine', label: '내 축', compute: () => null }])
  assert.equal(o.value, null)
  assert.doesNotMatch(o.unavailable, /위임/)
})

// ---------- 턴 마무리 훅 시간 (stop-hook-time) ----------
//
// 훅 시간은 subtype:'stop_hook_summary' 줄에만 있다. 그래서 "훅 전체"가 아니라 Stop 계열만
// 잰다. 이 검사가 지키는 것은 그 반쪽을 전부인 것처럼 부르지 않는 것과, 이름이 겹치는 훅을
// 합쳐서 잃지 않는 것이다.

const stopHook = observation.find((a) => a.id === 'stop-hook-time')
const withHooks = (runs, byCommand) => ({
  turns: runs,
  denials: {},
  stopHooks: { runs, ms: Object.values(byCommand).reduce((a, e) => a + e.ms, 0), byCommand },
})

test('턴 마무리 훅 시간은 누적이 아니라 한 번당 평균이다', () => {
  // 같은 밀도가 두 배로 늘어도 값이 그대로여야 창을 넘어 비교된다. 누적 ms 로 두면
  // 창을 넓힐 때마다 커져서 두 리포트를 견줄 수 없다(가드 차단이 100턴당을 쓰는 것과 같다).
  const one = withHooks(10, { 'a.sh': { runs: 10, ms: 1000 } })
  const small = stopHook.compute({ sessions: [one] })
  const big = stopHook.compute({ sessions: [one, one] })
  assert.equal(small.value, big.value)
  assert.equal(small.value, 100) // 1000ms / 10회
})

test('훅이 무거워지면 값이 오른다', () => {
  const light = stopHook.compute({ sessions: [withHooks(10, { 'a.sh': { runs: 10, ms: 200 } })] })
  const heavy = stopHook.compute({ sessions: [withHooks(10, { 'a.sh': { runs: 10, ms: 2000 } })] })
  assert.ok(heavy.value > light.value)
})

test('턴 마무리 훅이 한 번도 안 돌았으면 0ms 가 아니라 판정 불가다', () => {
  assert.equal(stopHook.compute({ sessions: [] }), null)
  assert.equal(stopHook.compute({ sessions: [withHooks(0, {})] }), null)
})

test('stopHooks 를 모르는 옛 캐시 세션이 섞여도 안 죽는다', () => {
  // 추출 함수 지문이 바뀌면 캐시가 갈리지만, 한 실행 안에서 옛 모양이 섞여 들어올 수 있다.
  const mixed = stopHook.compute({ sessions: [{ turns: 5, denials: {} }, withHooks(10, { 'a.sh': { runs: 10, ms: 500 } })] })
  assert.equal(mixed.value, 50)
  assert.equal(mixed.n, 10)
})

test('이름이 겹치는 훅을 합치지 않는다', () => {
  // 실측(2026-09-03): command 11종 중 셋 쌍이 같은 파일 이름으로 갈린다
  // (claude-hook.sh 4개, stop.py 2개). 합치면 그게 몇 개였는지를 잃는다.
  const o = stopHook.compute({
    sessions: [
      withHooks(2, {
        "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/stop.py": { runs: 2, ms: 200 },
        'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/stop.py"': { runs: 2, ms: 100 },
      }),
    ],
  })
  assert.deepEqual(Object.keys(o.detail), ['stop.py', 'stop.py (2)'])
})

test('훅 이름을 실측 11종 전부에서 뽑는다', () => {
  // 2026-09-03 전 프로젝트 전사에 실제로 있던 command 다. 못 뽑으면 원문 앞부분이
  // 그대로 나와 목록이 못 읽는 문자열로 채워진다.
  const cases = [
    ['node "${CLAUDE_PLUGIN_ROOT}/scripts/stop-review-gate-hook.mjs"', 'stop-review-gate-hook.mjs'],
    ['${CLAUDE_PLUGIN_ROOT}/scripts/on-stop.sh', 'on-stop.sh'],
    ['python3 ${CLAUDE_PLUGIN_ROOT}/hooks/stop.py', 'stop.py'],
    ['python3 "${CLAUDE_PLUGIN_ROOT}/hooks/stop.py"', 'stop.py'],
    ['python3 "${CLAUDE_PLUGIN_ROOT}"/hooks/handoff.py stop', 'handoff.py'],
    ['"/Users/x/Library/Application Support/GitKrakenCLI/gk" ai hook run --host claude-code', 'gk'],
    ["osascript -e 'display notification \"Turn finished\"'", 'osascript'],
    ["if [ -f '/Users/x/.orca/agent-hooks/claude-hook.sh' ]; then /bin/sh '/Users/x/.orca/agent-hooks/claude-hook.sh'; fi", 'claude-hook.sh'],
  ]
  for (const [cmd, want] of cases) assert.equal(hookCommandName(cmd), want, cmd.slice(0, 50))
})

test('Windows 분기가 앞에 있어도 실제로 도는 .sh 를 고른다', () => {
  // orca 훅 래퍼는 claude-hook.cmd 를 187번째 글자에, claude-hook.sh 를 1,625번째에 둔다.
  // 첫 매치를 쓰되 cmd 를 후보에서 뺐다 — macOS 기록에서는 이게 맞고 Windows 에서는 틀린다.
  const wrapper = 'if [ -z "${HOME-}" ]; then :; else case "${OSTYPE-}" in msys*) claude-hook.cmd ;; *) /bin/sh "${HOME}/.orca/agent-hooks/claude-hook.sh" ;; esac; fi'
  assert.equal(hookCommandName(wrapper), 'claude-hook.sh')
})

test('관찰값 표시를 한 곳에서 만든다', () => {
  // 같은 판정이 render.mjs 와 report.mjs 두 곳에 복사돼 있었다. unit 을 하나 늘릴 때마다
  // 두 곳을 고쳐야 했고, 한쪽만 고치면 화면과 터미널이 다른 말을 한다.
  assert.equal(formatValue(0.823, 'ratio'), '82.3%')
  assert.equal(formatValue(401.256, 'ms'), '401ms')
  assert.equal(formatValue(3, 'count'), '3')
  assert.equal(formatValue(1.5, 'count'), '1.50')
  assert.equal(formatValue(null, 'ms'), null)
  assert.equal(formatValue(undefined, 'ratio'), null)
})
