// 축을 사용자 파일로 뺄 수 있게 두는 게 처음부터의 약속이었다.
// 그 길이 실제로 열려 있는지, 그리고 조용히 안 열리는 일이 없는지를 본다.
//   node --test test/axes.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadAxes, compliance, observation } from '../src/axes.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-axes-'))
const write = (name, body) => {
  const p = path.join(dir, name)
  fs.writeFileSync(p, body)
  return p
}

test('파일이 없으면 기본 축만 쓴다', async () => {
  const a = await loadAxes({ file: path.join(dir, '없는파일.mjs') })
  assert.equal(a.compliance.length, compliance.length)
  assert.equal(a.from, null)
})

test('사용자 축이 뒤에 붙는다', async () => {
  const file = write(
    'add.mjs',
    `export const compliance = [{ id: 'mine', label: '내 축', rule: 'x', source: 'delegations', scope: () => true, violation: () => false }]`,
  )
  const a = await loadAxes({ file })
  assert.equal(a.compliance.length, compliance.length + 1)
  assert.equal(a.compliance.at(-1).id, 'mine')
  assert.equal(a.from, file)
})

test('기본 축을 끌 수 있다', async () => {
  const file = write('off.mjs', `export const disable = ['chore-model']`)
  const a = await loadAxes({ file })
  assert.equal(
    a.compliance.some((x) => x.id === 'chore-model'),
    false,
  )
  assert.equal(a.compliance.length, compliance.length - 1)
})

test('깨진 파일은 조용히 넘어가지 않는다', async () => {
  // 조용히 기본으로 돌아가면 사용자는 자기 축이 도는 줄 안다.
  const file = write('broken.mjs', 'export const compliance = [ 이건 JS 가 아니다')
  const said = []
  const a = await loadAxes({ file, onError: (m) => said.push(m) })
  assert.equal(said.length, 1)
  assert.match(said[0], /축 파일을 못 읽었다/)
  assert.equal(a.compliance.length, compliance.length) // 기본으로 돈다
})

test('축 하나가 터지면 그 축만 빼고 나머지는 낸다', async () => {
  // 사용자 축은 남이 쓰는 확장점이다. violation 을 안 적거나 compute 가 던지면
  // 앱이 통째로 죽어서 스택 트레이스만 나왔다. 기본 축이 멀쩡한데 리포트를 못 본다.
  const { measure, observe } = await import('../src/report.mjs')
  const rows = [{ model: 'sonnet' }, { model: null }]

  const good = { id: 'ok', label: '멀쩡', rule: 'x', source: 'delegations', scope: () => true, violation: (r) => !r.model }
  const half = { id: 'half', label: '반쪽', rule: 'x', source: 'delegations', scope: () => true } // violation 없음
  const got = measure({ delegations: rows }, [good, half])
  assert.equal(got.find((c) => c.id === 'ok').violations, 1) // 멀쩡한 축은 그대로 잰다
  const broken = got.find((c) => c.id === 'half')
  assert.equal(broken.rate, null)
  assert.match(broken.unavailable, /축이 터졌다/)

  // 관찰값도 같다. "고장"과 "데이터 없음"을 가른다
  const boom = { id: 'boom', label: '터짐', note: 'x', compute: ({ delegations }) => delegations.nope.field }
  const calm = { id: 'calm', label: '조용', note: 'x', compute: () => ({ value: 0.5, unit: 'ratio', n: 2 }) }
  const obs = observe({ delegations: rows }, [boom, calm])
  assert.equal(obs.find((o) => o.id === 'calm').value, 0.5)
  const bad = obs.find((o) => o.id === 'boom')
  assert.equal(bad.value, null)
  assert.match(bad.broken, /축이 터졌다/)
})

test('사용자가 자기 축 판정을 고치면 옛 값과 안 견준다', async () => {
  // 32회차의 축 지문이 사용자 축에도 붙는지. 실측으로 확인했다.
  // spawnDepth > 1 을 > 2 로 고치니 84.6% 에서 98.8% 로 뛰었고 견주지 않았다.
  const { axisFingerprint } = await import('../src/axes.mjs')
  const mine = { id: 'my', source: 'delegations', scope: () => true, violation: (r) => (r.spawnDepth ?? 1) > 1 }
  const fixed = { ...mine, violation: (r) => (r.spawnDepth ?? 1) > 2 }
  assert.notEqual(axisFingerprint(mine), axisFingerprint(fixed))
})

// 실측(2026-08-28): 기본 축 model-explicit 과 같은 id 로 사용자 축을 얹으니
// 화면이 "모델 명시 97.7%" 라고 하면서 그 아래 추세는 남의 축 값인 0% 를
// 다섯 주 내리 그렸다. series.mjs 와 snapshot.mjs 가 id 로만 축을 찾아서다.
test('id 가 겹치는 사용자 축은 조용히 덮지 않는다', async () => {
  const file = write(
    'dup.mjs',
    `export const compliance = [{ id: 'model-explicit', label: '내가 다시 쓴 것', rule: 'x', source: 'delegations', scope: () => true, violation: () => true }]`,
  )
  const said = []
  const a = await loadAxes({ file, onError: (m) => said.push(m) })
  assert.equal(a.compliance.length, compliance.length)
  assert.match(said[0], /축 id 가 겹친다: model-explicit/)
  assert.match(said[0], /disable/) // 바꾸는 길을 같이 알려준다
  // 살아남은 것이 기본 축이어야 한다. 사용자 축은 전부 위반으로 잡는다
  assert.equal(a.compliance.filter((x) => x.id === 'model-explicit').length, 1)
})

test('종류가 달라도 id 는 겹친다', async () => {
  // series.mjs 는 준수율과 관찰값을 한 맵에 같이 담는다. 종류로 갈리지 않는다.
  // 기본 축이 먼저 자리를 잡아야 한다. 오타 하나로 멀쩡한 기본 축이 사라졌다.
  const file = write(
    'cross.mjs',
    `export const compliance = [{ id: 'cache-hit', label: '오타', rule: 'x', source: 'delegations', scope: () => true, violation: () => false }]`,
  )
  const said = []
  const a = await loadAxes({ file, onError: (m) => said.push(m) })
  assert.equal(said.length, 1)
  assert.equal(a.compliance.some((x) => x.id === 'cache-hit'), false)
  assert.equal(a.observation.some((x) => x.id === 'cache-hit'), true) // 기본 관찰값이 살아 있다
})

test('disable 로 끄면 같은 id 를 다시 쓸 수 있다', async () => {
  // 바꾸는 길이 막히면 안 된다. 겹침을 막은 것과 같은 파일에서 함께 검사한다.
  const file = write(
    'redef.mjs',
    `export const disable = ['model-explicit']
     export const compliance = [{ id: 'model-explicit', label: '내가 다시 쓴 것', rule: 'x', source: 'delegations', scope: () => true, violation: () => true }]`,
  )
  const said = []
  const a = await loadAxes({ file, onError: (m) => said.push(m) })
  assert.deepEqual(said, [])
  const mine = a.compliance.filter((x) => x.id === 'model-explicit')
  assert.equal(mine.length, 1)
  assert.equal(mine[0].label, '내가 다시 쓴 것')
})

test('기본 축끼리는 id 가 안 겹친다', async () => {
  // 위 검사들이 "기본 축이 먼저 자리를 잡는다"에 기대고 있다. 그 전제를 여기서 고정한다.
  const ids = [...compliance, ...observation].map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length)
})

// 실측(2026-08-28): scan.mjs 가 뽑는 필드 중 어느 축도 안 읽는 것을 셌다.
// description 이 1067건 중 1000건에 있는데 0 곳이 읽고 있었다. 그래서 위반 사례 넷이
// `korean-tone  general-purpose  model=없음` 으로 똑같이 보였다.
// 어느 위임인지 가릴 수 없으면 고칠 수도 없다.
const plain = { id: 'm', label: '모델', rule: 'x', source: 'delegations', scope: () => true, violation: (r) => !r.model }

test('위반 사례가 어느 위임인지 말한다', async () => {
  const { measure } = await import('../src/report.mjs')
  const row = (description) => ({ project: '-Users-me-Projects-fromshim-korean-tone', agentType: 'general-purpose', model: null, description })
  const [m] = measure({ delegations: [row('mz variant B example only'), row('mz baseline A current rules')] }, [plain])

  assert.equal(m.samples.length, 2)
  assert.notEqual(m.samples[0], m.samples[1]) // 둘을 가릴 수 있다
  assert.match(m.samples[0], /mz variant B example only/)
  // 몰린 곳은 슬러그를 줄이는데 사례는 원문을 찍고 있었다
  assert.doesNotMatch(m.samples[0], /-Users-me-Projects-/)
  assert.match(m.samples[0], /fromshim-korean-tone/)
})

test('사례에 빈 칸이나 undefined 를 찍지 않는다', async () => {
  const { measure } = await import('../src/report.mjs')
  // description 은 67건이 비어 있다. 그 칸을 그냥 이으면 꼬리에 공백이 남는다.
  const [m] = measure({ delegations: [{ project: null, agentType: null, model: null, description: null }] }, [plain])
  assert.equal(m.samples[0], 'model=없음')
  assert.doesNotMatch(m.samples[0], /undefined|null/)
})

test('긴 지시문은 줄여서 낸다', async () => {
  const { measure } = await import('../src/report.mjs')
  const long = 'ㄱ'.repeat(200)
  const [m] = measure({ delegations: [{ agentType: 'a', model: null, description: long }] }, [plain])
  assert.ok(m.samples[0].length < 100, m.samples[0].length)
  assert.match(m.samples[0], /…"$/)
})
