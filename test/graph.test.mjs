// 하네스 연결 그래프 조립을 잰다. { nodes, edges } 를 낸다.
//   node --test test/graph.test.mjs
//
// 이 파일이 사용자 데이터를 건드리지 않는 이유: HARNESS_BRO_ROOT 로 임시 전사 뿌리를 만들고
// `repo` 도 임시 디렉터리를 쓴다. `npm test` 가 HARNESS_BRO_CACHE 도 격리한다(package.json).

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// repo(정의 파일이 사는 곳)와 root(전사가 사는 곳)는 서로 다른 디렉터리다.
// agentDefs·skillIndex 는 repo 를, delegations·transcriptPass 는 HARNESS_BRO_ROOT 를 본다.
//
// 함정 8(scan.mjs). os.tmpdir() 은 이 기계에서 `/var/folders/...` 로 풀리고, 그 슬러그는
// `isTempProject()` 에 걸려 sessionFiles·metaFiles 가 통째로 건너뛴다. repo 를 tmpdir 밑에
// 두면 harnessGraph 가 내 fixture 를 하나도 못 읽는다. HOME 밑에 만들고 끝나면 지운다.
const repo = fs.mkdtempSync(path.join(os.homedir(), '.harness-bro-graph-test-'))
after(() => fs.rmSync(repo, { recursive: true, force: true }))
fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true })
// custom-agent 는 스킬을 둘 선언한다: overlap-skill(아래서 실제로도 호출한다 — 겹침 판정용)과
// zzz-ghost-declared-skill-does-not-exist(아무 데도 정의가 없다 — declared 인데 index 에 없는 갈래용).
fs.writeFileSync(
  path.join(repo, '.claude', 'agents', 'custom-agent.md'),
  '---\nname: custom-agent\nskills: overlap-skill, zzz-ghost-declared-skill-does-not-exist\n---\nbody\n',
)
// phantom-agent 는 정의만 있고 한 번도 위임된 적이 없다(meta.json 이 없다). reviewer-skill 을
// 선언하지만 실제로 부른 적은 없다 — "선언만 있고 호출 기록이 없는" 이 기능의 핵심 사례.
fs.writeFileSync(
  path.join(repo, '.claude', 'agents', 'phantom-agent.md'),
  '---\nname: phantom-agent\nskills: reviewer-skill\n---\nbody\n',
)
fs.mkdirSync(path.join(repo, '.claude', 'skills', 'reviewer-skill'), { recursive: true })
fs.writeFileSync(path.join(repo, '.claude', 'skills', 'reviewer-skill', 'SKILL.md'), '# reviewer-skill\n')
fs.mkdirSync(path.join(repo, '.claude', 'skills', 'overlap-skill'), { recursive: true })
fs.writeFileSync(path.join(repo, '.claude', 'skills', 'overlap-skill', 'SKILL.md'), '# overlap-skill\n')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-graph-root-'))
process.env.HARNESS_BRO_ROOT = root

const { projectSlug } = await import('../src/scan.mjs')
const {
  harnessGraph,
  canonicalSkillName,
  dedupeCalls,
  modelDistribution,
  sessionModelDistribution,
  NO_DEFINITION,
  UNKNOWN_SCOPE,
  MODEL_INHERITED,
  MODEL_UNSPECIFIED,
} = await import('../src/graph.mjs')

const slug = projectSlug(repo)
const SID = '11111111-1111-1111-1111-111111111111'
const S = `${slug}/${SID}`

function meta(rel, obj) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(obj))
}

function write(rel, lines) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

const skillCall = (id, name, ts) => ({
  type: 'assistant',
  timestamp: ts,
  message: { content: [{ type: 'tool_use', id, name: 'Skill', input: { skill: name } }] },
})
const mcpCall = (id, name, ts) => ({
  type: 'assistant',
  timestamp: ts,
  message: { content: [{ type: 'tool_use', id, name, input: {} }] },
})
const agentDispatch = (id, ts, mid = 'msg') => ({
  type: 'assistant',
  timestamp: ts,
  message: { id: mid, content: [{ type: 'tool_use', id, name: 'Agent', input: {} }] },
})

// 메인 전사: 스킬 하나(design, 정의 없음), mcp 하나(notion), Agent 위임 둘.
// toolu_dup_skill 은 agent-1 전사에도 그대로 복사해서 넣는다(병렬 위임의 실측 복사 현상).
// 첫 줄에 message.model 을 얹는다 — 메인 세션 자신이 쓴 모델이다(위임 모델과는 다른 축,
// sessionModelCounts 검사용). 기존 필드(timestamp·cwd)는 그대로 두고 type·message 만 더했다.
write(`${S}.jsonl`, [
  { type: 'assistant', timestamp: '2026-08-01T00:00:00Z', cwd: repo, message: { model: 'claude-opus-5' } },
  agentDispatch('toolu_dispatch_1', '2026-08-01T00:00:01Z'),
  agentDispatch('toolu_dispatch_2', '2026-08-01T00:00:02Z'),
  skillCall('toolu_dup_skill', 'design', '2026-08-01T00:00:03Z'),
  mcpCall('toolu_mcp_main', 'mcp__notion__search', '2026-08-01T00:00:04Z'),
  // 실측(design-concept.md): 전사에 가용 도구 목록이 attachment 로 통째로 직렬화된다.
  // "tool_use" 라는 문자열까지 박아 원문 grep 이 걸려드는 상황을 그대로 재현한다.
  {
    type: 'attachment',
    timestamp: '2026-08-01T00:00:05Z',
    attachment: { note: 'available tool_use blocks include Skill and mcp__ghostserver__ghosttool' },
  },
])

// agent-1(general-purpose, 정의 없음, depth 1): toolu_dup_skill 이 복사돼 있다(부풀림 후보).
// 자기 것(toolu_agent1_skill, reviewer-skill)도 하나 부른다. 이건 agent-3 에 다시 복사된다.
meta(`${S}/subagents/agent-1.meta.json`, {
  agentType: 'general-purpose',
  model: 'sonnet',
  spawnDepth: 1,
  toolUseId: 'toolu_dispatch_1',
})
write(`${S}/subagents/agent-1.jsonl`, [
  { timestamp: '2026-08-01T00:00:01Z' },
  skillCall('toolu_dup_skill', 'design', '2026-08-01T00:00:03Z'), // 메인의 복사본, 같은 id
  skillCall('toolu_agent1_skill', 'reviewer-skill', '2026-08-01T00:00:10Z'),
])

// agent-2(custom-agent, 정의 있음, depth 1): overlap-skill 을 자기가 직접 부른다.
// custom-agent.md 가 overlap-skill 을 선언도 했으니, 이 호출로 declared+called 가 겹친다.
meta(`${S}/subagents/agent-2.meta.json`, {
  agentType: 'custom-agent',
  model: 'haiku',
  spawnDepth: 1,
  toolUseId: 'toolu_dispatch_2',
})
write(`${S}/subagents/agent-2.jsonl`, [
  { timestamp: '2026-08-01T00:00:01Z' },
  skillCall('toolu_agent2_skill', 'overlap-skill', '2026-08-01T00:00:12Z'),
])

// agent-3(grandchild-agent, 정의 없음, depth 2, agent-1 이 부모). parentAgentId 는
// 파일명 접두어 'agent-' 없이 '1' 로만 온다(실측, work-org-a-app-a). agent-1 의
// toolu_agent1_skill 이 복사돼 있고(부풀림 후보), 자기 것(toolu_agent3_mcp)도 하나 부른다.
meta(`${S}/subagents/agent-3.meta.json`, {
  agentType: 'grandchild-agent',
  spawnDepth: 2,
  parentAgentId: '1',
  toolUseId: 'toolu_dispatch_3',
})
write(`${S}/subagents/agent-3.jsonl`, [
  { timestamp: '2026-08-01T00:00:10Z' },
  skillCall('toolu_agent1_skill', 'reviewer-skill', '2026-08-01T00:00:10Z'), // agent-1 의 복사본, 같은 id
  mcpCall('toolu_agent3_mcp', 'mcp__grafana__query', '2026-08-01T00:00:11Z'),
])

// multi-model-agent: 모델 분포 검사 전용. 실제 모델 이름 둘(sonnet 2회 · opus 1회) +
// 부모 상속(isFork:true, model null) + 미명시(isFork 아님, model null) 넷을 한 에이전트에
// 몰아서, 정렬(많이 쓴 순)과 상속·미명시가 갈리는지를 한 번에 잰다. 기존 에이전트(general-purpose·
// custom-agent)의 위임 수·"최근 모델" 단일값 테스트를 안 건드리려고 별도 agentType 을 쓴다.
for (const [n, model, extra] of [
  [30, 'sonnet', {}],
  [31, 'sonnet', {}],
  [32, 'opus', {}],
  [33, null, { isFork: true }], // 상속
  [34, null, {}], // 미명시 (isFork 아님, axes.mjs 의 model-explicit 축이 위반으로 잡는 것과 같은 행)
]) {
  meta(`${S}/subagents/agent-${n}.meta.json`, { agentType: 'multi-model-agent', model, spawnDepth: 1, ...extra })
  write(`${S}/subagents/agent-${n}.jsonl`, [{ timestamp: `2026-08-03T00:00:${String(n).padStart(2, '0')}Z` }])
}

// 메인 세션 둘을 더 연다(SID_B·SID_C) — project 의 sessionModelCounts 가 "세션 수"로 세고
// 정렬되는지 보려면 세션이 최소 셋 있어야 한다. S(opus-5, 위) + SID_B(opus-5) + SID_C(haiku)
// = opus-5 세션 2개 · haiku 세션 1개. <synthetic> 한 줄도 섞어 걸러지는지 같이 본다.
const SID_B = '22222222-2222-2222-2222-222222222222'
const SID_C = '33333333-3333-3333-3333-333333333333'
write(`${slug}/${SID_B}.jsonl`, [
  { type: 'assistant', timestamp: '2026-08-04T00:00:00Z', cwd: repo, message: { model: 'claude-opus-5' } },
  { type: 'assistant', timestamp: '2026-08-04T00:00:01Z', message: { model: '<synthetic>' } }, // 걸러진다
])
write(`${slug}/${SID_C}.jsonl`, [{ type: 'assistant', timestamp: '2026-08-05T00:00:00Z', cwd: repo, message: { model: 'claude-haiku-4-5' } }])

const g = harnessGraph(repo, { cache: false })
const node = (id) => g.nodes.find((n) => n.id === id)
const edge = (source, target) => g.edges.find((e) => e.source === source && e.target === target)

test('tool_use id 중복이 걷힌다: 메인과 depth1 에 복사된 것은 한 번만 센다', () => {
  const design = node('skill:design')
  assert.ok(design, 'skill:design 노드가 없다')
  assert.equal(design.calls, 1, `메인+agent-1 복사본을 중복으로 세면 2가 된다: ${design.calls}`)
  // 더 얕은 쪽(메인)이 진짜 출처다
  assert.ok(edge('project', 'skill:design'), '얕은 쪽(project) 이 출발점이어야 한다')
  assert.equal(edge('agent:general-purpose', 'skill:design'), undefined, '깊은 쪽이 출발점이 되면 안 된다')
})

test('tool_use id 중복이 걷힌다: depth1 과 depth2 에 복사된 것도 한 번만 센다', () => {
  const reviewer = node('skill:reviewer-skill')
  assert.ok(reviewer, 'skill:reviewer-skill 노드가 없다')
  assert.equal(reviewer.calls, 1, `agent-1+agent-3 복사본을 중복으로 세면 2가 된다: ${reviewer.calls}`)
  assert.ok(edge('agent:general-purpose', 'skill:reviewer-skill'), 'depth1(agent-1) 이 출발점이어야 한다')
  assert.equal(edge('agent:grandchild-agent', 'skill:reviewer-skill'), undefined, 'depth2 가 출발점이 되면 안 된다')
})

test('정의 없는 에이전트·스킬의 scope 는 "판정 못 함"(MCP 의 unknown)과 다른 값이다', () => {
  assert.notEqual(NO_DEFINITION, UNKNOWN_SCOPE)
  // general-purpose·grandchild-agent 는 이 저장소에 정의 파일이 없다 — 확인해서 없다는 것을 안다
  assert.equal(node('agent:general-purpose').scope, NO_DEFINITION)
  assert.equal(node('agent:grandchild-agent').scope, NO_DEFINITION)
  assert.equal(node('skill:design').scope, NO_DEFINITION)
  // custom-agent·reviewer-skill 은 정의 파일을 찾았다
  assert.equal(node('agent:custom-agent').scope, 'repo')
  assert.equal(node('skill:reviewer-skill').scope, 'repo')
  // MCP 는 이번엔 정의를 안 읽는다 — "안 찾아봤다"이지 "없다"가 아니다
  assert.equal(node('mcp:notion').scope, UNKNOWN_SCOPE)
  assert.equal(node('mcp:grafana').scope, UNKNOWN_SCOPE)
})

test('고아 노드가 없다: 노드마다 최소 하나의 엣지가 닿는다', () => {
  const touched = new Set()
  for (const e of g.edges) {
    touched.add(e.source)
    touched.add(e.target)
  }
  const orphans = g.nodes.filter((n) => !touched.has(n.id))
  assert.deepEqual(
    orphans.map((n) => n.id),
    [],
  )
})

test('원문 grep 이 아니라 파싱된 tool_use 만 센다: attachment 에 박힌 도구 목록은 안 잡힌다', () => {
  // 메인 전사의 attachment 줄이 "tool_use" 문자열과 "mcp__ghostserver__ghosttool" 이름을
  // 그대로 담고 있다. 문자열 사전 필터(line.includes('"tool_use"'))만 걸었다면 이게
  // JSON.parse 를 통과해 새 노드로 잡혔을 것이다.
  assert.equal(node('mcp:ghostserver'), undefined, '원문에 박힌 도구 목록이 노드로 잡혔다')
})

test('엣지: 메인이 직접 부른 것은 project 에서 나가고, 서브에이전트가 부른 것은 그 에이전트에서 나간다', () => {
  assert.ok(edge('project', 'agent:general-purpose'))
  assert.ok(edge('project', 'agent:custom-agent'))
  assert.ok(edge('project', 'mcp:notion'))
  assert.ok(edge('agent:grandchild-agent', 'mcp:grafana'))
})

test('엣지: depth 2 는 parentAgentId 로 잇는다. 접두어 agent- 가 없어도 맞춰 찾는다', () => {
  // meta.json 의 parentAgentId 는 '1' 인데 agentId(파일명)는 'agent-1' 이다.
  // 접두어를 안 떼고 비교하면 못 찾아서 project 로 잘못 접힌다.
  assert.ok(edge('agent:general-purpose', 'agent:grandchild-agent'), 'depth2 에이전트가 project 로 잘못 접혔다')
  assert.equal(edge('project', 'agent:grandchild-agent'), undefined)
})

test('노드 계산: agent 의 calls 는 위임 횟수, model 은 최근 호출 모델이다', () => {
  const a = node('agent:custom-agent')
  assert.equal(a.calls, 1)
  assert.equal(a.model, 'haiku')
  assert.equal(a.modelInherited, false)
})

test('노드 계산: 스킬·MCP 는 model 개념이 없다', () => {
  assert.equal(node('skill:design').model, null)
  assert.equal(node('mcp:notion').model, null)
})

test('modelCounts: 모델별 호출 수가 많이 쓴 순으로 정렬된다', () => {
  const m = node('agent:multi-model-agent').modelCounts
  assert.deepEqual(m[0], { model: 'sonnet', count: 2 }, '가장 많이 쓴 모델이 앞에 와야 한다')
  assert.equal(m.length, 4, `실제 모델 하나 + 상속 + 미명시 = 4 갈래여야 하는데 ${m.length}`)
})

test('modelCounts: 부모 상속과 미명시는 서로 다른 값이다', () => {
  assert.notEqual(MODEL_INHERITED, MODEL_UNSPECIFIED)
  const m = node('agent:multi-model-agent').modelCounts
  assert.deepEqual(m.find((x) => x.model === MODEL_INHERITED), { model: MODEL_INHERITED, count: 1 })
  assert.deepEqual(m.find((x) => x.model === MODEL_UNSPECIFIED), { model: MODEL_UNSPECIFIED, count: 1 })
  assert.deepEqual(m.find((x) => x.model === 'opus'), { model: 'opus', count: 1 })
})

test('modelCounts: 위임 기록이 아예 없는 에이전트(declared 전용)는 빈 배열이다', () => {
  // phantom-agent 는 meta.json 이 없다 — 분포를 낼 데이터가 없다. 0 이라고 지어내지 않는다.
  assert.deepEqual(node('agent:phantom-agent').modelCounts, [])
})

test('modelDistribution: 순수 함수 — model 실명·상속·미명시를 세 칸으로 가른다', () => {
  const rows = [{ model: 'sonnet' }, { model: 'sonnet' }, { model: null, isFork: true }, { model: null, isFork: false }]
  assert.deepEqual(modelDistribution(rows), [
    { model: 'sonnet', count: 2 },
    { model: MODEL_INHERITED, count: 1 },
    { model: MODEL_UNSPECIFIED, count: 1 },
  ])
})

test('project 노드의 calls 는 자신이 낸 엣지 호출 수의 합이다', () => {
  const p = node('project')
  const out = g.edges.filter((e) => e.source === 'project').reduce((n, e) => n + e.calls, 0)
  assert.equal(p.calls, out)
  assert.ok(p.calls > 0)
})

test('project 노드는 modelCounts(위임 모델) 를 안 갖는다 — sessionModelCounts 로 이름이 바뀌었다', () => {
  // 이전엔 project.modelCounts 가 agent 노드들의 modelCounts(위임 모델)를 합친 값이었다.
  // 각 agent 노드에 이미 있는 것과 중복이고, 사용자가 물은 "메인 세션을 뭐로 썼는지"와도
  // 달랐다(2026-09-02 정정 지시서) — 그래서 필드 자체를 없앴다. agent 노드는 여전히
  // modelCounts(위임 모델)를 갖는다 — 뜻이 다른 값에 같은 이름을 다시 안 쓴다.
  assert.equal(node('project').modelCounts, undefined)
  assert.ok(node('agent:general-purpose').modelCounts, 'agent 노드의 modelCounts(위임 모델)는 그대로 있어야 한다')
})

test('project 노드의 sessionModelCounts 는 메인 세션 모델 분포다 — 세션 수로 세고 많이 쓴 순으로 정렬된다', () => {
  // S(claude-opus-5) + SID_B(claude-opus-5, <synthetic> 은 걸러진다) + SID_C(claude-haiku-4-5).
  // opus-5 를 쓴 세션 2개, haiku 를 쓴 세션 1개 — "3회"가 아니라 "세션 2개"다(위임 호출 수와
  // 다른 축이다: multi-model-agent 위임에도 sonnet 이 나오지만 세션 모델 분포엔 안 섞인다).
  assert.deepEqual(node('project').sessionModelCounts, [
    { model: 'claude-opus-5', count: 2 },
    { model: 'claude-haiku-4-5', count: 1 },
  ])
})

test('sessionModelDistribution: 순수 함수 — 세션 하나를 대표 모델 하나로 접고, 그 모델을 쓴 세션 수를 센다', () => {
  const rows = [
    { models: { A: 3, B: 1 } }, // A 가 대표
    { models: { A: 1 } },
    { models: { B: 5 } },
    { models: {} }, // 모델 정보가 없다 — 0 으로 지어내지 않고 분포에서 뺀다
  ]
  assert.deepEqual(sessionModelDistribution(rows), [
    { model: 'A', count: 2 },
    { model: 'B', count: 1 },
  ])
})

test('MODEL_UNSPECIFIED 로 분류되는 조건은 src/axes.mjs 의 model-explicit 축 위반 조건과 같다', async () => {
  // 같은 판정을 두 곳에 두지 않는다(CLAUDE.md) — 축이 이미 하는 판정(model-explicit)을
  // 여기서 다시 만들지 않되, 조건이 서로 어긋나지 않는지는 잰다. 축을 고치고 graph.mjs 를
  // 안 고치면(또는 반대로) 이 테스트가 걸린다.
  const { compliance } = await import('../src/axes.mjs')
  const axis = compliance.find((a) => a.id === 'model-explicit')
  assert.ok(axis, 'model-explicit 축을 못 찾았다')
  const sample = [
    { model: 'sonnet', isFork: false },
    { model: null, isFork: true }, // 상속 — scope 밖(fork), 위반 아님
    { model: null, isFork: false }, // 미명시 — scope 안 + 위반
    { model: null }, // isFork 가 아예 없어도(undefined) falsy 라 위와 같다
  ]
  for (const r of sample) {
    const graphLabel = modelDistribution([r])[0].model
    const isAxisViolation = axis.scope(r) && axis.violation(r)
    assert.equal(
      graphLabel === MODEL_UNSPECIFIED,
      isAxisViolation,
      `${JSON.stringify(r)}: 그래프는 ${graphLabel}, 축 위반은 ${isAxisViolation} — 조건이 어긋났다`,
    )
  }
})

test('repo 없이 부르면 실패로 말한다. 조용히 빈 그래프를 내지 않는다', () => {
  assert.throws(() => harnessGraph(null))
})

test('declared 엣지가 만들어진다: 위임 기록이 없는 에이전트도 노드가 생긴다', () => {
  // phantom-agent 는 meta.json 이 없다 — 한 번도 위임되지 않았다. 그래도 reviewer-skill 을
  // 선언했으니 노드와 엣지가 생겨야 한다. 이게 이 기능의 핵심 가치다.
  const p = node('agent:phantom-agent')
  assert.ok(p, 'phantom-agent 노드가 없다')
  assert.equal(p.calls, 0, '위임 기록을 다 훑고도 0건 — 진짜 0 이지 null 이 아니다')
  assert.equal(p.scope, 'repo')
  const e = edge('agent:phantom-agent', 'skill:reviewer-skill')
  assert.ok(e, 'declared 엣지가 없다')
  assert.equal(e.relation, 'declared')
  assert.equal(e.declared, undefined, '순수 declared 엣지엔 declared 플래그가 따로 없다(relation 이 이미 말한다)')
  // agent-1(general-purpose)이 이미 reviewer-skill 을 실제로 불렀다(위 테스트). phantom-agent 의
  // declared 관계가 그 skill 노드의 calls 를 건드리면 안 된다.
  assert.equal(node('skill:reviewer-skill').calls, 1)
})

test('declared 엣지의 calls 는 0 이 아니라 null 이다', () => {
  const e = edge('agent:phantom-agent', 'skill:reviewer-skill')
  assert.equal(e.calls, null)
  assert.notEqual(e.calls, 0)
})

test('선언 + 호출이 겹치면 엣지가 하나이고 called 가 이긴다. declared:true 로 선언 사실을 남긴다', () => {
  const matching = g.edges.filter((e) => e.source === 'agent:custom-agent' && e.target === 'skill:overlap-skill')
  assert.equal(matching.length, 1, '겹치면 엣지가 둘이 아니라 하나여야 한다')
  const e = matching[0]
  assert.equal(e.relation, 'called')
  assert.equal(e.calls, 1)
  assert.equal(e.declared, true, '선언도 되어 있었다는 사실을 잃으면 안 된다')
})

test('선언된 스킬이 skillIndex 에 없으면 NO_DEFINITION scope 로 노드를 만든다(브로큰 참조와 같은 판정 재사용)', () => {
  // brokenSkillRefs() 가 같은 이름을 "그런 스킬이 없음"으로 잡는 것과 같은 사실이다.
  // 그 판정을 graph.mjs 에서 다시 만들지 않고, called 스킬 노드가 정의를 못 찾을 때 쓰는
  // scope: NO_DEFINITION 을 그대로 재사용한다.
  const target = 'skill:zzz-ghost-declared-skill-does-not-exist'
  const n = node(target)
  assert.ok(n, '정의 없는 declared 스킬도 노드가 생겨야 한다')
  assert.equal(n.scope, NO_DEFINITION)
  assert.equal(n.calls, 0)
  const e = edge('agent:custom-agent', target)
  assert.ok(e)
  assert.equal(e.relation, 'declared')
  assert.equal(e.calls, null)
})

test('called 엣지는 전부 relation: called 를 갖는다', () => {
  const called = g.edges.filter((e) => e.relation === 'called')
  assert.ok(called.length > 0)
  for (const e of called) assert.equal(typeof e.calls, 'number')
})

// canonicalSkillName·dedupeCalls 는 순수 함수라 지문(전사·플러그인 파일) 없이 바로 잰다.

test('canonicalSkillName: 별칭은 짧은 이름으로 접힌다', () => {
  const index = new Map([['reviewer-skill', { path: '/x' }]])
  assert.equal(canonicalSkillName('myplugin:reviewer-skill', index), 'reviewer-skill')
  assert.equal(canonicalSkillName('reviewer-skill', index), 'reviewer-skill') // 콜론이 없으면 그대로
  assert.equal(canonicalSkillName('unknownplugin:unknownskill', index), 'unknownplugin:unknownskill') // 짧은 이름이 없으면 그대로
})

test('dedupeCalls: 같은 id 는 가장 얕은 파일이 이긴다', () => {
  const rows = [
    { sessionId: 's', agentId: 'agent-1', spawnDepth: 1 },
    { sessionId: 's', agentId: 'agent-2', spawnDepth: 2 },
  ]
  const calls = [
    { id: 'x', isSub: true, sessionId: 's', file: '/root/s/subagents/agent-2.jsonl' }, // depth 2
    { id: 'x', isSub: true, sessionId: 's', file: '/root/s/subagents/agent-1.jsonl' }, // depth 1, 더 얕다
  ]
  const out = dedupeCalls(calls, rows)
  assert.equal(out.length, 1)
  assert.equal(out[0].agentId, 'agent-1')
})

test('dedupeCalls: isSub 아닌 것(메인)은 depth 0 이라 항상 이긴다', () => {
  const rows = [{ sessionId: 's', agentId: 'agent-1', spawnDepth: 1 }]
  const calls = [
    { id: 'x', isSub: true, sessionId: 's', file: '/root/s/subagents/agent-1.jsonl' },
    { id: 'x', isSub: false, sessionId: 's', file: '/root/s.jsonl' },
  ]
  const out = dedupeCalls(calls, rows)
  assert.equal(out.length, 1)
  assert.equal(out[0].agentId, null)
  assert.equal(out[0].isSub, false)
})

test('Rust 스캐너로는 반쪽 그래프를 내주지 않고 멈춘다', () => {
  // scan-rs 는 Skill·mcp__ 호출을 안 뽑는다. 실측(2026-09-02, 이 저장소): JS 가 노드 9·엣지 10
  // 을 낼 때 Rust 는 노드 3(project 1·agent 2)·엣지 2 였다. 스킬 5개와 MCP 1개가 조용히 빠진다.
  // 반쪽을 전부인 것처럼 내주면 사람이 자기 하네스를 잘못 읽는다.
  assert.throws(
    () => harnessGraph(process.cwd(), { scanner: true }),
    /Rust 스캐너로는 그래프를 못 만든다/,
    'Rust 스캐너인데 안 멈췄다',
  )
})
