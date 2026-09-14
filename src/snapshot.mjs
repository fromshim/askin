// 집계를 시점별로 쌓는다. 원본 전사가 정리돼도 추세는 안 끊기게.
//
// 앱은 ~/.claude/projects 를 절대 쓰지 않는다(설계 문서의 불변식).
// 그래서 여기가 이 앱이 쓰는 유일한 곳이다.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// 부를 때마다 읽는다. 모듈을 읽는 순간 고정하면 테스트가 경로를 못 바꾼다.
export function storePath() {
  return process.env.HARNESS_BRO_STORE ?? path.join(os.homedir(), '.harness-bro', 'snapshots.jsonl')
}

// 같은 범위끼리만 비교해야 한다. 전 프로젝트와 한 저장소를 섞으면 추세가 거짓말한다.
//
// 기간 창도 범위의 일부다. 최근 30일치와 전체 기간치는 같은 축이라도 다른 숫자다.
// 창을 안 넣으면 `--all-time` 한 번이 추세에 절벽을 만들고, 그게 실제 변화처럼 보인다.
export function scopeKey(scope) {
  const where = scope.repo ?? '(전 프로젝트)'
  return `${where} @${windowLabel(scope)}`
}

function windowLabel(scope) {
  if (!scope.since && !scope.until) return '전체기간'
  // 끝을 정한 창은 지금과 무관하게 고정이다. 날짜로 그대로 적는다.
  if (scope.until) return `${scope.since ? scope.since.slice(0, 10) : '처음'}~${scope.until.slice(0, 10)}`
  // 상주는 켤 때 창을 잡고 끝까지 안 바꾼다. 그 창을 "최근 N일"로 적으면 날이 지날 때마다
  // 키가 최근30일 → 최근31일로 밀린다. **창은 그대로인데 통이 갈린다.** 하루에 한 통씩
  // 생겨서 이력이 어디에도 안 쌓인다. 시작 날짜로 적어야 한 통에 모인다.
  //
  // 창을 tick 마다 다시 잡는 길도 있었는데 안 갔다. 실측(2026-08-28): 창을 하루 굴리면
  // 모델 명시가 98.34% → 98.82% 로 0.48%p 움직인다. 흔들림 문턱(0.05%p)의 열 배다.
  // 낡은 위반이 창 밖으로 빠지는 것만으로 "나빠졌다"가 나간다. 39~41회차에 지운
  // 거짓 알림이 그 모양이었다.
  if (scope.pinned) return `${String(scope.since).slice(0, 10)}~`
  // 지금까지 이어지는 창은 날짜로 두면 매일 키가 바뀐다. "최근 N일"로 뭉갠다.
  // 못 읽는 날짜나 미래 창이면 NaN·음수가 키에 박힌다. 그때는 날짜를 그대로 쓴다.
  const n = Math.round((Date.now() - Date.parse(scope.since)) / 864e5)
  return n > 0 ? `최근${n}일` : `${String(scope.since).slice(0, 10)}~`
}

// 표본만 빼고 숫자만 남긴다. 원본이 정리돼도 남을 것들이다.
export function condense(report, at) {
  return {
    at,
    scope: scopeKey(report.scope),
    delegations: report.scope.delegations,
    sessions: report.scope.sessions ?? null,
    // fp 는 축이 무엇을 재는지의 지문이다. 정의가 바뀌면 옛 값과 비교할 수 없다.
    compliance: Object.fromEntries(
      report.compliance.map((c) => [c.id, { rate: c.rate, total: c.total, violations: c.violations, fp: c.fp ?? null }]),
    ),
    // unit 은 저장 판정에 쓴다. count 와 ratio 의 표시 자릿수가 다르다.
    observation: Object.fromEntries(
      report.observation.map((o) => [o.id, { value: o.value ?? null, n: o.n ?? null, unit: o.unit ?? null, fp: o.fp ?? null }]),
    ),
    refs: {
      deadPaths: report.refs.deadPaths.length,
      brokenSkillRefs: report.refs.brokenSkillRefs.length,
      danglingSkills: report.refs.danglingSkills.length,
    },
    contradictions: report.contradictions.length,
    // 근거가 사라진 축의 수. 죽은 참조와 같은 부류라 같은 모양으로 쌓는다.
    citations: report.citations?.length ?? 0,
  }
}

// 화면에서 같아 보이는 변화로는 스냅샷을 쌓지 않는다.
//
// 실측(2026-08-27, --watch 20분): 스냅샷 11줄이 쌓였는데 변화가 두 종류뿐이었다.
//   active-sessions 가 15분 창이 흐르며 6→7→8→9→6→5
//   delegation-share·cache-hit 이 0.2236739→0.2236602 처럼 다섯째 소수점
// 화면에는 둘 다 똑같이 찍힌다. 알림 여덟 번이 전부 무의미했다.
//
// worseThings 는 이미 "반올림해서 같아 보이는 흔들림은 말하지 않는다"를 한다.
// 저장 판정만 JSON.stringify 로 15자리까지 보고 있었다.
//
// noTrend 축(지금 도는 세션)은 애초에 추세 대상이 아니라 판정에서 뺀다.
export function saveKey(row, { noTrend = [] } = {}) {
  const skip = new Set(noTrend)
  // 화면 표시 자릿수에 맞춘다. 준수율과 ratio 는 (v*100).toFixed(1) 이라 소수 셋째,
  // count 는 v.toFixed(2) 라 둘째까지 보인다. 그 아래는 화면에서 같은 숫자다.
  const round = (v, unit) => (typeof v === 'number' ? Number(v.toFixed(unit === 'count' ? 2 : 3)) : v)
  const shrink = (obj, key, unitOf) =>
    Object.fromEntries(
      Object.entries(obj ?? {})
        .filter(([id]) => !skip.has(id))
        .map(([id, v]) => [id, { ...v, [key]: round(v[key], unitOf(v)) }]),
    )
  return JSON.stringify({
    ...row,
    at: null,
    // 준수율의 unit 은 세는 단위(delegations 등)라 표시 자릿수와 무관하다. 늘 셋째까지 본다.
    compliance: shrink(row.compliance, 'rate', () => 'ratio'),
    observation: shrink(row.observation, 'value', (v) => v.unit),
  })
}

// 같은 범위의 직전 스냅샷과 화면에서 같아 보이면 안 쌓는다. 쌓았으면 그 줄을 낸다.
//
// 판정을 메모리가 아니라 파일로 한다. 상주 두 개가 같은 범위를 감시하면 각자
// 자기 메모리만 보고 같은 값을 두 줄씩 넣는다. 실측(2026-08-27):
//
//   13:01:25.183 | 모델 명시 66.7%
//   13:01:25.183 | 모델 명시 66.7%   ← 쌍둥이
//   13:01:31.181 | 모델 명시 57.1%
//   13:01:31.182 | 모델 명시 57.1%   ← 쌍둥이
//
// 그러면 delta 가 직전 스냅샷으로 자기 쌍둥이를 봐서 diff 0 이 되고 **실제 변화
// 66.7% → 57.1% 를 놓친다.** 알림은 메모리로 견주니 정상인데 이력만 조용히 오염된다.
//
// 완전한 잠금은 아니다. 둘이 같은 순간에 읽으면 둘 다 쓴다. 다만 appendFileSync 는
// 작은 줄이라 원자적이어서 줄이 깨지지는 않는다. 파일 잠금까지 갈 일은 아니다.
export function save(report, at = new Date().toISOString(), { noTrend = [] } = {}) {
  const row = condense(report, at)
  const past = history(report.scope)
  const last = past[past.length - 1]
  if (last && saveKey(row, { noTrend }) === saveKey(last, { noTrend })) return null
  const file = storePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(row) + '\n')
  return row
}

export function history(scope, { limit = 200 } = {}) {
  let text
  try {
    text = fs.readFileSync(storePath(), 'utf8')
  } catch {
    return []
  }
  // 문자열 지름길을 두지 않는다. 범위 키가 "어디 @언제" 꼴이라
  // raw 문자열을 주면 어디에도 안 맞아 조용히 빈 배열이 돌아온다.
  const key = scopeKey(scope)
  const out = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const row = JSON.parse(line)
      if (row.scope !== key) continue
      // 연속 중복은 하나로 본다.
      //
      // 상주 둘이 같은 범위를 감시하면 같은 값이 두 줄씩 들어온다. save 가 파일을
      // 읽고 견주게 해봤지만 안 막힌다. 디바운스가 같아서 둘이 **정확히 같은 순간에**
      // tick 한다. 실측에서 타임스탬프가 밀리초까지 같았다(13:03:34.871 두 줄).
      //
      // 쓰기 경쟁을 파일 잠금 없이 막을 수 없으니 읽을 때 정리한다. 그러면 delta 가
      // 자기 쌍둥이를 직전으로 보고 diff 0 을 내는 것도 같이 풀린다.
      // save 가 이미 값이 같은 줄을 안 쌓으니, 여기 남은 연속 중복은 경쟁 산물뿐이다.
      if (out.length && saveKey(row) === saveKey(out[out.length - 1])) continue
      out.push(row)
    } catch {
      /* 깨진 줄은 넘어간다 */
    }
  }
  return out.slice(-limit)
}

// 옛 스냅샷과 지금 축이 같은 것을 재고 있나.
//
// 스냅샷은 축 id 로 견준다. 뜻이 바뀌면 같은 id 로 다른 것을 재게 된다.
// 옛 스냅샷에 fp 가 없으면(그 필드를 만들기 전) 뜻이 같은지 알 수 없으니 역시 안 견준다.
// delta 와 watch 가 같은 판정을 써야 한다. 한쪽만 고치면 화면과 알림이 다른 말을 한다.
export function comparable(before, cur) {
  return Boolean(before?.fp) && before.fp === cur?.fp
}

// 직전 스냅샷과의 차이. 첫 스냅샷이면 null 이다.
export function delta(report, at = new Date().toISOString()) {
  const past = history(report.scope)
  const last = past[past.length - 1]
  if (!last) return null
  const now = condense(report, at)
  const out = { since: last.at, compliance: {}, observation: {}, refs: {}, contradictions: null, redefined: [] }
  for (const [id, cur] of Object.entries(now.compliance)) {
    const before = last.compliance?.[id]
    if (!before || before.rate === null || cur.rate === null) continue
    if (!comparable(before, cur)) {
      // 지문이 다르면 축을 바꾼 것이라 알려야 한다. 아예 없으면 fp 를 만들기 전
      // 스냅샷이고 사람이 조치할 게 없다. 말하면 노이즈다
      if (before.fp) out.redefined.push(id)
      continue
    }
    out.compliance[id] = { from: before.rate, to: cur.rate, diff: cur.rate - before.rate }
  }
  for (const [id, cur] of Object.entries(now.observation)) {
    const before = last.observation?.[id]
    if (!before || before.value === null || cur.value === null) continue
    if (!comparable(before, cur)) {
      if (before.fp) out.redefined.push(id)
      continue
    }
    out.observation[id] = { from: before.value, to: cur.value, diff: cur.value - before.value }
  }
  for (const [k, cur] of Object.entries(now.refs)) {
    const before = last.refs?.[k]
    if (before === undefined) continue
    out.refs[k] = { from: before, to: cur, diff: cur - before }
  }
  if (last.contradictions !== undefined) {
    out.contradictions = { from: last.contradictions, to: now.contradictions, diff: now.contradictions - last.contradictions }
  }
  return out
}
