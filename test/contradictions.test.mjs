// 후보가 0건 나오는 탐지기는 고장난 탐지기와 겉이 같다.
// 그래서 진짜 모순을 심어 잡히는지, 안 어긋나는 것은 안 잡히는지 둘 다 본다.
//   node --test test/contradictions.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { candidates, clauseAround, polarity, judgeable, MIN_DOCS } from '../src/contradictions.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-contra-'))
const doc = (name, body) => {
  const p = path.join(dir, name)
  fs.writeFileSync(p, body)
  return [p, name]
}

test('한 줄에 권장과 금지가 같이 있으면 절 단위로 갈라야 한다', () => {
  const line = '- **긴 className 은 `cn()` 4분할**(베이스/상태) — 백틱·배열 `.join()` 금지'
  assert.equal(polarity(clauseAround(line, '.join()')), 'neg')
  // cn() 쪽 절에는 지시어가 없다. 줄 전체로 재면 여기도 금지로 잡혀 없는 대립이 생긴다.
  assert.notEqual(polarity(clauseAround(line, 'cn()')), 'neg')
})

test('진짜 모순을 잡는다: 한쪽은 금지, 다른 쪽은 권장', () => {
  // 설계 문서가 적어둔 모순 #2 와 같은 모양이다.
  // tailwind-design-system 스킬이 .join() 을 권하는데 CLAUDE.md 는 금지했다.
  const corpus = [
    doc('CLAUDE.md', '## 스타일\n\n- 배열 `.join()` 금지. `cn()` 을 쓴다\n'),
    doc('SKILL.md', '## 클래스 합치기\n\n- 여러 클래스는 `.join()` 으로 합쳐 사용한다\n'),
  ]
  const found = candidates(dir, { corpus })
  assert.equal(found.length, 1)
  assert.equal(found[0].token, '.join()')
  assert.equal(found[0].docs.length, 2)
})

test('같은 방향이면 후보가 아니다', () => {
  const corpus = [
    doc('a.md', '- 배열 `.join()` 금지\n'),
    doc('b.md', '- `.join()` 은 쓰지 않는다\n'),
  ]
  assert.equal(candidates(dir, { corpus }).length, 0)
})

test('한 문서에만 나오면 문서 쌍이 안 된다', () => {
  const corpus = [doc('solo.md', '- `.join()` 금지\n- `.join()` 을 사용한다\n')]
  assert.equal(candidates(dir, { corpus }).length, 0)
})

test('문서 개수로는 안 버린다', () => {
  // 문서 개수 상한이 있었는데 걷어냈다. 어느 크기에서도 제 일을 안 했다.
  // 문서 221개 하네스에서 35건 중 8건만 버렸고 남은 거짓 양성은 상한 2에서도 통과했다.
  const corpus = [
    doc('1.md', '- `xy` 금지\n'),
    doc('2.md', '- `xy` 를 사용한다\n'),
    doc('3.md', '- `xy` 를 사용한다\n'),
    doc('4.md', '- `xy` 를 사용한다\n'),
  ]
  assert.equal(candidates(dir, { corpus }).length, 1)
})

test('슬래시 명령 이름은 주제가 아니다', () => {
  // 한쪽은 "이럴 때 /review 를 호출하라", 다른 쪽은 "이미 돌렸으면 두 번 하지 말라".
  // 같은 명령을 다른 상황에서 말하는 것이지 대립이 아니다
  const corpus = [
    doc('1.md', '- 코드 검토를 원하면 `/review` 를 호출한다\n'),
    doc('2.md', '- 이미 돌렸으면 `/review` 를 다시 하지 않는다\n'),
  ]
  assert.equal(candidates(dir, { corpus }).length, 0)

  // 경로와 플래그는 남는다. `/tmp/` 는 실제로 대립하던 후보다
  const paths = [
    doc('1.md', '- `/tmp/` 에 만들지 않는다\n'),
    doc('2.md', '- 항상 `/tmp/` 에 먼저 만든다\n'),
  ]
  assert.equal(candidates(dir, { corpus: paths }).length, 1)

  // 순수 소문자 한 단어도 남긴다. 실제 저장소의 유일한 후보가 `var` 였다.
  // 문구는 server-a 의 실제 에이전트 정의에서 가져왔다
  const word = [
    doc('1.md', '- `val` over `var`, immutable collections at public boundaries\n'),
    doc('2.md', '- Mutable fields use `var` with `private set`\n'),
  ]
  assert.equal(candidates(dir, { corpus: word }).length, 1)
})

test('문서가 둘 미만이면 판정 자체가 안 된다', () => {
  // 후보 0건이 "모순이 없다"인지 "비교할 게 없다"인지 갈라야 한다.
  // 실측: harness-bro·omija·korean-tone 이 전역 CLAUDE.md 하나뿐이라 늘 0건이었다.
  // 깨끗하다는 뜻처럼 읽히지만 구조적으로 0건일 수밖에 없었다.
  assert.equal(judgeable(dir, [doc('solo.md', '- `.join()` 금지\n')]), false)
  assert.equal(judgeable(dir, [doc('a1.md', '- `.join()` 금지\n'), doc('b1.md', '- `.join()` 을 쓴다\n')]), true)
  assert.equal(MIN_DOCS, 2)
})
