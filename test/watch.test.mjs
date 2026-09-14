// 알림은 조용히 틀린다. 너무 말이 많으면 아무도 안 보고, 너무 없으면 있으나 마나다.
// 그 선을 어디에 그었는지를 여기 고정한다.
//   node --test test/watch.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worseThings } from '../src/watch.mjs'

// fp 는 축이 무엇을 재는지의 지문이다. 다르면 견줄 수 없다
const snap = (rate, dead = 0, contra = 0, fp = 'aaaa1111') => ({
  compliance: { m: { rate, violations: Math.round((1 - rate) * 100), fp } },
  refs: { deadPaths: dead, brokenSkillRefs: 0, danglingSkills: 0 },
  contradictions: contra,
})
const now = (rate, dead = 0, contra = [], fp = 'aaaa1111') => ({
  compliance: [{ id: 'm', label: '모델 명시', rate, violations: Math.round((1 - rate) * 100), fp }],
  refs: { deadPaths: Array(dead).fill({}), brokenSkillRefs: [], danglingSkills: [] },
  contradictions: contra,
})

test('첫 측정에는 아무 말도 안 한다', () => {
  assert.deepEqual(worseThings(null, now(0.5)), [])
})

test('준수율이 떨어지면 말한다', () => {
  const out = worseThings(snap(0.98), now(0.9))
  assert.equal(out.length, 1)
  assert.match(out[0].text, /98\.0% → 90\.0%/)
})

test('준수율이 올라가면 말하지 않는다', () => {
  // 좋아진 것은 스냅샷에만 쌓는다. 말하면 알림이 축하 인사로 변한다.
  assert.deepEqual(worseThings(snap(0.9), now(0.98)), [])
})

test('반올림해서 같아 보이는 흔들림은 말하지 않는다', () => {
  assert.deepEqual(worseThings(snap(0.98), now(0.9799)), [])
  assert.equal(worseThings(snap(0.98), now(0.97)).length, 1)
})

test('죽은 참조는 늘 때만 말한다', () => {
  assert.equal(worseThings(snap(0.9, 3), now(0.9, 7)).length, 1)
  assert.match(worseThings(snap(0.9, 3), now(0.9, 7))[0].text, /3건 → 7건/)
  assert.deepEqual(worseThings(snap(0.9, 7), now(0.9, 3)), [])
})

test('새 모순 후보는 무엇인지까지 말한다', () => {
  const out = worseThings(snap(0.9, 0, 0), now(0.9, 0, [{ token: 'var' }, { token: '.join()' }]))
  assert.equal(out.length, 1)
  assert.match(out[0].text, /var, \.join\(\)/)
})

test('비교할 축이 없으면 넘어간다', () => {
  // 범위를 바꾸면 있던 축이 사라지거나 판정 불가가 된다. 그때 없는 값을 빼면 안 된다.
  assert.deepEqual(worseThings(snap(0.9), { ...now(0.9), compliance: [{ id: 'x', label: '다른 축', rate: 0.1 }] }), [])
  assert.deepEqual(worseThings(snap(0.9), now(null)), [])
})

test('재는 방식이 바뀐 축은 나빠졌다고 안 한다', () => {
  // 실측: 서브에이전트 훅을 분모에 넣었더니 훅 무결성이 99.88% 에서 99.85% 로
  // 내려갔다. 그때 상주 중이었다면 "나빠졌다"고 알렸을 것이다. 도구가 정확해진 건데.
  assert.deepEqual(worseThings(snap(0.98, 0, 0, 'old00000'), now(0.9, 0, [], 'new11111')), [])
  // 지문이 같으면 그대로 말한다
  assert.equal(worseThings(snap(0.98, 0, 0, 'same0000'), now(0.9, 0, [], 'same0000')).length, 1)
  // 지문 없는 옛 스냅샷과도 안 견준다
  assert.deepEqual(worseThings(snap(0.98, 0, 0, null), now(0.9)), [])
})

test('죽은 참조는 축 지문과 무관하게 센다', () => {
  // 파일이 실재하나는 축 정의가 아니라 파일 시스템이 답한다. 지문을 걸 게 없다
  assert.equal(worseThings(snap(0.9, 3, 0, 'old00000'), now(0.9, 7, [], 'new11111')).length, 1)
})

// 근거가 사라진 축은 죽은 자산이다. 화면은 축마다 "판정 불가"라고 말하고 있었는데
// 상주는 아무 말도 안 했다. checkCitations 를 터미널 출력부만 부르고 있었다.
//
// 실측(2026-08-28): 근거 문구를 다시 쓴 문서로 재보니 89.7% 였던 축이 판정 불가로
// 빠졌고 worseThings 는 빈 배열을 냈다. 규칙 하나에 눈이 감겼는데 상주가 조용했다.
const snapCite = (n) => ({
  compliance: {},
  refs: { deadPaths: 0, brokenSkillRefs: 0, danglingSkills: 0 },
  contradictions: 0,
  citations: n,
})
const nowCite = (...axisIds) => ({
  compliance: [],
  refs: { deadPaths: [], brokenSkillRefs: [], danglingSkills: [] },
  contradictions: [],
  citations: axisIds.map((axis) => ({ axis, reason: '문서에 그 규칙이 없다' })),
})

test('근거가 사라지면 어느 축인지까지 말한다', () => {
  const out = worseThings(snapCite(0), nowCite('model-explicit'))
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'citation')
  assert.match(out[0].text, /0건 → 1건: model-explicit/)
})

test('근거가 다시 붙으면 말하지 않는다', () => {
  // 좋아진 것은 스냅샷에만 쌓는다. 죽은 참조와 같은 규칙이다.
  assert.deepEqual(worseThings(snapCite(1), nowCite()), [])
  assert.deepEqual(worseThings(snapCite(1), nowCite('a')), [])
})

test('citations 를 모르는 옛 스냅샷에는 조용하다', () => {
  // 스냅샷 형식을 늘렸다. 앞서 쌓인 줄에는 이 값이 없다. 없는 값을 0 으로 읽으면
  // 상주를 켠 첫 tick 에 없던 알림이 나간다.
  const before = { compliance: {}, refs: { deadPaths: 0, brokenSkillRefs: 0, danglingSkills: 0 }, contradictions: 0 }
  assert.deepEqual(worseThings(before, nowCite('a')), [])
})
