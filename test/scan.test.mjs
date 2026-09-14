// 측정 함정이 다시 살아나는지만 본다. 함정마다 하나씩.
//   node --test test/scan.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-'))

function meta(rel, obj) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(obj))
}

const S = 'proj-a/11111111-1111-1111-1111-111111111111'
// agent-1 과 agent-2 는 한 번에 같이 띄운 두 갈래다. 같은 message.id 를 공유한다.
meta(`${S}/subagents/agent-1.meta.json`, { agentType: 'general-purpose', model: 'sonnet', spawnDepth: 1, toolUseId: 'toolu_1' })
meta(`${S}/subagents/agent-2.meta.json`, { agentType: 'general-purpose', spawnDepth: 1, toolUseId: 'toolu_2' }) // model 없음 → 위반
// fork 도 Agent 도구 호출이라 toolUseId 를 갖는다. 실측 82건 전부 그렇다.
meta(`${S}/subagents/agent-3.meta.json`, { agentType: 'fork', isFork: true, spawnDepth: 1, toolUseId: 'toolu_3' }) // 모델 명시 분모에서만 빠진다
meta(`${S}/subagents/agent-4.meta.json`, { agentType: 'runner', model: 'haiku', spawnDepth: 1, toolUseId: 'toolu_4' })
meta(`${S}/subagents/agent-5.meta.json`, { agentType: 'runner', model: 'sonnet', spawnDepth: 1, toolUseId: 'toolu_5' }) // 잡무 위반
// 함정 5. 워크플로 에이전트는 한 단계 더 깊다
meta(`${S}/subagents/workflows/wf_abc/agent-6.meta.json`, { agentType: 'workflow-subagent', spawnDepth: 1, toolUseId: 'toolu_6' })
// 함정 4. subagents/ 아래 jsonl 은 세션이 아니다
// 서브에이전트 전사에도 훅 기록이 있다. SubagentStart 계열은 본 세션에 아예 안 나온다.
// 실측: 그 훅 2,947건과 실패 1건이 집계에서 통째로 빠져 있었다.
const hookLine = (o) => JSON.stringify({ type: 'attachment', timestamp: '2026-08-01T00:00:10Z', attachment: o })
fs.writeFileSync(
  path.join(root, S, 'subagents', 'agent-1.jsonl'),
  [
    '{"timestamp":"2026-08-01T00:00:00Z"}',
    hookLine({ type: 'hook_success', hookName: 'SubagentStart:general-purpose', hookEvent: 'SubagentStart' }),
    // 취소는 사람이 누른 게 아니라 시간 초과다. 잘린 훅은 규칙을 적용하지 못했다
    hookLine({
      type: 'hook_cancelled',
      hookName: 'SubagentStart:general-purpose',
      hookEvent: 'SubagentStart',
      timedOut: true,
      timeoutMs: 5000,
      durationMs: 7651,
    }),
    // 서브에이전트에서도 도구가 막힌다. 실측: 차단 132건 중 58건이 여기서 났다
    JSON.stringify({ type: 'user', timestamp: '2026-08-01T00:00:20Z', toolDenialKind: 'permission-rule' }),
    JSON.stringify({ type: 'user', timestamp: '2026-08-01T00:00:21Z', toolDenialKind: 'permission-rule' }),
  ].join('\n') + '\n',
)

// 부모 전사. 함정 2 대로 병렬 호출이 별도 줄로 기록된다.
const line = (mid, tid) =>
  JSON.stringify({
    type: 'assistant',
    message: { id: mid, content: [{ type: 'tool_use', id: tid, name: 'Agent', input: {} }] },
  })
fs.writeFileSync(
  path.join(root, `${S}.jsonl`),
  [
    '{"timestamp":"2026-08-01T00:00:00Z"}',
    line('msg_A', 'toolu_1'), // 같은 msg_A 를 공유하는 두 갈래
    line('msg_A', 'toolu_2'),
    line('msg_B', 'toolu_3'),
    line('msg_B', 'toolu_4'), // msg_B 는 fork 와 runner 를 같이 띄웠다
    line('msg_C', 'toolu_5'),
    line('msg_D', 'toolu_6'),
  ].join('\n') + '\n',
)
// 함정 3. 부모의 tool_use 블록이 자식 전사에 그대로 복사돼 있다. 세면 갈래가 부푼다.
fs.writeFileSync(
  path.join(root, S, 'subagents', 'agent-2.jsonl'),
  ['{"timestamp":"2026-08-01T00:00:00Z"}', line('msg_A', 'toolu_1'), line('msg_A', 'toolu_2')].join('\n') + '\n',
)

// 세션 전사에 실물과 같은 모양의 줄을 심는다.
const S2 = 'proj-a/22222222-2222-2222-2222-222222222222'
fs.writeFileSync(
  path.join(root, `${S2}.jsonl`),
  [
    { type: 'assistant', timestamp: '2026-08-02T00:00:00Z', cwd: '/repo/x', gitBranch: 'main', version: '2.0.0', message: { model: 'claude-opus-5' }, effort: 'xhigh' },
    { type: 'assistant', timestamp: '2026-08-02T00:01:00Z', message: { model: '<synthetic>' } }, // 진짜 호출이 아니다
    { type: 'attachment', timestamp: '2026-08-02T00:02:00Z', attachment: { type: 'hook_success', hookName: 'Stop', hookEvent: 'Stop' } },
    { type: 'attachment', timestamp: '2026-08-02T00:03:00Z', attachment: { type: 'hook_additional_context', hookName: 'Stop', hookEvent: 'Stop' } }, // 정상이다
    { type: 'attachment', timestamp: '2026-08-02T00:04:00Z', attachment: { type: 'hook_non_blocking_error', hookName: 'Stop', hookEvent: 'Stop' } }, // 실패다
    { type: 'user', timestamp: '2026-08-02T00:05:00Z', toolDenialKind: 'user-rejected' },
    { type: 'system', subtype: 'turn_duration', durationMs: 1000, timestamp: '2026-08-02T00:06:00Z' },
    { type: 'assistant', timestamp: '2026-08-02T00:07:00Z', attributionSkill: 'korean-tone' },
  ]
    .map((o) => JSON.stringify(o))
    .join('\n') + '\n',
)

// 토큰이 붙은 줄. 메인과 서브가 따로 세어져야 한다.
const usage = (o) => JSON.stringify({ type: 'assistant', message: { usage: o } })
fs.appendFileSync(
  path.join(root, `${S2}.jsonl`),
  usage({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 10 }) + '\n',
)
fs.appendFileSync(
  path.join(root, S, 'subagents', 'agent-1.jsonl'),
  usage({ input_tokens: 300, output_tokens: 200, cache_read_input_tokens: 100 }) + '\n',
)

process.env.HARNESS_BRO_ROOT = root
const { delegations, sessionFiles, withDispatch, sessions, transcriptPass } = await import('../src/scan.mjs')
const { measure, observe, hookRows } = await import('../src/report.mjs')
const rows = delegations(root)
const joined = withDispatch(rows, root)

test('함정 5: workflows/ 아래 에이전트도 센다', () => {
  assert.equal(rows.length, 6)
  assert.equal(rows.filter((r) => r.workflowId === 'wf_abc').length, 1)
})

test('함정 4: subagents/ 아래 jsonl 은 세션이 아니다', () => {
  // 세션 파일 2개, subagents/ 아래 전사 2개. 무필터로 세면 4개가 된다.
  assert.equal(sessionFiles(root).length, 2)
})

test('함정 1: fork 는 모델 명시 분모에서 빠진다', () => {
  const [modelExplicit] = measure(rows)
  // 6건 중 fork 1건을 빼 5건, 그중 model 없음이 agent-2 와 agent-6 둘
  assert.equal(modelExplicit.total, 5)
  assert.equal(modelExplicit.violations, 2)
})

test('잡무 축은 runner 만 본다', () => {
  const [, chore] = measure(rows)
  assert.equal(chore.total, 2)
  assert.equal(chore.violations, 1)
})

test('시작 시각은 전사 첫 줄에서 온다', () => {
  assert.equal(rows.find((r) => r.agentId === 'agent-1').ts, '2026-08-01T00:00:00Z')
})

test('함정 2: 병렬 호출은 dispatchId 로 묶인다', () => {
  // agent-1 과 agent-2 는 msg_A 를 공유한다. 배열 길이로 세면 각각 1갈래로 보인다.
  const byDispatch = new Map()
  for (const r of joined) {
    if (!r.dispatchId) continue
    byDispatch.set(r.dispatchId, (byDispatch.get(r.dispatchId) ?? 0) + 1)
  }
  assert.equal(byDispatch.get('msg_A'), 2)
  assert.equal(byDispatch.size, 4) // msg_A, msg_B, msg_C, msg_D
})

test('디스패치에서 빠지는 것은 fork 가 아니라 toolUseId 가 없는 것이다', () => {
  // 한동안 "fork 는 dispatchId 가 없다"고 적어뒀는데 틀렸다.
  // 실측하면 fork 82건은 전부 dispatchId 가 있고, 빠지는 것은 workflow-subagent 81건이다.
  // 워크플로 스크립트가 직접 띄운 것이라 Agent 도구 호출이 아니다.
  assert.equal(joined.find((r) => r.agentType === 'fork').dispatchId, 'msg_B')
  assert.equal(joined.find((r) => r.agentType === 'workflow-subagent').dispatchId, 'msg_D')
})

test('세션은 cwd 로 저장소에 잇는다. 슬러그를 되돌리지 않는다', () => {
  const s = sessions(root).find((x) => x.sessionId.startsWith('22222222'))
  assert.equal(s.repo, '/repo/x')
  assert.equal(s.startedAt, '2026-08-02T00:00:00Z')
  assert.equal(s.endedAt, '2026-08-02T00:07:00Z')
})

test('디렉터리를 옮긴 세션은 거쳐온 곳을 다 기억한다', () => {
  // resume 로 다른 저장소에서 이어가면 전사 한 파일에 cwd 가 둘 들어온다.
  // 첫 cwd 만 잡으면 시작한 곳에 달려서 지금 일하는 저장소가 비어 보인다.
  // 실제로 이 앱을 만든 세션이 omija 에서 시작해 harness-bro 로 옮겼고,
  // 그 탓에 harness-bro 리포트가 "세션 0개"로 나왔다.
  const moved = 'proj-a/44444444-4444-4444-4444-444444444444'
  fs.writeFileSync(
    path.join(root, `${moved}.jsonl`),
    [
      { type: 'assistant', timestamp: '2026-08-03T00:00:00Z', cwd: '/repo/before' },
      { type: 'assistant', timestamp: '2026-08-03T01:00:00Z', cwd: '/repo/after' },
    ]
      .map((o) => JSON.stringify(o))
      .join('\n') + '\n',
  )
  const s = sessions(root, { cache: false }).find((x) => x.sessionId.startsWith('44444444'))
  assert.equal(s.repo, '/repo/after') // 지금 있는 곳
  assert.deepEqual(s.repos, ['/repo/before', '/repo/after']) // 거쳐온 곳 전부
})

test('hook_additional_context 는 실패가 아니다', () => {
  const s = sessions(root).find((x) => x.sessionId.startsWith('22222222'))
  // 성공 1 + 부가 문맥 1 = 정상 2, 오류 1 = 실패 1
  assert.deepEqual({ ok: s.hooks.Stop.ok, fail: s.hooks.Stop.fail }, { ok: 2, fail: 1 })
  assert.equal(hookRows([s]).find((h) => h.name === 'Stop').fail, 1)
})

test('사람이 거부한 것도 잡힌다', () => {
  const s = sessions(root).find((x) => x.sessionId.startsWith('22222222'))
  assert.deepEqual(s.denials, { 'user-rejected': 1 })
  assert.equal(s.turns, 1)
})

test('메인 세션이 쓴 모델을 센다 — <synthetic> 은 걸러진다', () => {
  // S2 fixture 에 두 assistant 줄이 있다: claude-opus-5 하나, <synthetic> 하나.
  // <synthetic> 은 진짜 호출이 낸 모델이 아니라 시스템이 넣은 자리표시자다.
  const s = sessions(root).find((x) => x.sessionId.startsWith('22222222'))
  assert.deepEqual(s.models, { 'claude-opus-5': 1 })
})

test('서브에이전트 토큰은 부모 세션 앞으로 달린다', () => {
  // agent-1.jsonl 은 <세션UUID>/subagents/ 아래에 있다.
  // 파일 이름만 보면 어느 세션 것인지 알 수 없어서 내려가며 UUID 를 들고 가야 한다.
  const { tokens } = transcriptPass(root)
  const parent = tokens.get('11111111-1111-1111-1111-111111111111')
  assert.equal(parent.sub.in, 300)
  assert.equal(parent.sub.out, 200)
  assert.equal(parent.main.in, 0) // 이 세션의 메인 전사에는 usage 줄이 없다

  const own = tokens.get('22222222-2222-2222-2222-222222222222')
  assert.equal(own.main.in, 100)
  assert.equal(own.sub.in, 0)
})

test('위임률은 캐시를 빼고 잰다', async () => {
  const { observation } = await import('../src/axes.mjs')
  const axis = observation.find((a) => a.id === 'delegation-share')
  const tokens = new Map([
    // 메인이 캐시를 잔뜩 읽었지만 새로 한 일은 적다
    ['s', { main: { in: 10, out: 10, cacheRead: 999_999, cacheCreate: 0 }, sub: { in: 40, out: 40, cacheRead: 0, cacheCreate: 0 } }],
  ])
  // 캐시를 넣었으면 위임률이 0에 가깝게 나온다. 빼면 80% 다.
  assert.equal(axis.compute({ tokens }).value, 80 / 100)
})

test('캐시 적중률은 다시 읽은 몫만 센다', async () => {
  const { observation } = await import('../src/axes.mjs')
  const axis = observation.find((a) => a.id === 'cache-hit')
  const tokens = new Map([
    ['s', { main: { in: 10, out: 0, cacheRead: 70, cacheCreate: 20 }, sub: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 } }],
  ])
  assert.equal(axis.compute({ tokens }).value, 0.7)
})

test('함정 3: 자식 전사의 복사본이 갈래를 부풀리지 않는다', () => {
  // agent-2.jsonl 에 msg_A 의 두 블록이 복사돼 있다. 세는 단위가 meta.json 이라 영향이 없다.
  const [ratio, width] = observe(joined)
  assert.equal(width.n, 4) // 디스패치 4번: msg_A, msg_B, msg_C, msg_D
  assert.equal(width.value, 6 / 4) // 위임 6건 전부 dispatchId 가 있다 / 디스패치 4번
  assert.equal(ratio.value, 2 / 4) // msg_A 와 msg_B 가 2갈래
})

test('서브에이전트 전사의 훅도 그 세션 것으로 센다', () => {
  // SubagentStart 계열은 본 세션 전사에 하나도 없다. 서브에이전트를 세션 수에서
  // 빼는 것은 맞지만(함정 4) 그 안에서 돈 훅 실행은 세야 한다.
  const s = sessions(root).find((x) => x.sessionId === S.split('/')[1])
  const h = s.hooks['SubagentStart:general-purpose']
  assert.ok(h, '서브에이전트 훅이 세션에 안 붙었다')
  assert.deepEqual({ ok: h.ok, fail: h.fail }, { ok: 1, fail: 1 })
  // 시간 초과는 왜 잘렸는지까지 말한다. stderr 가 없어서 이것 말고는 단서가 없다
  assert.match(h.why.join(' '), /5\.0초 제한을 넘겨 잘림 \(7\.7초 걸렸다\)/)

  // 세션 수는 안 늘어난다
  assert.equal(sessions(root).filter((x) => x.file.includes('/subagents/')).length, 0)
})

test('두 번 불러도 훅이 이중으로 안 쌓인다', () => {
  // 캐시가 준 객체를 그대로 더하면 그게 저장돼서 다음 실행에 두 배가 된다
  const count = () => {
    let n = 0
    for (const x of sessions(root)) for (const h of Object.values(x.hooks)) n += h.ok + h.fail
    return n
  }
  const first = count()
  assert.ok(first > 0, '픽스처에 훅이 없다')
  assert.equal(count(), first)
  assert.equal(count(), first)
})

const axes = await import('../src/axes.mjs')

// 토큰 함정 셋. 픽스처는 실물 전사 줄 모양을 그대로 흉내 낸다.
// 세션 파일을 테스트 안에서 만든다 — 위쪽 `sessionFiles(root).length` 기대값을 건드리지 않으려고
// (같은 이유로 '디렉터리를 옮긴 세션' 검사도 그렇게 한다). 그래서 cache:false 로 읽는다.
const usageLine = (mid, u, extra = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-09-04T00:00:00Z',
    message: {
      id: mid,
      model: 'claude-opus-5',
      content: [{ type: 'tool_use', id: `toolu_${mid}`, name: 'Read', input: {} }],
      usage: { input_tokens: u[0], output_tokens: u[1], cache_read_input_tokens: u[2], cache_creation_input_tokens: u[3] },
      ...extra,
    },
  })

test('함정 A: 한 턴의 usage 는 줄마다 복사된다. 마지막 줄만 센다', () => {
  // 한 assistant 턴에 도구 호출 블록이 여럿이면 같은 message.id 줄이 여러 개 남는다.
  // input·cache_read·cache_creation 은 같은 값이 그대로 복사되고 output 만 누적으로 커진다.
  // 실측(위반 전사 30건): 줄마다 더하면 입력 ×2.74, 캐시 읽기 ×2.23, 캐시 생성 ×2.58,
  // 출력 ×1.09 부풀었다. 전역(전사 1,332개)으로는 입력 ×3.37, 캐시 읽기 ×2.36 이다.
  const id = '33333333-3333-3333-3333-333333333333'
  fs.writeFileSync(
    path.join(root, `proj-a/${id}.jsonl`),
    [
      usageLine('msg_T', [1000, 10, 5000, 200]),
      usageLine('msg_T', [1000, 25, 5000, 200]),
      usageLine('msg_T', [1000, 60, 5000, 200]),
    ].join('\n') + '\n',
  )
  const { tokens } = transcriptPass(root, { cache: false })
  // 줄마다 더하면 in=3000 out=95 cacheRead=15000 cacheCreate=600 이 된다
  assert.deepEqual(tokens.get(id).main, { in: 1000, out: 60, cacheRead: 5000, cacheCreate: 200 })
})

test('함정 B: 같은 message.id 가 파일 경계를 넘어 겹치면 한 번만 센다', () => {
  // 같은 세션 전사가 프로젝트 디렉터리 개명과 orca 워크트리 사본으로 여러 곳에 복사돼 있다.
  // 실측(2026-09-13, 전 프로젝트): usage 줄이 있는 고유 message.id 39,429개 중
  // 2,165개가 여러 파일에 걸쳐 있고 초과분이 3,075건이다.
  // 사본은 갈라져 서로 다른 메시지를 가질 수 있어서 파일 하나를 고르는 게 아니라
  // message.id 단위 합집합을 쓴다. 누가 이기든 같게 나오도록 경로 사전순으로 고정한다.
  const id = '55555555-5555-5555-5555-555555555555'
  const body = [usageLine('msg_U', [100, 10, 400, 0]), usageLine('msg_V', [100, 20, 400, 0])].join('\n') + '\n'
  fs.writeFileSync(path.join(root, `proj-a/${id}.jsonl`), body)
  fs.mkdirSync(path.join(root, 'proj-b'), { recursive: true })
  // 사본은 msg_U 를 그대로 들고, 갈라진 뒤의 msg_W 를 더 갖고 있다
  fs.writeFileSync(path.join(root, `proj-b/${id}.jsonl`), body + usageLine('msg_W', [100, 30, 400, 0]) + '\n')
  const { tokens } = transcriptPass(root, { cache: false })
  // 파일마다 더하면 in=500 out=90 cacheRead=2000 이 된다. 합집합은 세 메시지뿐이다
  assert.deepEqual(tokens.get(id).main, { in: 300, out: 60, cacheRead: 1200, cacheCreate: 0 })
})

test('함정 C: <synthetic> 줄은 API 호출이 아니라 usage 에서 뺀다', () => {
  // "No response requested." 같은 큐 처리 자리표시자다. models 집계는 이미 걸러내는데
  // usage 집계만 안 걸렀다. 실측: cache_read 와 cache_creation 이 둘 다 0 인 턴 52건이
  // 전부 synthetic 이었다. 전 프로젝트 usage 줄 중 68건이 synthetic 이다.
  const id = '66666666-6666-6666-6666-666666666666'
  fs.writeFileSync(
    path.join(root, `proj-a/${id}.jsonl`),
    [
      usageLine('msg_X', [10, 1, 20, 0]),
      usageLine('msg_Y', [7, 7, 0, 0], { model: '<synthetic>' }),
    ].join('\n') + '\n',
  )
  const { tokens } = transcriptPass(root, { cache: false })
  assert.deepEqual(tokens.get(id).main, { in: 10, out: 1, cacheRead: 20, cacheCreate: 0 })
})

test('서브에이전트에서 막힌 도구도 그 세션 차단으로 센다', () => {
  // 실측: 차단 132건 중 58건(44%)이 서브에이전트에서 났고, permission-rule 은
  // 서브에이전트 52건이 본 세션 40건보다 많았다. 100턴당 값이 2.08 에서 3.74 로 뛰었다.
  const s = sessions(root).find((x) => x.sessionId === S.split('/')[1])
  assert.equal(s.denials['permission-rule'], 2)
  // 턴은 서브에이전트 전사에 아예 없다(실측 0건). 분모는 본 세션 것만 센다
  assert.equal(s.turns, 0)

  const guard = axes.observation.find((a) => a.id === 'guard-denials')
  const withTurns = [{ ...s, turns: 100 }]
  assert.equal(guard.compute({ sessions: withTurns }).value, 2) // 100턴당 2건
})
