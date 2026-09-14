// 하네스 연결 그래프의 데이터를 만든다. { nodes, edges } 를 내는 것까지가 이 파일의 일이다.
// 렌더러(Sigma.js + Graphology)는 다른 파일이 맡는다. 여기는 판정도 안 한다 — 노드·엣지
// 조립은 report.mjs 가 축을 적용하는 것과 같은 "사실을 모아 형태를 낸다" 층이다.
//
// 노드 4종: agent · skill · mcp · project(중심점). desktop/design-concept.md 의
//   node(id, type, scope, name, model, calls, lastUsed)
//   edge(source, target, calls, direction)
// 를 그대로 따르되 필드 이름 하나만 다르다. **`type` 대신 `kind` 를 쓴다.** 렌더러가 쓰는
// Sigma.js 는 노드·엣지 속성의 `type` 을 렌더 프로그램 이름(circle/point/image)으로 읽어서,
// 그대로 두면 빌드가 아니라 렌더 시점에 "could not find a suitable program for node type
// project" 로 죽는다(렌더러 갈래 실측, 2026-09-02). model·modelInherited 는 노드 상세에
// "호출 모델 상속 여부"를 보여주려고 하나 더 붙였다(계약을 깨지 않는 추가 필드). agent 노드는
// modelCounts 도 갖는다 — `[{ model, count }]`, 많이 쓴 순. model 필드가 최근 호출 하나만
// 담는 것과 달리 이건 전체 분포다(모델이 여럿인 에이전트가 흔하다, 아래 modelDistribution 근거
// 참고). model 값은 실제 모델 이름이거나 MODEL_INHERITED·MODEL_UNSPECIFIED 둘 중 하나다.
// project 노드는 modelCounts 대신 sessionModelCounts 를 갖는다(2026-09-02, 메인 세션 팝오버
// 정정 지시서). 처음엔 agent 노드들의 modelCounts(위임 모델)를 합친 값을 여기 담았는데,
// 그건 "서브에이전트를 어느 모델로 돌렸는지"라서 각 agent 노드에 이미 있는 것과 중복이고
// 사용자가 물은 것과 달랐다("메인 세션을 뭐로 몇 번 썼는지"). sessionModelCounts 는
// `[{ model, count }]` — count 는 호출 수가 아니라 **그 모델이 대표 모델이었던 세션 수**다
// (아래 sessionModelDistribution 근거 참고). 코디네이터 지시(2026-09-02)로 Codex 를 가르지
// 않고 한 목록에 합친다(harnessGraph 의 project 노드 조립부 주석 참고).
//
// 엣지에는 `relation` 도 붙는다. `'called'`(전사에 실제 호출 기록이 있다) 또는
// `'declared'`(에이전트 정의의 frontmatter `skills:` 가 가리켰을 뿐, 호출 기록은 없다).
// 같은 쌍이 둘 다에 해당하면 엣지는 하나이고 'called' 가 이긴다 — 그 엣지에 `declared: true`
// 를 얹어 선언도 되어 있었다는 사실을 잃지 않는다. 순수 declared 엣지의 `calls` 는 0 이 아니라
// `null` 이다(호출 기록이 없다≠0번 불렸다). 조립 근거는 아래 declaredPairs 블록에 있다.
//
// 실측(2026-09-02, 이 저장소): 노드 9개(project 1 · agent 2 · skill 5 · mcp 1), 엣지 10개,
// 고아 0개. `--no-cache` 한 번 + 캐시 세 번 연속이 노드·엣지 내용까지 완전히 같았다(1회차
// 자체 조사 스크립트의 9/9/0 과 에이전트·스킬 종류 구성은 같다. 엣지가 하나 더 나온 것은
// `agent:general-purpose → mcp:playwright` 다 — 그 사이 이 저장소에서 실제로 더 작업이
// 있었다. "살아 있는 데이터는 순서를 뒤집어 한 번 더 잰다"의 실물 사례로, 결함이 아니다).
//
// Codex 병합(2026-09-02, opts.codex, 기본 꺼짐). Claude Code 전사 말고 Codex 전사
// (`~/.codex/sessions`, src/codex.mjs)도 같은 그래프에 섞는다 — 노드 4종은 그대로 두고
// `provider: 'claude' | 'codex'` 로 어느 쪽이 낸 사실인지를 노드·엣지에 붙인다. Codex 의
// agent_role 'runner' 는 Claude 의 runner 에이전트와 이름만 같은 다른 도구의 다른 에이전트라
// id 를 `codex-agent:<role>` 네임스페이스로 가른다(자세한 근거는 harnessGraph 본문의 Codex
// 병합 블록 주석). MCP 는 서버 이름이 같으면 노드를 합친다 — `mcp:playwright` 는 두 도구가
// 같이 쓰는 하나의 서버다. **이 병합은 harnessGraph() 하나에만 들어간다.** src/report.mjs 와
// src/axes.mjs 는 손대지 않았다 — 축 열둘(`chore-model`·`model-explicit`·`agent-used`·
// `skill-declared-exists` 등)은 전부 `~/.claude/CLAUDE.md` 규율이나 `.claude/agents`·
// `.claude/skills` 파일을 근거로 삼는 Claude Code 전용 판정이라 Codex 위임을 섞으면 그 축들이
// 전부 틀린 위반을 낸다(지시서 2번 — 예: `chore-model` 은 Codex 의 gpt-5.x 모델을 전부
// "잡무에 비싼 모델을 썼다"는 위반으로 본다). 리포트·축·`--json` 출력은 이번 작업 범위 밖이고
// 여전히 Claude Code 것만 본다.

import path from 'node:path'
import { delegations, transcriptPass, sessions, projectSlug, rustScanner, ROOT } from './scan.mjs'
import { agentDefs, skillIndex } from './refs.mjs'
import { codexSessions, codexDelegations, codexMcpCalls } from './codex.mjs'

// scope: 정의 파일을 못 찾았다. 내장 에이전트(general-purpose 등)·내장 스킬(design·loop·
// artifact-* 등)이 여기 든다. **"정의 없음"이지 "판정 못 함"이 아니다** — agentDefs/skillIndex
// 는 repo·global·plugin 을 다 훑었고, 그래도 없다는 것을 확인했다. 다만 이 값 하나로는
// "진짜 내장"과 "이름이 깨진 참조"를 못 가른다. 실측(2026-09-01): 이 저장소 위임의 67%가
// 이 scope 다(대부분 general-purpose).
export const NO_DEFINITION = 'builtin'

// scope: MCP 정의 출처를 이번엔 안 읽는다(지시서 지침). "판정 못 함" — agentDefs·skillIndex
// 처럼 다 훑고도 없는 게 아니라 애초에 안 찾아봤다. NO_DEFINITION 과 섞으면 안 된다.
export const UNKNOWN_SCOPE = 'unknown'

// modelCounts 의 sentinel 값. NO_DEFINITION·UNKNOWN_SCOPE 와 같은 관례 — 여기는 기술적인
// 토큰만 내고, 사람이 읽을 말("호출 모델 상속"·"모델 미명시")로 바꾸는 건 렌더러 몫이다
// (renderer.mjs 의 scopeLabel 이 scope 를 옮기는 것과 같다). 실제 모델 이름(sonnet·opus·
// haiku 등)과 절대 안 겹치게 접두어를 붙인다.
// - MODEL_INHERITED: isFork:true 인데 model 이 null. 부모 모델을 그대로 쓴다 — 정상.
// - MODEL_UNSPECIFIED: isFork 도 아닌데 model 이 null. **이 조건은 src/axes.mjs 의
//   `model-explicit` 축(scope: `!isFork`, violation: `!model`)이 위반으로 잡는 조건과
//   정확히 같다** — 둘 다 "fork 가 아닌데 model 이 없다"를 본다. 옛 이름 MODEL_UNKNOWN 은
//   "판정 못 함"으로 오해되기 쉬웠다. 실측(2026-09-01, 이 저장소): 전체 위임 1,052건 중
//   이 조건에 걸리는 33건(general-purpose 24 · runner 4 · workflow-subagent 3 ·
//   claude-code-guide 1 · Explore 1)은 전부 "판정 불가"가 아니라 "model 파라미터를
//   안 적고 위임했다"는 위반이었다 — 그래서 "모름"이 아니라 "미명시"로 이름을 바꿨다.
//   이 조건을 한쪽만 고치면 그래프와 축이 다른 말을 하게 된다. 같이 고쳐라.
export const MODEL_INHERITED = 'model-inherited'
export const MODEL_UNSPECIFIED = 'model-unspecified'

// Codex 쪽 "모델 없음"은 MODEL_UNSPECIFIED 를 못 쓴다(지시서: "기존 상수를 재사용하지 마라").
// 그 상수는 src/axes.mjs 의 model-explicit 축(위반 조건: `!isFork && !model`)과
// test/graph.test.mjs 가 값까지 묶어놓은, Claude Code 전용 판정이다. 그 축의 근거는
// `~/.claude/CLAUDE.md` 의 "model 파라미터를 항상 명시한다"는 Claude Code 위임 규율이라
// Codex 위임엔 적용될 규율 자체가 없다 — Codex 에 이 값을 쓰면 "판정 불가"가 아니라
// "규율 위반"으로 잘못 읽힌다(그래프·축이 같은 조건을 다른 말로 하게 된다, 지시서 4번).
//
// MODEL_INHERITED 는 그대로 재사용한다. model-explicit 축은 이 값 자체를 위반 조건으로
// 쓰지 않는다(fork 를 scope 밖으로 뺄 뿐이다) — 축에 안 묶여 있다. "부모 모델을 상속했다"는
// 뜻도 프로바이더와 무관하게 똑같은 구조적 사실이다: Codex 의 fork_context:true 는 Claude 의
// isFork:true 와 대응한다(지시서: "상속으로 다뤄도 된다").
export const CODEX_MODEL_UNSPECIFIED = 'codex-model-unspecified'

const PROJECT = 'project'

export function harnessGraph(repo, { cache = true, scanner = null, since = null, until = null, codex = false } = {}) {
  if (!repo) throw new Error('harnessGraph 는 저장소 경로가 있어야 한다. 그래프는 항상 프로젝트 하나에 대한 것이다')
  // Rust 스캐너는 아직 Skill·mcp__ 호출을 안 뽑는다. 그대로 두면 스킬·MCP 노드가 통째로
  // 빠진 그래프가 조용히 나온다. 실측(2026-09-02, 이 저장소): JS 는 노드 9·엣지 10 인데
  // Rust 는 노드 3(project 1·agent 2)·엣지 2 였다. 반쪽을 전부인 것처럼 내주는 것이
  // 이 도구가 하지 않기로 한 일이라, 조용히 넘어가지 않고 여기서 멈춘다.
  if (scanner) {
    throw new Error(
      'Rust 스캐너로는 그래프를 못 만든다. scan-rs 가 Skill·mcp__ 호출을 아직 안 뽑아서 ' +
        '스킬·MCP 노드가 통째로 빠진다. --scanner rust 를 빼고 다시 부르거나, scan-rs 에 ' +
        '같은 추출을 넣고 JS 결과와 대조해라.',
    )
  }
  const slug = projectSlug(repo)
  const inRepo = (project) => project === slug || project.startsWith(`${slug}--`)

  let rows = delegations(undefined, { cache, scanner: scanner ? rustScanner('delegation') : null }).filter((r) =>
    inRepo(r.project),
  )
  if (since) rows = rows.filter((r) => r.ts && r.ts >= since)
  if (until) rows = rows.filter((r) => r.ts && r.ts < until)

  const pass = transcriptPass(undefined, { cache, scanner: scanner ? rustScanner('transcript') : null })
  let calls = pass.calls.filter((c) => inRepo(projectOf(c.file)))
  if (since) calls = calls.filter((c) => c.ts && c.ts >= since)
  if (until) calls = calls.filter((c) => c.ts && c.ts < until)
  calls = dedupeCalls(calls, rows)

  const touches = (s) => (s.repos?.length ? s.repos : [s.repo]).some((c) => c === repo || c?.startsWith(`${repo}/`))
  const sessionRows = sessions(undefined, { cache, scanner: scanner ? rustScanner('session') : null }).filter(touches)

  const defByName = new Map(agentDefs(repo).map((d) => [d.name, d]))
  const index = skillIndex(repo)
  // agentId → row. 서브에이전트 전사가 어느 에이전트 것인지(엣지의 출발점)를 찾는 데 쓴다.
  const byAgentId = new Map(rows.map((r) => [`${r.sessionId}:${r.agentId}`, r]))
  // parentAgentId → row. meta.json 의 parentAgentId 는 파일명 접두어 `agent-` 가 없다
  // (실측 2026-09-02, work-org-a-app-a 의 depth-2 사례로 확인). agentId 는 파일명
  // 그대로라 접두어가 있다. 접두어를 떼고 맞춰야 부모를 찾는다.
  const byStrippedId = new Map(rows.map((r) => [`${r.sessionId}:${stripAgentPrefix(r.agentId)}`, r]))

  const nodes = new Map()
  const edgeCounts = new Map()
  const bumpEdge = (source, target) => edgeCounts.set(key(source, target), (edgeCounts.get(key(source, target)) ?? 0) + 1)

  nodes.set(PROJECT, {
    id: PROJECT,
    kind: PROJECT,
    scope: null,
    name: path.basename(repo),
    model: null,
    // 메인 세션이 모델별로 몇 개인지(사용자가 물은 것 — 위임 모델이 아니다, 파일 머리말
    // 참고). sessionRows(사람이 연 세션만, 서브에이전트 제외 — 위 touches() 필터) 하나하나를
    // 대표 모델 하나로 접어 그 모델을 쓴 세션 수를 센다. codex:true 면 아래에서 Codex 세션을
    // 더해 다시 계산한다.
    sessionModelCounts: sessionModelDistribution(sessionRows),
    calls: 0, // 아래서 나가는 엣지 합으로 채운다
    lastUsed: sessionRows.reduce((max, s) => pickLater(max, s.endedAt ?? s.mtime), null),
  })

  // 에이전트 노드 + 엣지. Agent/Task 는 meta.json 이 진실이다(함정 3이 이미 여기서 안 걸린다).
  const byType = new Map()
  for (const r of rows) {
    if (!byType.has(r.agentType)) byType.set(r.agentType, [])
    byType.get(r.agentType).push(r)
  }
  for (const [agentType, rs] of byType) {
    const latest = rs.reduce((a, b) => (pickLater(a?.ts, b.ts) === b.ts ? b : a), null)
    const def = defByName.get(agentType)
    nodes.set(`agent:${agentType}`, {
      id: `agent:${agentType}`,
      kind: 'agent',
      scope: def?.scope ?? NO_DEFINITION,
      name: agentType,
      model: latest?.model ?? null,
      // isFork:true 인 최근 호출의 model=null 은 부모 상속이라 정상이다. 순수 미상과 구분한다.
      modelInherited: Boolean(latest?.isFork),
      // 가장 최근 호출 하나만 담던 model 필드로는 분포를 잃는다. 실측(2026-09-02, ~/.claude.json
      // 등록 프로젝트 전체): 에이전트-저장소 쌍 30개 중 13개(43%)가 모델이 여럿이다
      // (예: app-a/general-purpose 는 sonnet 325·opus 36·모름 1). model/modelInherited 는
      // 쓰는 곳(위 두 필드)이 있어 그대로 두고, 분포는 이 필드에 새로 담는다.
      modelCounts: modelDistribution(rs),
      calls: rs.length,
      lastUsed: rs.reduce((max, r) => pickLater(max, r.ts), null),
    })
  }
  for (const r of rows) {
    const parent = r.parentAgentId ? byStrippedId.get(`${r.sessionId}:${r.parentAgentId}`) : null
    const caller = parent ? `agent:${parent.agentType}` : PROJECT
    bumpEdge(caller, `agent:${r.agentType}`)
  }

  // 스킬 · MCP 노드 + 엣지. 전사 tool_use 기반이라 dedupeCalls 로 이미 중복을 걷었다.
  const byTarget = new Map()
  for (const c of calls) {
    const canon = c.kind === 'skill' ? canonicalSkillName(c.name, index) : c.name
    const targetId = `${c.kind}:${canon}`
    if (!byTarget.has(targetId)) byTarget.set(targetId, { kind: c.kind, name: canon, items: [] })
    byTarget.get(targetId).items.push(c)
    const caller = c.isSub ? callerOf(c, byAgentId) : PROJECT
    bumpEdge(caller, targetId)
  }
  for (const [targetId, { kind, name, items }] of byTarget) {
    nodes.set(targetId, {
      id: targetId,
      kind,
      scope: kind === 'skill' ? (index.get(name)?.scope ?? NO_DEFINITION) : UNKNOWN_SCOPE,
      name,
      model: null, // 스킬·MCP 호출엔 모델 개념이 없다. 해당 없음
      calls: items.length,
      lastUsed: items.reduce((max, c) => pickLater(max, c.ts), null),
    })
  }

  // 선언 관계. frontmatter `skills:` 는 전사 호출 기록이 아니라 "쓴다고 적어놓은" 선언이다.
  // 실제로도 불린 쌍은 'called' 가 이긴다 — 실제 호출이 더 강한 사실이라서다. declared 만 있는
  // 쌍이 이 기능의 값어치다: 선언해놓고 한 번도 안 부른 것을 그래프에 드러낸다.
  //
  // 실측(2026-09-02, ~/.claude.json 에 등록된 프로젝트 중 실존 경로 29개): 선언된 스킬
  // 참조는 2개 저장소(work/org-a/app-a 6건 · work/org-a/server-b 2건)에서
  // 총 8건이다. 8건 전부 skillIndex 에서 찾아졌다(못 찾은 건 0건) — 이 데이터셋으로는
  // "정의를 못 찾은 declared 스킬"을 실측하지 못했다. 그 갈래는 called 스킬 노드가 정의를
  // 못 찾았을 때 이미 쓰는 판정(scope: NO_DEFINITION)을 그대로 재사용해 새 상태를 만들지
  // 않는 쪽으로 정했다 — brokenSkillRefs() 의 "이름이 없다/심링크가 깨졌다" 판정을 여기서
  // 다시 만들 필요는 없고, 그래프는 "노드를 그릴 수 있나"만 보면 된다.
  // server-b 의 backend-developer·backend-reviewer 는 정의는 있지만 위임 기록이
  // 0건이라(실측) 지금 그래프에 에이전트 노드가 아예 없다 — declared 로만 등장하는 에이전트도
  // 노드를 새로 만들어야 한다는 근거가 됐다.
  const declaredPairs = new Set()
  for (const def of defByName.values()) {
    if (def.skills.length === 0) continue // 선언한 스킬이 없으면 이 관계에서 할 일이 없다
    const source = `agent:${def.name}`
    if (!nodes.has(source)) {
      nodes.set(source, {
        id: source,
        kind: 'agent',
        scope: def.scope,
        name: def.name,
        model: def.model ?? null,
        modelInherited: false,
        modelCounts: [], // 위임 기록이 아예 없다 — 분포를 낼 데이터가 없다(빈 배열이지 추측값 아니다)
        calls: 0, // 위임 기록을 다 훑고도 0건 — 판정 불가가 아니라 진짜 0(rows 는 완전한 집합이다)
        lastUsed: null,
      })
    }
    for (const raw of def.skills) {
      const canon = canonicalSkillName(raw, index)
      const target = `skill:${canon}`
      const k = key(source, target)
      if (declaredPairs.has(k)) continue // 같은 정의가 같은 스킬을 중복 선언해도 엣지는 하나
      declaredPairs.add(k)
      if (!nodes.has(target)) {
        nodes.set(target, {
          id: target,
          kind: 'skill',
          scope: index.get(canon)?.scope ?? NO_DEFINITION,
          name: canon,
          model: null,
          calls: 0, // 호출 기록을 다 훑고도 0건. declared 엣지 자체의 calls(null)와는 다른 축이다
          lastUsed: null,
        })
      }
    }
  }

  // 여기까지가 Claude 쪽 노드 전부다. 한 번에 provider 를 찍는다 — 만드는 자리가 넷(project·
  // agent·skill/mcp·declaredPairs)이라 자리마다 찍으면 하나 빠뜨리기 쉽다. 아래 Codex 블록이
  // nodes.has() 로 겹치는 노드(mcp)를 가릴 때 이 시점 이후에 있는 건 전부 'claude' 다.
  for (const n of nodes.values()) n.provider = 'claude'
  const projectNode = nodes.get(PROJECT)

  const edges = [...edgeCounts.entries()].map(([k, n]) => {
    const [source, target] = k.split('\0')
    const e = { source, target, calls: n, direction: 'out', relation: 'called', provider: 'claude' }
    if (declaredPairs.has(k)) e.declared = true // 선언도 되어 있다. 실제 호출이 이겨서 relation 은 called 다
    return e
  })
  for (const k of declaredPairs) {
    if (edgeCounts.has(k)) continue // 실제로도 불렸으면 위에서 이미 'called' 엣지로 만들었다
    const [source, target] = k.split('\0')
    // calls: null. "호출 기록이 없다"이지 "0번 불렸다"가 아니다(CLAUDE.md 재는 규율 — 분모가
    // 비면 0 이 아니라 판정 불가). 렌더러가 엣지 굵기를 calls 로 계산한다면 null 을 0 처럼
    // 굵기 계산에 넣지 마라 — "가장 가는 선(1번 호출)"과 "굵기 없음(호출 기록 없음)"을 못 가른다.
    // relation === 'declared' 를 보고 점선처럼 굵기 축과 무관하게 그리는 쪽을 렌더러가 정해야 한다.
    edges.push({ source, target, calls: null, direction: 'out', relation: 'declared', provider: 'claude' })
  }

  // ---- Codex 병합 ----
  // 완전 병합: 같은 그래프에 Claude 와 Codex 를 같이 그리고 provider 로 가른다(지시서, 위
  // 파일 머리말 "Codex 병합" 절 참고). 기본은 꺼짐이다 — 켜짐이 기본이면 이 함수를 부르는
  // 모든 자리(테스트 포함)가 조용히 ~/.codex/sessions(975MB·249개, 실측)를 읽게 된다. 옵션을
  // 안 주는 기존 호출부(test/graph.test.mjs 포함, 211개)는 이전과 완전히 같게 움직인다.
  if (codex) {
    // Codex 세션은 cwd 하나만 들고 있다. Claude 처럼 세션 하나가 resume 로 여러 저장소를
    // 거쳐온 사례를 실측으로 못 봤다(src/codex.mjs) — repo 자신이거나 그 하위 경로면 이
    // 그래프의 것이다. scan.mjs 의 sessionRows touches() 와 같은 모양이다.
    const inCodexRepo = (cwd) => cwd === repo || cwd?.startsWith(`${repo}/`)

    let cRows = codexDelegations(undefined, { cache }).filter((r) => inCodexRepo(r.cwd))
    if (since) cRows = cRows.filter((r) => r.ts && r.ts >= since)
    if (until) cRows = cRows.filter((r) => r.ts && r.ts < until)

    let cCalls = codexMcpCalls(undefined, { cache }).filter((c) => inCodexRepo(c.cwd))
    if (since) cCalls = cCalls.filter((c) => c.ts && c.ts >= since)
    if (until) cCalls = cCalls.filter((c) => c.ts && c.ts < until)

    const cSessions = codexSessions(undefined, { cache }).filter((s) => inCodexRepo(s.cwd))

    const codexEdgeCounts = new Map()
    const bumpCodexEdge = (source, target) =>
      codexEdgeCounts.set(key(source, target), (codexEdgeCounts.get(key(source, target)) ?? 0) + 1)

    // 에이전트 노드. id 에 codex-agent: 접두어를 쓴다 — Codex 의 agent_role 'runner' 와 Claude
    // 의 runner 에이전트는 이름만 같은 다른 도구의 다른 에이전트다(지시서 3번: "합치면
    // 거짓말이 된다"). agent: 접두어를 그대로 쓰면 두 에이전트가 하나로 합쳐진다. 반대로 kind
    // 는 그대로 'agent' 를 쓴다 — desktop/app/renderer.mjs(안 건드리는 파일)가 kind 로 Sigma
    // 색상을 고르는데(colorForKind), 새 kind 값을 쓰면 거기 없는 값이라 색이 안 먹는다.
    // provider 필드로 이미 갈렸으니 kind 를 또 나눌 이유가 없다.
    const byCodexType = new Map()
    for (const r of cRows) {
      if (!r.agentType) continue
      if (!byCodexType.has(r.agentType)) byCodexType.set(r.agentType, [])
      byCodexType.get(r.agentType).push(r)
    }
    for (const [agentType, rs] of byCodexType) {
      const latest = rs.reduce((a, b) => (pickLater(a?.ts, b.ts) === b.ts ? b : a), null)
      const id = `codex-agent:${agentType}`
      nodes.set(id, {
        id,
        kind: 'agent',
        provider: 'codex',
        // Codex 쪽 에이전트 정의 출처는 이번엔 안 찾아봤다 — MCP 의 UNKNOWN_SCOPE 와 같은
        // 사정이라 그 값을 그대로 쓴다(NO_DEFINITION 은 "찾아봤는데 없다"는 뜻이라 다르다.
        // Codex 쪽엔 agentDefs 에 대응하는 "정의 파일" 개념 자체가 없다).
        scope: UNKNOWN_SCOPE,
        name: agentType,
        model: latest?.model ?? null,
        // Claude 의 isFork 대응. fork_context:true 는 부모 모델을 상속한다(지시서).
        modelInherited: Boolean(latest?.forkContext),
        modelCounts: codexModelDistribution(rs),
        calls: rs.length,
        lastUsed: rs.reduce((max, r) => pickLater(max, r.ts), null),
      })
    }
    for (const r of cRows) {
      if (!r.agentType) continue
      // callerAgentRole 이 없으면 사람이 연 세션에서 바로 낸 위임이다 — Claude 의 PROJECT
      // 폴백과 같은 뜻이다.
      const caller = r.callerAgentRole ? `codex-agent:${r.callerAgentRole}` : PROJECT
      bumpCodexEdge(caller, `codex-agent:${r.agentType}`)
    }

    // MCP 노드는 합친다(지시서: "playwright 는 두 도구가 쓰는 같은 서버다. 서버 이름이 같으면
    // 노드 하나다"). 이미 Claude 쪽에서 만든 노드가 있으면 그 위에 계속 더한다 — calls·
    // lastUsed 는 두 프로바이더 합계다. node.provider 는 여기서 안 건드린다: 이 시점에 이미
    // 있는 노드는 전부 위에서 'claude' 로 찍혔다. 이 필드가 어느 한쪽만 남기는 건 알고
    // 하는 선택이다 — "누가 몇 번 불렀는지"의 진짜 분리는 엣지가 provider 로 담당한다
    // (desktop/app/renderer.mjs 가 그 내역을 노드가 아니라 엣지에서 구한다).
    for (const c of cCalls) {
      if (!c.server) continue
      const targetId = `mcp:${c.server}`
      if (!nodes.has(targetId)) {
        nodes.set(targetId, {
          id: targetId,
          kind: 'mcp',
          provider: 'codex',
          scope: UNKNOWN_SCOPE,
          name: c.server,
          model: null,
          calls: 0,
          lastUsed: null,
        })
      }
      const mcpNode = nodes.get(targetId)
      mcpNode.calls++
      mcpNode.lastUsed = pickLater(mcpNode.lastUsed, c.ts)
      const caller = c.callerAgentRole ? `codex-agent:${c.callerAgentRole}` : PROJECT
      bumpCodexEdge(caller, targetId)
    }

    for (const [k, n] of codexEdgeCounts) {
      const [source, target] = k.split('\0')
      edges.push({ source, target, calls: n, direction: 'out', relation: 'called', provider: 'codex' })
    }

    // project 노드의 sessionModelCounts 를 Codex 세션까지 합쳐 다시 낸다. 코디네이터
    // 지시(2026-09-02): "Codex 를 합친다. provider 무관하게 한 목록에 섞는다. 가르지 마라."
    // 실측(2026-09-02, 저장소 10곳)으로 한 저장소당 합친 종류가 최대 5개(app-a: claude
    // 3 + codex 2)라 목록이 안 넘친다 — 프로바이더 접두어(claude-/gpt-)가 이미 달라서 섞여도
    // 헷갈리지 않는다. sessionRows 를 다시 넘기는 이유: 위 project 노드 조립 시점에는 아직
    // cSessions 가 없었다(계산 순서상 여기서만 합칠 수 있다).
    projectNode.sessionModelCounts = sessionModelDistribution([...sessionRows, ...cSessions])
    const codexLastUsed = [...cSessions.map((s) => s.lastUsed), ...cRows.map((r) => r.ts), ...cCalls.map((c) => c.ts)].reduce(
      (max, t) => pickLater(max, t),
      null,
    )
    projectNode.lastUsed = pickLater(projectNode.lastUsed, codexLastUsed)
  }

  projectNode.calls = edges.filter((e) => e.source === PROJECT).reduce((n, e) => n + e.calls, 0)

  return { nodes: [...nodes.values()], edges }
}

function key(source, target) {
  return `${source} ${target}`
}

// ISO 문자열은 사전식 비교가 시간 비교와 같다. null 은 진다.
function pickLater(a, b) {
  if (!b) return a ?? null
  if (!a) return b
  return b > a ? b : a
}

function stripAgentPrefix(id) {
  return id.startsWith('agent-') ? id.slice('agent-'.length) : id
}

// 별칭(`<플러그인>:<스킬>`)으로 불렸으면 짧은 이름으로 접는다. 그래야 노드가 하나로 합쳐진다.
// refs.mjs 가 별칭을 만들 때 짧은 이름도 함께 인덱스에 넣어두므로(add 가 먼저 이긴다),
// 짧은 이름이 인덱스에 없으면 별칭이 아니라 그냥 콜론이 든 이름이다. 원래 이름을 남긴다.
// 단위 테스트를 위해 export 한다. `~/.claude/plugins` 실물 없이도 이 판정만 따로 잴 수 있다.
export function canonicalSkillName(name, index) {
  if (!name.includes(':')) return name
  const short = name.slice(name.indexOf(':') + 1)
  return index.has(short) ? short : name
}

// 위임 행(delegations 의 한 agentType 몫)을 모델별 호출 수로 접는다. 많이 쓴 순으로
// 정렬한다 — 팝오버가 위에서부터 읽으면 되게 하려고다(폭이 280px 라 스크롤 없이 몇 줄만
// 보이는 게 자연스럽다). Map 을 쓰는 이유는 동률일 때 처음 본 순서를 지켜 결과가
// 안정적이게 하려는 것뿐이고, 그 순서 자체에 뜻을 두지는 않는다(정렬 기준은 count 하나).
export function modelDistribution(rows) {
  const counts = new Map()
  for (const r of rows) {
    // fork 도 아니고 model 도 없으면 MODEL_UNSPECIFIED — src/axes.mjs 의 model-explicit 축이
    // 위반으로 잡는 것과 같은 조건이다(위 MODEL_UNSPECIFIED 상수 주석 참고. 이 조건을 고치면
    // 그 축도 같이 봐야 한다).
    const key = r.model ?? (r.isFork ? MODEL_INHERITED : MODEL_UNSPECIFIED)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([model, count]) => ({ model, count }))
}

// modelDistribution 의 Codex 판. row 모양이 다르다({model, forkContext} — Claude 의
// {model, isFork} 와 같은 뜻이지만 필드 이름이 src/codex.mjs 의 원래 사실 이름을 따른다).
// MODEL_UNSPECIFIED 대신 CODEX_MODEL_UNSPECIFIED 를 쓴다(위 상수 주석 참고 — axes.mjs 의
// model-explicit 축과 안 묶이게 하려는 것). MODEL_INHERITED 는 그대로 재사용한다(같은 이유).
export function codexModelDistribution(rows) {
  const counts = new Map()
  for (const r of rows) {
    const key = r.model ?? (r.forkContext ? MODEL_INHERITED : CODEX_MODEL_UNSPECIFIED)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([model, count]) => ({ model, count }))
}

// 메인 세션 목록(Claude 의 sessions() 결과·Codex 의 codexSessions() 결과 — 둘 다
// { models: { modelName: count } } 를 낸다, scan.mjs/codex.mjs 참고)을 "모델별 세션 수"로
// 접는다. 위 modelDistribution·codexModelDistribution 과 다른 축이다: 저건 위임 한 건 = 한
// 갈래를 세지만, 이건 세션 하나 = 한 표다. 세션 안에서 모델이 여러 번 바뀔 수 있어(실측
// 2026-09-02, 전 프로젝트 159세션 중 6개) 세션마다 대표 모델 하나를 먼저 골라야 한다 —
// 그 세션에서 가장 많이 쓰인 모델을 대표로 삼는다(동률이면 먼저 나온 쪽. 실측 6개 다중모델
// 세션 전부 최다가 뚜렷해 동률 자체가 없었다 — 예: korean-tone 세션은 opus-5 690 대
// fable-5 98이었다. "마지막에 쓴 모델"로 대신 재도 전 프로젝트 분포가 똑같이 나왔다
// — 대표를 어느 규칙으로 고르든 이 데이터셋에서는 답이 안 갈린다).
// models 가 비면(assistant/turn_context 줄에 모델이 아예 안 남은 세션) 대표를 못 고른다 —
// 0 으로 지어내지 않고 그 세션은 분포에서 뺀다(CLAUDE.md: 분모가 비면 판정 불가).
//
// MODEL_INHERITED·(CODEX_)MODEL_UNSPECIFIED 를 안 쓴다 — 그 값들은 "위임에 model 파라미터를
// 안 적었다"는 축 위반 판정이고, 세션 모델 없음은 그냥 데이터가 없다는 사실이라 다른 뜻이다.
// 같은 값을 여기서도 쓰면 "규칙을 어겼다"로 잘못 읽힌다.
//
// Claude·Codex 세션을 가리지 않고 한 번에 받는다 — 코디네이터 지시(2026-09-02): "Codex 를
// 합친다. provider 무관하게 한 목록에 섞는다." 원문 모델 이름을 그대로 담는다. 사람이 읽을
// 짧은 이름(예: claude-opus-5 → Opus 5)으로 바꾸는 것은 표시 층(desktop/app/model-name.mjs)
// 몫이다 — 원문을 잃으면 나중에 못 되돌린다.
export function sessionModelDistribution(rows) {
  const counts = new Map()
  for (const r of rows) {
    const entries = Object.entries(r.models ?? {})
    if (!entries.length) continue
    const [model] = entries.reduce((a, b) => (b[1] > a[1] ? b : a))
    counts.set(model, (counts.get(model) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([model, count]) => ({ model, count }))
}

function projectOf(file) {
  return path.relative(ROOT, file).split(path.sep)[0]
}

// 병렬 위임에서 부모의 tool_use 블록이 형제 서브에이전트 전사에 복사된다(실측, CLAUDE.md).
// 같은 id 가 여러 파일에 나오면 가장 얕은 곳(메인 → depth 1 → depth 2 …)이 진짜 출처다.
// 깊은 전사의 사본은 그 시점까지의 문맥을 그대로 물려받은 것일 뿐 다시 부른 게 아니다.
// 단위 테스트를 위해 export 한다.
export function dedupeCalls(calls, rows) {
  const byAgentId = new Map(rows.map((r) => [`${r.sessionId}:${r.agentId}`, r]))
  const depthOf = (c) => {
    if (!c.isSub) return 0
    const agentId = path.basename(c.file, '.jsonl')
    return byAgentId.get(`${c.sessionId}:${agentId}`)?.spawnDepth ?? 1
  }
  const best = new Map()
  for (const c of calls) {
    const depth = depthOf(c)
    const prev = best.get(c.id)
    if (!prev || depth < prev.depth) {
      best.set(c.id, { depth, call: { ...c, agentId: c.isSub ? path.basename(c.file, '.jsonl') : null } })
    }
  }
  return [...best.values()].map((v) => v.call)
}

function callerOf(call, byAgentId) {
  const row = byAgentId.get(`${call.sessionId}:${call.agentId}`)
  // 못 찾으면(예: 시간창이 부모 위임 행을 잘랐다) project 로 접어준다. 고아 노드보다 낫다.
  return row ? `agent:${row.agentType}` : PROJECT
}
