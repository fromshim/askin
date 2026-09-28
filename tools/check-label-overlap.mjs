#!/usr/bin/env node
// tools/check-label-overlap.mjs
// 라벨 바욷딩 박스 JSON 을 읽고 겹치는 쌍의 개수를 출력한다.

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const boxesIdx = args.indexOf('--boxes')
if (boxesIdx === -1 || !args[boxesIdx + 1]) {
  console.error('Usage: node tools/check-label-overlap.mjs --boxes <path>')
  process.exit(1)
}

const boxesPath = args[boxesIdx + 1]
const raw = fs.readFileSync(boxesPath, 'utf8')
const boxes = JSON.parse(raw)

// 라벨이 서로 붙어서 읽기 어려운 것도 겹침으로 센다. 양쪽에 5px 여유를 두고 본다.
const MARGIN = 5
function intersects(a, b) {
  return (
    a.x - MARGIN < b.x + b.width + MARGIN &&
    a.x + a.width + MARGIN > b.x - MARGIN &&
    a.y - MARGIN < b.y + b.height + MARGIN &&
    a.y + a.height + MARGIN > b.y - MARGIN
  )
}

let count = 0
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    if (intersects(boxes[i], boxes[j])) count++
  }
}

console.log(`intersections: ${count}`)
