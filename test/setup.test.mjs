// 첫 설치 안내(desktop/app/setup.mjs). 진짜 git·xcode-select 는 안 부른다 — 주입한다.
//   node --test test/setup.test.mjs
import { it } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findOnPath, gatherFacts, setupChecklist, readSeen, markSeen, SETUP_LINKS } from '../desktop/app/setup.mjs'

const ready = {
  claudeProjects: 3,
  codexHistory: true,
  git: { ok: true, path: '/opt/homebrew/bin/git' },
  claude: { installed: true, loggedIn: true },
  codex: { installed: true, loggedIn: true },
}

it('다 갖춰졌으면 손볼 것이 없다', () => {
  const { items, needsAttention } = setupChecklist(ready)
  assert.strictEqual(needsAttention, false)
  assert.ok(items.every((i) => i.ready))
  assert.ok(items.every((i) => !i.action))
})

it('Claude Code 기록이 없으면 그것만 필수로 막는다', () => {
  const { items, needsAttention } = setupChecklist({ ...ready, claudeProjects: 0 })
  assert.strictEqual(needsAttention, true)
  const h = items.find((i) => i.id === 'claude-history')
  assert.strictEqual(h.level, 'required')
  assert.match(h.detail, /~\/\.claude\/projects/)
})

it('CLI 가 없거나 로그인 안 됐으면 채팅만 선택 항목으로 안내한다', () => {
  const { items, needsAttention } = setupChecklist({ ...ready, claude: { installed: false, loggedIn: false }, codex: { installed: true, loggedIn: false } })
  assert.strictEqual(needsAttention, false, '채팅은 필수가 아니다 — 레포트는 CLI 없이 된다')
  const c = items.find((i) => i.id === 'claude-cli')
  assert.strictEqual(c.level, 'optional')
  assert.deepStrictEqual(c.action, { kind: 'link', label: '설치 안내', url: 'https://code.claude.com/docs/en/setup' })
  assert.deepStrictEqual(items.find((i) => i.id === 'codex-cli').action, { kind: 'login', label: '터미널에서 로그인', provider: 'codex' })
  for (const i of items) if (i.action?.kind === 'link') assert.ok(SETUP_LINKS.includes(i.action.url))
})

it('Xcode 개발 도구가 없으면 git 을 부르지 않고 설치 명령을 알려 준다', () => {
  const calls = []
  const run = (bin, args) => { calls.push([bin, ...args]); return { status: 2 } }
  const f = gatherFacts({
    claudeRoot: '/nope', codexRoot: '/nope', pathValue: '/usr/bin:/bin', platform: 'darwin',
    run, isExecutable: (p) => p === '/usr/bin/git',
  })
  assert.deepStrictEqual(calls, [['xcode-select', '-p']], 'git 자체는 실행하지 않는다(설치 창이 뜬다)')
  assert.strictEqual(f.git.ok, false)
  assert.match(setupChecklist(f).items.find((i) => i.id === 'git').detail, /xcode-select --install/)
})

it('Homebrew git 은 xcode-select 를 안 묻는다', () => {
  const calls = []
  const f = gatherFacts({
    claudeRoot: '/nope', codexRoot: '/nope', pathValue: '/usr/bin:/opt/homebrew/bin', platform: 'darwin',
    run: (...a) => { calls.push(a); return { status: 0 } }, isExecutable: (p) => p === '/opt/homebrew/bin/git',
  })
  assert.strictEqual(f.git.ok, true)
  assert.strictEqual(calls.length, 0)
})

it('기록 폴더의 프로젝트 수를 센다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askin-setup-'))
  try {
    fs.mkdirSync(path.join(dir, 'a'))
    fs.mkdirSync(path.join(dir, 'b'))
    fs.writeFileSync(path.join(dir, 'x.txt'), '')
    const f = gatherFacts({ claudeRoot: dir, codexRoot: path.join(dir, 'none'), pathValue: '', platform: 'darwin' })
    assert.strictEqual(f.claudeProjects, 2)
    assert.strictEqual(f.codexHistory, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('findOnPath 는 실행하지 않고 앞선 폴더를 고른다', () => {
  assert.strictEqual(findOnPath('git', '/a:/b', { isExecutable: (p) => p === '/b/git' || p === '/a/git' }), '/a/git')
  assert.strictEqual(findOnPath('git', '', { isExecutable: () => true }), null)
})

it('처음 한 번 보면 다음에는 처음이 아니다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askin-seen-'))
  const file = path.join(dir, 'sub', 'first-run.json')
  try {
    assert.strictEqual(readSeen(file), false)
    markSeen(file)
    assert.strictEqual(readSeen(file), true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
