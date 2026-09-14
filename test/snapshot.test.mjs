// 추세는 같은 범위끼리만 비교해야 뜻이 있다. 그것과, 표본을 안 쌓는 것을 본다.
//   node --test test/snapshot.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.HARNESS_BRO_STORE = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-snap-')),
  'snapshots.jsonl',
)
const { save, history, delta, condense, scopeKey } = await import('../src/snapshot.mjs')

// fp 는 축이 무엇을 재는지의 지문이다. 실물에서는 axisFingerprint 가 채운다
const report = (repo, rate, dead = 3, fp = 'aaaa1111') => ({
  scope: { repo, delegations: 100, sessions: 10 },
  compliance: [
    { id: 'model-explicit', rate, total: 100, violations: Math.round(100 * (1 - rate)), samples: ['버릴 것'], fp },
  ],
  observation: [{ id: 'parallel-ratio', value: 0.33, n: 50, fp }],
  refs: { deadPaths: Array(dead).fill({}), brokenSkillRefs: [], danglingSkills: [] },
  contradictions: [],
})

test('표본은 안 쌓는다. 숫자만 남긴다', () => {
  const row = condense(report('/repo/a', 0.9), '2026-08-01T00:00:00Z')
  assert.equal(row.compliance['model-explicit'].rate, 0.9)
  assert.equal(row.refs.deadPaths, 3)
  assert.equal(JSON.stringify(row).includes('버릴 것'), false)
})

test('첫 스냅샷이면 비교할 것이 없다', () => {
  assert.equal(delta(report('/repo/a', 0.9)), null)
})

test('같은 범위끼리만 비교한다', () => {
  save(report('/repo/a', 0.9), '2026-08-01T00:00:00Z')
  save(report('/repo/b', 0.5), '2026-08-02T00:00:00Z')

  // /repo/b 의 0.5 가 /repo/a 의 추세를 오염시키면 안 된다
  const d = delta(report('/repo/a', 0.95))
  assert.equal(d.since, '2026-08-01T00:00:00Z')
  assert.equal(d.compliance['model-explicit'].from, 0.9)
  assert.ok(Math.abs(d.compliance['model-explicit'].diff - 0.05) < 1e-9)

  assert.equal(history({ repo: '/repo/a' }).length, 1)
  assert.equal(history({ repo: '/repo/b' }).length, 1)
})

test('죽은 참조 수의 변화도 따라간다', () => {
  const d = delta(report('/repo/a', 0.9, 7))
  assert.deepEqual(d.refs.deadPaths, { from: 3, to: 7, diff: 4 })
})

test('기간 창이 다르면 다른 범위다', () => {
  // 같은 저장소라도 최근 30일치와 전체 기간치는 다른 숫자다.
  // 섞이면 --all-time 한 번이 추세에 절벽을 만들고 그게 실제 변화처럼 보인다.
  const windowed = { ...report('/repo/c', 0.9), scope: { repo: '/repo/c', delegations: 1, since: new Date(Date.now() - 30 * 864e5).toISOString() } }
  save(windowed, '2026-08-03T00:00:00Z')

  assert.equal(delta(report('/repo/c', 0.5)), null) // 전체 기간이라 비교 대상이 없다
  assert.equal(history({ repo: '/repo/c' }).length, 0)
  assert.equal(history(windowed.scope).length, 1)
})

test('범위 키는 어디와 언제를 같이 담는다', () => {
  assert.equal(scopeKey({ repo: null }), '(전 프로젝트) @전체기간')
  assert.equal(scopeKey({ repo: '/repo/a' }), '/repo/a @전체기간')
  assert.match(scopeKey({ repo: '/repo/a', since: new Date(Date.now() - 7 * 864e5).toISOString() }), /@최근7일$/)
})

test('축의 뜻이 바뀌면 옛 값과 비교하지 않는다', () => {
  // 실측: guard-denials 를 누적 건수에서 100턴당으로 바꿨더니 delta 가
  // `74 → 3.95, diff -70.05` 를 내며 "엄청 좋아졌다"고 말했다. 단위가 바뀐 것이다.
  save(report('/repo/fp', 0.9, 3, 'old00000'), '2026-08-03T00:00:00Z')

  const same = delta(report('/repo/fp', 0.95, 3, 'old00000'))
  assert.ok(Math.abs(same.compliance['model-explicit'].diff - 0.05) < 1e-9)
  assert.deepEqual(same.redefined, [])

  const changed = delta(report('/repo/fp', 0.95, 3, 'new11111'))
  assert.equal(changed.compliance['model-explicit'], undefined) // 견주지 않는다
  assert.equal(changed.observation['parallel-ratio'], undefined)
  assert.deepEqual(changed.redefined.sort(), ['model-explicit', 'parallel-ratio'])
})

test('지문 없는 옛 스냅샷과도 비교하지 않는다', () => {
  // fp 를 만들기 전 스냅샷이 이력에 남아 있다. 뜻이 같은지 알 수가 없다
  save({ ...report('/repo/nofp', 0.9), compliance: [{ id: 'model-explicit', rate: 0.9, total: 100, violations: 10 }] },
    '2026-08-04T00:00:00Z')
  const d = delta(report('/repo/nofp', 0.95))
  assert.equal(d.compliance['model-explicit'], undefined) // 견주지 않는다
  // 그렇다고 "축을 바꿨다"고 말하지도 않는다. 사람이 조치할 게 없다
  assert.deepEqual(d.redefined, [])
})

test('축 지문은 주석을 고쳐도 안 바뀐다', async () => {
  const { axisFingerprint } = await import('../src/axes.mjs')
  const a = { id: 'x', source: 'delegations', scope: (r) => !r.isFork, violation: (r) => !r.model }
  const b = {
    id: 'x',
    source: 'delegations',
    // 함정 1. fork 는 정의상 부모 모델을 상속한다
    scope: (r) => !r.isFork,
    violation: (r) => !r.model,
  }
  assert.equal(axisFingerprint(a), axisFingerprint(b))

  // 재는 방식이 바뀌면 달라진다
  const c = { ...a, scope: () => true }
  assert.notEqual(axisFingerprint(a), axisFingerprint(c))
  // 표시용 필드는 지문에 안 들어간다
  assert.equal(axisFingerprint(a), axisFingerprint({ ...a, label: '딴 이름', note: '딴 설명' }))
})

test('화면에서 같아 보이는 흔들림으로는 안 쌓는다', async () => {
  // 실측(--watch 20분): 스냅샷 15줄이 쌓였고 알림 15번이 나갔는데 변화가 두 종류였다.
  //   active-sessions 가 15분 창이 흐르며 6→7→8→9→6→5 (시점 값)
  //   delegation-share·cache-hit 이 0.2236739→0.2236602 (다섯째 소수점)
  // 화면에는 22.4%, 3.92 로 똑같이 찍힌다. 같은 데이터로 재보니 2줄로 줄었다.
  const { saveKey } = await import('../src/snapshot.mjs')
  const row = (value, active) => ({
    at: 'x',
    scope: 's',
    compliance: { m: { rate: 0.977, fp: 'a' } },
    observation: {
      share: { value, unit: 'ratio', fp: 'b' },
      guard: { value: 3.9215686, unit: 'count', fp: 'c' },
      'active-sessions': { value: active, unit: 'count', fp: 'd' },
    },
    refs: { deadPaths: 0 },
    contradictions: 0,
  })
  const opts = { noTrend: ['active-sessions'] }

  // 다섯째 소수점은 같은 것으로 본다
  assert.equal(saveKey(row(0.2236739, 6), opts), saveKey(row(0.2236602, 6), opts))
  // 시점 값은 판정에서 빠진다
  assert.equal(saveKey(row(0.2236739, 6), opts), saveKey(row(0.2236739, 9), opts))
  // 화면에 보이는 만큼 움직이면 쌓는다
  assert.notEqual(saveKey(row(0.2236739, 6), opts), saveKey(row(0.2246739, 6), opts))
  // count 단위는 둘째까지 본다. 3.92 로 같으면 안 쌓고 3.93 이면 쌓는다
  const bump = (v) => {
    const r = row(0.2236739, 6)
    r.observation.guard.value = v
    return saveKey(r, opts)
  }
  assert.equal(bump(3.9215686), bump(3.9204039))
  assert.notEqual(bump(3.9215686), bump(3.9304039))
})

test('상주 둘이 쌓은 쌍둥이 줄을 하나로 본다', () => {
  // 실측: --watch 를 둘 띄우면 같은 값이 두 줄씩 들어간다. 타임스탬프가 밀리초까지
  // 같았다(13:03:34.871 두 줄). 디바운스가 같아서 정확히 같은 순간에 tick 한다.
  // save 가 파일을 읽고 견주게 해봤지만 안 막힌다. 그래서 읽을 때 정리한다.
  //
  // 그러면 delta 가 자기 쌍둥이를 직전으로 보고 실제 변화를 놓치는 것도 풀린다.
  const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-twin-')), 'snap.jsonl')
  const prevStore = process.env.HARNESS_BRO_STORE
  process.env.HARNESS_BRO_STORE = store

  const row = (at, rate) => ({
    at,
    scope: '/repo/twin @전체기간',
    delegations: 6,
    sessions: 1,
    compliance: { m: { rate, total: 6, violations: 2, fp: 'a' } },
    observation: {},
    refs: { deadPaths: 0, brokenSkillRefs: 0, danglingSkills: 0 },
    contradictions: 0,
  })
  // 두 프로세스가 같은 값을 두 줄씩 넣은 모양
  fs.writeFileSync(
    store,
    [row('2026-08-27T13:01:25.183Z', 0.667), row('2026-08-27T13:01:25.183Z', 0.667),
     row('2026-08-27T13:01:31.181Z', 0.571), row('2026-08-27T13:01:31.182Z', 0.571)]
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n',
  )

  const past = history({ repo: '/repo/twin', since: null, until: null })
  assert.equal(past.length, 2, '쌍둥이가 안 걷혔다')
  assert.equal(past[0].compliance.m.rate, 0.667)
  assert.equal(past[1].compliance.m.rate, 0.571)

  process.env.HARNESS_BRO_STORE = prevStore
})

// 상주는 켤 때 창을 잡고 끝까지 안 바꾼다. 그 창을 "최근 N일"로 적으면 날이 지날 때마다
// 키가 최근30일 → 최근31일로 밀린다. 창은 그대로인데 통이 갈려서 이력이 안 쌓인다.
test('상주가 잡은 창은 키가 날마다 밀지 않는다', () => {
  const since = new Date(Date.now() - 30 * 864e5).toISOString()

  // 켤 때 잡은 창은 시작 날짜로 적는다. 지금이 언제인지에 안 달린다
  const pinned = scopeKey({ repo: null, since, pinned: true })
  assert.match(pinned, /@\d{4}-\d{2}-\d{2}~$/)
  assert.doesNotMatch(pinned, /최근/)
  assert.ok(pinned.includes(since.slice(0, 10)))

  // 한 번 돌리는 것은 그대로다. 매일 새로 잡으니 최근30일이 맞다
  assert.match(scopeKey({ repo: null, since }), /@최근30일$/)
})

test('창을 굴리지 않는 이유를 값으로 남긴다', () => {
  // 실측(2026-08-28): 창을 하루 굴리면 모델 명시가 98.34% → 98.82% 로 0.48%p 움직인다.
  // 흔들림 문턱(0.05%p)의 열 배다. 낡은 위반이 창 밖으로 빠지는 것만으로 알림이 나간다.
  // 그래서 창은 고정하고 키만 안 밀게 했다. 이 검사는 그 선택을 못박는다.
  const since = new Date(Date.now() - 30 * 864e5).toISOString()
  const pin = (extra) => condense({ ...report(null, 0.9), scope: { repo: null, since, ...extra } }, 'x').scope
  assert.equal(pin({ pinned: true }), pin({ pinned: true })) // 같은 창이면 같은 통이다
  assert.notEqual(pin({ pinned: true }), pin({})) // 상주가 잡은 창과 한 번 돌린 창은 다르다
})
