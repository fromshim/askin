// 전사에서 사실만 뽑는다. 판정은 axes.mjs 가 한다.
//
// 이 파일이 비율을 계산하지 않는 이유: 측정 함정이 집계 코드에 박히면
// 축을 하나 더 만들 때 같은 함정을 다시 밟는다. 여기서는 한 줄로 펴기만 하고
// 무엇을 분모에서 빼는지는 축이 결정한다.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { fileCache } from './filecache.mjs'

export const ROOT =
  process.env.HARNESS_BRO_ROOT ?? path.join(os.homedir(), '.claude', 'projects')

// 저장소 경로가 전사 디렉터리에서 어떤 이름이 되는지.
// /Users/me/Projects/foo → -Users-me-Projects-foo
export function projectSlug(repoPath) {
  return path.resolve(repoPath).replace(/\//g, '-')
}

// 함정 8. 임시 디렉터리는 프로젝트가 아니다.
//
// 슬러그는 경로의 `/` 를 `-` 로 바꾼 것이라 `/private/tmp/...` 는 `-private-tmp-...` 가 된다.
// Claude Code 가 자기 스크래치패드에서 세션을 열면 그게 프로젝트로 잡힌다.
// 실측에서 위임 1건짜리 스크래치패드 하나가 프로젝트 목록에 끼어 준수율 0% 로 잡혔다.
export function isTempProject(slug) {
  return /^-(private-)?tmp-|^-var-folders-/.test(slug)
}

// 함정 4. subagents/ 아래 jsonl 은 세션이 아니다. 무필터로 세면 6~7배 부풀려진다.
export function sessionFiles(root = ROOT) {
  const out = []
  for (const project of readdir(root, 'dir')) {
    if (isTempProject(project)) continue
    const dir = path.join(root, project)
    for (const f of readdir(dir, 'file')) {
      if (f.endsWith('.jsonl')) out.push({ project, sessionId: f.slice(0, -6), file: path.join(dir, f) })
    }
  }
  return out
}

// 함정 3. 서브에이전트는 meta.json 으로만 센다.
// jsonl 을 grep 하면 부모의 tool_use 블록이 자식 전사에 복사돼 이중으로 잡힌다.
//
// 함정 5. subagents/ 바로 아래만 읽으면 안 된다.
// 워크플로가 띄운 에이전트는 subagents/workflows/<wf-id>/ 로 한 단계 더 들어간다.
// 실측 1,098건 중 81건이 거기 있었고 전부 workflow-subagent 타입이다.
// 그 81건에 model 없음이 20건 들어 있어서, 안 읽으면 준수율이 실제보다 좋게 나온다.
// 읽을 meta.json 을 한 곳에서 편다. 훑는 규칙을 두 곳에 두면 대조 도구와 앱이
// 다른 파일을 보게 된다.
export function* metaFiles(root = ROOT) {
  for (const project of readdir(root, 'dir')) {
    if (isTempProject(project)) continue
    const projectDir = path.join(root, project)
    for (const sessionId of readdir(projectDir, 'dir')) {
      const subDir = path.join(projectDir, sessionId, 'subagents')
      if (!fs.existsSync(subDir)) continue
      for (const { dir, file, workflowId } of walkMeta(subDir)) {
        yield {
          project,
          sessionId,
          workflowId,
          dir,
          agentId: file.slice(0, -'.meta.json'.length),
          metaPath: path.join(dir, file),
        }
      }
    }
  }
}

export function delegations(root = ROOT, { cache = true, scanner = null } = {}) {
  const store = fileCache('delegations', { enabled: cache, root })
  const found = [...metaFiles(root)]
  // meta.json 은 한 번 쓰이면 안 바뀌고, ts 도 전사 첫 줄이라 안 바뀐다.
  // 그래서 meta.json 의 크기+mtime 만으로 캐시가 선다.
  const facts = scanner
    ? store.getBatch(
        found.map((f) => f.metaPath),
        scanner,
      )
    : new Map(
        found
          .map(({ metaPath, dir, agentId }) => [metaPath, store.get(metaPath, (p) => readDelegation(p, dir, agentId))])
          .filter(([, v]) => v),
      )

  const out = []
  for (const { project, sessionId, agentId, workflowId, metaPath } of found) {
    const row = facts.get(metaPath)
    if (!row) continue
    out.push({
      project,
      sessionId,
      agentId,
      workflowId,
      ...row,
    })
  }
  store.save()
  return out
}

export function readDelegation(metaPath, dir, agentId) {
  const meta = readJson(metaPath)
  if (!meta) return null
  return {
    agentType: meta.agentType ?? null,
    model: meta.model ?? null,
    // spawnDepth·parentAgentId 는 기본 축이 안 쓴다. 사용자 축을 위한 자리다.
    // README 의 예시 축(위임 깊이)이 spawnDepth 를 쓴다. 실측(2026-08-28)으로
    // 기본 축·출구에서 읽는 곳이 0 인 것을 확인했고, 그래서 지우지 않았다.
    //
    // 지우면 추출 함수 지문이 바뀌어 캐시를 통째로 버린다. 안 쓰는 필드 둘을
    // 걷으려고 전사 1,000개를 다시 읽을 이유가 없다.
    spawnDepth: meta.spawnDepth ?? null,
    parentAgentId: meta.parentAgentId ?? null,
    // agentType==='fork' 와 완전히 같은 값이지만 둘 다 남긴다.
    // 축이 어느 쪽을 보든 같은 답이 나오는지 확인할 수 있게.
    isFork: Boolean(meta.isFork),
    toolUseId: meta.toolUseId ?? null,
    description: meta.description ?? null,
    ts: startedAt(path.join(dir, `${agentId}.jsonl`)) ?? statMtime(metaPath),
  }
}

// subagents/ 아래를 끝까지 내려간다. workflows/<wf-id>/ 를 만나면 그 id 를 들고 나온다.
function* walkMeta(dir, workflowId = null) {
  for (const file of readdir(dir, 'file')) {
    if (file.endsWith('.meta.json')) yield { dir, file, workflowId }
  }
  for (const sub of readdir(dir, 'dir')) {
    yield* walkMeta(path.join(dir, sub), sub.startsWith('wf_') ? sub : workflowId)
  }
}

const HOOK_FAILURE = /error|cancelled|blocked|denied/i

// 밖에서 도는 스캐너. 낡은 파일 목록을 주고 사실을 받는다.
//
// `readSession` 과 같은 답을 내야 한다. 그걸 믿지 않고 `tools/compare.mjs` 로 견준다.
// 실측(2026-08-28): 견줌 1,254개, 다름 0개. JS 1.60초, Rust 0.43초.
//
// 없으면 조용히 JS 로 돌아가지 않는다. 그러면 `--scanner rust` 가 아무 일도 안 하고
// 아무 말도 안 한다. 38·53회차에 지운 "조용히 죽는 인자"가 그 모양이었다.
export function rustScanner(kind = 'session') {
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scan-rs', 'target', 'release', 'scan-rs')
  let st
  try {
    st = fs.statSync(bin)
  } catch {
    console.error(`Rust 스캐너가 없다: ${bin}`)
    console.error('  cd scan-rs && cargo build --release')
    process.exit(1)
  }
  return {
    // 지문은 바이너리 자체다. 다시 빌드하면 크기와 mtime 이 바뀌어 옛 캐시를 안 쓴다.
    // JS 함수 소스를 해시하는 기본 지문으로는 바이너리가 바뀐 것을 못 본다.
    stamp: createHash('sha1').update(`rust:${kind}:${st.size}:${st.mtimeMs}`).digest('hex').slice(0, 8),
    extract(files) {
      const r = spawnSync(bin, ['--files', '-', '--only', kind], {
        input: files.join('\n'),
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
      })
      if (r.status !== 0) {
        console.error(`Rust 스캐너가 ${r.status} 로 죽었다`)
        if (r.stderr) console.error(r.stderr.trim())
        process.exit(1)
      }
      const out = new Map()
      for (const line of r.stdout.split('\n')) {
        if (!line) continue
        const row = JSON.parse(line)
        out.set(row.file, row[kind])
      }
      return out
    },
  }
}

// 진짜 세션 한 개를 한 줄로 편다. 위임과 단위가 달라서 파일을 나눈다.
//
// 서브에이전트 전사는 안 읽는다(함정 4). 여기서 세는 것은 사람이 연 세션이다.
export function sessions(root = ROOT, { cache = true, scanner = null } = {}) {
  const store = fileCache('sessions', { enabled: cache, root })

  // 읽을 것을 먼저 다 모은다. 밖에서 도는 스캐너는 한 번에 받아야 프로세스를 한 번만 띄운다.
  const groups = []
  for (const { project, sessionId, file } of sessionFiles(root)) {
    groups.push({ project, sessionId, file, subs: [...subagentTranscripts(root, project, sessionId)] })
  }
  const want = groups.flatMap((g) => [g.file, ...g.subs])
  const facts = scanner
    ? store.getBatch(want, scanner)
    : new Map(want.map((f) => [f, store.get(f, readSession)]).filter(([, v]) => v))

  const out = []
  for (const { project, sessionId, file, subs } of groups) {
    const row = facts.get(file)
    if (!row) continue
    // 함정 9. 서브에이전트 전사의 훅도 이 세션에서 돈 것이다.
    //
    // 실측(2026-08-27): SubagentStart 계열 훅 2,947건이 본 세션 전사에 하나도 없다.
    // 전부 서브에이전트 전사에만 있어서 그 훅은 아예 재지 않고 있었다. 실패 1건도
    // 같이 묻혔다. 서브에이전트를 세션 수에서 빼는 것은 맞지만(함정 4) 그 안에서 돈
    // 훅 실행은 세야 한다. 서브에이전트 훅이 전체의 6.3% (3,705 / 54,999) 다.
    //
    // 함정 10. 도구 차단도 같다. 실측: 차단 132건 중 58건(44%)이 서브에이전트에서 났고,
    // `permission-rule` 은 서브에이전트 52건이 본 세션 40건보다 많다. 그게 안 보였다.
    // 턴(`turn_duration`)은 서브에이전트 전사에 아예 없어서(0건) 분모는 원래 맞았다.
    const subHooks = []
    const subDenials = []
    for (const sub of subs) {
      const subFacts = facts.get(sub)
      if (!subFacts) continue
      if (Object.keys(subFacts.hooks).length) subHooks.push(subFacts.hooks)
      if (Object.keys(subFacts.denials).length) subDenials.push(subFacts.denials)
    }
    out.push({
      project,
      sessionId,
      file,
      ...row,
      hooks: mergeHooks(row.hooks, ...subHooks),
      denials: mergeCounts(row.denials, ...subDenials),
    })
  }
  store.save()
  return out
}

function subagentTranscripts(root, project, sessionId) {
  const subDir = path.join(root, project, sessionId, 'subagents')
  if (!fs.existsSync(subDir)) return []
  const out = []
  for (const { dir, file } of walkMeta(subDir)) {
    out.push(path.join(dir, `${file.slice(0, -'.meta.json'.length)}.jsonl`))
  }
  return out
}

// 늘 새 객체를 만든다. 캐시가 준 것을 그대로 더하면 그게 저장돼서 다음 실행에 이중이 된다.
function mergeCounts(...sets) {
  const out = {}
  for (const set of sets) for (const [k, n] of Object.entries(set)) out[k] = (out[k] ?? 0) + n
  return out
}

// 늘 새 객체를 만든다. 캐시가 준 것을 그대로 더하면 그게 저장돼서 다음 실행에 이중이 된다.
function mergeHooks(...sets) {
  const out = {}
  for (const set of sets) {
    for (const [name, h] of Object.entries(set)) {
      const t = (out[name] ??= { ok: 0, fail: 0, kinds: {}, why: [] })
      t.ok += h.ok
      t.fail += h.fail
      for (const [kind, n] of Object.entries(h.kinds ?? {})) t.kinds[kind] = (t.kinds[kind] ?? 0) + n
      for (const w of h.why ?? []) if (!t.why.includes(w)) t.why.push(w)
    }
  }
  return out
}

// 세션 전사 한 개에서 뽑는 것. 파일 하나만 알면 되게 떼어놨다. 캐시가 이 결과를 담는다.
// 실측으로 세션 전사가 151개에 530MB 라 매번 다 읽으면 1.2초가 든다.
export function readSession(file) {
  {
    const row = {
      repo: null,
      repos: [],
      startedAt: null,
      endedAt: null,
      mtime: statMtime(file),
      hooks: {},
      // 턴이 끝날 때 도는 훅이 시간을 얼마나 먹는지. hooks 와 소스가 다르다 — hooks 는
      // attachment.hookEvent(모든 이벤트, 실패 여부)에서, 이건 subtype:'stop_hook_summary'
      // 줄(Stop 훅 묶음 하나, durationMs)에서 나온다. 둘을 이을 방법이 없다: attachment 쪽은
      // 어느 훅 스크립트가 돌았는지 안 담고, stop_hook_summary 쪽은 Stop 계열에만 붙는다.
      // 실측(2026-09-03, 전 프로젝트): attachment.hookName 은 169종 68,137건인데
      // stop_hook_summary 는 2,991줄뿐이고 그 안의 command 는 9종이다. 그래서 이 값의 뜻은
      // "훅 전체"가 아니라 **"턴 마무리 훅"** 이다. 축 이름과 note 가 그렇게 말해야 한다.
      stopHooks: { runs: 0, ms: 0, byCommand: {} },
      denials: {},
      turns: 0,
      lines: 0,
      // 메인 세션이 쓴 모델의 분포다(위임 모델이 아니다 — 그건 delegations() 가 잰다).
      // assistant 줄의 message.model 에 남는다. 실측(2026-09-02): 이 저장소 세션 4개가
      // 전부 claude-opus-5 하나뿐이다. 값을 하나만 담지 않고 분포로 담는다 — 실측(전
      // 프로젝트 159개)으로 6개 세션이 중간에 모델을 바꿨다. 대표 하나를 고르는 것은
      // 판정이라 graph.mjs 의 sessionModelDistribution() 이 한다(축이 판정을 독점한다).
      models: {},
    }
    for (const line of readLines(file)) {
      let d
      try {
        d = JSON.parse(line)
      } catch {
        continue
      }
      row.lines++
      if (d.timestamp) {
        if (!row.startedAt || d.timestamp < row.startedAt) row.startedAt = d.timestamp
        if (!row.endedAt || d.timestamp > row.endedAt) row.endedAt = d.timestamp
      }
      // 함정 7. cwd 가 줄마다 있다. 슬러그를 되돌리는 것보다 이쪽이 정확하다.
      //
      // 한 세션이 디렉터리를 옮길 수 있다. resume 로 다른 저장소에서 이어가면
      // 전사 한 파일에 cwd 가 둘 이상 들어온다. 실제로 이 앱을 만든 세션이 그랬다.
      // 첫 cwd 를 잡으면 시작한 곳에 달려서, 지금 일하는 저장소에서는 세션 0 으로 보인다.
      // repo 는 마지막 것(지금 있는 곳)으로 두고, 거쳐온 곳은 repos 에 다 남긴다.
      if (d.cwd) {
        row.repo = d.cwd
        if (!row.repos.includes(d.cwd)) row.repos.push(d.cwd)
      }

      if (d.toolDenialKind) bump(row.denials, d.toolDenialKind)
      if (d.type === 'system' && d.subtype === 'turn_duration') row.turns++
      // 함정: `<synthetic>` 같이 `<` 로 시작하는 값이 섞인다. 진짜 호출이 낸 모델이 아니라
      // 시스템이 넣은 자리표시자다(실측: 이 저장소 세션 2개에 각 1건). 걸러야 한다.
      if (d.type === 'assistant' && d.message?.model && !d.message.model.startsWith('<')) {
        bump(row.models, d.message.model)
      }
      // 턴 하나가 끝날 때 Stop 훅이 묶음으로 돈 기록. 줄 하나가 그 묶음 하나다.
      // 실측(2026-09-03): 이 줄은 최상위에 hookInfos 를 든다(toolUseResult 안에는 0건).
      if (d.type === 'system' && d.subtype === 'stop_hook_summary') {
        row.stopHooks.runs++
        for (const h of d.hookInfos ?? []) {
          const cmd = h.command
          // durationMs 가 없는 항목이 있다(실측 16,858건 중 33건). 시간은 못 세지만
          // 그 훅이 돌았다는 사실은 진짜라 runs 는 센다.
          const ms = typeof h.durationMs === 'number' ? h.durationMs : 0
          if (!cmd) continue
          row.stopHooks.ms += ms
          const e = (row.stopHooks.byCommand[cmd] ??= { runs: 0, ms: 0 })
          e.runs++
          e.ms += ms
        }
        continue
      }

      const hook = d.attachment
      if (hook?.hookEvent) {
        const key = hook.hookName ?? hook.hookEvent
        row.hooks[key] ??= { ok: 0, fail: 0, kinds: {} }
        bump(row.hooks[key].kinds, hook.type ?? 'unknown')
        // 함정 6. 성공만 세면 안 된다. hook_additional_context 도 정상 결과다(실측 3,521건).
        // hook_system_message 13건도 정상이다. 핸드오프 훅이 시스템 메시지를 넣은 것이다.
        // 실패로 볼 것은 error 와 cancelled 뿐이다(실측 각각 9건, 2건).
        //
        // 함정 11. cancelled 는 사람이 취소한 게 아니라 시간 초과다. 둘 다 timedOut 이었고
        // 10초 제한에 14초, 5초 제한에 7.7초였다. 잘린 훅은 규칙을 적용하지 못했으니
        // 축의 근거("훅이 조용히 실패하면 규칙이 안 지켜져도 아무도 모른다")에 그대로 맞는다.
        if (HOOK_FAILURE.test(hook.type ?? '')) {
          row.hooks[key].fail++
          const why = hookFailReason(hook)
          if (why) {
            row.hooks[key].why ??= []
            if (!row.hooks[key].why.includes(why)) row.hooks[key].why.push(why)
          }
        } else row.hooks[key].ok++
      }
    }
    return row
  }
}

// 무엇이 왜 실패했는지 없으면 여러 줄이 서로 다른 문제처럼 보인다.
//
// 실측(2026-08-27): 실패 11건 중 9건이 같은 원인이었다. `/bin/sh: node: command not found`.
// 전부 플러그인 훅이고 node 가 PATH 에 없는 환경에서 세션이 시작된 것이다. 그런데 화면은
// `Stop 5회 실패`, `SessionStart:resume 4회 실패`, `PreToolUse:Bash 1회 실패` 세 줄로
// 보여줘서 서로 다른 문제처럼 읽혔다. 고칠 곳은 훅 설정이 아니라 PATH 하나였다.
function hookFailReason(hook) {
  if (hook.timedOut) {
    const sec = (ms) => (ms ? `${(ms / 1000).toFixed(1)}초` : '?')
    return `${sec(hook.timeoutMs)} 제한을 넘겨 잘림 (${sec(hook.durationMs)} 걸렸다)`
  }
  const line = String(hook.stderr ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .pop()
  return line ? line.slice(0, 120) : null
}

function bump(obj, key) {
  obj[key] = (obj[key] ?? 0) + 1
}

// 함정 2. 병렬로 띄운 에이전트는 같은 message.id 를 공유하되 JSONL 에서는 별도 줄로 기록된다.
// message.content 배열 길이로 세면 항상 1이 나와서 병렬을 전혀 안 쓴 것처럼 보인다.
// meta.json 에는 message.id 가 없어서 전사에서 toolUseId → message.id 를 이어붙여야 한다.
//
// 서브에이전트 전사도 읽어야 한다. 실측 1,070건 중 152건이 거기에만 있었다. 깊이 2 이상의 위임이다.
// 부모의 tool_use 블록이 자식 전사에 복사돼 300건이 중복으로 잡히지만,
// 복사본이 원본과 같은 message.id 를 들고 있어(어긋남 0건) 덮어써도 답이 안 바뀐다.
//
// 전사를 한 번만 훑는다. 1.02GB 에 3.7초 걸리니 두 번 훑을 이유가 없다.
// 여기서 셋이 나온다: toolUseId → message.id, 세션별 토큰(메인/서브 따로), 끝난 상태.
// 상주로 갈 때는 증분으로 바꿔야 한다.

// 끝난 상태는 알림 문구 안에 박혀 있어서 정규식으로 꺼낸다.
// 한 에이전트가 여러 번 멈출 수 있어서 마지막 것이 이긴다.
const STATUS = /<tool-use-id>(toolu_[A-Za-z0-9]+)<\/tool-use-id>[\s\S]*?<status>([a-z]+)<\/status>/
const REAL_STATUS = new Set(['completed', 'failed', 'killed', 'stopped'])

// 전사 파일은 append-only 다. 한 번 쓰인 줄은 안 바뀐다.
// 그래서 파일별로 뽑은 사실을 크기+mtime 으로 캐시해두면 안 바뀐 파일은 다시 안 읽어도 된다.
//
// 실측(2026-08-27): 1,252개 중 최근 1분에 바뀐 것이 1개, 15분에 2개, 1시간에 11개다.
// 99% 넘게 건너뛴다. 이게 3단계 상주의 전제다.
export function extractFile(file) {
  const dispatch = []
  const status = []
  // 하네스 연결 그래프용. Skill·mcp__ 호출을 tool_use id 와 함께 담는다.
  // 원문 grep 이 아니라 이 순회(assistant 의 tool_use)만 본다. 실측: 원문 grep 은
  // MCP 서버 27종을 잡는데(가용 도구 목록이 attachment 로 통째로 박혀서다),
  // 이 순회로는 6종만 잡힌다. 그 6종이 진짜 호출이다.
  const calls = []
  // 함정 A. 한 턴 안에서 usage 가 줄마다 복사된다.
  //
  // 한 assistant 턴에 도구 호출 블록이 여럿이면 같은 message.id 줄이 여러 개 남는다.
  // 그때마다 input_tokens·cache_read_input_tokens·cache_creation_input_tokens 는 같은 값이
  // 그대로 복사되고 output_tokens 만 누적치로 커진다. 줄마다 더하면 통째로 부푼다.
  // 실측(2026-09-04, 위반 전사 30건): 입력 ×2.74, 캐시 읽기 ×2.23, 캐시 생성 ×2.58, 출력 ×1.09.
  // 실측(2026-09-13, 전 프로젝트 전사 1,332개): 입력 ×3.37, 출력 ×2.21, 캐시 읽기 ×2.36,
  // 캐시 생성 ×3.26. 그래서 message.id 로 묶어 **그룹 안에서는 마지막 줄만** 쓴다.
  //
  // 합을 여기서 내지 않고 message 단위로 남기는 이유는 함정 B 다. 같은 message.id 가
  // 파일 경계를 넘어 겹쳐서, 합을 내버리면 transcriptPass 가 중복을 못 걷는다.
  const usage = new Map()
  // message.id 가 없는 줄. 중복을 걸러낼 열쇠가 없으니 그대로 한 건으로 센다.
  // 실측(2026-09-13): 실물 전사에는 0건이다. 테스트 픽스처에는 있다.
  const loose = []

  for (const line of readLines(file)) {
    // 끝난 상태는 queue-operation 줄에만 있다. 여기서 tool-use-id 로 이으면
    // 위임 한 건당 상태 하나가 되어 함정 3(자식 전사의 복사본)이 저절로 풀린다.
    if (line.includes('queue-operation') && line.includes('<status>')) {
      const m = line.match(STATUS)
      // `[a-z]*` 나 `completed|failed|killed|stopped` 같은 문서 속 문자열이 섞여 들어온다
      if (m && REAL_STATUS.has(m[2])) status.push([m[1], m[2]])
    }
    // JSON.parse 는 비싸다. 문자열로 먼저 거른다
    if (!line.includes('"tool_use"') && !line.includes('"usage"')) continue
    let d
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    if (d.type !== 'assistant') continue

    for (const c of d.message?.content ?? []) {
      if (c?.type !== 'tool_use') continue
      if (c.name === 'Agent' || c.name === 'Task') {
        dispatch.push([c.id, d.message?.id ?? null])
      } else if (c.name === 'Skill' && c.input?.skill) {
        // 이름이 짧은 형태거나 `<플러그인>:<스킬>` 별칭일 수 있다. 정규화는 그래프 조립부 몫이다.
        calls.push({ id: c.id, kind: 'skill', name: c.input.skill, ts: d.timestamp ?? null })
      } else if (c.name?.startsWith('mcp__')) {
        // 노드는 도구 단위가 아니라 서버 단위다. `mcp__<서버>__<도구>` 에서 서버만 남긴다.
        calls.push({ id: c.id, kind: 'mcp', name: c.name.slice('mcp__'.length).split('__')[0], ts: d.timestamp ?? null })
      }
    }
    // 함정 C. `<synthetic>` 줄은 API 호출이 아니다.
    //
    // "No response requested." 같은 큐 처리 자리표시자다. 위 readSession() 의 models 집계는
    // 이미 `<` 로 시작하는 모델을 거르는데(325행 근처) 여기만 안 걸렀다. 같은 파일 안에서
    // 한쪽만 걸러져 있었다. 실측: cache_read 와 cache_creation 이 둘 다 0 인 턴 52건이
    // 전부 synthetic 이었고, 전 프로젝트 usage 줄 중 68건이 synthetic 이다.
    if (d.message?.usage && !(d.message.model && d.message.model.startsWith('<'))) {
      const u = d.message.usage
      const row = [
        u.input_tokens ?? 0,
        u.output_tokens ?? 0,
        u.cache_read_input_tokens ?? 0,
        u.cache_creation_input_tokens ?? 0,
      ]
      // 같은 id 면 나중 줄이 앞의 것을 덮는다 = 그룹의 마지막 줄만 남는다
      if (d.message.id) usage.set(d.message.id, row)
      else loose.push(row)
    }
  }
  // 캐시에 담기는 모양이다. [message.id 또는 null, in, out, cacheRead, cacheCreate].
  // 실측(2026-09-13): 전 프로젝트에서 항목 36,354개, 전사 캐시 파일이 870KB 에서 2.78MB 로
  // 는다(×3.2). 합 넷을 항목 36,354개로 바꾼 값이고, 이 정도면 담아둘 만하다.
  return { dispatch, status, calls, usage: [...[...usage].map(([id, r]) => [id, ...r]), ...loose.map((r) => [null, ...r])] }
}

export function transcriptPass(root = ROOT, { cache = true, scanner = null } = {}) {
  const dispatch = new Map()
  const tokens = new Map() // sessionId -> { main, sub }
  const status = new Map() // toolUseId -> 'completed' | 'failed' | ...
  // 하네스 연결 그래프용 원자재. 어느 파일에서 나왔는지를 붙여야 graph.mjs 가
  // 부풀림(같은 tool_use id 가 형제 서브에이전트 전사에 복사되는 것)을 걷어낼 수 있다.
  // 여기서는 걷지 않는다. 스캐너는 파일 하나만 알아서 걷어낼 자격이 없다(축이 판정을 독점한다).
  const calls = []
  const store = fileCache('transcripts', { enabled: cache, root })

  // 읽을 것을 먼저 다 모은다. 밖에서 도는 스캐너는 한 번에 받아야 프로세스를 한 번만 띄운다.
  const found = [...allJsonl(root)]
  const all = scanner
    ? store.getBatch(
        found.map((f) => f.file),
        scanner,
      )
    : new Map(found.map(({ file }) => [file, store.get(file, extractFile)]).filter(([, v]) => v))

  // 함정 B. 같은 message.id 가 파일 경계를 넘어 겹친다.
  //
  // 같은 세션 전사가 프로젝트 디렉터리 개명(한 세션 파일이 두 프로젝트 디렉터리에 같이 있음)과
  // orca 워크트리 사본으로 다른 (project, sessionId) 조합에 복사돼 있다. 파일마다 더하면
  // 사본 수만큼 곱해진다. 실측(2026-09-13): usage 줄이 있는 고유 message.id 39,429개 중
  // 2,165개가 여러 파일에 걸쳐 있고 초과분이 3,075건이다. 그중 1,011개는 (sessionId, isSub)
  // 조합까지 다르다 — 어느 세션 앞으로 다는지가 실제로 갈린다.
  //
  // 사본은 어느 시점 이후 갈라져 서로 다른 메시지를 가질 수 있다(워크트리에서 이어 쓴 경우).
  // 그래서 파일 하나를 고르는 게 아니라 message.id 단위 합집합이다. sessions() 가 "디렉터리를
  // 옮긴 세션은 거쳐온 곳을 다 기억한다"로 푸는 것과 같은 문제를 토큰 쪽에서 푸는 것이다.
  //
  // 누가 이기는지는 경로 사전순으로 고정한다. readdir 순서에 안 달려야 캐시를 켜든 끄든 답이
  // 같다. **어느 사본이 원본인지는 못 가른다.** 실측(2026-09-13): 고유 id 36,403개 중
  // 1,348개가 프로젝트 디렉터리 둘 이상에 걸쳐 있어서, 저장소로 좁힌 리포트에서는 그 몫이
  // 어느 저장소 앞으로 달릴지가 이 사전순에 달린다. 전 프로젝트 값은 영향이 없다.
  const owner = new Map() // message.id -> { file, sessionId, isSub, row }
  const loose = [] // message.id 가 없는 줄. 걸러낼 열쇠가 없어 그대로 센다
  let warned = false
  for (const { file, sessionId, isSub } of found) {
    const facts = all.get(file)
    if (!facts) continue
    for (const [id, mid] of facts.dispatch) dispatch.set(id, mid)
    for (const [id, s] of facts.status) status.set(id, s)
    // Rust 스캐너는 아직 calls 를 안 낸다. --scanner rust 로는 스킬·MCP 노드가 안 생긴다.
    for (const c of facts.calls ?? []) calls.push({ ...c, file, sessionId, isSub })
    if (!sessionId) continue
    // Rust 스캐너는 message 단위 usage 도 아직 안 낸다. 합만 내는데 그 합은 함정 A·B 를
    // 그대로 안고 있다. 조용히 부푼 값을 쓰지 않고 한 번 말하고 뺀다 — 토큰 축은 판정 불가가 된다.
    if (!facts.usage) {
      if (!warned) {
        console.error('Rust 스캐너는 message 단위 usage 를 안 낸다. 토큰 축(캐시 적중률·위임률)은 판정 불가로 나온다')
        warned = true
      }
      continue
    }
    for (const [id, ...row] of facts.usage) {
      if (id === null) {
        loose.push({ sessionId, isSub, row })
        continue
      }
      const prev = owner.get(id)
      if (!prev || file < prev.file) owner.set(id, { file, sessionId, isSub, row })
    }
  }
  for (const { sessionId, isSub, row } of [...owner.values(), ...loose]) {
    const [i, o, cacheRead, cacheCreate] = row
    if (!(i || o || cacheRead || cacheCreate)) continue
    if (!tokens.has(sessionId)) tokens.set(sessionId, { main: newTokens(), sub: newTokens() })
    const t = tokens.get(sessionId)[isSub ? 'sub' : 'main']
    t.in += i
    t.out += o
    t.cacheRead += cacheRead
    t.cacheCreate += cacheCreate
  }
  return { dispatch, tokens, status, calls, files: store.save() }
}

function newTokens() {
  return { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 }
}


// 위임에 message.id 를 붙인다. 같은 message.id 면 한 번에 띄운 갈래다.
export function withDispatch(rows, root = ROOT, pass) {
  const { dispatch, status } = pass ?? transcriptPass(root)
  return rows.map((r) => ({
    ...r,
    dispatchId: (r.toolUseId && dispatch.get(r.toolUseId)) ?? null,
    status: (r.toolUseId && status.get(r.toolUseId)) ?? null,
  }))
}

// 세션 UUID 를 들고 내려간다. 서브에이전트 전사는 <세션UUID>/subagents/ 아래에 있어서
// 파일 이름만으로는 어느 세션 것인지 알 수 없다.
export function* allJsonl(dir, sessionId = null, isSub = false) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      const looksLikeSession = /^[0-9a-f-]{36}$/.test(e.name)
      yield* allJsonl(p, looksLikeSession ? e.name : sessionId, isSub || e.name === 'subagents')
    } else if (e.name.endsWith('.jsonl') && fs.existsSync(p)) {
      // 깨진 심링크가 3개 있다. existsSync 로 걸러야 아래에서 안 터진다
      yield { file: p, sessionId: isSub ? sessionId : e.name.slice(0, -6), isSub }
    }
  }
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

// 전사 첫 줄의 timestamp 가 진짜 시작 시각이다. 파일 전체를 읽지 않으려고 앞부분만 뜬다.
function startedAt(jsonlPath) {
  let fd
  try {
    fd = fs.openSync(jsonlPath, 'r')
    const buf = Buffer.alloc(65536)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    const line = buf.subarray(0, n).toString('utf8').split('\n')[0]
    return JSON.parse(line).timestamp ?? null
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function statMtime(p) {
  try {
    return fs.statSync(p).mtime.toISOString()
  } catch {
    return null
  }
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function readdir(dir, kind) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => (kind === 'dir' ? e.isDirectory() : e.isFile()))
    .map((e) => e.name)
}
