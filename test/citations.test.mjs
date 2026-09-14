// 축의 근거는 파일과 문구를 가리킨다. 줄 번호는 읽을 때 찾는다.
// 박아뒀더니 실제로 썩었다. 전역 CLAUDE.md 가 자라면 조용히 어긋나고,
// 남의 홈에서는 첫 실행부터 어긋난다. 문구는 그 파일에 그대로 있는데도.
// 이 앱이 남의 하네스에서 찾아주는 죽은 참조와 똑같은 모양이라 자기 것부터 본다.
//   node --test test/citations.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkCitations, citation, compliance } from '../src/axes.mjs'
import { measure } from '../src/report.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-cite-'))
const file = path.join(dir, 'RULES.md')
fs.writeFileSync(file, ['# 제목', '', '- `model` 을 항상 명시한다', '- 잡무는 haiku 로'].join('\n'))
const axis = (id, rule) => ({ id, rule })

test('기본 축의 근거가 지금 다 맞는다', () => {
  // 여기가 빨개지면 ~/.claude/CLAUDE.md 에서 그 문구가 사라진 것이다.
  // 줄이 밀린 것만으로는 안 빨개진다. 그게 이 판의 요점이다.
  assert.deepEqual(checkCitations(compliance), [])
})

test('그 문구가 파일에 없으면 잡는다', () => {
  const got = checkCitations([axis('x', `${file}  이 말은 이 파일에 없다`)])
  assert.equal(got.length, 1)
  assert.match(got[0].reason, /그 규칙이 없어 판정할 수 없다/)
  assert.equal(got[0].cite, file) // 어느 파일을 볼지 알려준다
})

test('있으면 안 잡는다', () => {
  assert.deepEqual(checkCitations([axis('ok', `${file}  \`model\` 을 항상 명시한다`)]), [])
})

test('내가 덧붙인 괄호 설명은 원문에 없어도 된다', () => {
  // 축에 "(이 축만 전체 기간으로 본다)" 같은 주석을 달아뒀다. 원문에는 없다.
  assert.deepEqual(checkCitations([axis('ok', `${file}  잡무는 haiku 로 (이 축만 전체 기간)`)]), [])
})

test('파일을 못 읽는 것과 문구가 없는 것을 가른다', () => {
  assert.match(checkCitations([axis('b', `${dir}/없다.md  아무거나`)])[0].reason, /못 읽어 판정할 수 없다/)
})

test('줄을 안 가리키는 근거는 검사 대상이 아니다', () => {
  assert.deepEqual(checkCitations([axis('prose', '에이전트가 선언한 스킬이 실재해야 한다')]), [])
  // 두 칸 공백이 든 산문도 파일로 오해하지 않는다. 사용자 축이 뭘 쓸지 모른다
  assert.deepEqual(checkCitations([axis('prose2', '규칙이 죽었나  두 축으로 본다')]), [])
})

test('표시할 때 지금 이 파일의 줄 번호를 붙인다', () => {
  assert.equal(citation(`${file}  잡무는 haiku 로`).rule, `${file}:4  잡무는 haiku 로`)
  // 파일이 자라도 따라간다. 박아둔 번호가 썩는 것과 반대다
  fs.writeFileSync(file, '# 새 섹션\n\n' + fs.readFileSync(file, 'utf8'))
  assert.equal(citation(`${file}  잡무는 haiku 로`).rule, `${file}:6  잡무는 haiku 로`)
})

test('근거를 못 찾은 축은 판정 불가로 빠진다', () => {
  // 남의 하네스에는 내 규칙이 없다. 그 사람 위임을 내 기준으로 재면 리포트가 거짓말한다
  const mine = { id: 'mine', label: '내 축', rule: `${file}  남에게는 없는 규칙`, source: 'delegations', scope: () => true, violation: () => true }
  const got = measure([{ model: 'haiku' }], [mine])
  assert.equal(got[0].rate, null)
  assert.match(got[0].unavailable, /그 규칙이 없어 판정할 수 없다/)
  assert.equal(got[0].total, 0) // 위반 1건을 세지 않는다

  const ok = { ...mine, rule: `${file}  잡무는 haiku 로` }
  assert.equal(measure([{ model: 'haiku' }], [ok])[0].rate, 0)
})

test('근거가 산문인 축은 그냥 잰다', () => {
  const prose = { id: 'p', label: '산문', rule: '스킬이 실재해야 한다', source: 'delegations', scope: () => true, violation: () => false }
  assert.equal(measure([{ model: 'haiku' }], [prose])[0].rate, 1)
})

test('측정 함정 번호가 README 와 소스에서 맞는다', () => {
  // 목록이 세 곳(README·설계 문서·소스 주석)에 있었고 서로 어긋났다. README 는 7개,
  // 핸드오프는 8개, 소스는 1~5 만 참조했다. 새로 찾은 둘은 어디에도 번호가 없었다.
  // 이 앱이 남의 하네스에서 찾아주는 죽은 참조와 똑같은 모양이라 자기 것부터 본다.
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
  const section = readme.slice(readme.indexOf('## 측정 함정'))
  const listed = [...section.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))
  assert.ok(listed.length >= 8, `README 함정 목록이 ${listed.length}개뿐이다`)
  // 번호는 소스가 참조하니 재정렬하지 않는다. 1 부터 빈틈 없이 이어져야 한다
  assert.deepEqual(listed, listed.map((_, i) => i + 1))

  const cited = new Set()
  for (const f of fs.readdirSync(path.join(root, 'src'))) {
    if (!f.endsWith('.mjs')) continue
    for (const m of fs.readFileSync(path.join(root, 'src', f), 'utf8').matchAll(/함정 (\d+)\./g)) {
      cited.add(Number(m[1]))
    }
  }
  for (const n of listed) assert.ok(cited.has(n), `함정 ${n} 을 소스가 참조하지 않는다`)
  for (const n of cited) assert.ok(listed.includes(n), `소스가 없는 함정 ${n} 을 가리킨다`)
})
