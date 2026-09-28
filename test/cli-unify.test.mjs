// --plan CLI 가 desktop/app/main.mjs 의 cards() 와 같은 id 목록을 내고,
// ignored.json 도 똑같이 적용하는지 검사한다.
//   node --test test/cli-unify.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

function parseCardIds(stdout) {
  const ids = []
  for (const line of stdout.split('\n')) {
    const m = line.match(/^  · (\S+)/)
    if (m) ids.push(m[1])
  }
  return ids
}

function runPlan(repo, env) {
  return execFileSync(process.execPath, ['src/report.mjs', '--repo', repo, '--plan', '--no-cache'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// 같은 픽스처와 같은 HOME/ignored 를 쓰는 자식 프로세스에서 cards() 를 돌린다.
// 그래야 buildReport() 가 보는 전역 상태(HOME 의 하네스 문서)도 CLI 와 정확히 같다.
function expectedIds(repo, ignoredFile, home) {
  const script = `
    import { buildReport } from './src/report.mjs'
    import { cards, loadIgnored } from './src/coach.mjs'
    import { loadAxes } from './src/axes.mjs'
    const axes = await loadAxes()
    const report = buildReport({ repo: ${JSON.stringify(repo)}, axes, cache: false })
    const ignored = loadIgnored()
    const ids = cards(report, { ignored }).map((c) => c.id)
    console.log(JSON.stringify(ids))
  `
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, HARNESS_BRO_IGNORED: ignoredFile },
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out.trim())
}

async function withFixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-cli-unify-'))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-home-'))
  const ignoredDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-ignored-'))
  const ignoredFile = path.join(ignoredDir, 'ignored.json')
  fs.writeFileSync(ignoredFile, '[]')
  fs.mkdirSync(path.join(repo, '.claude', 'skills'), { recursive: true })
  fs.symlinkSync('../../.nowhere/gone', path.join(repo, '.claude', 'skills', 'broken'))
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# 규칙\n\n- 오류는 `lib/gone.ts` 를 쓴다\n')

  try {
    await t(repo, ignoredFile, home)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(ignoredDir, { recursive: true, force: true })
  }
}

test('cards() 와 --plan CLI 가 같은 id 목록을 낸다', async () => {
  await withFixture(async (repo, ignoredFile, home) => {
    const expected = expectedIds(repo, ignoredFile, home)
    const stdout = runPlan(repo, { HARNESS_BRO_IGNORED: ignoredFile, HOME: home })
    const actual = parseCardIds(stdout)
    assert.deepEqual(actual, expected)
  })
})

test('무시한 id 는 cards() 와 --plan CLI 양쪽에서 빠진다', async () => {
  await withFixture(async (repo, ignoredFile, home) => {
    const allIds = expectedIds(repo, ignoredFile, home)
    assert.ok(allIds.length > 0, '테스트 픽스처에 카드가 있어야 한다')

    const ignoredId = allIds[0]
    fs.writeFileSync(ignoredFile, JSON.stringify([ignoredId]))

    const expected = expectedIds(repo, ignoredFile, home)
    assert.ok(!expected.includes(ignoredId))

    const stdout = runPlan(repo, { HARNESS_BRO_IGNORED: ignoredFile, HOME: home })
    const actual = parseCardIds(stdout)
    assert.deepEqual(actual, expected)
    assert.ok(!actual.includes(ignoredId))
  })
})
