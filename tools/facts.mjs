#!/usr/bin/env node
// 뽑는 층이 내는 사실을 파일 하나에 한 줄씩 찍는다. Rust 스캐너와 대조할 기준이다.
//
//   node tools/facts.mjs > js.ndjson          기본 뿌리
//   node tools/facts.mjs --root <경로>        다른 뿌리
//   node tools/facts.mjs --only session       한 쪽만
//
// 왜 이게 첫 이정표인가. 스캐너를 갈아끼울 때 먼저 물을 것은 "빨라졌나"가 아니라
// "같은 답을 내나"다. CLAUDE.md 의 "앱 값과 직접 센 값을 대조한다"가 그 규율이다.
// 한 줄에 한 파일이라 `diff` 가 어느 전사에서 갈렸는지 바로 말해준다.
//
// **키를 정렬하지 않는다.** 처음엔 정렬했는데 그게 진짜 차이를 지웠다.
// 훅은 처음 나온 순서로 담기고 그 순서가 리포트의 사례 순서가 된다. 정렬해서 견주니
// "같다"가 나왔는데 화면의 사례 순서가 달랐다(실측 2026-08-28). 순서까지 같아야 같은 것이다.
//
// **전사는 지금도 자란다.** 두 번 찍어보니 5초 사이에 2줄이 갈렸고, 갈린 것이
// 지금 도는 세션의 전사였다. 그래서 이 파일 하나로 대조하면 안 된다.
// `tools/compare.mjs` 가 JS → 상대 → JS 순서로 세 번 찍어 그 사이에 안 자란 것만 견준다.

import path from 'node:path'
import { ROOT, allJsonl, metaFiles, readDelegation, readSession, extractFile } from '../src/scan.mjs'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) {
    console.error(`--${name} 에 값이 없다`)
    process.exit(1)
  }
  return v
}

const root = path.resolve(arg('root', ROOT))
const only = arg('only')
if (only && !['session', 'transcript', 'delegation'].includes(only)) {
  console.error(`--only 는 session·transcript·delegation 중 하나여야 한다: ${only}`)
  process.exit(1)
}

let n = 0

// 위임은 읽는 파일이 다르다(.meta.json). 훑는 것도 다른 규칙이라 따로 돈다.
if (only === 'delegation') {
  for (const { metaPath, dir, agentId } of metaFiles(root)) {
    const row = { file: path.relative(root, metaPath), delegation: readDelegation(metaPath, dir, agentId) }
    process.stdout.write(`${JSON.stringify(row)}\n`)
    n++
  }
  console.error(`meta.json ${n}개`)
  process.exit(0)
}

for (const { file, sessionId, isSub } of allJsonl(root)) {
  // 뿌리 기준 상대경로로 찍는다. 절대경로를 넣으면 남의 기계와 대조할 수 없다.
  const row = { file: path.relative(root, file), sessionId, isSub }
  if (only !== 'transcript') row.session = readSession(file)
  if (only !== 'session') row.transcript = extractFile(file)
  process.stdout.write(`${JSON.stringify(row)}\n`)
  n++
}
console.error(`전사 ${n}개`)
