// Codex 전사에서 사실을 뽑는 층을 잰다. test/graph.test.mjs 와 같은 결(임시 뿌리를 만들고
// 끝나면 지운다)로, 실제 ~/.codex/sessions 는 절대 안 건드린다.
//   node --test test/codex.test.mjs

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-codex-test-'))
process.env.HARNESS_BRO_CODEX_ROOT = root
after(() => fs.rmSync(root, { recursive: true, force: true }))

const REPO = '/Users/tester/repo'

function write(name, lines) {
  fs.writeFileSync(path.join(root, name), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

const sessionMeta = (id, source, cwd, ts, extra = {}) => ({
  timestamp: ts,
  type: 'session_meta',
  payload: { id, cwd, source, timestamp: ts, ...extra },
})
const spawnCall = (callId, { agent_type, model, fork_context } = {}, ts) => ({
  timestamp: ts,
  type: 'response_item',
  payload: {
    type: 'function_call',
    name: 'spawn_agent',
    call_id: callId,
    arguments: JSON.stringify({ agent_type, model, fork_context }),
  },
})
const mcpCall = (id, server, tool, ts) => ({
  timestamp: ts,
  type: 'event_msg',
  payload: { type: 'item_completed', item: { type: 'McpToolCall', id, server, tool } },
})
const taskComplete = (ts) => ({ timestamp: ts, type: 'event_msg', payload: { type: 'task_complete' } })
// 이 세션이 쓴 모델 — src/scan.mjs 의 readSession 이 assistant 줄에서 읽는 것과 같은 뜻이다.
const turnContext = (model, ts) => ({ timestamp: ts, type: 'turn_context', payload: { model } })

// 사람이 연 세션(vscode). explorer 를 한 번 spawn 한다(call_shared) — 부모 쪽 진짜 출처.
// gpt-5.3-codex 로 두 턴, model:null 인 턴 하나(카운트에서 빠져야 한다).
write('human.jsonl', [
  sessionMeta('human-1', 'vscode', REPO, '2026-08-01T00:00:00Z'),
  turnContext('gpt-5.3-codex', '2026-08-01T00:00:00Z'),
  spawnCall('call_shared', { agent_type: 'explorer', model: 'gpt-5.4', fork_context: false }, '2026-08-01T00:00:01Z'),
  taskComplete('2026-08-01T00:00:02Z'),
  turnContext('gpt-5.3-codex', '2026-08-01T00:00:02Z'),
  turnContext(null, '2026-08-01T00:00:04Z'),
  taskComplete('2026-08-01T00:00:05Z'),
  mcpCall('mcp-main-1', 'grafana', 'query', '2026-08-01T00:00:03Z'),
])

// explorer 서브에이전트(depth 1, thread_spawn). fork_context 로 부모 역사가 복사돼
// call_shared 가 그대로 들어와 있다(실측 현상 재현) — dedup 이 이걸 걸러야 한다.
// 자기 것(call_child, worker 를 spawn, model 없음+fork_context:true → 상속)도 하나 낸다.
write('sub-explorer.jsonl', [
  sessionMeta('sub-explorer-1', { subagent: { thread_spawn: { parent_thread_id: 'human-1', depth: 1, agent_role: 'explorer', agent_nickname: 'Nick' } } }, REPO, '2026-08-01T00:00:01Z', {
    agent_role: 'explorer',
    forked_from_id: 'human-1',
  }),
  spawnCall('call_shared', { agent_type: 'explorer', model: 'gpt-5.4', fork_context: false }, '2026-08-01T00:00:01Z'), // 복사본
  spawnCall('call_child', { agent_type: 'worker', model: null, fork_context: true }, '2026-08-01T00:00:10Z'),
  mcpCall('mcp-sub-1', 'grafana', 'alerts', '2026-08-01T00:00:11Z'),
])

// source.subagent.other 변형(예: guardian). depth·agent_role 이 없다 — 세션 목록에서는
// 서브에이전트로 걸러지지만 spawn_agent 호출이 없으니 위임 목록엔 안 잡힌다.
write('sub-guardian.jsonl', [
  sessionMeta('sub-guardian-1', { subagent: { other: 'guardian' } }, REPO, '2026-08-01T00:00:20Z', { parent_thread_id: 'human-1' }),
])

// 워크스페이스 없이 연 대화(cwd:'/'). 프로젝트로 못 쓴다 — 전부 걸러져야 한다.
write('no-workspace.jsonl', [
  sessionMeta('no-ws-1', 'cli', '/', '2026-08-01T00:00:30Z'),
  spawnCall('call_noproject', { agent_type: 'ghost', model: 'gpt-5.4', fork_context: false }, '2026-08-01T00:00:31Z'),
])

// 다른 저장소의 세션. repo 필터가 안 섞는지 확인용.
write('other-repo.jsonl', [
  sessionMeta('other-1', 'exec', '/Users/tester/other-repo', '2026-08-01T00:00:40Z'),
  spawnCall('call_other', { agent_type: 'explorer', model: 'gpt-5.4', fork_context: false }, '2026-08-01T00:00:41Z'),
])

const { codexSessions, codexDelegations, codexMcpCalls, extractCodexFile } = await import('../src/codex.mjs')

const sessions = codexSessions(undefined, { cache: false })
const delegations = codexDelegations(undefined, { cache: false })
const calls = codexMcpCalls(undefined, { cache: false })

test('세션 목록: 서브에이전트(thread_spawn·other 둘 다)를 걸러낸다', () => {
  const ids = sessions.map((s) => s.id)
  assert.ok(ids.includes('human-1'))
  assert.ok(!ids.includes('sub-explorer-1'), 'thread_spawn 서브에이전트가 세션으로 잡혔다')
  assert.ok(!ids.includes('sub-guardian-1'), 'other 서브에이전트가 세션으로 잡혔다')
})

test('세션 목록: cwd가 / 인 세션은 프로젝트로 못 써서 걸러진다', () => {
  assert.ok(!sessions.some((s) => s.id === 'no-ws-1'))
})

test('세션 목록: turn 수는 task_complete 로 센다', () => {
  const human = sessions.find((s) => s.id === 'human-1')
  assert.ok(human, 'human-1 세션이 없다')
  assert.equal(human.turns, 2)
})

test('세션 목록: project 는 cwd 를 projectSlug 로 바꾼 값이다', () => {
  const human = sessions.find((s) => s.id === 'human-1')
  assert.equal(human.project, REPO.replace(/\//g, '-'))
})

test('세션 목록: turn_context.model 을 센다. model:null 인 턴은 안 잡힌다', () => {
  const human = sessions.find((s) => s.id === 'human-1')
  assert.deepEqual(human.models, { 'gpt-5.3-codex': 2 })
})

test('위임: call_id 로 유일하게 센다. 복사본(depth 1)이 아니라 진짜 출처(depth 0)가 남는다', () => {
  const shared = delegations.filter((d) => d.callId === 'call_shared')
  assert.equal(shared.length, 1, `dedup 이 안 됐다: ${shared.length}건`)
  assert.equal(shared[0].callerAgentRole, null, '사람 세션(depth 0)이 아니라 서브에이전트가 출처로 잡혔다')
})

test('위임: 서브에이전트 자신이 낸 위임은 그 에이전트의 agent_role 을 부모로 남긴다', () => {
  const child = delegations.find((d) => d.callId === 'call_child')
  assert.ok(child, 'call_child 위임이 없다')
  assert.equal(child.callerAgentRole, 'explorer')
  assert.equal(child.agentType, 'worker')
  assert.equal(child.model, null)
  assert.equal(child.forkContext, true)
})

test('위임: guardian(other) 서브에이전트는 spawn_agent 호출이 없어서 위임 목록에 안 잡힌다', () => {
  assert.ok(!delegations.some((d) => d.callerSessionId === 'sub-guardian-1'))
})

test('위임: cwd가 / 인 세션의 spawn_agent 는 잡히지 않는다', () => {
  assert.ok(!delegations.some((d) => d.callId === 'call_noproject'))
})

test('위임: 다른 저장소 것과 안 섞인다(호출부 필터 대상 — project 필드로 직접 확인)', () => {
  const other = delegations.find((d) => d.callId === 'call_other')
  assert.ok(other)
  assert.notEqual(other.cwd, REPO)
})

test('MCP 호출: server·tool 이 그대로 나온다. 사람 세션과 서브에이전트 둘 다 잡힌다', () => {
  const main = calls.find((c) => c.sessionId === 'human-1')
  assert.ok(main)
  assert.equal(main.server, 'grafana')
  assert.equal(main.tool, 'query')
  assert.equal(main.isSub, false)
  const sub = calls.find((c) => c.sessionId === 'sub-explorer-1')
  assert.ok(sub)
  assert.equal(sub.callerAgentRole, 'explorer')
  assert.equal(sub.isSub, true)
})

test('MCP 호출: 워크스페이스 없는 세션은 안 잡힌다', () => {
  assert.ok(!calls.some((c) => c.cwd === '/'))
})

test('extractCodexFile: session_meta 없는 줄도 안 죽는다(깨진 JSON 은 건너뛴다)', () => {
  const p = path.join(root, 'broken.jsonl')
  fs.writeFileSync(p, 'not json\n' + JSON.stringify(sessionMeta('broken-1', 'cli', REPO, '2026-08-01T00:00:00Z')) + '\n')
  const facts = extractCodexFile(p)
  assert.equal(facts.meta.id, 'broken-1')
})

// ---------- MCP 기록 형식 세 세대 ----------
//
// 처음엔 마지막 세대(McpToolCall)만 읽어서 절반을 놓쳤다. 실측(2026-09-03, 전사 250개):
// 합쳐서 유일한 호출 424건 중 199건(47%)만 잡았다. 세 세대의 id 는 서로 안 겹친다.
// 이 검사가 지키는 것은 세 형식을 다 읽는 것과, 형식마다 다른 dedup 필요성이다.

const gen1 = (callId, name, ts) => ({
  timestamp: ts,
  type: 'response_item',
  payload: { type: 'function_call', name, call_id: callId },
})
const gen2 = (callId, server, tool, ts) => ({
  timestamp: ts,
  type: 'event_msg',
  payload: { type: 'mcp_tool_call_end', call_id: callId, invocation: { server, tool } },
})

test('MCP 호출: 기록 형식 세 세대를 다 읽는다', () => {
  write('gens.jsonl', [
    sessionMeta('gens-1', 'cli', REPO, '2026-08-02T00:00:00Z'),
    gen1('g1', 'mcp__pencil__batch_design', '2026-08-02T00:00:01Z'),
    gen2('g2', 'node_repl', 'js', '2026-08-02T00:00:02Z'),
    mcpCall('g3', 'grafana', 'query_prometheus', '2026-08-02T00:00:03Z'),
  ])
  const rows = codexMcpCalls(root, { cache: false }).filter((c) => c.sessionId === 'gens-1')
  assert.deepEqual(
    rows.map((c) => `${c.server}/${c.tool}`).sort(),
    ['grafana/query_prometheus', 'node_repl/js', 'pencil/batch_design'],
  )
})

test('MCP 호출: 1세대 이름의 __ 를 서버와 도구로 가른다. 도구 이름 안의 __ 는 다시 붙인다', () => {
  write('gen1-name.jsonl', [
    sessionMeta('gen1-name-1', 'cli', REPO, '2026-08-03T00:00:00Z'),
    gen1('n1', 'mcp__claude_ai_Higgsfield__show_generation_by_ids', '2026-08-03T00:00:01Z'),
    gen1('n2', 'mcp__srv__a__b', '2026-08-03T00:00:02Z'),
  ])
  const rows = codexMcpCalls(root, { cache: false }).filter((c) => c.sessionId === 'gen1-name-1')
  const byId = Object.fromEntries(rows.map((c) => [`${c.server}/${c.tool}`, true]))
  assert.ok(byId['claude_ai_Higgsfield/show_generation_by_ids'])
  assert.ok(byId['srv/a__b'])
})

test('MCP 호출: call_id 로 유일하게 센다. 복사본이 아니라 진짜 출처가 남는다', () => {
  // 실측(2026-09-03): 2세대는 원문 337건인데 유일 call_id 가 150개다. 중복은 전부 파일
  // 사이에 있고(150 중 75가 파일 둘 이상, 많게는 넷) 한 파일 안에서는 0건이다.
  // 전에는 "3세대에 중복이 없으니 event_msg 는 복사 대상이 아니다"라고 적어뒀는데 틀렸다.
  write('gen2-parent.jsonl', [
    sessionMeta('gen2-parent-1', 'cli', REPO, '2026-08-04T00:00:00Z'),
    gen2('shared-call', 'node_repl', 'js', '2026-08-04T00:00:01Z'),
  ])
  write('gen2-child.jsonl', [
    sessionMeta('gen2-child-1', { subagent: { thread_spawn: { agent_role: 'runner', depth: 1 } } }, REPO, '2026-08-04T00:00:02Z'),
    gen2('shared-call', 'node_repl', 'js', '2026-08-04T00:00:03Z'),
  ])
  const rows = codexMcpCalls(root, { cache: false }).filter((c) => c.server === 'node_repl' && c.cwd === REPO)
  const shared = rows.filter((c) => ['gen2-parent-1', 'gen2-child-1'].includes(c.sessionId))
  assert.equal(shared.length, 1, '같은 call_id 가 두 파일에 있으면 하나로 센다')
  assert.equal(shared[0].sessionId, 'gen2-parent-1', 'depth 가 낮은 쪽(부모)이 진짜 출처다')
})
