// 사이드바 프로젝트 목록 파일(desktop/app/projects.mjs).
//
// 함수마다 파일 경로를 인자로 받는다 — 그래서 이 검사는 사용자의 ~/.harness-bro/projects.json
// 을 건드리지 않는다(CLAUDE.md: "테스트는 사용자 데이터를 건드리지 않는다"). 기본값
// PROJECTS_FILE 은 모듈을 읽을 때 경로만 계산하고 파일을 만들지 않는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readProjectPaths, listProjectPaths, addProjectPath, removeProjectPath } from '../desktop/app/projects.mjs'

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askin-projects-'))
  return { dir, file: path.join(dir, 'nested', 'projects.json') }
}

test('파일이 없으면 빈 목록이다 — 앱이 목록 파일 하나 때문에 안 뜨면 안 된다', () => {
  const { file } = tmp()
  assert.deepEqual(readProjectPaths(file), [])
  assert.deepEqual(listProjectPaths(file), [])
})

test('내용이 깨졌거나 배열이 아니면 빈 목록이다', () => {
  const { dir } = tmp()
  const broken = path.join(dir, 'broken.json')
  fs.writeFileSync(broken, '{{{')
  assert.deepEqual(readProjectPaths(broken), [])

  const notArray = path.join(dir, 'object.json')
  fs.writeFileSync(notArray, JSON.stringify({ projects: ['/tmp'] }))
  assert.deepEqual(readProjectPaths(notArray), [])

  const mixed = path.join(dir, 'mixed.json')
  fs.writeFileSync(mixed, JSON.stringify(['/tmp/a', 42, null, '', '/tmp/b']))
  assert.deepEqual(readProjectPaths(mixed), ['/tmp/a', '/tmp/b'])
})

test('추가는 절대경로로 저장하고, 같은 것을 두 번 넣어도 하나다', () => {
  const { dir, file } = tmp()
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(repo)

  const added = addProjectPath(repo, file)
  assert.equal(added, repo)
  assert.deepEqual(readProjectPaths(file), [repo])

  // 같은 곳을 가리키는 다른 표기(끝의 슬래시, .)를 넣어도 늘지 않아야 한다
  addProjectPath(`${repo}/`, file)
  addProjectPath(path.join(repo, '.'), file)
  assert.deepEqual(readProjectPaths(file), [repo])
})

test('넣은 순서를 지킨다 — 정렬은 표시하는 쪽(main.mjs)의 몫이다', () => {
  const { dir, file } = tmp()
  const made = ['zeta', 'alpha', 'mid'].map((name) => {
    const p = path.join(dir, name)
    fs.mkdirSync(p)
    addProjectPath(p, file)
    return p
  })
  assert.deepEqual(readProjectPaths(file), made)
})

test('제거는 그 하나만 뺀다', () => {
  const { dir, file } = tmp()
  const a = path.join(dir, 'a')
  const b = path.join(dir, 'b')
  fs.mkdirSync(a)
  fs.mkdirSync(b)
  addProjectPath(a, file)
  addProjectPath(b, file)

  assert.deepEqual(removeProjectPath(a, file), [b])
  assert.deepEqual(readProjectPaths(file), [b])

  // 목록에 없는 것을 빼도 남은 것이 안 바뀐다
  assert.deepEqual(removeProjectPath('/없는/곳', file), [b])
  assert.deepEqual(readProjectPaths(file), [b])
})

test('없어진 디렉터리는 목록에서 안 보이지만 파일에는 남는다', () => {
  const { dir, file } = tmp()
  const live = path.join(dir, 'live')
  const gone = path.join(dir, 'gone')
  const plainFile = path.join(dir, 'not-a-dir')
  fs.mkdirSync(live)
  fs.mkdirSync(gone)
  fs.writeFileSync(plainFile, 'x')
  addProjectPath(live, file)
  addProjectPath(gone, file)
  addProjectPath(plainFile, file)
  fs.rmSync(gone, { recursive: true })

  // 마운트가 잠깐 빠졌을 수 있어 파일에서는 안 지운다(projects.mjs listProjectPaths 주석)
  assert.deepEqual(listProjectPaths(file), [live])
  assert.deepEqual(readProjectPaths(file), [live, gone, plainFile])
})
