// 추세를 스냅샷에서 뽑으면 시간 간격이 거짓말한다. 데이터에서 뽑는다.
// 그때 남는 위험은 분모가 작은 칸이 급등락처럼 보이는 것이다.
//   node --test test/series.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weekStart, weeklySeries, sparkline, trendGap, MIN_SAMPLE } from '../src/series.mjs'
import { measure } from '../src/report.mjs'

const axis = [
  { id: 'm', label: '모델', rule: 'x', source: 'delegations', scope: () => true, violation: (r) => !r.model },
]
const rows = (day, n, bad) =>
  Array(n)
    .fill(0)
    .map((_, i) => ({ ts: `${day}T00:00:00Z`, model: i < bad ? null : 'sonnet' }))

test('주는 월요일에 시작한다', () => {
  assert.equal(weekStart('2026-08-27T10:00:00Z'), '2026-08-24') // 목요일 → 그 주 월요일
  assert.equal(weekStart('2026-08-24T00:00:00Z'), '2026-08-24') // 월요일은 그대로
  assert.equal(weekStart('2026-08-23T23:59:59Z'), '2026-08-17') // 일요일은 앞 주
})

test('같은 주는 한 칸으로 묶는다', () => {
  const s = weeklySeries([...rows('2026-08-24', 30, 3), ...rows('2026-08-26', 30, 0)], axis, { measure })
  assert.equal(s.length, 1)
  assert.equal(s[0].delegations, 60)
  assert.equal(s[0].axes.m.rate, 57 / 60)
})

test('분모가 작은 칸은 비율을 안 낸다', () => {
  // 3건 중 1건이 위반이면 67% 다. 그걸 추세로 읽으면 없던 급락이 생긴다.
  const s = weeklySeries([...rows('2026-08-17', 3, 1), ...rows('2026-08-24', 40, 0)], axis, { measure })
  assert.equal(s[0].axes.m.rate, null)
  assert.equal(s[0].axes.m.thin, true)
  assert.equal(s[1].axes.m.rate, 1)
  assert.ok(MIN_SAMPLE > 3)
})

test('위임을 원천으로 하지 않는 축은 안 섞는다', () => {
  // 세션·훅 축은 단위가 달라 주별 위임 칸에 넣으면 뜻이 없다.
  const mixed = [...axis, { id: 'h', label: '훅', rule: 'x', source: 'hooks', scope: () => true, violation: () => true }]
  const s = weeklySeries(rows('2026-08-24', 30, 0), mixed, { measure })
  assert.deepEqual(Object.keys(s[0].axes), ['m'])
})

test('시간 순서대로 나온다', () => {
  const s = weeklySeries([...rows('2026-08-24', 30, 0), ...rows('2026-08-10', 30, 0), ...rows('2026-08-17', 30, 0)], axis, {
    measure,
  })
  assert.deepEqual(
    s.map((x) => x.start),
    ['2026-08-10', '2026-08-17', '2026-08-24'],
  )
})

test('빈 칸은 점으로 남긴다', () => {
  assert.equal(sparkline([null, 1, null]).length, 3)
  assert.equal(sparkline([null])[0], '·')
})

// 관찰값은 목표가 없다. 0 부터 그리면 1.60 → 1.66 같은 변화가 평평해 보인다.
// 실측(2026-08-28): 평균 갈래 주별이 1.5~1.7 사이에 있는데 0~1 기준으로 그리면
// 전부 위쪽에 붙어 추세가 안 보인다. 화면과 터미널이 같은 기준을 쓴다.
test('관찰값 추세는 지나온 값의 범위 안에서 그린다', () => {
  const vals = [1.52, 1.6, 1.71]
  const fixed = sparkline(vals, { min: 0, max: 1 }) // 준수율 기준. 값이 1 을 넘는다
  const own = sparkline(vals, { min: Math.min(...vals), max: Math.max(...vals) })
  assert.notEqual(own, fixed)
  assert.equal(new Set(own).size > 1, true) // 서로 다른 칸이 보인다
  assert.equal(new Set(fixed).size, 1) // 고정 기준에서는 전부 같은 칸이다
})

// 실측(2026-08-28, korean-tone): 위임 40건인 저장소에서 병렬 비율·평균 갈래·
// 서브에이전트 결말 셋이 "세션이나 토큰이 있어야 계산된다"고 말했다. 셋 다 위임만으로
// 계산되는 축이다. 얇아서 못 낸 것이지 못 낼 축이 아니다.
test('추세를 못 그리는 이유를 셋으로 가른다', () => {
  const week = (rate) => ({ rate, total: 30 })

  // 그릴 수 있으면 아무 말도 안 한다
  assert.equal(trendGap([week(0.9), week(0.95)]), null)

  // 위임이 원천이 아닌 축은 주별 칸이 아예 안 생긴다
  assert.match(trendGap([]), /세션이나 토큰이 있어야/)

  // 칸은 생겼는데 전부 얇다. 쌓이면 나온다
  assert.match(trendGap([week(null), week(null)]), new RegExp(`${MIN_SAMPLE}건에 못 미친다`))

  // 한 칸만 있으면 선이 안 그려진다
  assert.match(trendGap([week(0.9), week(null)]), /한 칸뿐이다/)

  // 시점 값은 기다려도 안 나온다. 다른 이유보다 앞선다
  assert.equal(trendGap([week(0.9), week(0.95)], { noTrend: '시점 값이다' }), '시점 값이다')
  assert.equal(trendGap([], { noTrend: '시점 값이다' }), '시점 값이다')
})
