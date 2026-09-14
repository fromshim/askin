// harnessGraph({ codex: true })의 Codex 병합을 잰다. test/graph.test.mjs 는 건드리지 않았다
// (기존 211개 검사가 이 파일과 완전히 분리돼 있다 — codex 옵션을 안 주면 그 파일은 전혀
// 영향이 없다). 여기는 Claude 전사 뿌리(HARNESS_BRO_ROOT)와 Codex 전사 뿌리
// (HARNESS_BRO_CODEX_ROOT)를 둘 다 임시 디렉터리로 돌려서 실제 사용자 데이터를 안 건드린다.
//   node --test test/graph-codex.test.mjs

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// repo(정의 파일이 사는 곳)는 HOME 밑에 둔다 — scan.mjs 의 isTempProject() 가 tmpdir 슬러그를
// 프로젝트가 아니라고 거른다(test/graph.test.mjs 와 같은 이유).
const repo = fs.mkdtempSync(path.join(os.homedir(), '.harness-bro-graph-codex-test-'))
after(() => fs.rmSync(repo, { recursive: true, force: true }))

const claudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-graph-codex-claude-'))
process.env.HARNESS_BRO_ROOT = claudeRoot

const codexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-graph-codex-codex-'))
process.env.HARNESS_BRO_CODEX_ROOT = codexRoot

function writeCodex(name, lines) {
  fs.writeFileSync(path.join(codexRoot, name), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

const sessionMeta = (id, source, cwd, ts, extra = {}) => ({
  timestamp: ts,
  type: 'session_meta',
  payload: { id, cwd, source, timestamp: ts, ...extra },
})
const spawnCall = (callId, { agent_type, model, fork_context } = {}, ts) => ({
  timestamp: ts,
  type: 'response_item',
  payload: { type: 'function_call', name: 'spawn_agent', call_id: callId, arguments: JSON.stringify({ agent_type, model, fork_context }) },
})
const mcpCall = (id, server, tool, ts) => ({
  timestamp: ts,
  type: 'event_msg',
  payload: { type: 'item_completed', item: { type: 'McpToolCall', id, server, tool } },
})
// 세션이 쓴 모델(src/codex.mjs 의 extractCodexFile 이 읽는 것) — 매 턴마다 한 줄 남는다.
const turnContext = (model, ts) => ({ timestamp: ts, type: 'turn_context', payload: { model } })

// 사람 세션: runner 를 두 번 spawn(모델 다름), playwright 를 직접 호출, gpt-5.6-sol 로 턴 셋.
writeCodex('human.jsonl', [
  sessionMeta('human-1', 'vscode', repo, '2026-08-01T00:00:00Z'),
  turnContext('gpt-5.6-sol', '2026-08-01T00:00:00Z'),
  spawnCall('call_1', { agent_type: 'runner', model: 'gpt-5.6-sol', fork_context: false }, '2026-08-01T00:00:01Z'),
  turnContext('gpt-5.6-sol', '2026-08-01T00:00:01Z'),
  spawnCall('call_2', { agent_type: 'runner', model: 'gpt-5.6-sol', fork_context: false }, '2026-08-01T00:00:02Z'),
  turnContext('gpt-5.6-sol', '2026-08-01T00:00:02Z'),
  spawnCall('call_3', { agent_type: 'runner', model: null, fork_context: false }, '2026-08-01T00:00:03Z'), // 미명시
  mcpCall('mcp-1', 'playwright', 'click', '2026-08-01T00:00:04Z'),
])

const { harnessGraph, CODEX_MODEL_UNSPECIFIED, MODEL_INHERITED, codexModelDistribution } = await import('../src/graph.mjs')
const { projectSlug } = await import('../src/scan.mjs')

// Claude 쪽 메인 세션 하나. sessionModelCounts 가 codex:true 일 때 두 프로바이더를 정말
// 합치는지 보려면 Claude 쪽에도 세션이 있어야 한다(claudeRoot 는 위에서 이미 만들었다).
const claudeSlug = projectSlug(repo)
fs.mkdirSync(path.join(claudeRoot, claudeSlug), { recursive: true })
fs.writeFileSync(
  path.join(claudeRoot, claudeSlug, '44444444-4444-4444-4444-444444444444.jsonl'),
  JSON.stringify({ type: 'assistant', timestamp: '2026-08-01T00:00:00Z', cwd: repo, message: { model: 'claude-opus-5' } }) + '\n',
)

test('codex 옵션을 안 주면(기본값) Codex 전사를 읽지 않는다 — 노드는 전부 provider:claude 다', () => {
  const off = harnessGraph(repo, { cache: false })
  assert.ok(!off.nodes.some((n) => n.id.startsWith('codex-agent:')), '기본값인데 codex-agent 노드가 생겼다')
  assert.ok(off.nodes.every((n) => n.provider === 'claude'), 'provider 필드는 옵션과 무관하게 항상 붙는다(스키마 추가) — 이 값이 claude 가 아니면 뭔가 잘못됐다')
  assert.ok(off.edges.every((e) => e.provider === 'claude'))
})

test('codex:true 면 Claude 노드는 전부 provider:claude 다', () => {
  const on = harnessGraph(repo, { cache: false, codex: true })
  const claudeNodes = on.nodes.filter((n) => !n.id.startsWith('codex-agent:') && n.id !== 'mcp:playwright')
  for (const n of claudeNodes) assert.equal(n.provider, 'claude', `${n.id} 의 provider 가 claude 가 아니다: ${n.provider}`)
})

test('codex-agent 노드 id 는 agent: 네임스페이스와 안 겹친다', () => {
  const on = harnessGraph(repo, { cache: false, codex: true })
  const runner = on.nodes.find((n) => n.id === 'codex-agent:runner')
  assert.ok(runner, 'codex-agent:runner 노드가 없다')
  assert.equal(runner.provider, 'codex')
  assert.equal(runner.kind, 'agent')
  assert.equal(runner.calls, 3)
  assert.equal(on.nodes.some((n) => n.id === 'agent:runner'), false, '이 fixture 엔 Claude runner 위임이 없으니 agent:runner 가 생기면 안 된다')
})

test('codex 위임의 model 없음은 MODEL_UNSPECIFIED 가 아니라 CODEX_MODEL_UNSPECIFIED 다', () => {
  const on = harnessGraph(repo, { cache: false, codex: true })
  const runner = on.nodes.find((n) => n.id === 'codex-agent:runner')
  const unspecified = runner.modelCounts.find((m) => m.model === CODEX_MODEL_UNSPECIFIED)
  assert.ok(unspecified, 'CODEX_MODEL_UNSPECIFIED 항목이 없다')
  assert.equal(unspecified.count, 1)
  assert.ok(!runner.modelCounts.some((m) => m.model === 'model-unspecified'), 'Claude 쪽 MODEL_UNSPECIFIED 문자열이 섞였다')
})

test('MCP 노드는 provider 와 무관하게 서버 이름으로 합쳐진다(mcp:playwright 하나)', () => {
  const on = harnessGraph(repo, { cache: false, codex: true })
  const playwrightNodes = on.nodes.filter((n) => n.id === 'mcp:playwright')
  assert.equal(playwrightNodes.length, 1, 'mcp:playwright 노드가 하나가 아니다')
})

test('MCP 엣지는 provider 별로 갈린다(Claude 호출이 없어도 codex 엣지 하나만 있다)', () => {
  const on = harnessGraph(repo, { cache: false, codex: true })
  const edges = on.edges.filter((e) => e.target === 'mcp:playwright')
  assert.equal(edges.length, 1)
  assert.equal(edges[0].provider, 'codex')
  assert.equal(edges[0].calls, 1)
})

test('project 노드의 calls 는 Claude+Codex 엣지 합이다(기존 계산식 그대로, provider 로 안 뺀다)', () => {
  const on = harnessGraph(repo, { cache: false, codex: true })
  const p = on.nodes.find((n) => n.id === 'project')
  const sum = on.edges.filter((e) => e.source === 'project').reduce((n, e) => n + e.calls, 0)
  assert.equal(p.calls, sum)
  assert.ok(p.calls > 0)
})

test('codexModelDistribution: 순수 함수 — model 실명·상속·미명시를 세 칸으로 가른다', () => {
  const rows = [{ model: 'gpt-5.6-sol' }, { model: 'gpt-5.6-sol' }, { model: null, forkContext: true }, { model: null, forkContext: false }]
  assert.deepEqual(codexModelDistribution(rows), [
    { model: 'gpt-5.6-sol', count: 2 },
    { model: MODEL_INHERITED, count: 1 },
    { model: CODEX_MODEL_UNSPECIFIED, count: 1 },
  ])
})

test('codex:false(기본값) 면 project 의 sessionModelCounts 는 Claude 세션만 본다', () => {
  const off = harnessGraph(repo, { cache: false })
  const p = off.nodes.find((n) => n.id === 'project')
  assert.deepEqual(p.sessionModelCounts, [{ model: 'claude-opus-5', count: 1 }])
})

test('codex:true 면 project 의 sessionModelCounts 가 Claude+Codex 세션을 한 목록에 합친다', () => {
  // 코디네이터 지시(2026-09-02): "Codex 를 합친다. provider 무관하게 한 목록에 섞는다."
  // Claude 세션 1개(claude-opus-5) + Codex 세션 1개(gpt-5.6-sol) — 가르지 않고 한 배열에 담는다.
  const on = harnessGraph(repo, { cache: false, codex: true })
  const p = on.nodes.find((n) => n.id === 'project')
  assert.deepEqual(
    new Set(p.sessionModelCounts.map((m) => m.model)),
    new Set(['claude-opus-5', 'gpt-5.6-sol']),
    'Claude 와 Codex 세션 모델이 한 배열에 같이 있어야 한다',
  )
  assert.ok(
    p.sessionModelCounts.every((m) => m.count === 1),
    '각 모델을 쓴 세션이 하나씩이라 count 는 1이어야 한다',
  )
})
