// 채팅 패널의 로컬 CLI shell-out(src/coach.mjs runChat)과 채팅용 지시서(chatPrompt), 출력
// 마크다운 조각 나누기(desktop/app/chat-markdown.mjs)를 잰다. 진짜 claude/codex 는 안 부른다 —
// tools/mock-claude-codex.sh 를 .omo/evidence/task-10-mockbin/ 에 claude·codex 이름으로 깔고
// PATH 앞에 둔다(plan Todo 10).
//   node --test test/chat.test.mjs
import { describe, it, before, after, afterEach } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runChat, chatPrompt, CHAT_MISSING } from '../src/coach.mjs'
import { markdownSegments } from '../desktop/app/chat-markdown.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARGV_LOG = path.join(ROOT, '.omo/evidence/task-10-argv.log')
const MOCKBIN = path.join(ROOT, '.omo/evidence/task-10-mockbin')
const INSTALL =
  'mkdir -p .omo/evidence/task-10-mockbin && cp tools/mock-claude-codex.sh .omo/evidence/task-10-mockbin/claude && cp tools/mock-claude-codex.sh .omo/evidence/task-10-mockbin/codex && chmod +x .omo/evidence/task-10-mockbin/claude .omo/evidence/task-10-mockbin/codex'

const argvLines = () => (fs.existsSync(ARGV_LOG) ? fs.readFileSync(ARGV_LOG, 'utf8').split('\n').filter(Boolean) : [])

describe('runChat', () => {
  const originalPath = process.env.PATH
  before(() => {
    execSync(INSTALL, { cwd: ROOT })
    fs.rmSync(ARGV_LOG, { force: true })
  })
  afterEach(() => {
    process.env.PATH = `${MOCKBIN}:${originalPath}`
    delete process.env.MOCK_EXIT
    delete process.env.MOCK_READ_STDIN
  })
  after(() => {
    process.env.PATH = originalPath
  })

  it('claude 는 -p <지시서> 로 부르고 지시서가 CLI 에 닿는다', async () => {
    process.env.PATH = `${MOCKBIN}:${originalPath}`
    const res = await runChat({ provider: 'claude', prompt: 'hello-claude', cwd: ROOT })
    assert.strictEqual(res.ok, true)
    assert.deepStrictEqual(res.argv, ['claude', '-p', 'hello-claude'])
    assert.match(res.stdout, /Mock Claude response/)
    assert.match(res.stdout, /받은 지시: hello-claude/)
    const line = argvLines().find((l) => l.startsWith('claude '))
    assert.ok(line, `argv 로그에 claude 줄이 있어야 한다: ${argvLines().join(' | ')}`)
    assert.match(line, /^claude -p hello-claude$/)
  })

  it('codex 는 exec - 로 부르고 지시서는 stdin 으로 간다', async () => {
    process.env.PATH = `${MOCKBIN}:${originalPath}`
    const prompt = '# 제목\n\n여러 줄 지시서'
    const res = await runChat({ provider: 'codex', prompt, cwd: ROOT })
    assert.strictEqual(res.ok, true)
    assert.deepStrictEqual(res.argv, ['codex', 'exec', '-'])
    assert.match(res.stdout, /Mock Codex response/)
    assert.ok(res.stdout.includes(prompt), '지시서 전문이 stdin 으로 넘어가야 한다')
    const line = argvLines().find((l) => l.startsWith('codex '))
    assert.ok(line, `argv 로그에 codex 줄이 있어야 한다: ${argvLines().join(' | ')}`)
    assert.match(line, /^codex exec -$/)
  })

  it('claude -p 가 stdin 을 EOF 까지 읽어도 멈추지 않는다(stdin 을 닫는다)', { timeout: 5000 }, async () => {
    process.env.PATH = `${MOCKBIN}:${originalPath}`
    process.env.MOCK_READ_STDIN = '1'
    const res = await runChat({ provider: 'claude', prompt: 'reads-stdin', cwd: ROOT })
    assert.strictEqual(res.ok, true)
  })

  it('0 이 아닌 종료 코드는 ok:false 와 stderr·code 로 드러난다', async () => {
    process.env.PATH = `${MOCKBIN}:${originalPath}`
    process.env.MOCK_EXIT = '3'
    for (const provider of ['claude', 'codex']) {
      const res = await runChat({ provider, prompt: 'fail', cwd: ROOT })
      assert.strictEqual(res.ok, false, provider)
      assert.strictEqual(res.code, 3, provider)
      assert.match(res.stderr, /로그인이 필요합니다/, provider)
    }
  })

  it('CLI 가 없으면 설치·로그인 안내로 실패하고 멈추지 않는다', { timeout: 5000 }, async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'askin-nocli-'))
    process.env.PATH = empty
    try {
      await assert.rejects(runChat({ provider: 'claude', prompt: 'x', cwd: ROOT }), /claude 를 찾을 수 없다.*로그인/)
      await assert.rejects(runChat({ provider: 'codex', prompt: 'x', cwd: ROOT }), /codex 를 찾을 수 없다.*codex login/)
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  it('모르는 provider 는 아무것도 띄우지 않고 거절한다', async () => {
    const before = argvLines().length
    await assert.rejects(runChat({ provider: 'gpt', prompt: 'x' }), /지원하지 않는 provider/)
    assert.strictEqual(argvLines().length, before)
  })
})

describe('chatPrompt', () => {
  const card = { title: 't', recommend: '모델을 적어요.' }

  it('누른 버튼을 맨 위에, 지시서 본문을 그대로 싣는다', () => {
    const out = chatPrompt('# 본문\n\n## 규칙', card)
    assert.strictEqual(out.split('\n')[0], '> 누른 버튼: 채팅에서 고치기')
    assert.ok(out.includes('# 본문\n\n## 규칙'))
  })

  it('아직 못 뽑는 세 줄(차액 근거·세션 전사 경로·다시 재는 루프)을 없다고 적는다', () => {
    const out = chatPrompt('본문', card)
    assert.ok(out.includes('## 이 지시서에 아직 없는 것'))
    for (const v of Object.values(CHAT_MISSING)) assert.ok(out.includes(v), v)
  })

  it('카드 추천에 비용 추정이 붙어 있으면 차액 근거는 없다고 하지 않고 그 문구를 싣는다', () => {
    const recommend = '모델을 적어요. 월 $1.20 추정 절감(기준: src/rates.mjs, 2026-09-01 단가, opus→sonnet, estimate)'
    const out = chatPrompt('본문', { recommend })
    assert.ok(out.includes(`차액 근거: ${recommend}`))
    assert.ok(!out.includes(CHAT_MISSING.cost))
    assert.ok(out.includes(CHAT_MISSING.transcripts))
  })
})

describe('markdownSegments', () => {
  it('코드 펜스는 code 조각, 나머지는 text 조각이다', () => {
    const segs = markdownSegments('# 제목\n\n```sh\nnpm test\n```\n끝')
    assert.deepStrictEqual(segs, [
      { type: 'text', text: '# 제목\n\n' },
      { type: 'code', lang: 'sh', text: 'npm test' },
      { type: 'text', text: '\n끝' },
    ])
  })

  it('닫히지 않은 펜스는 끝까지 code 로 본다', () => {
    const segs = markdownSegments('앞\n```\na\nb')
    assert.deepStrictEqual(segs, [
      { type: 'text', text: '앞\n' },
      { type: 'code', lang: null, text: 'a\nb' },
    ])
  })

  it('HTML 은 해석하지 않고 글자로 남긴다', () => {
    const segs = markdownSegments('<img src=x onerror=alert(1)>')
    assert.deepStrictEqual(segs, [{ type: 'text', text: '<img src=x onerror=alert(1)>' }])
  })

  it('모의 CLI 출력이 조각으로 나뉜다', async () => {
    const out = '# Mock Claude response\n\n받은 지시: hi\n\n```sh\nnpm test\n```\n'
    const segs = markdownSegments(out)
    assert.strictEqual(segs.filter((s) => s.type === 'code').length, 1)
    assert.strictEqual(segs.find((s) => s.type === 'code').text, 'npm test')
  })

  it('빈 입력은 빈 목록이다', () => {
    assert.deepStrictEqual(markdownSegments(''), [])
    assert.deepStrictEqual(markdownSegments(undefined), [])
  })
})
