#!/usr/bin/env node
// 축을 사실에 적용해 준수율과 관찰값을 낸다. 축을 모르고 사실도 모른다. 둘을 잇기만 한다.
//
//   node src/report.mjs                          현재 디렉터리 기준
//   node src/report.mjs --repo <경로>            다른 저장소
//   node src/report.mjs --all                    전 프로젝트 (저장소 축은 건너뜀)
//   node src/report.mjs --since 2026-07-27       기간
//   node src/report.mjs --until 2026-08-26T06:00
//   node src/report.mjs --all-time               전체 기간 (기본은 최근 30일)
//   node src/report.mjs --plan                   고칠 것을 갈래로
//   node src/report.mjs --html out.html          한 장으로
//   node src/report.mjs --json                   기계용
//   node src/report.mjs --no-cache               캐시 없이 전부 다시 읽는다
//   node src/report.mjs --scanner rust           세션 전사를 Rust 로 읽는다 (scan-rs 를 먼저 빌드)
//   node src/report.mjs --watch                  전사가 자라면 다시 재고 나빠진 것만 말한다

import fs from 'node:fs'
import path from 'node:path'
import { delegations, withDispatch, projectSlug, rustScanner, sessions, transcriptPass, ROOT } from './scan.mjs'
import { agentDefs, brokenSkillRefs, danglingSkills, deadPaths, harnessDocs, skillIndex } from './refs.mjs'
import { candidates, harnessCorpus, judgeable, MIN_DOCS } from './contradictions.mjs'
import { compliance, observation, loadAxes, userAxesPath, checkCitations, citation, axisFingerprint, formatValue } from './axes.mjs'
import { save, delta, condense, saveKey, storePath } from './snapshot.mjs'
import { render } from './render.mjs'
import { counts, plan } from './fix.mjs'
import { watch, worseThings } from './watch.mjs'
import { weeklySeries, sparkline, trendGap } from './series.mjs'

// 값 자리에 다음 플래그가 오면 값이 아니다.
//
// `--since --all` 이 since="--all" 로 들어왔다. 문자열 비교라 위임이 전부 통과해서
// 필터가 조용히 무력화되고 "기간: --all (최근 NaN일)" 이 찍혔다.
function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return null
  const v = process.argv[i + 1]
  // 값을 빠뜨린 것은 오타다. 조용히 기본값으로 가면 준 줄 알고 숫자를 읽는다.
  if (v === undefined || v.startsWith('--')) {
    console.error(`--${name} 에 값이 없다`)
    process.exit(1)
  }
  return v
}

// 날짜로 못 읽으면 죽는다.
//
// `--since 어제` 를 주면 문자열 비교에서 전부 걸러져 0건이 나온다. 오타인지 정말
// 없는 건지 가릴 수 없다. --repo 오타를 막은 것과 같은 결이다.
function dateArg(name) {
  const v = arg(name)
  if (v === null) return null
  if (Number.isNaN(Date.parse(v))) {
    console.error(`--${name} 를 날짜로 못 읽었다: ${v}`)
    process.exit(1)
  }
  return v
}

// groupBy 는 "몰린 곳"을 무엇으로 묶을지다. 범위에 따라 쓸모 있는 축이 다르다.
//   한 저장소를 볼 때는 에이전트 타입별로 갈리는 게 보고 싶다
//   전 프로젝트를 볼 때는 어느 프로젝트가 끌어내리는지가 보고 싶다
export function measure(rows, axes = compliance, groupBy = (r) => r.agentType ?? r.project ?? '기타') {
  const list = Array.isArray(rows) ? { delegations: rows } : rows
  return axes
    .filter((axis) => list[axis.source ?? 'delegations'])
    .map((axis) => {
      const cite = citation(axis.rule)
      const base = { id: axis.id, label: axis.label, rule: cite.rule, unit: axis.source ?? 'delegations', fp: axisFingerprint(axis) }
      // 근거가 이 하네스에 없으면 그건 내 규칙이지 이 사람의 규칙이 아니다.
      if (cite.missing) {
        return { ...base, total: 0, violations: 0, rate: null, unavailable: cite.missing, samples: [] }
      }
      // 표본이 없으면 0% 가 아니라 판정 불가다. 둘을 섞으면 리포트가 거짓말한다.
      if (axis.precondition && !axis.precondition(list)) {
        return { ...base, total: 0, violations: 0, rate: null, unavailable: axis.unavailable, samples: [] }
      }
      // 축 하나가 터지면 그 축만 빼고 나머지는 보여준다.
      //
      // 사용자 축은 남이 쓰는 확장점이다. violation 을 안 적거나 compute 가 던지면
      // 앱이 통째로 죽어서 스택 트레이스만 나왔다. 기본 축이 멀쩡한데 리포트를
      // 아예 못 본다. loadAxes 가 import 실패를 잡는 것과 같은 결이다.
      try {
        return judge(axis, list, base, groupBy)
      } catch (e) {
        return { ...base, total: 0, violations: 0, rate: null, unavailable: `축이 터졌다: ${e.message}`, samples: [] }
      }
    })
}

function judge(axis, list, base, groupBy) {
  const source = list[axis.source ?? 'delegations']
  const scoped = source.filter(axis.scope)
  // 분모가 비면 판정 불가다. 0% 도 아니고 "해당 없음"도 아니다.
  //
  // 처음 쓰는 사람 눈으로 보고 알았다. 같은 상황(위임 0건)을 두 축이 다르게 말하고 있었다.
  // 하나는 "판정 불가 · 위임 기록이 아예 없다"고 하고 다른 하나는 "0건 중 0건 위반"이라 했다.
  // 뒤쪽은 도구가 고장난 건지 데이터가 없는 건지 알려주지 않는다.
  if (scoped.length === 0) {
    return { ...base, total: 0, violations: 0, rate: null, unavailable: emptyReason(axis), samples: [] }
  }
  const violations = scoped.filter(axis.violation)
  return {
    ...base,
    total: scoped.length,
    violations: violations.length,
    rate: (scoped.length - violations.length) / scoped.length,
    // 위반이 어디에 몰렸는지. 종합 점수를 안 만드는 이유와 같은 결이다.
    // 숫자만 보면 왜 떨어졌는지가 가려진다.
    concentration: concentrate(scoped, violations, axis.groupBy ?? groupBy),
    samples: violations.slice(0, 6).map((v) => (axis.describe ? axis.describe(v) : defaultDescribe(v))),
  }
}

// 슬러그는 길다. 사람이 읽을 만큼만 남긴다.
export function shortProject(slug) {
  if (!slug) return null
  const trimmed = slug.replace(/^-Users-[^-]+-Projects-/, '').replace(/^-Users-[^-]+-/, '')
  // worktree 슬러그는 저장소 이름을 두 번 담아서 아주 길다.
  // work-org-a-app-a--orca-workspaces-app-a-feat-monorepo-step-a
  const wt = trimmed.match(/^(.+?)--orca-workspaces-.*?-([^-]+(?:-[^-]+)*)$/)
  return wt ? `${wt[1]} (worktree ${wt[2]})` : trimmed
}

const SCOPE_NAMES = { repo: '이 저장소', global: '전역', plugin: '플러그인' }

// 무엇이 없어서 못 재는지 단위 이름으로 말한다.
const UNIT_NAMES = {
  delegations: '이 범위에 위임 기록이 없다',
  agents: '이 저장소에 에이전트 정의가 없다',
  declaredSkills: '에이전트가 선언한 스킬이 없다',
  hooks: '이 범위에 훅 실행 기록이 없다',
  sessions: '이 범위에 세션이 없다',
}

function emptyReason(axis, fallbackSource = 'delegations') {
  return axis.unavailable ?? UNIT_NAMES[axis.source ?? fallbackSource] ?? '분모가 비어 못 쟀다'
}

// 사례는 "어느 위임을 고쳐야 하나"를 말해야 한다.
//
// 실측(2026-08-28): 모델 명시 위반 118건 중 112건에 description 이 있는데 안 읽고
// 있었다. 그래서 사례 넷이 `korean-tone  general-purpose  model=없음` 으로 똑같이
// 보였다. 어느 위임인지 가릴 수 없으면 고칠 수도 없다.
//
// 프로젝트도 슬러그 원문을 찍고 있었다. 몰린 곳은 shortProject 로 줄이는데 사례는 아니었다.
function defaultDescribe(r) {
  return [
    shortProject(r.project) ?? r.project,
    r.agentType,
    `model=${r.model ?? '없음'}`,
    // 긴 지시문은 줄을 넘겨서 오히려 안 읽힌다. 무엇이었는지 알 만큼만 남긴다.
    r.description && `"${r.description.length > 60 ? `${r.description.slice(0, 60)}…` : r.description}"`,
  ]
    .filter(Boolean)
    .join('  ')
}

// 위반이 몰린 곳을 위반율 순으로. 분모가 작아 비율만 크게 나오는 것은 뒤로 민다.
//
// violations 는 늘 scoped.filter(...) 라 부분집합이다. 그래서 bad 의 모든 키가
// totals 에 있다. 분모 자리에 `?? 1` 이 있었는데 도달 불가한 방어였고, 도달하면
// `5/0` 을 보여주면서 비율은 500% 로 내는 모양이 된다. 분모가 비면 판정 불가라는
// 원칙과 어긋나니 지웠다. 계약이 깨지면 NaN 으로 눈에 띄는 게 낫다.
function concentrate(scoped, violations, groupBy) {
  const totals = new Map()
  const bad = new Map()
  // groupBy 를 한 행에 두 번 부르지 않는다. 비결정적이면 넣는 키와 찾는 키가 갈린다
  for (const r of scoped) {
    const k = groupBy(r)
    totals.set(k, (totals.get(k) ?? 0) + 1)
  }
  for (const r of violations) {
    const k = groupBy(r)
    bad.set(k, (bad.get(k) ?? 0) + 1)
  }
  return [...bad.entries()]
    .map(([key, count]) => ({ key, count, of: totals.get(key), rate: count / totals.get(key) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

export function observe(sources, axes = observation) {
  const list = Array.isArray(sources) ? { delegations: sources } : sources
  return axes.map((axis) => {
    const base = { id: axis.id, label: axis.label, note: axis.note, noTrend: axis.noTrend, fp: axisFingerprint(axis) }
    // 준수율 축과 같은 이유로 감싼다. 축 하나가 터지면 그 축만 빼고 나머지는 보여준다.
    try {
      const got = axis.compute(list) ?? { value: null }
      // 관찰값도 왜 못 쟀는지 단위 이름으로 말한다. 준수율 축과 같은 함수를 쓴다.
      // compute 가 null 을 내는 이유는 늘 분모가 비었기 때문이다.
      //
      // 기본 단위를 안 준다. 관찰값 축은 source 를 안 적는 것이 많고(세션·토큰을 쓴다)
      // 위임으로 떠넘기면 세션 축이 "위임 기록이 없다"고 거짓말한다.
      if (got.value === null || got.value === undefined) {
        return { ...base, ...got, value: null, unavailable: emptyReason(axis, null) }
      }
      return { ...base, ...got }
    } catch (e) {
      return { ...base, value: null, broken: `축이 터졌다: ${e.message}` }
    }
  })
}

// 훅은 세션 안에 접혀 있다. 축이 한 건씩 보게 편다.
// 훅 실행 총합. 요약 띠 "훅 실행" 칸의 재료다. 판정이 아니라 합이라 여기 둔다.
// 실측(2026-09-13, 이 저장소): 세션 6개에서 실행 9,638회, 이벤트 키 64종(PreToolUse:Bash 같은
// event:tool 단위), 실패 0.
export function hookTotals(rows) {
  if (!rows.length) return null
  const names = new Set()
  let runs = 0
  let fail = 0
  for (const h of rows) {
    names.add(h.name)
    runs += h.ok + h.fail
    fail += h.fail
  }
  return { runs, events: names.size, fail }
}

export function hookRows(sessionRows) {
  const out = []
  for (const s of sessionRows) {
    for (const [name, h] of Object.entries(s.hooks)) {
      out.push({ project: s.project, sessionId: s.sessionId, name, ok: h.ok, fail: h.fail, why: h.why ?? [] })
    }
  }
  return out
}

// 에이전트 정의에 실제 호출 수를 붙인다. 정의했는데 안 쓰인 것을 가리려면 이 조인이 필요하다.
//
// 전역 정의는 저장소 범위로 세지 않는다. 이 축이 기간을 안 좁히는 것과 같은 이유다.
// "한 달에 한 번 쓰는 에이전트도 살아 있다"가 시간 쪽 근거였는데, 범위 쪽에도
// 그대로 성립한다. 다른 저장소에서만 쓰는 전역 에이전트도 살아 있다.
// 범위를 좁히면 멀쩡한 정의를 지우라고 말하게 된다.
export function agentRows(repo, rows, everyRepoRows = rows, defs = agentDefs(repo)) {
  const count = (list) => {
    const m = new Map()
    for (const r of list) m.set(r.agentType, (m.get(r.agentType) ?? 0) + 1)
    return m
  }
  const here = count(rows)
  const anywhere = count(everyRepoRows)
  // basis 는 이 정의를 무엇으로 셌는지의 크기다. 0 이면 그 정의는 판정할 수 없다.
  // 전역과 저장소 정의가 서로 다른 기록을 보니 판정 가능 여부도 정의마다 다르다.
  return defs.map((a) => {
    const global = a.scope === 'global'
    return { ...a, calls: (global ? anywhere : here).get(a.name) ?? 0, basis: (global ? everyRepoRows : rows).length }
  })
}

export function declaredSkillRows(repo) {
  const index = skillIndex(repo)
  const out = []
  for (const agent of agentDefs(repo)) {
    for (const skill of agent.skills) {
      const hit = index.get(skill)
      out.push({ agent: agent.name, scope: agent.scope, skill, exists: Boolean(hit?.exists), path: hit?.path ?? null })
    }
  }
  return out
}

// 지난번 대비 변화. 비교할 스냅샷이 없으면 아무것도 안 붙인다.
function arrow(d) {
  // 표시 자릿수보다 작은 변화는 없는 것으로 친다. 안 그러면 `-0.0%p` 같은 게 뜬다.
  if (!d || Math.abs(d.diff) < 0.0005) return ''
  const pp = (d.diff * 100).toFixed(1)
  return d.diff > 0 ? `  (지난번보다 +${pp}%p)` : `  (지난번보다 ${pp}%p)`
}

// 준수율의 기본 창은 최근 30일이다. 전체 기간이 아니다.
//
// 목표가 100% 인 축을 전체 기간으로 재면 **영원히 100% 로 못 돌아온다.** 과거는 못 고친다.
// 도달 불가능한 목표는 "고치는 루프"라는 목적 자체를 깬다.
//
// 실측(2026-08-27): 모델 명시가 전체 기간 94.8%, 최근 30일 97.6%, 최근 14일 99.3% 다.
// 위반 53건 중 마지막이 8월 24일이고 대부분 7월이다. 지금은 지키고 있는데
// 7월의 잔재가 현재 점수를 누르고 있었다.
const DEFAULT_WINDOW_DAYS = 30

// 사실을 모아 축을 적용한 결과. 감시 쪽도 이걸 그대로 쓴다.
export function buildReport({ repo = null, since = null, until = null, cache = true, axes = null, pinned = false, scanner = null } = {}) {
  const useCompliance = axes?.compliance ?? compliance
  const useObservation = axes?.observation ?? observation
  // 전사는 한 번만 훑는다. 여기서 dispatch 와 토큰이 같이 나온다.
  const pass = transcriptPass(undefined, { cache, scanner: scanner ? rustScanner('transcript') : null })
  let rows = withDispatch(delegations(undefined, { cache, scanner: scanner ? rustScanner('delegation') : null }), undefined, pass)
  const totalAll = rows.length
  const everyRepoRows = rows // 저장소로 좁히기 전. 전역 에이전트는 여기서 센다
  if (repo) {
    const slug = projectSlug(repo)
    rows = rows.filter((r) => r.project === slug || r.project.startsWith(`${slug}--`))
  }
  const allTimeRows = rows // 저장소로만 좁힌 것. 기간은 아직 안 좁혔다
  if (since) rows = rows.filter((r) => r.ts && r.ts >= since)
  if (until) rows = rows.filter((r) => r.ts && r.ts < until)

  let sessionRows = sessions(undefined, { cache, scanner: scanner ? rustScanner('session') : null })
  // 거쳐온 곳 중 하나라도 맞으면 이 저장소의 세션이다.
  // 옮겨온 세션을 옛 저장소에만 달면 지금 일하는 곳이 비어 보인다.
  if (repo) {
    const touches = (s) => (s.repos?.length ? s.repos : [s.repo]).some((c) => c === repo || c?.startsWith(`${repo}/`))
    sessionRows = sessionRows.filter(touches)
  }
  if (since) sessionRows = sessionRows.filter((s) => s.endedAt && s.endedAt >= since)
  if (until) sessionRows = sessionRows.filter((s) => s.startedAt && s.startedAt < until)

  // 세션은 창과 **겹치면** 잡는다. 위임은 시점 하나로 판단한다. 그 비대칭이 조용히 값을 오염시킨다.
  //
  // 세션 기반 축(훅 무결성·가드 차단·위임률·캐시 적중률)은 세션 row 의 집계를 쓴다.
  // 그 집계는 세션 **전체 기간** 값이라 창으로 안 잘린다. 실측(2026-08-27):
  //
  //   창      세션  창 밖으로 뻗는 것   그 세션들의 턴 / 전체 턴
  //   하루     14        14 (100%)          838 / 838   (100%)
  //   한 주    36        20 ( 56%)        1,490 / 1,709 ( 87%)
  //   30일    142        11 (  8%)          829 / 3,373 ( 25%)
  //
  // 하루 창에 위임은 4건으로 좁혀지는데 턴은 838 이 그대로 들어온다. 기본 창에서도
  // 표본의 4분의 1이 창 밖 값이다.
  //
  // 일 단위 버킷으로 잘라 정확히 재는 것을 재보고 안 만들었다(46회차).
  //
  // 비용은 작다. 세션 150개가 버킷 510개(세션당 3.4, 절반은 하루라 1개)고 캐시가
  // 638KB 에서 1.5MB 정도 된다. 이득도 재봤다. 창 밖 세션을 아예 빼면(하한) 이렇다.
  //
  //   창      가드 차단          훅 무결성
  //   하루    1.19 → 판정 불가   99.53% → 판정 불가
  //   한 주   1.35 → 0.46        99.74% → 100.00%
  //   30일    3.91 → 4.48        99.85% → 99.92%
  //
  // 정확한 값은 그 사이다. 기본 창에서 15% 오차다. 그런데 **창이 고정이면 오차 방향이
  // 일정해서 추세는 유효하다.** scopeKey 에 창이 들어가 다른 창과 섞이지도 않는다.
  // 짧은 창의 큰 오차는 아래 경고가 알린다. scan·report·축을 다 건드릴 값어치가 없다.
  const spanning = sessionRows.filter((s) => (since && s.startedAt < since) || (until && s.endedAt >= until))
  const turnsAll = sessionRows.reduce((n, s) => n + s.turns, 0)
  const turnsSpanning = spanning.reduce((n, s) => n + s.turns, 0)

  // 토큰도 세션과 같은 범위로 좁힌다. 안 좁히면 저장소를 골라도 위임률이 전체 값으로 나온다.
  const inScope = new Set(sessionRows.map((s) => s.sessionId))
  const scopedTokens = new Map([...pass.tokens].filter(([id]) => inScope.has(id)))

  const sources = { delegations: rows, sessions: sessionRows, hooks: hookRows(sessionRows), tokens: scopedTokens }
  if (repo) {
    // 하네스 활용만 기간을 안 좁힌다.
    //
    // "정의가 죽었나"는 리포트 창이 아니라 그 질문 고유의 시간 축을 가진다.
    // 한 달에 한 번 쓰는 에이전트도 살아 있다. 창을 좁히면 멀쩡한 정의가 죽은 걸로 보인다.
    // 실측: app-a 의 frontend-reviewer 가 14일 창에서 "호출 0회"로 잡혔는데
    // 30일 창에서는 쓰였다. 짧은 창으로 돌리면 살아 있는 정의를 지우라고 말하게 된다.
    sources.agents = agentRows(repo, allTimeRows, everyRepoRows)
    // 전제 조건도 축이 보는 것과 같은 것을 봐야 한다.
    // 창만 보면 "이 저장소에 위임 기록이 없다"고 하면서 정작 축은 전체 기간으로 판정한다.
    sources.delegationsAllTime = allTimeRows
    sources.declaredSkills = declaredSkillRows(repo)
  }

  return {
    scope: {
      repo,
      since,
      until,
      // 상주가 켤 때 잡아 끝까지 안 바꾸는 창인가. 스냅샷 키가 날마다 밀지 않게 한다.
      pinned,
      delegations: rows.length,
      sessions: sessionRows.length,
      totalAll,
      // 세션 기반 축의 표본이 창을 얼마나 넘는지. 창이 없으면 0 이다.
      spanningSessions: spanning.length,
      spanningTurnShare: turnsAll ? turnsSpanning / turnsAll : 0,
    },
    // 전 프로젝트를 볼 때는 어느 프로젝트가 끌어내리는지를 본다.
    // 프로젝트를 가로질러 평균만 내면 그게 곧 종합 점수다. 왜 떨어졌는지가 가려진다.
    compliance: measure(sources, useCompliance, repo ? undefined : (r) => shortProject(r.project) ?? r.agentType ?? '기타'),
    observation: observe(sources, useObservation),
    // 요약 띠의 훅 칸. 축이 아니라 합이다. 훅 기록이 없으면 null(판정 불가), 0 으로 뭉개지 않는다.
    hookTotals: hookTotals(sources.hooks),
    // 죽은 경로는 하네스 문서를 훑어서 찾는다. 훑을 문서가 없으면 0건이 아니라 판정 불가다.
    // 분모가 비면 예외 없이 판정 불가라는 원칙이 여기도 그대로다.
    refDocs: repo ? harnessDocs(repo).length : 0,
    refs: {
      deadPaths: repo ? deadPaths(repo) : [],
      brokenSkillRefs: repo ? brokenSkillRefs(repo) : [],
      danglingSkills: repo ? danglingSkills(repo) : [],
    },
    // 근거가 사라진 축. 화면은 축마다 "판정 불가"로 말하고 있었는데 상주는 아무 말도
    // 안 했다. checkCitations 를 터미널 출력부만 부르고 있었다.
    //
    // 실측(2026-08-28): 근거 문구를 다시 쓴 문서로 재보니 66.7% 였던 축이 판정 불가로
    // 빠졌고 worseThings 는 빈 배열을 냈다. 규칙 하나에 눈이 감겼는데 상주가 조용했다.
    citations: checkCitations(useCompliance),
    contradictions: repo ? candidates(repo) : [],
    // 후보 0건이 "모순이 없다"인지 "비교할 게 없다"인지 가르려면 문서 수가 필요하다
    contradictionDocs: repo ? harnessCorpus(repo).length : 0,
    // 이 저장소 것이 하나도 없으면 전역 규칙만 보고 있는 것이다. 그게 첫 번째 할 일이다.
    repoDocs: repo ? harnessCorpus(repo).filter(([, , scope]) => scope === 'repo').length : 0,
    files: pass.files,
    // 추세는 스냅샷이 아니라 데이터에서 뽑는다. 소급되고 시간 간격이 진짜다.
    weekly: weeklySeries(rows, { compliance: useCompliance, observation: useObservation }, { measure, observe }),
  }
}

export function scopeFromArgs() {
  const all = process.argv.includes('--all')
  const repo = all ? null : path.resolve(arg('repo') ?? process.cwd())
  // 없는 경로를 주면 모든 축이 "기록이 없다"로 빠져서 오타인지 안 쓴 저장소인지 알 수 없다.
  if (repo && !fs.existsSync(repo)) {
    console.error(`그런 디렉터리가 없다: ${repo}`)
    process.exit(1)
  }
  const until = dateArg('until')
  // 창을 두 번 말하면 하나가 조용히 죽는다. `--since` 가 이기고 `--all-time` 은 아무 일도 안 했다.
  // `--since --all` 이 필터를 무력화한 것과 같은 부류다. 조용히 지지 않게 막는다.
  // `--all-time --until` 은 다르다. 처음부터 그 날까지라 창이 하나다.
  if (process.argv.includes('--all-time') && process.argv.includes('--since')) {
    console.error('--all-time 과 --since 를 같이 줬다. 창은 하나여야 한다')
    process.exit(1)
  }
  const since =
    dateArg('since') ??
    (process.argv.includes('--all-time') ? null : new Date(Date.now() - DEFAULT_WINDOW_DAYS * 864e5).toISOString())
  // 창이 뒤집히면 아무것도 안 잡힌다. 0건을 보여주는 것보다 말하는 게 낫다.
  if (since && until && Date.parse(since) >= Date.parse(until)) {
    console.error(`창이 비었다: --since ${since} 가 --until ${until} 보다 늦거나 같다`)
    process.exit(1)
  }
  // 뽑는 층을 갈아끼운다. 판정은 그대로다. 지금은 세션 전사만 Rust 가 읽는다.
  // 이름이 틀리면 죽는다. 조용히 JS 로 돌아가면 플래그가 아무 일도 안 하고 아무 말도 안 한다.
  const name = arg('scanner')
  if (name !== null && name !== 'rust' && name !== 'js') {
    console.error(`--scanner 는 rust 나 js 여야 한다: ${name}`)
    process.exit(1)
  }
  return {
    repo,
    until,
    since,
    cache: !process.argv.includes('--no-cache'),
    // 뽑는 함수마다 스캐너를 따로 만든다. 캐시 지문에 무엇을 뽑는지가 들어가야
    // 세션 캐시와 전사 캐시가 서로의 지문을 쓰지 않는다.
    scanner: name === 'rust',
  }
}

// JSON 소비자가 판정 불가를 미달로 읽지 않게 구조로 가른다.
//
// jq 에서 `null < 0.95` 는 true 다. 그래서 `select(.rate < 0.95)` 로 게이트를 걸면
// 판정 불가가 같이 잡힌다. 실측(2026-08-27): `--repo .` 에서 판정 불가 3건이 전부
// 걸렸다. 터미널과 HTML 은 "판정 불가"라고 따로 말하는데 JSON 만 rate: null 로 뭉갰다.
// 같은 사실을 세 곳에 내면서 한 곳만 애매했다.
//
// fp 는 스냅샷 비교용 내부 값이라 뺀다.
export function jsonView(report, delta = null) {
  const strip = ({ fp, ...rest }) => rest
  const judged = (v) => v !== null && v !== undefined
  return {
    ...report,
    compliance: report.compliance.filter((c) => judged(c.rate)).map(strip),
    observation: report.observation.filter((o) => judged(o.value)).map(strip),
    // 못 잰 것은 여기 모은다. 왜 못 쟀는지 단위 이름으로 말한다.
    unjudged: [
      ...report.compliance
        .filter((c) => !judged(c.rate))
        .map((c) => ({ kind: 'compliance', id: c.id, label: c.label, why: c.unavailable ?? '판정 불가' })),
      ...report.observation
        .filter((o) => !judged(o.value))
        .map((o) => ({ kind: 'observation', id: o.id, label: o.label, n: o.n ?? 0, why: o.broken ?? o.unavailable })),
    ],
    delta,
  }
}

// 상주. 나빠진 것만 말하고 좋아진 것은 스냅샷에만 쌓는다.
function runWatch(axes) {
  // 창을 켤 때 잡고 끝까지 안 바꾼다. 그래야 tick 사이에 새로 들어온 것만 값을 움직인다.
  // pinned 를 같이 넘겨서 스냅샷 키도 안 밀게 한다(snapshot.mjs 의 windowLabel).
  const opts = { ...scopeFromArgs(), axes, pinned: true }
  const noTrend = axes.observation.filter((a) => a.noTrend).map((a) => a.id)
  let last = null

  const tick = (why) => {
    const report = buildReport(opts)
    const now = condense(report, new Date().toISOString())
    const worse = worseThings(last, report)
    const stamp = new Date().toTimeString().slice(0, 8)

    // 알림 한 줄로 무엇을 할지 정해야 한다. 다음 걸음을 같이 준다.
    // 범위는 리포트와 같아야 한다. 지시서의 검증 명령과 같은 이유다(fix.mjs).
    const how = `node ${process.argv[1]} ${opts.repo ? `--repo ${opts.repo} ` : '--all '}--plan`

    if (worse.length) {
      console.log(`\n[${stamp}] 나빠졌다`)
      for (const w of worse) console.log(`  · ${w.text}`)
      console.log(`  고치려면: ${how}`)
    } else if (last === null) {
      console.log(`[${stamp}] 기준을 잡았다. 위임 ${report.scope.delegations}건, 세션 ${report.scope.sessions}개`)
      for (const c of report.compliance) {
        if (c.rate !== null) console.log(`  ${c.label} ${(c.rate * 100).toFixed(1)}%`)
      }
      // 못 잰 축을 조용히 빼면 기준선이 축을 몇 개 보는지 알 수 없다.
      const unjudged = report.compliance.filter((c) => c.rate === null).length
      if (unjudged) console.log(`  판정 불가 ${unjudged}개 (리포트를 돌리면 왜인지 말한다)`)
      // 기준선이 알림이 재는 것을 다 말해야 한다.
      //
      // 준수율만 찍고 있었다. 그런데 알림 네 종류 중 셋(죽은 참조·모순 후보·근거)은
      // 건수로 견준다. 죽은 경로가 이미 3건인 저장소에서 상주를 켜면 그 3 을 한 번도
      // 못 듣고, 나중에 "3건 → 7건" 이라는 처음 듣는 숫자를 받는다.
      for (const [name, n] of Object.entries(counts(report))) console.log(`  ${name} ${n}건`)
    }

    // 쌓기만 하고 말하지 않는다.
    //
    // "바뀌었지만 나빠진 것은 없다"를 찍고 있었는데 설계와 어긋났다. 이 파일 위쪽과
    // watch.mjs 머리에 "좋아진 것은 스냅샷에만 조용히 쌓고 말하지 않는다"고 적혀 있다.
    // 실측(--watch 20분): 그 줄이 15번 나갔고 전부 화면에 안 보이는 흔들림이었다.
    //
    // 중복 판정은 save 가 파일 기준으로 한다. 여기서 메모리로 걸러도 상주가 둘이면
    // 각자 자기 것만 봐서 이력이 중복된다. 판정을 한 곳에 둔다.
    save(report, now.at, { noTrend })
    last = {
      compliance: Object.fromEntries(report.compliance.map((c) => [c.id, c])),
      refs: now.refs,
      contradictions: now.contradictions,
      citations: now.citations,
      raw: now,
    }
  }

  console.log(`감시 중: ${ROOT}`)
  console.log(`범위: ${opts.repo ?? '전 프로젝트'}`)
  // 창을 말한다. 켤 때 잡아 끝까지 안 바꾸니, 며칠 돌면 창이 그만큼 넓어진다.
  console.log(`창: ${opts.since ? `${opts.since.slice(0, 10)} 부터` : '전체 기간'} (켤 때 잡아 고정한다)\n`)
  tick('처음')
  watch({ onQuiet: tick })
  process.on('SIGINT', () => {
    console.log('\n감시를 멈춘다.')
    process.exit(0)
  })
}

async function main() {
  const axes = await loadAxes()
  if (process.argv.includes('--watch')) return runWatch(axes)
  const opts = { ...scopeFromArgs(), axes }
  const { repo, since, until } = opts
  const report = buildReport(opts)
  const { rates, trends } = { rates: report.compliance, trends: report.observation }
  const { deadPaths: dead, brokenSkillRefs: broken, danglingSkills: dangling } = report.refs
  const contradictions = report.contradictions
  const rows = { length: report.scope.delegations }
  const sessionRows = { length: report.scope.sessions }
  const totalAll = report.scope.totalAll
  const pass = { files: report.files }

  // 직전 스냅샷과의 차이는 저장하기 전에 구한다. 저장하고 나면 자기 자신과 비교하게 된다.
  const change = delta(report)
  // 쌓았는지 말한다. 사용자가 명시적으로 요청한 것이라 결과를 알아야 한다.
  //
  // --html 은 "어디에 썼다"고 말하고 --plan 은 갈래를 낸다. --save 만 조용했다.
  // 41회차에 같은 값이면 안 쌓게 했으니, 말하지 않으면 쌓은 줄 알고 넘어간다.
  // 상주(--watch)는 다르다. 거기서는 "쌓기만 하고 말하지 않는다"가 설계다(40회차).
  if (process.argv.includes('--save')) {
    const row = save(report, undefined, { noTrend: axes.observation.filter((a) => a.noTrend).map((a) => a.id) })
    // stderr 로 쓴다. --json --save 조합에서 stdout 에 섞이면 JSON 이 깨진다.
    // 실제로 넣어보고 jq 가 "Invalid numeric literal" 로 죽는 것을 봤다.
    console.error(row ? `스냅샷을 쌓았다: ${storePath()}` : `지난번과 같아서 스냅샷을 안 쌓았다: ${storePath()}`)
  }

  if (process.argv.includes('--plan')) {
    // 전 프로젝트 범위에서는 볼 수가 없다. "깨끗하다"고 말하면 거짓말이다.
    //
    // 죽은 참조·깨진 스킬 선언·모순 후보는 저장소가 있어야 검사한다(buildReport 의
    // `repo ? ... : []`). --all 은 그걸 다 건너뛰고 refs 가 전부 0 으로 온다.
    // 실측(2026-08-28): --all --plan 이 "깨끗하다"고 했는데 저장소별로 돌리니
    // app-a 12건, org-a 33건, server-a·server-b 각 6건이었다.
    //
    // 다만 아예 돌아서면 안 된다. 근거가 사라진 축은 저장소와 무관하게 나온다.
    // 실측(2026-08-28): 같은 리포트로 --all --html 은 그 갈래를 냈는데
    // --all --plan 은 "못 뽑는다"고만 했다. 한 사실을 두 곳이 다르게 말했다.
    if (!repo) {
      console.log('전 프로젝트 범위에서는 저장소 축을 못 뽑는다. 죽은 참조와 모순 후보는 저장소가 있어야 검사한다.')
      console.log('--repo <경로> 로 저장소를 골라라.\n')
    }
    const p = plan(report)
    if (p.total === 0) {
      // 저장소를 안 골랐으면 위에서 이미 말했다. 거기에 "깨끗하다"를 더하면 거짓말이 된다.
      if (repo) console.log('고칠 게 없다. 깨끗하다.')
      return
    }
    console.log(
      p.lanes.length === 1
        ? `고칠 것 ${p.total}건. 파일이 서로 겹쳐서 한 갈래로 묶었다.\n`
        : `고칠 것 ${p.total}건을 ${p.lanes.length}갈래로 갈랐다. 파일이 안 겹치니 동시에 돌려도 된다.\n`,
    )
    for (const lane of p.lanes) {
      console.log('─'.repeat(72))
      console.log(lane.prompt)
      console.log()
    }
    return
  }

  const htmlPath = arg('html')
  if (htmlPath) {
    const at = new Date().toISOString()
    fs.writeFileSync(htmlPath, render({ report, at, fixPlan: plan(report) }))
    const weeks = report.weekly?.length ?? 0
    console.log(`${htmlPath} 에 썼다.${weeks ? ` 주별 ${weeks}칸으로 추세를 그렸다.` : ''}`)
    return
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(jsonView(report, change), null, 2))
    return
  }

  console.log(repo ? `저장소: ${repo}` : '범위: 전 프로젝트')
  if (axes.from) console.log(`축: 기본 + ${axes.from}`)

  // 근거를 못 찾았으면 아래 숫자를 읽기 전에 알아야 한다.
  // 그 축은 판정 불가로 빠지지만, 왜 빠졌는지는 한 곳에 모아 말해야 보인다.
  const drifted = report.citations
  if (drifted.length) {
    console.log(`\n⚠ 축 ${drifted.length}개의 근거를 이 하네스에서 못 찾아 판정에서 뺐다`)
    for (const d of drifted) console.log(`  · ${d.axis} → ${d.reason}`)
  }
  // 전 프로젝트 범위는 저장소 축을 건너뛴다. 절이 아예 안 나오니 "없다"로 읽힐 수 있다.
  // README 에는 적혀 있지만 화면을 보는 사람은 그걸 안 읽었을 수 있다.
  if (!repo) {
    console.log('저장소 축(죽은 참조·모순 후보·하네스 활용)은 건너뛴다. --repo 로 저장소를 골라야 본다')
  }
  // 이 저장소에 규칙이 없으면 아래 숫자 전부가 전역 규칙 기준이다. 먼저 알아야 한다.
  // 전역 문서만으로도 문서 수가 채워지니 "모순 후보 0건"이 깨끗하다는 뜻처럼 보인다.
  // 실측: harness-bro 가 CLAUDE.md 도 AGENTS.md 도 없는데 "하네스 문서 2개"로 나왔다.
  if (repo && report.repoDocs === 0) {
    console.log('\n⚠ 이 저장소에는 하네스 문서가 없다. CLAUDE.md 도 AGENTS.md 도 없어서 전역 규칙만 보고 있다')
  }
  // 화살표가 조용히 사라지면 "변화 없음"으로 읽힌다. 실제로는 견줄 수가 없는 것이다.
  if (change?.redefined?.length) {
    console.log(`\n※ 축 ${change.redefined.length}개는 재는 방식이 바뀌어 지난번과 안 견줬다: ${change.redefined.join(', ')}`)
  }
  console.log(
    `위임 ${rows.length}건${rows.length === totalAll ? '' : ` (전체 ${totalAll}건 중)`}, 세션 ${sessionRows.length}개`,
  )
  // 세션 표본이 창을 넘으면 말한다. 훅·차단·턴이 그만큼 창 밖 값이다.
  if (report.scope.spanningSessions > 0) {
    const pct = Math.round(report.scope.spanningTurnShare * 100)
    console.log(
      `※ 세션 ${sessionRows.length}개 중 ${report.scope.spanningSessions}개가 이 창 밖으로 뻗는다. ` +
        `훅·차단·턴 표본의 ${pct}% 가 창 밖 값이다`,
    )
  }
  // 창은 늘 말한다. --all-time 일 때만 이 줄이 없어서, 저장된 리포트를 나중에 읽으면
  // 전체 기간인지 기본 30일인지 가릴 수 없었다. 범위를 말하는 것과 같은 결이다.
  //
  // "최근 N일"은 창이 지금까지 이어질 때만 맞다. --until 이 있으면 이미 끝난 창이다.
  // 미래 창이면 "최근 -127일" 이 된다. 일수는 양수일 때만 쓴다.
  const n = since && !until ? Math.round((Date.now() - Date.parse(since)) / 864e5) : 0
  const days = n > 0 ? ` (최근 ${n}일)` : ''
  console.log(`기간: ${since ? since.slice(0, 10) : '처음'}${days} ~ ${until ?? '지금'}`)

  console.log('\n준수율 (목표 100%)\n')
  for (const r of rates) {
    if (r.rate === null) {
      console.log(`  ${r.label}  판정 불가`)
      console.log(`    ${r.unavailable ?? '분모가 비어 못 쟀다'}`)
      console.log()
      continue
    }
    console.log(`  ${r.label}  ${(r.rate * 100).toFixed(1)}%${arrow(change?.compliance[r.id])}   ${r.total}건 중 ${r.violations}건 위반`)
    console.log(`    근거: ${r.rule}`)
    const weeks = report.weekly.map((w) => w.axes[r.id]).filter(Boolean)
    const gap = trendGap(weeks)
    if (gap === null) {
      const shown = weeks.map((w) => w.rate)
      const solid = shown.filter((x) => x !== null)
      console.log(
        `    주별: ${sparkline(shown, { min: Math.min(...solid), max: 1 })}  ${report.weekly[0].start} ~ ${report.weekly.at(-1).start}` +
          `  (${solid.map((x) => (x * 100).toFixed(0) + '%').join(' → ')})`,
      )
    } else {
      console.log(`    ${gap}`)
    }
    if (r.concentration?.length > 1) {
      // 건수만 보이면 큰 프로젝트가 늘 앞에 온다. 분모를 같이 줘야
      // "40건 중 6건"과 "616건 중 8건"이 다른 얘기라는 게 보인다.
      const where = r.concentration.map((c) => `${c.key} ${c.count}/${c.of}`).join(', ')
      console.log(`    몰린 곳: ${where}`)
    }
    for (const s of r.samples) console.log(`    · ${s}`)
    console.log()
  }

  if (pass.files) {
    const { read, reused } = pass.files
    // "0개 중 0개는 다시 안 읽었다"는 아무 말도 아니다. 전사가 없다는 것이 진짜 소식이고,
    // 처음 돌리는 사람에게는 그게 설정 문제라는 신호다.
    if (read + reused === 0) {
      console.log(`\n전사가 하나도 없다. ${ROOT} 를 본다. HARNESS_BRO_ROOT 로 바꿀 수 있다`)
    } else {
      console.log(`\n전사 ${read + reused}개 중 ${reused}개는 안 바뀌어 다시 안 읽었다`)
    }
  }

  console.log('\n관찰값 (목표 없음, 추세로 본다)\n')
  for (const t of trends) {
    const shown = t.broken ? '고장' : (formatValue(t.value, t.unit) ?? '판정 불가')
    console.log(`  ${t.label}  ${shown}   표본 ${t.n ?? 0}`)
    // 값이 null 인 것만으로는 "데이터가 없다"와 "축이 고장났다"가 구별되지 않는다
    console.log(`    ${t.broken ?? t.unavailable ?? t.note}`)
    if (t.detail) console.log(`    ${Object.entries(t.detail).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    // 절 이름이 "추세로 본다"인데 추세를 안 보여주고 있었다. 준수율에는 이 줄이 있었다.
    //
    // 못 재는 축에는 안 붙인다. 위에서 이미 왜 못 재는지 말했다.
    if (t.value !== null && t.value !== undefined) {
      const weeks = report.weekly.map((w) => w.axes[t.id]).filter(Boolean)
      // 빈 자리를 두면 데이터가 없는 건지 축이 고장난 건지 모른다. 못 그리면 왜인지 말한다.
      const gap = trendGap(weeks, { noTrend: t.noTrend })
      if (gap === null) {
        // 관찰값은 목표가 없다. 그래서 0 부터가 아니라 지나온 값의 범위 안에서 그린다.
        // 준수율은 목표가 100% 라 max 를 1 로 고정한다. 화면과 같은 기준이다(render.mjs).
        const solid = weeks.map((w) => w.rate).filter((x) => typeof x === 'number')
        console.log(
          `    주별: ${sparkline(weeks.map((w) => w.rate), { min: Math.min(...solid), max: Math.max(...solid) })}` +
            `  ${report.weekly[0].start} ~ ${report.weekly.at(-1).start}`,
        )
      } else {
        console.log(`    ${gap}`)
      }
    }
  }

  if (repo) {
    console.log('\n죽은 참조\n')
    // how 를 같이 낸다. 지시서만 읽고 있었다.
    //
    // 42회차 실측: "절대 경로가 없음" 은 7건 중 거짓 1건(14%), "git 이 아는 경로
    // 어디에도 없음" 은 14건 중 거짓 5건(36%) 이다. 그걸 안 보여주면 읽는 사람이
    // 셋을 다 같은 무게로 읽는다. 실측(2026-08-28, kbo-card-gacha): 3건이
    // `/kbo/solo/2026`·`/epl/solo/2526`·git 원격 주소인데 화면에서 구별이 안 됐다.
    //
    // 줄 번호도 낸다. 축의 근거에는 줄을 안 박지만(26회차) 이건 다르다.
    // 매번 새로 찾은 값이라 어긋날 수가 없고, 고치려면 그 줄로 가야 한다.
    if (report.refDocs === 0) {
      console.log('  문서가 가리키는데 없는 경로  판정 불가')
      console.log('    훑을 하네스 문서가 없다. CLAUDE.md 나 AGENTS.md 가 있어야 검사한다')
    } else console.log(`  문서가 가리키는데 없는 경로  ${dead.length}건`)
    for (const d of dead.slice(0, 12)) {
      const at = `${path.basename(d.doc)}${d.lineNumber ? `:${d.lineNumber}` : ''}`
      console.log(`    · ${at}  ${d.token}${d.how ? `  — ${d.how}` : ''}`)
    }
    const globalBroken = broken.filter((b) => b.scope !== 'repo').length
    console.log(`  선언했는데 없는 스킬  ${broken.length}건${globalBroken ? ` (${globalBroken}건은 전역 에이전트)` : ''}`)
    for (const b of broken) console.log(`    · ${b.agent}${b.scope === 'global' ? ' (전역)' : ''} → ${b.skill}  ${b.reason}`)
    // 전역·플러그인 것은 저장소마다 같은 건이 나온다. 어디 것인지 말해야
    // 이 저장소를 고치는 일로 안 읽는다. 실측: 저장소 12곳 전부에서 같은 3건이 나왔다.
    const globalDangling = dangling.filter((d) => d.scope !== 'repo').length
    const note = globalDangling ? ` (${globalDangling}건은 이 저장소 밖)` : ''
    console.log(`  스킬 디렉터리의 깨진 심링크  ${dangling.length}건${note}`)
    for (const d of dangling) {
      const where = SCOPE_NAMES[d.scope] ?? d.path
      console.log(`    · ${d.skill}  ${where}${d.target ? ` → ${d.target} (없음)` : ''}`)
    }

    if (report.contradictionDocs < MIN_DOCS) {
      console.log(`\n모순 후보  판정 불가`)
      const many = report.contradictionDocs === 0 ? '없다' : `${report.contradictionDocs}개뿐이다`
      console.log(`  비교할 하네스 문서가 ${many}. 둘은 있어야 서로 어긋나는지 볼 수 있다\n`)
    } else {
      console.log(
        `\n모순 후보  ${contradictions.length}건  (하네스 문서 ${report.contradictionDocs}개 · 기계는 후보만 좁힌다. 판정은 사람과 Claude 몫)\n`,
      )
    }
    for (const c of contradictions) {
      console.log(`  ▸ ${c.token}`)
      for (const e of c.evidence) console.log(`     [${e.pol}] ${e.doc}  ${e.line.slice(0, 90)}`)
    }
  }
  console.log()
}

if (import.meta.filename === process.argv[1]) main()
