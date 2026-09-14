// 캐시의 위험은 느린 게 아니라 낡는 것이다.
// 파일이 자랐는데 옛 답을 내놓으면 리포트가 조용히 거짓말한다.
//   node --test test/cache.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-cache-'))
process.env.HARNESS_BRO_CACHE = path.join(root, '.cache')

const S = 'proj/33333333-3333-3333-3333-333333333333'
const sub = path.join(root, S, 'subagents')
fs.mkdirSync(sub, { recursive: true })
fs.writeFileSync(path.join(sub, 'agent-a.meta.json'), JSON.stringify({ agentType: 'runner', model: 'haiku', toolUseId: 'toolu_a' }))

const line = (tid) =>
  JSON.stringify({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', id: tid, name: 'Agent' }] } })
const main = path.join(root, `${S}.jsonl`)
fs.writeFileSync(main, ['{"timestamp":"2026-08-01T00:00:00Z"}', line('toolu_a')].join('\n') + '\n')

const { transcriptPass, delegations } = await import('../src/scan.mjs')
const { fileCache } = await import('../src/filecache.mjs')

test('캐시를 켜든 끄든 같은 답이 나온다', () => {
  const cold = transcriptPass(root, { cache: false })
  const warm1 = transcriptPass(root, { cache: true }) // 캐시를 채운다
  const warm2 = transcriptPass(root, { cache: true }) // 캐시를 쓴다
  assert.equal(warm2.files.reused > 0, true)
  for (const t of [warm1, warm2]) {
    assert.deepEqual([...t.dispatch], [...cold.dispatch])
  }
})

test('파일이 자라면 캐시가 비켜준다', async () => {
  transcriptPass(root, { cache: true }) // 지금 상태로 캐시를 채운다
  const before = transcriptPass(root, { cache: true })
  assert.equal(before.dispatch.size, 1)

  // 크기가 바뀌도록 한 줄 덧붙인다. append-only 전사가 자라는 것과 같은 모양이다.
  fs.appendFileSync(main, line('toolu_b') + '\n')
  // mtime 이 같은 초에 묻히지 않게 앞당겨 둔다
  const st = fs.statSync(main)
  fs.utimesSync(main, st.atime, new Date(st.mtimeMs + 5000))

  const after = transcriptPass(root, { cache: true })
  assert.equal(after.dispatch.size, 2, '자란 파일을 다시 안 읽었다')
  assert.equal(after.dispatch.has('toolu_b'), true)
})

test('캐시가 깨져 있어도 답은 같다', () => {
  const good = transcriptPass(root, { cache: false })
  fs.writeFileSync(path.join(root, '.cache', 'transcripts.json'), '{ 이건 JSON 이 아니다')
  const still = transcriptPass(root, { cache: true })
  assert.deepEqual([...still.dispatch], [...good.dispatch])
})

test('다른 뿌리를 봐도 앞 캐시를 안 지운다', () => {
  // 캐시를 통째로 갈아 끼우기 때문에, 뿌리마다 파일을 안 가르면
  // 다른 뿌리를 한 번 보는 것만으로 앞의 캐시가 날아간다.
  // 실제로 테스트가 진짜 캐시 1,252건을 4건으로 덮어썼다.
  transcriptPass(root, { cache: true })
  const mine = transcriptPass(root, { cache: true })
  assert.equal(mine.files.reused > 0, true)

  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-other-'))
  transcriptPass(other, { cache: true })

  const again = transcriptPass(root, { cache: true })
  assert.equal(again.files.reused, mine.files.reused, '다른 뿌리를 보고 왔더니 캐시가 비었다')
})

test('위임도 캐시를 켜든 끄든 같다', () => {
  const cold = delegations(root, { cache: false })
  delegations(root, { cache: true })
  const warm = delegations(root, { cache: true })
  assert.deepEqual(warm, cold)
})

test('오래 안 만진 캐시 파일은 걷는다', () => {
  // 캐시를 뿌리마다 가르면서 생긴 부작용이다. 한 번 훑은 뿌리마다 파일이 셋 남는다.
  // 실측에서 48개 중 27개가 임시 뿌리의 잔재였다. 바이트는 작아도 개수가 안 멈춘다.
  const dir = process.env.HARNESS_BRO_CACHE
  fs.mkdirSync(dir, { recursive: true })
  const stale = path.join(dir, 'transcripts-deadbeef.json')
  const fresh = path.join(dir, 'transcripts-cafe0000.json')
  fs.writeFileSync(stale, '{}')
  fs.writeFileSync(fresh, '{}')
  const long_ago = new Date(Date.now() - 20 * 864e5)
  fs.utimesSync(stale, long_ago, long_ago)

  fileCache('transcripts', { root: '/somewhere/else' }).save()

  assert.equal(fs.existsSync(stale), false, '두 주 넘게 안 만진 것은 지운다')
  assert.equal(fs.existsSync(fresh), true, '최근 것은 남긴다')
})

test('뽑는 함수가 바뀌면 옛 캐시를 안 쓴다', () => {
  // 캐시의 위험은 파일이 자란 것만이 아니다. 뽑는 쪽이 바뀐 것도 낡음이다.
  // 실측: 안 쓰는 세션 필드 여섯 개를 걷었는데 캐시가 안 바뀐 전사에 옛 facts 를
  // 계속 냈다. 훅과 도구 차단 집계를 고칠 때는 --no-cache 를 매번 붙여야 맞았다.
  const target = path.join(root, 'stamp.txt')
  fs.writeFileSync(target, 'x')

  const oldWay = (f) => ({ shape: 'old', size: fs.statSync(f).size })
  const newWay = (f) => ({ shape: 'new', size: fs.statSync(f).size })

  const c1 = fileCache('stamp', { root })
  assert.equal(c1.get(target, oldWay).shape, 'old')
  c1.save()

  // 파일은 그대로다. 뽑는 함수만 바꿨다
  const c2 = fileCache('stamp', { root })
  assert.equal(c2.get(target, newWay).shape, 'new')
  assert.equal(c2.save().reused, 0) // 캐시를 안 썼다
  c2.save()

  // 같은 함수로 다시 부르면 캐시를 쓴다
  const c3 = fileCache('stamp', { root })
  assert.equal(c3.get(target, newWay).shape, 'new')
  assert.equal(c3.save().reused, 1)
})

// 주석과 공백만 뗀다. 포매터가 붙이는 trailing comma 까지는 안 지운다.
// 거기까지 정규화할 값어치가 없다. 캐시를 한 번 잃는 비용이 한 번 느린 것뿐이다.
test('주석만 고친 함수는 캐시를 살려둔다', () => {
  const target = path.join(root, 'stamp2.txt')
  fs.writeFileSync(target, 'y')
  const a = (f) => ({ size: fs.statSync(f).size })
  const b = (f) => ({
    // 안 떼면 주석 한 줄에 캐시가 통째로 날아간다
    size: fs.statSync(f).size
  })

  const c1 = fileCache('stamp2', { root })
  c1.get(target, a)
  c1.save()

  const c2 = fileCache('stamp2', { root })
  c2.get(target, b)
  assert.equal(c2.save().reused, 1)
})
