// Codex 전사에서 사실만 뽑는다. src/scan.mjs 와 같은 결이다 — 사실만 모으고 판정은 안 한다.
//
// Codex 전사는 ~/.codex/sessions/**/*.jsonl 에 있다(연도/월/일 하위 디렉터리, 파일마다
// 세션 하나). 첫 줄이 session_meta 다. Claude Code 전사와 구조가 전혀 다르니 scan.mjs 를
// 고치는 대신 이 파일을 새로 둔다. 재사용하는 건 projectSlug·isTempProject 뿐이다 —
// cwd → 슬러그 변환과 임시 디렉터리 판정은 프로바이더와 무관한 순수 함수라서다.
//
// 세션 종류. 실측(2026-09-02, 전체 249개): 사람이 연 것 97(source 가 문자열 —
// vscode 50 · cli 38 · exec 9) + 서브에이전트 152(source 가 dict, 키가 ('subagent',)).
// 무필터로 세면 2.5배(249/97) 부풀려진다 — Claude Code 쪽 함정 4(README)와 같은 모양이다.
// 서브에이전트는 다시 두 갈래로 갈린다:
//   - source.subagent.thread_spawn (130개): spawn_agent 로 띄운 것. agent_role·depth·
//     parent_thread_id 를 들고 있다(payload 최상위에도 agent_role·forked_from_id 로 복사돼 있다).
//   - source.subagent.other (22개): 예 "guardian". Codex Desktop 이 내부 정책 판단(위험한
//     행동을 승인해도 되는지)용으로 띄우는 것이라 spawn_agent 호출과 안 이어진다. depth·
//     agent_role 이 없다 — codexSessions() 에서는 여전히 서브에이전트로 걸러지지만,
//     codexDelegations() 에는 애초에 안 잡힌다(대응하는 spawn_agent call_id 가 없다).
//
// cwd == '/' 인 세션이 8개다(워크스페이스 없이 연 대화). 프로젝트로 못 쓴다 — 세션·위임·
// MCP 호출 전부에서 뺀다.
//
// **MCP 기록 형식이 세 세대다.** 처음엔 마지막 세대만 읽어서 절반을 놓쳤다. 실측
// (2026-09-03, 전사 250개). 한 세션은 한 형식만 쓴다(세대가 섞인 세션 0건).
//
//   세대  쓰인 기간            어디에                                     원문   유일 id
//   1     ~2026-03-31         response_item / function_call, 이름이         75      75
//                             `mcp__<서버>__<도구>` (Claude Code 와 같은 꼴)
//   2     2026-06 ~ 08-06     event_msg / mcp_tool_call_end,               337     150
//                             server·tool 이 invocation 안에
//   3     2026-08-13 ~        event_msg / item_completed / McpToolCall,    199     199
//                             server·tool 이 필드로 분리
//
// 세 세대의 id 는 서로 안 겹치고(1∩2, 1∩3, 2∩3 모두 0건) id 가 빈 것도 0건이다.
// 합쳐서 유일한 호출이 424건인데 3세대만 읽으면 199건, 47% 다.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileCache } from './filecache.mjs'
import { projectSlug, isTempProject } from './scan.mjs'

export const CODEX_ROOT = process.env.HARNESS_BRO_CODEX_ROOT ?? path.join(os.homedir(), '.codex', 'sessions')

export function codexFiles(root = CODEX_ROOT) {
  const out = []
  walk(root, out)
  return out
}

function walk(dir, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.jsonl') && fs.existsSync(p)) out.push(p)
  }
}

// session_meta 한 줄에서 정체성을 뽑는다. thread_spawn 과 other 두 모양을 한 방향으로 편다.
function parseMeta(payload) {
  if (!payload) return null
  const source = payload.source
  const isSub = source !== null && typeof source === 'object'
  const threadSpawn = isSub ? source.subagent?.thread_spawn : null
  // agent_role: thread_spawn 쪽은 payload 최상위에도 있다(실측 확인). other 쪽엔 role 이
  // 아예 없어서 source.subagent.other 문자열(예: "guardian")로 대신한다 — 유일한 이름표다.
  const agentRole = payload.agent_role ?? threadSpawn?.agent_role ?? (isSub ? (source.subagent?.other ?? null) : null)
  // 부모 스레드 id: thread_spawn 쪽은 payload.forked_from_id, other 쪽은 payload.parent_thread_id 다.
  // 실측으로 forked_from_id 값이 source.subagent.thread_spawn.parent_thread_id 와 같았다.
  const parentThreadId = payload.parent_thread_id ?? payload.forked_from_id ?? threadSpawn?.parent_thread_id ?? null
  const depth = threadSpawn?.depth ?? (isSub ? 1 : 0)
  return {
    id: payload.id ?? null,
    cwd: payload.cwd ?? null,
    isSub,
    source, // 사람 세션이면 문자열('vscode'|'cli'|'exec'), 서브에이전트면 dict. 원본 그대로 남긴다
    agentRole,
    parentThreadId,
    depth,
    startedAt: payload.timestamp ?? null,
  }
}

// 파일 하나에서 사실을 뽑는다. 캐시가 이 결과를 담는다.
// 실측(2026-09-02): 249개, 975MB. 캐시 없이 매번 다 읽으면 약 2.5초 — Claude 전사 캐싱과
// 같은 이유로 캐시를 쓴다(전사는 append-only 라 크기+mtime 만으로 안 바뀐 파일을 안다).
export function extractCodexFile(file) {
  const row = { meta: null, spawnCalls: [], mcpCalls: [], turns: 0, lastTs: null, models: {} }
  for (const line of readLines(file)) {
    let d
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    if (d.timestamp && (!row.lastTs || d.timestamp > row.lastTs)) row.lastTs = d.timestamp

    if (!row.meta && d.type === 'session_meta') {
      row.meta = parseMeta(d.payload)
      continue
    }
    // 이 세션이 쓴 모델의 분포다(Claude 의 row.models 와 같은 뜻 — src/scan.mjs 의
    // readSession 주석 참고). 매 턴마다 한 줄씩 남는다(실측: app-a 세션 하나가
    // 690줄). 대표 하나를 고르는 판정은 여기서 안 한다 — graph.mjs 의
    // sessionModelDistribution() 이 Claude·Codex 세션을 가리지 않고 같이 본다.
    if (d.type === 'turn_context') {
      const m = d.payload?.model
      if (m) row.models[m] = (row.models[m] ?? 0) + 1
      continue
    }
    if (d.type === 'event_msg') {
      const pt = d.payload?.type
      // 턴 수: task_complete 를 센다(완료된 턴). task_started 도 거의 같은 수인데(실측 예:
      // 이 저장소 세션 하나가 11/11) 마지막 턴이 안 끝났으면 하나 적게 잡힌다 — Claude 의
      // turn_duration 처럼 "끝난 턴"만 세는 쪽이 뜻이 더 맞다.
      if (pt === 'task_complete') row.turns++
      else if (pt === 'item_completed') {
        const item = d.payload.item
        // McpToolCall 은 server·tool 이 필드로 분리돼 있다(지시서 확인). 이름 파싱이 필요 없다.
        if (item?.type === 'McpToolCall') {
          row.mcpCalls.push({ id: item.id ?? null, server: item.server ?? null, tool: item.tool ?? null, ts: d.timestamp ?? null })
        }
      } else if (pt === 'mcp_tool_call_end') {
        // MCP 기록 형식 2세대(아래 세대 표 참고). server·tool 이 invocation 안에 들어간다.
        const inv = d.payload.invocation ?? {}
        row.mcpCalls.push({ id: d.payload.call_id ?? null, server: inv.server ?? null, tool: inv.tool ?? null, ts: d.timestamp ?? null })
      }
      continue
    }
    if (d.type === 'response_item' && d.payload?.type === 'function_call' && String(d.payload.name ?? '').startsWith('mcp__')) {
      // MCP 기록 형식 1세대. 이름이 `mcp__<서버>__<도구>` 한 문자열이라 갈라야 한다 —
      // Claude Code 전사와 같은 모양이다(src/scan.mjs 의 extractFile).
      const parts = d.payload.name.split('__')
      row.mcpCalls.push({
        id: d.payload.call_id ?? null,
        server: parts[1] || null,
        // 도구 이름 안에 __ 가 또 있을 수 있어 나머지를 다시 붙인다
        tool: parts.slice(2).join('__') || null,
        ts: d.timestamp ?? null,
      })
      continue
    }
    if (d.type === 'response_item' && d.payload?.type === 'function_call' && d.payload.name === 'spawn_agent') {
      let args = {}
      try {
        args = JSON.parse(d.payload.arguments ?? '{}')
      } catch {
        /* 인자가 깨져 있으면 빈 걸로 둔다. 위임 사실 자체(호출이 있었다)는 남긴다 */
      }
      // 실측(2026-09-02, app-a): spawn_agent 106건 중 44건이 다른 스키마다
      // (namespace:"collaboration", 인자가 agent_type·model·fork_context 대신
      // task_name·fork_turns·암호화된 것으로 보이는 message 다). agent_type·model 이 아예
      // 없으니 이 갈래는 agentType:null, model:null, forkContext:false 로 남는다 — 억지로
      // task_name 을 agentType 자리에 넣지 않는다(다른 뜻의 값을 같은 자리에 넣으면 나중에
      // 못 가른다). codexDelegations() 는 이 행을 여전히 담는다(위임이 있었다는 사실 자체는
      // 진짜다), graph.mjs 의 codex-agent 노드만 agentType 이 있는 행으로 좁힌다.
      row.spawnCalls.push({
        callId: d.payload.call_id ?? null,
        agentType: args.agent_type ?? null,
        model: args.model ?? null,
        forkContext: Boolean(args.fork_context),
        ts: d.timestamp ?? null,
      })
    }
  }
  return row
}

// 세 내보내기 함수(codexSessions·codexDelegations·codexMcpCalls)가 같은 파일 집합을 본다.
// 캐시 이름을 하나로 묶은 이유: extractCodexFile 이 세 함수가 쓰는 사실을 한 번에 다 낸다.
// scan.mjs 는 delegations·sessions·transcripts 를 뽑는 함수 자체가 서로 다른 사실을 내서
// 캐시 이름을 셋으로 가르지만, 여기는 뽑는 함수가 하나라 이름도 하나면 된다 — 셋으로 가르면
// 같은 파일의 같은 사실이 캐시에 세 벌 남는다.
function readAll(root, cache) {
  const store = fileCache('codex', { enabled: cache, root })
  const out = new Map()
  for (const file of codexFiles(root)) {
    const facts = store.get(file, extractCodexFile)
    if (facts) out.set(file, facts)
  }
  store.save()
  return out
}

function usable(meta) {
  if (!meta || !meta.cwd) return false
  if (meta.cwd === '/') return false // 함정: 워크스페이스 없이 연 대화. 프로젝트로 못 쓴다(실측 8개)
  if (isTempProject(projectSlug(meta.cwd))) return false
  return true
}

// 서브에이전트를 걸러낸 세션 목록. cwd·projectSlug·turn 수·마지막 시각을 낸다.
// since·until 은 안 받는다 — scan.mjs 의 sessions()·delegations() 도 안 받는다. 창 자르기는
// 부르는 쪽(graph.mjs)의 몫이라 여기서 새 규칙을 만들지 않는다.
export function codexSessions(root = CODEX_ROOT, { cache = true } = {}) {
  const files = readAll(root, cache)
  const out = []
  for (const facts of files.values()) {
    const meta = facts.meta
    if (!meta || meta.isSub) continue // 함정: 서브에이전트를 세션으로 세면 부풀려진다
    if (!usable(meta)) continue
    out.push({
      id: meta.id,
      cwd: meta.cwd,
      project: projectSlug(meta.cwd),
      source: meta.source, // 'vscode' | 'cli' | 'exec'
      turns: facts.turns,
      lastUsed: facts.lastTs ?? meta.startedAt,
      startedAt: meta.startedAt,
      models: facts.models, // { modelName: count } — Claude sessions() 의 models 와 같은 모양
    })
  }
  return out
}

// 위임 목록. spawn_agent function_call 기반이다.
//
// 함정: fork_context:true 로 띄운 자식의 전사에 부모 역사가 그대로 복사돼 들어온다(Claude
// 함정 3 과 같은 모양 — 부모의 tool_use 블록이 자식 전사에 복사되는 것). 실측(2026-09-02):
// spawn_agent function_call 원문이 155건인데 call_id 로 유일하게 세면 139건이다 — 16건이
// 복사본이다. 부모(depth 가 더 낮은 쪽)의 사본이 진짜 출처이니 그쪽을 남긴다 — graph.mjs 의
// dedupeCalls(가장 얕은 파일이 이긴다)와 같은 규칙이다.
//
// MCP 호출에도 같은 dedup 을 건다(codexMcpCalls). 전에는 안 걸었다 — 3세대(McpToolCall)만
// 읽던 때에 "165건 전부 id 가 유일했으니 event_msg 는 복사 대상이 아니다"라고 적었는데,
// 그 추측이 틀렸다. 2세대(mcp_tool_call_end)도 event_msg 인데 원문 337건 중 유일 call_id 가
// 150개다(실측 2026-09-03). 중복은 전부 파일 사이에 있고 한 파일 안에서는 0건이다 —
// 150개 중 75개가 파일 두 개 이상에 같은 call_id 로 남았고, 많은 것은 파일 넷이다.
// 복사가 없는 세대를 보고 형식 전체를 판단한 것이 잘못이었다.
export function codexDelegations(root = CODEX_ROOT, { cache = true } = {}) {
  const files = readAll(root, cache)
  const best = new Map() // callId -> { depth, row }
  for (const facts of files.values()) {
    const meta = facts.meta
    if (!usable(meta)) continue
    for (const call of facts.spawnCalls) {
      if (!call.callId) continue
      const prev = best.get(call.callId)
      if (prev && prev.depth <= meta.depth) continue
      best.set(call.callId, {
        depth: meta.depth,
        row: {
          callId: call.callId,
          agentType: call.agentType,
          model: call.model,
          forkContext: call.forkContext,
          ts: call.ts,
          // 이 위임을 낸 세션 자신의 정체성. 사람 세션이 냈으면 callerAgentRole 은 null이다
          // (project 루트에서 낸 것과 같다 — Claude 의 parentAgentId 없음과 같은 뜻).
          callerAgentRole: meta.isSub ? meta.agentRole : null,
          callerSessionId: meta.id,
          project: projectSlug(meta.cwd),
          cwd: meta.cwd,
        },
      })
    }
  }
  return [...best.values()].map((v) => v.row)
}

// MCP 호출 목록. server·tool·시각·어느 세션인지를 낸다.
// 세 세대를 다 읽고, call_id 로 중복을 걷는다(위 dedup 주석 참고).
export function codexMcpCalls(root = CODEX_ROOT, { cache = true } = {}) {
  const files = readAll(root, cache)
  const best = new Map() // id -> { depth, row }
  const noId = [] // id 가 없어 dedup 을 못 거는 것. 실측 0건이지만 버리지는 않는다
  for (const facts of files.values()) {
    const meta = facts.meta
    if (!usable(meta)) continue
    for (const c of facts.mcpCalls) {
      const row = {
        server: c.server,
        tool: c.tool,
        ts: c.ts,
        sessionId: meta.id,
        isSub: meta.isSub,
        callerAgentRole: meta.isSub ? meta.agentRole : null,
        project: projectSlug(meta.cwd),
        cwd: meta.cwd,
      }
      if (!c.id) {
        noId.push(row)
        continue
      }
      const prev = best.get(c.id)
      // 부모(depth 가 더 낮은 쪽)의 사본이 진짜 출처다 — codexDelegations 와 같은 규칙이다.
      if (prev && prev.depth <= meta.depth) continue
      best.set(c.id, { depth: meta.depth, row })
    }
  }
  return [...[...best.values()].map((v) => v.row), ...noId]
}

function* readLines(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }
  let start = 0
  while (start < text.length) {
    const nl = text.indexOf('\n', start)
    if (nl === -1) {
      yield text.slice(start)
      return
    }
    yield text.slice(start, nl)
    start = nl + 1
  }
}
