#!/usr/bin/env node
// 스캐너 둘이 같은 답을 내는지 본다.
//
//   node tools/facts.mjs > js1.ndjson
//   ./scan-rs            > rs.ndjson
//   node tools/facts.mjs > js2.ndjson
//   node tools/compare.mjs js1.ndjson rs.ndjson js2.ndjson
//
// **전사는 지금도 자란다.** 도는 세션의 파일은 세 번 찍는 사이에 커진다.
// 그걸 결함으로 읽은 전례가 있다(설계 문서, 4건 차이). 그래서 JS 를 앞뒤로 두 번 찍고
// **그 둘이 같은 파일만** 견준다. 자란 파일은 판정에서 빼고 몇 개였는지 말한다.
//
// 빠르기는 여기서 안 잰다. 먼저 물을 것은 "같은 답을 내나" 하나다.

import fs from 'node:fs'

const [a, b, c] = process.argv.slice(2)
if (!a || !b) {
  console.error('쓰기: node tools/compare.mjs <js1.ndjson> <다른.ndjson> [js2.ndjson]')
  process.exit(1)
}

function load(p) {
  const m = new Map()
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line) continue
    const row = JSON.parse(line)
    // 대조는 파일 단위다. 나머지 필드를 그대로 문자열로 견준다.
    const { file, ...rest } = row
    m.set(file, JSON.stringify(rest))
  }
  return m
}

const js1 = load(a)
const other = load(b)
const js2 = c ? load(c) : null

const moved = []   // 재는 사이에 자란 것
const differ = []  // 진짜로 다른 것
const onlyJs = []
const onlyOther = []

for (const [file, v1] of js1) {
  if (js2 && js2.get(file) !== v1) {
    moved.push(file)
    continue
  }
  if (!other.has(file)) {
    onlyJs.push(file)
    continue
  }
  if (other.get(file) !== v1) differ.push(file)
}
for (const file of other.keys()) if (!js1.has(file)) onlyOther.push(file)

const judged = js1.size - moved.length - onlyJs.length
console.log(`전사 ${js1.size}개`)
if (!js2) console.log('※ JS 를 한 번만 찍었다. 자란 파일이 다른 것으로 잡힐 수 있다')
console.log(`  견줌      ${judged}개`)
console.log(`  자라서 뺌 ${moved.length}개`)
console.log(`  한쪽에만  JS ${onlyJs.length}개 · 상대 ${onlyOther.length}개`)
console.log(`  다름      ${differ.length}개`)

// 분모가 비면 무엇이든 같다. 0 개를 견주고 "같다"고 말하면 안 된다.
if (judged === 0) {
  console.log('\n견준 것이 0개다. 같다고 말할 수 없다.')
  process.exit(1)
}
for (const f of [...differ, ...onlyJs, ...onlyOther].slice(0, 20)) console.log(`  · ${f}`)
if (differ.length + onlyJs.length + onlyOther.length > 20) console.log('  … 20개까지만 보여준다')

const ok = differ.length === 0 && onlyJs.length === 0 && onlyOther.length === 0
console.log(ok ? '\n같다.' : '\n다르다.')
process.exit(ok ? 0 : 1)
