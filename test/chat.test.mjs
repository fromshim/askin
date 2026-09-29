import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import fs from 'node:fs'
import { runChat } from '../src/coach.mjs'

const ARGV_LOG = path.resolve('.omo/evidence/task-10-argv.log')
const MOCKBIN = path.resolve('.omo/evidence/task-10-mockbin')

describe('runChat', () => {
  let originalPath
  before(() => {
    originalPath = process.env.PATH
    fs.rmSync(ARGV_LOG, { force: true })
  })
  after(() => {
    process.env.PATH = originalPath
  })

  it('claude provider builds -p argv', async () => {
    process.env.PATH = `${MOCKBIN}:${originalPath}`
    const res = await runChat({ provider: 'claude', prompt: 'hello' })
    assert.strictEqual(res.ok, true)
    assert.match(res.stdout, /Mock Claude response/)
    const log = fs.readFileSync(ARGV_LOG, 'utf8')
    const lines = log.trim().split('\n')
    const line = lines.find((l) => l.startsWith('claude'))
    assert.ok(line, `argv log should contain claude command; got: ${log}`)
    assert.match(line, /-p/)
  })

  it('codex provider builds exec argv', async () => {
    process.env.PATH = `${MOCKBIN}:${originalPath}`
    const res = await runChat({ provider: 'codex', prompt: 'hello' })
    assert.strictEqual(res.ok, true)
    assert.match(res.stdout, /Mock Codex response/)
    const log = fs.readFileSync(ARGV_LOG, 'utf8')
    const lines = log.trim().split('\n')
    const line = lines.find((l) => l.startsWith('codex'))
    assert.ok(line, `argv log should contain codex command; got: ${log}`)
    assert.match(line, /exec/)
  })

  it('missing CLI surfaces guidance without hanging', async () => {
    process.env.PATH = '/usr/bin'
    await assert.rejects(
      runChat({ provider: 'claude', prompt: 'hello' }),
      /claude CLI/,
    )
    await assert.rejects(
      runChat({ provider: 'codex', prompt: 'hello' }),
      /codex CLI|codex login/,
    )
  })
})
