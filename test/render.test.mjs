// 화면이 거짓말하지 않는지만 본다. 모양은 눈으로 보면 되지만 이 셋은 눈으로 못 잡는다.
//   node --test test/render.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render, spark, rule } from '../src/render.mjs'

const base = {
  scope: { repo: '/repo/a', delegations: 10, sessions: 2 },
  compliance: [
    { id: 'x', label: '모델 명시', rule: '~/.claude/CLAUDE.md:9  `model` 을 항상 명시한다', rate: 0.9, total: 10, violations: 1, concentration: [], samples: [] },
  ],
  observation: [{ id: 'p', label: '병렬 비율', value: 0.33, unit: 'ratio', n: 5, note: '' }],
  refs: { deadPaths: [], brokenSkillRefs: [], danglingSkills: [] },
  contradictions: [],
}

test('산문을 코드 상자에 넣지 않는다', () => {
  assert.equal(rule('~/.claude/CLAUDE.md:9  `model` 을 항상 명시한다'), '<code>~/.claude/CLAUDE.md:9</code> `model` 을 항상 명시한다')
  // 위치가 없는 근거는 통째로 산문이다
  assert.equal(rule('에이전트가 선언한 스킬이 실재해야 한다'), '에이전트가 선언한 스킬이 실재해야 한다')
})

test('값이 안 변하면 바닥이 아니라 가운데에 긋는다', () => {
  const flat = spark([0.5, 0.5, 0.5], { w: 100, hgt: 28 })
  assert.match(flat, /14\.0/) // hgt/2
  assert.doesNotMatch(flat, /26\.0/) // 바닥이 아니다
})

test('값이 하나뿐이면 추세를 안 그린다', () => {
  assert.match(spark([0.5]), /값이 두 개 이상/)
})

test('표본이 얇아 비운 칸은 선을 잇지 않고 건너뛴다', () => {
  // 분모가 작은 주는 비율을 안 낸다. 그 칸을 0 으로 그리면 없던 급락이 생긴다.
  const svg = spark([null, 0.9, 0.95, null, 1.0], { w: 100, hgt: 28 })
  const pts = svg.match(/points="([^"]*)"/)[1].split(' ')
  assert.equal(pts.length, 3) // null 둘은 빠진다
})

test('주별로 못 내는 축은 왜 못 내는지 말한다', () => {
  // 스냅샷으로 그리던 것을 주별로 옮겼다. 위임만 있으면 되는 축만 낼 수 있다.
  // 못 내는 축에 빈 자리를 두면 데이터가 없는 건지 축이 고장난 건지 모른다.
  const r = structuredClone(base)
  r.observation = [
    { id: 'p', label: '병렬 비율', value: 0.33, unit: 'ratio', n: 5, note: '' },
    { id: 'a', label: '지금 도는 세션', value: 4, unit: 'count', n: 9, note: '', noTrend: '시점 값이라 추세가 성립하지 않는다' },
  ]
  const html = render({ report: r, weekly: [] })
  assert.match(html, /시점 값이라 추세가 성립하지 않는다/)
  assert.match(html, /주별로 나눌 수 없다/) // noTrend 가 없는 축은 기본 문구
})

test('문서에서 온 문자열을 그대로 심지 않는다', () => {
  const evil = structuredClone(base)
  evil.contradictions = [
    { token: '<script>alert(1)</script>', docs: ['a', 'b'], evidence: [{ pol: 'neg', doc: 'a', line: '<img onerror=x>' }] },
  ]
  const html = render({ report: evil })
  assert.doesNotMatch(html, /<script>alert/)
  assert.doesNotMatch(html, /<img onerror/)
  assert.match(html, /&lt;script&gt;/)
})

test('판정 불가와 0% 를 다르게 그린다', () => {
  const r = structuredClone(base)
  r.compliance = [
    { id: 'a', label: '판정 못함', rate: null, unavailable: '표본이 없다', total: 0, violations: 0, samples: [] },
    { id: 'b', label: '진짜 0퍼', rate: 0, total: 5, violations: 5, concentration: [], samples: [] },
  ]
  const html = render({ report: r })
  assert.match(html, /판정 불가/)
  assert.match(html, /표본이 없다/)
  assert.match(html, /0\.0%/)
})

test('색 대비가 WCAG AA 를 지킨다', () => {
  // 브라우저에서 재고 두 곳을 고쳤다(43회차). 흰 배경의 --warn 이 3.87 이었고,
  // code 가 색을 상속해 --dim 이 되면서 --line 배경 위에서 라이트 4.42 / 다크 4.33 이었다.
  // 눈으로 보는 대신 계산으로 지킨다. 값을 다시 만질 때 이게 잡는다.
  const css = render({
    report: {
      scope: { repo: null, since: null, until: null, delegations: 0, sessions: 0 },
      compliance: [], observation: [], weekly: [], files: {},
      refs: { deadPaths: [], brokenSkillRefs: [], danglingSkills: [] },
      contradictions: [], contradictionDocs: 0,
    },
  })
  const token = (name, dark) => {
    const block = dark ? css.slice(css.indexOf('prefers-color-scheme')) : css.slice(0, css.indexOf('prefers-color-scheme'))
    const m = block.match(new RegExp(`--${name}:(#[0-9a-f]{3,6})`, 'i'))
    assert.ok(m, `--${name} 를 ${dark ? '다크' : '라이트'} 블록에서 못 찾았다`)
    // #fff 처럼 세 자리로 적힌 것도 있다
    return m[1].length === 4 ? '#' + [...m[1].slice(1)].map((c) => c + c).join('') : m[1]
  }
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (fg, bg) => {
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
    return (a + 0.05) / (b + 0.05)
  }

  for (const dark of [false, true]) {
    const t = (n) => token(n, dark)
    // 값 색은 카드 위에, code 는 --line 위에 놓인다
    const pairs = [
      ['ok', 'card'], ['warn', 'card'], ['bad', 'card'], ['accent', 'card'],
      ['fg', 'card'], ['dim', 'bg'], ['fg', 'line'],
    ]
    for (const [fg, bg] of pairs) {
      const r = ratio(t(fg), t(bg))
      assert.ok(r >= 4.5, `${dark ? '다크' : '라이트'} --${fg} on --${bg} 대비 ${r.toFixed(2)} < 4.5`)
    }
  }
})

test('JSON 은 판정된 축과 못 잰 축을 구조로 가른다', async () => {
  // jq 에서 `null < 0.95` 는 true 다. 안 가르면 `select(.rate < 0.95)` 게이트에
  // 판정 불가가 같이 잡힌다. 실측(2026-08-27): --repo . 에서 판정 불가 3건이 다 걸렸다.
  // 터미널과 HTML 은 "판정 불가"라고 따로 말하는데 JSON 만 rate: null 로 뭉갰다.
  const { jsonView } = await import('../src/report.mjs')
  const report = {
    scope: { repo: '/r', since: null, until: null, delegations: 1, sessions: 1 },
    compliance: [
      { id: 'judged', label: '잼', rate: 0.9, total: 10, violations: 1, fp: 'a' },
      { id: 'zero', label: '영', rate: 0, total: 3, violations: 3, fp: 'b' },
      { id: 'blank', label: '못 잼', rate: null, unavailable: '이 범위에 위임 기록이 없다', fp: 'c' },
    ],
    observation: [
      { id: 'ok', label: '값', value: 0.33, n: 50, fp: 'd' },
      { id: 'none', label: '없음', value: null, n: 0, fp: 'e' },
      { id: 'boom', label: '고장', value: null, broken: '축이 터졌다: x', fp: 'f' },
    ],
    refs: { deadPaths: [], brokenSkillRefs: [], danglingSkills: [] },
    contradictions: [],
    weekly: [],
    files: {},
  }
  const v = jsonView(report)

  // 잰 것만 남는다. rate 0 은 잰 것이다
  assert.deepEqual(v.compliance.map((c) => c.id), ['judged', 'zero'])
  assert.deepEqual(v.observation.map((o) => o.id), ['ok'])

  // 못 잰 것은 이유와 함께 따로 나온다
  assert.deepEqual(
    v.unjudged.map((u) => [u.kind, u.id]),
    [['compliance', 'blank'], ['observation', 'none'], ['observation', 'boom']],
  )
  assert.match(v.unjudged[0].why, /위임 기록이 없다/)
  assert.equal(v.unjudged[1].n, 0) // 관찰값은 표본 수를 같이 준다
  assert.match(v.unjudged[2].why, /축이 터졌다/)

  // fp 는 스냅샷 비교용 내부 값이라 안 낸다
  for (const x of [...v.compliance, ...v.observation]) assert.equal('fp' in x, false)

  // 순진한 게이트가 안전하다
  const gated = v.compliance.filter((c) => c.rate < 0.95).map((c) => c.id)
  assert.deepEqual(gated, ['judged', 'zero'])
})

// 실측(2026-08-28): `--all-time` 은 since·until 이 둘 다 없어서 창을 아예 안 말했다.
// 저장된 리포트를 나중에 읽으면 전체 기간인지 기본 30일인지 가릴 수 없다.
// 범위를 말하는 것과 같은 결이다. 스냅샷 키는 그때도 '전체기간'이라 적고 있었다.
test('전체 기간이어도 창을 말한다', () => {
  const r = structuredClone(base)
  r.scope = { repo: null, since: null, until: null, delegations: 10, sessions: 2 }
  assert.match(render({ report: r, weekly: [] }), /기간 처음 ~ 지금/)

  const win = structuredClone(base)
  win.scope = { repo: null, since: '2026-08-01', until: null, delegations: 10, sessions: 2 }
  assert.match(render({ report: win, weekly: [] }), /기간 2026-08-01 ~ 지금/)
})

// 실측(2026-08-28): `--all --html` 이 "죽은 참조 모두 0건" 에 0건 줄 셋을 냈다.
// 저장소가 없으면 검사를 아예 안 한 것이다. 터미널은 같은 상황에서
// "저장소 축은 건너뛴다"고 말하고 있었다. 49회차의 거짓말이 화면에 남아 있었다.
test('저장소를 안 골랐으면 죽은 참조를 0건이라 하지 않는다', () => {
  const r = structuredClone(base)
  r.scope = { repo: null, since: null, until: null, delegations: 10, sessions: 2 }
  r.contradictionDocs = 0
  const html = render({ report: r, weekly: [] })
  assert.doesNotMatch(html, /모두 0건/)
  assert.match(html, /판정 불가/)
  // 문서가 모자란 것과 아예 안 본 것은 다르다
  assert.doesNotMatch(html, /비교할 하네스 문서가/)
  assert.equal(html.match(/저장소를 골라야 검사한다/g).length, 2) // 죽은 참조와 모순 후보 둘 다
})

test('저장소가 있으면 문서가 모자란 이유를 그대로 말한다', () => {
  const r = structuredClone(base)
  r.contradictionDocs = 1
  const html = render({ report: r, weekly: [] })
  assert.match(html, /비교할 하네스 문서가 1개뿐이다/)
  assert.doesNotMatch(html, /저장소를 골라야 검사한다/)
})

// 50회차에 터미널에는 대상을 붙였는데 화면에는 안 붙였다.
// 이름만 주면 어디를 고칠지 모른다.
test('깨진 심링크가 무엇을 가리키다 깨졌는지 화면도 말한다', () => {
  const r = structuredClone(base)
  r.refs.danglingSkills = [
    { skill: 'next-best-practices', path: '/h/.claude/skills/next-best-practices', scope: 'global', target: '../../.agents/skills/next-best-practices' },
    { skill: 'no-link', path: '/h/.claude/skills/no-link', scope: 'repo', target: null },
  ]
  const html = render({ report: r, weekly: [] })
  assert.match(html, /\.\.\/\.\.\/\.agents\/skills\/next-best-practices/)
  assert.match(html, /전역/)
  // 대상을 못 읽은 것에 "null" 을 찍지 않는다
  assert.doesNotMatch(html, />null</)
})

// 리포트 필드를 어느 출구가 읽는지 세보니 repoDocs 와 spanningSessions 를
// 터미널 하나만 읽고 있었다. 화면은 남겨두고 보는 것이라 오히려 여기가 더 필요하다.
test('하네스 문서가 없으면 화면이 먼저 말한다', () => {
  const bare = structuredClone(base)
  bare.repoDocs = 0
  assert.match(render({ report: bare, weekly: [] }), /하네스 문서가 없다/)

  const has = structuredClone(base)
  has.repoDocs = 3
  assert.doesNotMatch(render({ report: has, weekly: [] }), /하네스 문서가 없다/)

  // 전 프로젝트 범위에서는 저장소 문서를 안 센다. 없다고 말하면 거짓말이다.
  const all = structuredClone(base)
  all.repoDocs = 0
  all.scope = { repo: null, since: null, until: null, delegations: 1, sessions: 1 }
  assert.doesNotMatch(render({ report: all, weekly: [] }), /하네스 문서가 없다/)
})

test('세션 표본이 창을 넘으면 화면도 말한다', () => {
  // 훅 무결성과 가드 차단의 절대값을 읽는 사람이 알아야 한다.
  const r = structuredClone(base)
  r.scope = { repo: '/repo/a', delegations: 10, sessions: 44, spanningSessions: 11, spanningTurnShare: 0.333 }
  const html = render({ report: r, weekly: [] })
  assert.match(html, /세션 44개 중 11개가 이 창 밖으로 뻗는다/)
  assert.match(html, /33% 가 창 밖 값이다/) // 터미널과 같은 문구

  assert.doesNotMatch(render({ report: base, weekly: [] }), /창 밖으로 뻗는다/)
})

test('기간에 ISO 원문을 그대로 찍지 않는다', () => {
  // 기본 창은 since 가 시각까지 있다. 그대로 넣으면 2026-07-28T19:37:45.506Z 가 찍힌다.
  const r = structuredClone(base)
  r.scope = { repo: '/repo/a', since: '2026-07-28T19:37:45.506Z', until: null, delegations: 1, sessions: 1 }
  const html = render({ report: r, weekly: [] })
  assert.match(html, /기간 2026-07-28 ~ 지금/)
  assert.doesNotMatch(html, /T19:37/)
})

// totalAll 도 터미널 하나만 읽고 있었다. "위임 0건" 만 보면 도구가 고장난 건지
// 이 저장소에서 위임을 안 쓴 건지 가릴 수 없다.
test('창이나 저장소로 좁힌 만큼을 화면도 말한다', () => {
  const r = structuredClone(base)
  r.scope = { repo: '/repo/a', delegations: 0, sessions: 0, totalAll: 1067 }
  assert.match(render({ report: r, weekly: [] }), /위임 0건 \(전체 1067건 중\)/)

  // 안 좁혔으면 붙이지 않는다. 늘 붙으면 눈에 안 들어온다
  const whole = structuredClone(base)
  whole.scope = { repo: '/repo/a', delegations: 1067, sessions: 3, totalAll: 1067 }
  assert.doesNotMatch(render({ report: whole, weekly: [] }), /전체 1067건 중/)

  // 옛 호출부는 이 값을 안 담는다. 0건과 견주면 "전체 undefined건 중" 이 찍힌다
  assert.doesNotMatch(render({ report: base, weekly: [] }), /전체/)
})

// how 는 거짓 양성 비율이 다른 두 종류를 가르는 유일한 신호다(42회차 실측: "절대 경로가
// 없음" 14%, "git 이 아는 경로 어디에도 없음" 36%). 그런데 지시서만 읽고 있었다.
// 실측(2026-08-28, kbo-card-gacha): 3건이 /kbo/solo/2026·/epl/solo/2526·git 원격
// 주소인데 화면에서 셋이 같은 무게로 보였다.
test('죽은 경로가 어느 종류인지, 몇 번째 줄인지 말한다', () => {
  const r = structuredClone(base)
  r.refs.deadPaths = [
    { doc: '/repo/a/AGENTS.md', token: '/kbo/solo/2026', line: '- `/kbo/solo/2026`', lineNumber: 118, how: '절대 경로가 없음' },
    { doc: '/repo/a/AGENTS.md', token: 'apps/web/lib', line: null, lineNumber: null, how: 'git 이 아는 경로 어디에도 없음' },
  ]
  const html = render({ report: r, weekly: [] })
  assert.match(html, /AGENTS\.md:118/)
  assert.match(html, /절대 경로가 없음/)
  assert.match(html, /git 이 아는 경로 어디에도 없음/)
  // 줄을 못 찾은 것에 :null 을 찍지 않는다
  assert.doesNotMatch(html, /:null/)
})

// 죽은 경로는 하네스 문서를 훑어서 찾는다. 훑을 문서가 없으면 0건이 아니라 판정 불가다.
test('훑을 문서가 없으면 죽은 경로를 0건이라 하지 않는다', () => {
  const r = structuredClone(base)
  r.refDocs = 0
  const html = render({ report: r, weekly: [] })
  assert.match(html, /훑을 하네스 문서가 없다/)

  // 문서가 있으면 그대로 센다
  const has = structuredClone(base)
  has.refDocs = 3
  assert.doesNotMatch(render({ report: has, weekly: [] }), /훑을 하네스 문서가 없다/)
})

test('비교할 문서가 0개면 "0개뿐이다"라고 하지 않는다', () => {
  const r = structuredClone(base)
  r.contradictionDocs = 0
  assert.match(render({ report: r, weekly: [] }), /비교할 하네스 문서가 없다/)
})
