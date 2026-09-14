// 리포트를 한 장으로 그린다. 의존성도 빌드 단계도 없다. 파일 하나 열면 끝이다.
//
// 준수율은 게이지, 관찰값은 추세다. 둘을 섞지 않는 것이 이 화면의 전부다.
// 준수율은 목표가 100% 라 100 을 기준으로 그리고,
// 관찰값은 목표가 없어서 지나온 값들의 범위 안에서만 그린다.

import { trendGap } from './series.mjs'
import { formatValue } from './axes.mjs'

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c])

export function render({ report, at = new Date().toISOString(), fixPlan = null }) {
  const weekly = report.weekly ?? []
  const { scope } = report
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>하네스 점검 · ${h(shortScope(scope))}</title>
<style>${CSS}</style>
</head><body>
<header>
  <h1>하네스 점검</h1>
  <p class="scope">${h(scope.repo ?? '전 프로젝트')}</p>
  <p class="meta">위임 ${scope.delegations}건${
    // 창이나 저장소로 좁힌 만큼을 말한다. "위임 0건" 만 보면 도구가 고장난 건지
    // 이 저장소에서 위임을 안 쓴 건지 가릴 수 없다. totalAll 도 터미널만 읽고 있었다.
    scope.totalAll !== undefined && scope.delegations !== scope.totalAll ? ` (전체 ${scope.totalAll}건 중)` : ''
  } · 세션 ${scope.sessions ?? 0}개 · ${h(at.slice(0, 16).replace('T', ' '))} · 기간 ${h(scope.since?.slice(0, 10) ?? '처음')} ~ ${h(scope.until?.slice(0, 10) ?? '지금')}</p>
  ${
    // 이 저장소에 규칙이 없으면 아래 숫자 전부가 전역 규칙 기준이다. 먼저 알아야 한다.
    // 터미널은 ⚠ 로 말하는데 화면은 아무 말도 안 했다. repoDocs 를 읽는 출구가
    // 터미널 하나뿐이었다. 화면은 남겨두고 보는 것이라 오히려 여기가 더 필요하다.
    scope.repo && report.repoDocs === 0
      ? '<p class="alert">⚠ 이 저장소에는 하네스 문서가 없다. CLAUDE.md 도 AGENTS.md 도 없어서 아래 숫자는 전부 전역 규칙 기준이다</p>'
      : ''
  }
  ${
    // 세션 기반 축(훅 무결성·가드 차단)의 표본이 창을 얼마나 넘는지. 이것도 터미널만
    // 알고 있었다. 창이 고정이라 오차 방향이 일정해서 추세는 유효하지만, 절대값을
    // 읽는 사람은 표본의 몇 %가 창 밖 값인지 알아야 한다.
    scope.spanningSessions > 0
      ? `<p class="meta">※ 세션 ${scope.sessions ?? 0}개 중 ${scope.spanningSessions}개가 이 창 밖으로 뻗는다. 훅·차단·턴 표본의 ${Math.round(scope.spanningTurnShare * 100)}% 가 창 밖 값이다</p>`
      : ''
  }
</header>

<section>
  <h2>준수율 <span class="note">기준이 이미 내가 쓴 규칙이다. 목표는 100%</span></h2>
  ${report.compliance.map((c) => complianceRow(c, weekly)).join('\n')}
</section>

<section>
  <h2>관찰값 <span class="note">"얼마가 좋은가"의 기준이 없다. 추세로만 본다</span></h2>
  ${report.observation.map((o) => observationRow(o, weekly)).join('\n')}
</section>

${refsSection(report.refs, report.scope.repo, report.refDocs)}
${contradictionSection(report.contradictions, report.contradictionDocs, report.scope.repo)}
${fixSection(fixPlan)}

<footer>종합 점수는 만들지 않는다. 왜 떨어졌는지를 가린다.</footer>
${fixPlan?.lanes.length ? SCRIPT : ''}
</body></html>
`
}

function shortScope(scope) {
  return scope.repo ? scope.repo.split('/').pop() : '전 프로젝트'
}

// 근거는 "위치  문장" 꼴이다. 위치만 코드로 감싼다.
// 문장까지 코드 상자에 넣으면 한글 산문이 자간 벌어진 채로 나온다.
export function rule(text) {
  const m = String(text ?? '').match(/^(\S+)\s{2,}(.+)$/)
  return m ? `<code>${h(m[1])}</code> ${h(m[2])}` : h(text)
}

function complianceRow(c, weekly) {
  // rate 가 null 이면 measure() 가 늘 unavailable 을 붙인다. 갈래를 둘로 두면
  // 이유 없는 쪽이 "해당 없음"이라고 말하게 된다.
  if (c.rate === null) {
    return `<article class="axis muted">
  <div class="row"><span class="label">${h(c.label)}</span><span class="value">판정 불가</span></div>
  <p class="why">${h(c.unavailable ?? '분모가 비어 못 쟀다')}</p>
</article>`
  }
  const pct = c.rate * 100
  const state = c.violations === 0 ? 'ok' : pct >= 95 ? 'warn' : 'bad'
  // 추세는 스냅샷이 아니라 주별 데이터에서 온다. 소급되고 시간 간격이 진짜다.
  const weeks = weekly.map((w) => w.axes?.[c.id]).filter(Boolean)
  const shown = weeks.map((w) => w.rate)
  const solid = shown.filter((x) => x !== null)
  const diff = solid.length >= 2 ? (solid.at(-1) - solid.at(-2)) * 100 : null

  return `<article class="axis">
  <div class="row">
    <span class="label">${h(c.label)}</span>
    <span class="value ${state}">${pct.toFixed(1)}%${diff === null || Math.abs(diff) < 0.05 ? '' : `<em>${diff > 0 ? '+' : ''}${diff.toFixed(1)}%p</em>`}</span>
  </div>
  <div class="gauge"><i class="${state}" style="width:${pct.toFixed(2)}%"></i></div>
  ${
    trendGap(weeks) === null
      ? `${spark(shown, { min: Math.min(...solid), max: 1 })}<p class="nodata">주별 ${h(weekly[0].start)} ~ ${h(weekly.at(-1).start)} · ${solid.map((x) => (x * 100).toFixed(0) + '%').join(' → ')}</p>`
      : `<p class="nodata">${h(trendGap(weeks))}</p>`
  }
  <p class="why">${h(c.total)}건 중 <b>${h(c.violations)}건</b> 위반 · 근거: ${rule(c.rule)}</p>
  ${
    c.concentration?.length > 1
      ? `<p class="chips">몰린 곳 ${c.concentration.map((x) => `<span>${h(x.key)} ${x.count}/${x.of}</span>`).join('')}</p>`
      : ''
  }
  ${
    c.samples?.length
      ? `<details><summary>위반 ${c.samples.length}건 보기</summary><ul>${c.samples
          .map((s) => `<li>${h(s).replace(/\n\s*/g, '<br>')}</li>`)
          .join('')}</ul></details>`
      : ''
  }
</article>`
}

function observationRow(o, weekly) {
  if (o.value === null || o.value === undefined) {
    const why = o.broken ?? o.unavailable ?? '분모가 비어 못 쟀다'
    return `<article class="axis muted"><div class="row"><span class="label">${h(o.label)}</span><span class="value">${o.broken ? '고장' : '판정 불가'}</span></div><p class="why">${h(why)}</p></article>`
  }
  const shown = formatValue(o.value, o.unit)
  // 추세는 주별 데이터에서만 그린다. 스냅샷은 저장 명령을 돌린 시점에만 생겨 간격이 거짓말한다.
  // 위임만 있으면 되는 축만 주별로 낼 수 있다. 세션·토큰이 필요한 축은 그리지 않는다.
  const weeks = weekly.map((w) => w.axes?.[o.id]).filter(Boolean)
  const series = weeks.map((w) => w.rate)
  const solid = series.filter((x) => typeof x === 'number')
  return `<article class="axis">
  <div class="row">
    <span class="label">${h(o.label)}</span>
    <span class="value plain">${h(shown)}</span>
  </div>
  ${
    trendGap(weeks, { noTrend: o.noTrend }) === null
      ? `${spark(series, { min: Math.min(...solid), max: Math.max(...solid) })}<p class="nodata">주별 ${h(weekly[0].start)} ~ ${h(weekly.at(-1).start)}</p>`
      : `<p class="nodata">${h(trendGap(weeks, { noTrend: o.noTrend }))}</p>`
  }
  <p class="why">${h(o.note ?? '')} · 표본 ${h(o.n ?? 0)}</p>
  ${o.detail ? `<p class="chips">${Object.entries(o.detail).map(([k, v]) => `<span>${h(k)} ${h(v)}</span>`).join('')}</p>` : ''}
</article>`
}


// 관찰값은 목표가 없다. 그래서 0 부터가 아니라 지나온 값의 범위 안에서 그린다.
export function spark(values, { w = 240, hgt = 28, min: lo, max: hi } = {}) {
  const solid = values.filter((v) => typeof v === 'number')
  if (solid.length < 2) return '<p class="nodata">추세를 그리려면 값이 두 개 이상 필요하다</p>'
  const min = lo ?? Math.min(...solid)
  const max = hi ?? Math.max(...solid)
  const span = max - min
  const pts = values
    .map((v, i) => {
      // 표본이 얇아 비율을 안 낸 칸은 선을 잇지 않고 건너뛴다
      if (typeof v !== 'number') return null
      const x = (i / (values.length - 1)) * w
      // 값이 하나도 안 변했으면 바닥이 아니라 가운데에 긋는다.
      // 바닥에 붙은 직선은 데이터가 아니라 구분선처럼 보인다.
      const y = span === 0 ? hgt / 2 : hgt - ((v - min) / span) * (hgt - 4) - 2
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .filter(Boolean)
    .join(' ')
  return `<svg class="spark" viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" role="img" aria-label="추세"><polyline points="${pts}"/></svg>`
}

// 전역·플러그인 것은 저장소마다 같은 건이 나온다. 어디 것인지 말해야 한다.
const SCOPE_NAMES = { repo: '이 저장소', global: '전역', plugin: '플러그인' }

// 저장소가 없으면 검사를 아예 안 했다. 0건이라고 말하면 거짓말이다.
//
// 실측(2026-08-28): `--all --html` 이 "죽은 참조 모두 0건" 에 0건 줄 셋을 냈다.
// 터미널은 같은 상황에서 "저장소 축은 건너뛴다"고 말하고 있었다. 49회차의 거짓말이
// 화면에 남아 있었다.
const NEED_REPO = '저장소를 골라야 검사한다. <code>--repo &lt;경로&gt;</code> 로 고른다'

function refsSection(refs, repo, refDocs = 1) {
  if (!repo) {
    return `<section>
  <h2>죽은 참조 <span class="note">가리키는 대상이 없는 것</span></h2>
  <article class="axis muted">
    <div class="row"><span class="label">죽은 참조</span><span class="value">판정 불가</span></div>
    <p class="why">${NEED_REPO}</p>
  </article>
</section>`
  }
  const total = refs.deadPaths.length + refs.brokenSkillRefs.length + refs.danglingSkills.length
  return `<section>
  <h2>죽은 참조 <span class="note">가리키는 대상이 없는 것. 모두 ${total}건</span></h2>
  ${
    // 훑을 문서가 없으면 0건이 아니라 판정 불가다. 터미널과 같은 말을 한다.
    refDocs === 0
      ? `<article class="axis muted"><div class="row"><span class="label">문서가 가리키는데 없는 경로</span><span class="value">판정 불가</span></div><p class="why">훑을 하네스 문서가 없다. CLAUDE.md 나 AGENTS.md 가 있어야 검사한다</p></article>`
      : listBlock(
    '문서가 가리키는데 없는 경로',
    refs.deadPaths,
    // how 는 거짓 양성 비율이 다른 두 종류를 가르는 유일한 신호다(42회차: 14% 대 36%).
    // 지시서만 읽고 있어서 화면에서는 셋이 같은 무게로 보였다.
    (d) =>
      `${h(d.doc.split('/').pop())}${d.lineNumber ? `:${d.lineNumber}` : ''} → <code>${h(d.token)}</code>` +
      (d.how ? ` <span class="note">${h(d.how)}</span>` : ''),
        )
  }
  ${listBlock('선언했는데 없는 스킬', refs.brokenSkillRefs, (b) => `${h(b.agent)} → <code>${h(b.skill)}</code> ${h(b.reason)} <span class="note">${h(SCOPE_NAMES[b.scope] ?? '')}</span>`)}
  ${listBlock(
    '스킬 디렉터리의 깨진 심링크',
    refs.danglingSkills,
    // 이름만 주면 어디를 고칠지 모른다. 50회차에 터미널에는 대상을 붙였는데
    // 화면에는 안 붙였다. 같은 사실을 두 곳에서 다르게 말하고 있었다.
    (d) =>
      `<code>${h(d.skill)}</code> <span class="note">${h(SCOPE_NAMES[d.scope] ?? '')}</span>` +
      (d.target ? ` → <code>${h(d.target)}</code> <span class="note">없음</span>` : ''),
  )}
</section>`
}

function listBlock(title, items, fmt) {
  if (!items.length) return `<article class="axis muted"><div class="row"><span class="label">${h(title)}</span><span class="value ok">0건</span></div></article>`
  // 길면 접어둔다. 26건짜리가 펼쳐져 있으면 아래 절이 화면 밖으로 밀린다.
  const open = items.length <= 8 ? ' open' : ''
  return `<article class="axis">
  <div class="row"><span class="label">${h(title)}</span><span class="value bad">${items.length}건</span></div>
  <details${open}><summary>목록 ${items.length}건</summary><ul>${items.map((i) => `<li>${fmt(i)}</li>`).join('')}</ul></details>
</article>`
}

function contradictionSection(list, docs = 99, repo = '있다') {
  // 문서가 모자란 것과 아예 안 본 것은 다르다. 전 프로젝트 범위에서 문서 수가 0 으로
  // 오는데, 그건 하네스에 문서가 없다는 뜻이 아니라 저장소를 안 골랐다는 뜻이다.
  if (!repo || docs < 2) {
    return `<section>
  <h2>모순 후보 <span class="note">기계는 후보만 좁힌다. 어긋나는지 판정은 사람과 Claude 몫</span></h2>
  <article class="axis muted">
    <div class="row"><span class="label">두 문서가 반대로 말하는 토큰</span><span class="value">판정 불가</span></div>
    <p class="why">${
      repo
        ? `비교할 하네스 문서가 ${docs === 0 ? '없다' : `${h(docs)}개뿐이다`}. 둘은 있어야 서로 어긋나는지 볼 수 있다`
        : NEED_REPO
    }</p>
  </article>
</section>`
  }
  return `<section>
  <h2>모순 후보 <span class="note">하네스 문서 ${h(docs)}개 · 기계는 후보만 좁힌다. 판정은 사람과 Claude 몫</span></h2>
  ${
    list.length === 0
      ? '<article class="axis muted"><div class="row"><span class="label">두 문서가 반대로 말하는 토큰</span><span class="value ok">0건</span></div></article>'
      : list
          .map(
            (c) => `<article class="axis">
  <div class="row"><span class="label"><code>${h(c.token)}</code></span><span class="value warn">${c.docs.length}개 문서</span></div>
  <ul class="evidence">${c.evidence
    .map((e) => `<li><span class="pol ${h(e.pol)}">${h(e.pol)}</span> <b>${h(e.doc)}</b> ${h(e.line.slice(0, 160))}</li>`)
    .join('')}</ul>
</article>`,
          )
          .join('\n')
  }
</section>`
}

// 화면에서 고치기로 이어지는 길. 여기가 설계 문서가 말하는 "입구"다.
// 앱이 고치지는 않는다. 지시서를 손에 쥐여주는 데까지가 몫이다.
function fixSection(fixPlan) {
  if (!fixPlan || fixPlan.total === 0) return ''
  const many = fixPlan.lanes.length > 1
  return `<section>
  <h2>고치기 <span class="note">${
    many
      ? `${fixPlan.total}건을 ${fixPlan.lanes.length}갈래로 갈랐다. 파일이 안 겹치니 동시에 돌려도 된다`
      : `${fixPlan.total}건. 파일이 서로 겹쳐서 한 갈래로 묶었다`
  }</span></h2>
  ${fixPlan.lanes
    .map(
      (lane, i) => `<article class="axis">
  <div class="row">
    <span class="label">${h(lane.id)} <span class="note">${lane.findings.length}건 · 파일 ${lane.files.length}개</span></span>
    <button class="copy" data-for="p${i}">지시서 복사</button>
  </div>
  ${lane.needsJudgement ? '<p class="why"><b>판정이 필요한 건이 섞여 있다.</b> 기계는 후보만 좁혔다</p>' : ''}
  <details><summary>지시서 보기</summary><pre id="p${i}">${h(lane.prompt)}</pre></details>
</article>`,
    )
    .join('\n')}
</section>`
}

const SCRIPT = `<script>
document.querySelectorAll('.copy').forEach((b) => {
  b.onclick = async () => {
    await navigator.clipboard.writeText(document.getElementById(b.dataset.for).textContent)
    const was = b.textContent
    b.textContent = '복사했다'
    setTimeout(() => (b.textContent = was), 1200)
  }
})
</script>`

const CSS = `
:root {
  /* 대비를 브라우저에서 재고 정했다(2026-08-27, 43회차). WCAG AA 는 일반 텍스트 4.5:1 이다.
     --warn 이 흰 배경에서 3.87 이었다. 준수율이 낮을 때 쓰는 색이라 안 읽히면 곤란하다.
     code 는 색을 상속해서 --dim 이 됐고 --line 배경 위에서 라이트 4.42 / 다크 4.33 이었다.
     test/render.test.mjs 가 토큰 쌍을 계산해 지킨다. */
  --bg:#fbfaf9; --fg:#1c1a17; --dim:#6b6560; --line:#e6e1dc; --card:#fff;
  --ok:#2f7d5d; --warn:#946a15; --bad:#b4402c; --accent:#4a5a8a;
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#16151a; --fg:#e8e5e0; --dim:#948d86; --line:#2c2a31; --card:#1e1d23;
          --ok:#5fb98f; --warn:#d6a44f; --bad:#e07a63; --accent:#8fa0d4; }
}
* { box-sizing:border-box }
body { margin:0; padding:2.5rem 1.25rem 4rem; background:var(--bg); color:var(--fg);
  font:15px/1.6 ui-sans-serif,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif; }
header, section, footer { max-width:52rem; margin:0 auto }
h1 { font-size:1.5rem; margin:0 0 .2rem; letter-spacing:-.01em }
.scope { margin:0; color:var(--fg); font-weight:600; word-break:break-all }
.meta { margin:.15rem 0 2rem; color:var(--dim); font-size:.85rem }
h2 { font-size:1rem; margin:2.2rem 0 .8rem; padding-bottom:.4rem; border-bottom:1px solid var(--line) }
.note { font-weight:400; color:var(--dim); font-size:.8rem; margin-left:.4rem }
.alert { color:var(--warn); font-size:.85rem; margin:.6rem 0 0 }
.axis { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:.85rem 1rem; margin-bottom:.6rem }
.axis.muted { opacity:.62 }
.row { display:flex; align-items:baseline; justify-content:space-between; gap:1rem }
.label { font-weight:600 }
.value { font-variant-numeric:tabular-nums; font-weight:600; white-space:nowrap }
.value.ok { color:var(--ok) } .value.warn { color:var(--warn) } .value.bad { color:var(--bad) }
.value.plain { color:var(--accent) }
.value em { font-style:normal; font-weight:400; font-size:.8rem; color:var(--dim); margin-left:.4rem }
.gauge { height:5px; background:var(--line); border-radius:3px; margin:.55rem 0 .5rem; overflow:hidden }
.gauge i { display:block; height:100%; border-radius:3px; background:var(--ok) }
.gauge i.warn { background:var(--warn) } .gauge i.bad { background:var(--bad) }
.why { margin:.3rem 0 0; color:var(--dim); font-size:.82rem }
.why b { color:var(--fg) }
.chips { margin:.45rem 0 0; font-size:.78rem; color:var(--dim) }
.chips span { display:inline-block; background:var(--line); border-radius:20px; padding:.1rem .55rem; margin:.15rem .3rem .15rem 0; color:var(--fg) }
code { font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--line); color:var(--fg); padding:.05rem .3rem; border-radius:4px; word-break:break-all }
details { margin-top:.5rem } summary { cursor:pointer; font-size:.82rem; color:var(--dim) }
ul { margin:.4rem 0 0; padding-left:1.1rem; font-size:.82rem; color:var(--dim) }
li { margin:.18rem 0; word-break:break-all }
.evidence { list-style:none; padding:0 }
.evidence li { padding:.3rem 0; border-top:1px solid var(--line) }
.pol { display:inline-block; min-width:2.6rem; text-align:center; border-radius:4px; padding:0 .3rem;
  font-size:.7rem; font-weight:600; background:var(--line) }
.pol.neg { color:var(--bad) } .pol.pos { color:var(--ok) } .pol.both { color:var(--warn) }
.spark { width:100%; height:28px; margin:.5rem 0 .2rem; display:block }
.spark polyline { fill:none; stroke:var(--accent); stroke-width:1.5; vector-effect:non-scaling-stroke }
.nodata { margin:.4rem 0 0; font-size:.78rem; color:var(--dim); font-style:italic }
.copy { font:inherit; font-size:.78rem; border:1px solid var(--line); background:var(--card); color:var(--dim);
  border-radius:6px; padding:.2rem .6rem; cursor:pointer }
.copy:hover { color:var(--fg); border-color:var(--dim) }
pre { margin:.5rem 0 0; padding:.7rem; background:var(--bg); border:1px solid var(--line); border-radius:8px;
  font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; word-break:break-word;
  max-height:26rem; overflow:auto }
footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--dim); font-size:.8rem }
`
