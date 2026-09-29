// BYOS 인증(src/auth.mjs)을 mock 만으로 잰다. 진짜 claude·codex·Electron safeStorage 로 가는 갈래는
// 없다 — spawn 과 safeStorage 는 전부 가짜를 주입한다(docs/_inbox/oauth-byos-plan.md Gate 2).
//   node --test test/oauth-safeStorage.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  detectStatus, effectiveStatus, accountKey, statusLine, maskEmail,
  loginCommand, logoutCommand, openInTerminal,
  createConsent, sendWithConsent, createReloginNotice, isAuthExpired,
  createSecretStore, keyEnv,
} from '../src/auth.mjs'

// 가짜 spawn. 불린 인자를 calls 에 쌓고, reply(bin, args) 가 준 출력으로 끝난다.
function fakeSpawn(reply) {
  const calls = []
  const spawn = (bin, args, opts) => {
    calls.push({ bin, args, opts })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { on() {}, end() {} }
    child.kill = () => {}
    const r = reply(bin, args) ?? {}
    setImmediate(() => {
      if (r.enoent) {
        const err = new Error(`spawn ${bin} ENOENT`)
        err.code = 'ENOENT'
        child.emit('error', err)
        return
      }
      if (r.stdout) child.stdout.emit('data', r.stdout)
      if (r.stderr) child.stderr.emit('data', r.stderr)
      child.emit('close', r.code ?? 0, null)
    })
    return child
  }
  return { spawn, calls }
}

// 가짜 safeStorage. 암호문은 뒤집고 접두어를 붙인 것 — 원문이 파일에 안 남는지 볼 수 있다.
function fakeSafeStorage({ available = true, backend = 'keychain' } = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (s) => Buffer.from(`enc:${[...s].reverse().join('')}`),
    decryptString: (b) => [...b.toString().replace(/^enc:/, '')].reverse().join(''),
  }
}

const CLAUDE_OK = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', email: 'person@example.com', orgId: 'x' })

describe('refuse: safeStorage 를 못 쓰면 키를 저장하지 않는다', () => {
  let dir
  let file
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askin-keys-'))
    file = path.join(dir, 'askin-keys.enc.json')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('refuse: 암호화를 못 쓰면 저장을 거부하고 파일을 안 만든다', () => {
    const store = createSecretStore({ safeStorage: fakeSafeStorage({ available: false }), file })
    assert.throws(() => store.set('claude', 'sk-test-123'), /^Error: refuse:/)
    assert.strictEqual(fs.existsSync(file), false)
    assert.strictEqual(store.has('claude'), false)
    console.log('refuse: encryption unavailable → no key file')
  })

  it('refuse: Linux basic_text 백엔드(사실상 평문)도 거부한다', () => {
    const store = createSecretStore({ safeStorage: fakeSafeStorage({ backend: 'basic_text' }), file })
    assert.throws(() => store.set('codex', 'sk-test-456'), /refuse/)
    assert.strictEqual(fs.existsSync(file), false)
  })

  it('refuse: safeStorage 가 아예 없으면 거부한다', () => {
    const store = createSecretStore({ safeStorage: undefined, file })
    assert.throws(() => store.set('claude', 'k'), /refuse/)
  })

  it('쓸 수 있으면 암호문만 파일에 남고 되읽으면 원래 키다', () => {
    const store = createSecretStore({ safeStorage: fakeSafeStorage(), file })
    store.set('claude', '  sk-live-abc  ')
    const raw = fs.readFileSync(file, 'utf8')
    assert.ok(!raw.includes('sk-live-abc'), '평문 키가 파일에 있으면 안 된다')
    assert.strictEqual(store.get('claude'), 'sk-live-abc')
    assert.strictEqual(store.has('claude'), true)
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600)
  })

  it('나중에 암호화를 못 쓰게 되면 복호화하지 않고 null 이다', () => {
    const ok = createSecretStore({ safeStorage: fakeSafeStorage(), file })
    ok.set('codex', 'sk-x')
    const later = createSecretStore({ safeStorage: fakeSafeStorage({ available: false }), file })
    assert.strictEqual(later.get('codex'), null)
  })

  it('지우면 파일도 사라진다', () => {
    const store = createSecretStore({ safeStorage: fakeSafeStorage(), file })
    store.set('claude', 'a')
    store.clear('claude')
    assert.strictEqual(store.has('claude'), false)
    assert.strictEqual(fs.existsSync(file), false)
  })

  it('키는 provider 별 env 로만 붙는다', () => {
    assert.strictEqual(keyEnv('claude', 'k', {}).ANTHROPIC_API_KEY, 'k')
    assert.strictEqual(keyEnv('codex', 'k', {}).CODEX_API_KEY, 'k')
  })
})

describe('동의를 거절하면 spawn 하지 않는다', () => {
  const status = { provider: 'claude', installed: true, loggedIn: true, method: 'claude.ai', plan: 'max', account: 'p*****@example.com' }

  it('묻는 중(동의 전)에는 spawn 이 한 번도 안 불린다', async () => {
    const { spawn, calls } = fakeSpawn(() => ({ stdout: 'hi' }))
    const res = await sendWithConsent({ provider: 'claude', prompt: 'x', status, consent: createConsent(), spawn })
    assert.strictEqual(res.needsConsent, true)
    assert.strictEqual(calls.length, 0)
  })

  it('거절하면 spawn 이 한 번도 안 불린다', async () => {
    const { spawn, calls } = fakeSpawn(() => ({ stdout: 'hi' }))
    const consent = createConsent()
    consent.decline('claude', accountKey(status))
    const res = await sendWithConsent({ provider: 'claude', prompt: 'x', status, consent, spawn })
    assert.strictEqual(res.declined, true)
    assert.strictEqual(calls.length, 0)
  })

  it('동의하면 그때 한 번 띄운다', async () => {
    const { spawn, calls } = fakeSpawn(() => ({ stdout: 'hi' }))
    const consent = createConsent()
    consent.grant('claude', accountKey(status))
    const res = await sendWithConsent({ provider: 'claude', prompt: 'x', status, consent, spawn })
    assert.strictEqual(res.ok, true)
    assert.strictEqual(calls.length, 1)
    assert.deepStrictEqual(calls[0].args, ['-p', 'x'])
  })

  it('계정이 바뀌면 동의를 다시 묻는다', async () => {
    const { spawn, calls } = fakeSpawn(() => ({ stdout: 'hi' }))
    const consent = createConsent()
    consent.grant('claude', accountKey(status))
    const other = { ...status, account: 'o****@example.com' }
    const res = await sendWithConsent({ provider: 'claude', prompt: 'x', status: other, consent, spawn })
    assert.strictEqual(res.needsConsent, true)
    assert.strictEqual(calls.length, 0)
  })
})

describe('로그인된 계정과 방식을 보여 주고, 동의 전 상태다', () => {
  it('claude auth status --json 에서 방식·플랜·가린 이메일을 뽑는다', async () => {
    const { spawn, calls } = fakeSpawn(() => ({ stdout: CLAUDE_OK }))
    const st = await detectStatus({ provider: 'claude', spawn })
    assert.deepStrictEqual(calls[0].args, ['auth', 'status', '--json'])
    assert.strictEqual(st.loggedIn, true)
    assert.strictEqual(st.method, 'claude.ai')
    assert.strictEqual(st.plan, 'max')
    assert.strictEqual(st.account, 'p*****@example.com')
    assert.ok(!JSON.stringify(st).includes('person@'), '가리지 않은 이메일이 나가면 안 된다')
    assert.strictEqual(statusLine(st), 'Claude Code · claude.ai (max) · p*****@example.com 로 실행돼요')
    assert.strictEqual(createConsent().get('claude', accountKey(st)), 'ask')
  })

  it('codex login status 의 종료 코드와 문구로 로그인 여부를 본다', async () => {
    const ok = await detectStatus({ provider: 'codex', spawn: fakeSpawn(() => ({ stdout: 'Logged in using ChatGPT\n' })).spawn })
    assert.strictEqual(ok.loggedIn, true)
    assert.strictEqual(ok.method, 'ChatGPT')
    const no = await detectStatus({ provider: 'codex', spawn: fakeSpawn(() => ({ stderr: 'Not logged in\n', code: 1 })).spawn })
    assert.strictEqual(no.loggedIn, false)
  })

  it('CLI 가 없으면 설치 안 됨으로 답한다', async () => {
    const st = await detectStatus({ provider: 'claude', spawn: fakeSpawn(() => ({ enoent: true })).spawn })
    assert.strictEqual(st.installed, false)
    assert.strictEqual(statusLine(st), 'Claude Code 가 설치돼 있지 않아요')
  })

  it('상태 출력이 JSON 이 아니면 로그인 안 됨으로 보고 죽지 않는다', async () => {
    const st = await detectStatus({ provider: 'claude', spawn: fakeSpawn(() => ({ stdout: 'oops' })).spawn })
    assert.strictEqual(st.loggedIn, false)
    assert.ok(st.error)
  })

  it('본인 키가 있으면 화면은 구독 계정이 아니라 키로 돈다고 말한다', () => {
    const st = effectiveStatus({ provider: 'claude', installed: true, loggedIn: false, method: null, plan: null, account: null }, { hasKey: true })
    assert.strictEqual(st.loggedIn, true)
    assert.strictEqual(st.viaKey, true)
    assert.match(statusLine(st), /본인 API 키/)
  })

  it('maskEmail 은 이메일이 아니면 null 이다', () => {
    assert.strictEqual(maskEmail(undefined), null)
    assert.strictEqual(maskEmail('ab@x.io'), 'a**@x.io')
  })

  it('진짜 spawn 으로 셸 mock(tools/mock-claude-codex.sh)의 상태를 읽는다', async () => {
    // 다른 테스트 파일과 병렬로 돌아도 안 부딪히게 mock 을 제 임시 폴더에 깐다.
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askin-mockbin-'))
    try {
      for (const n of ['claude', 'codex']) {
        fs.copyFileSync(path.join(root, 'tools/mock-claude-codex.sh'), path.join(dir, n))
        fs.chmodSync(path.join(dir, n), 0o755)
      }
      const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, MOCK_ARGV_LOG: path.join(dir, 'argv.log') }
      const c = await detectStatus({ provider: 'claude', env })
      assert.strictEqual(c.loggedIn, true)
      assert.strictEqual(c.account, 'm***@example.com')
      const x = await detectStatus({ provider: 'codex', env })
      assert.strictEqual(x.loggedIn, true)
      const out = await detectStatus({ provider: 'codex', env: { ...env, MOCK_LOGGED_OUT: '1' } })
      assert.strictEqual(out.loggedIn, false)
      assert.match(fs.readFileSync(path.join(dir, 'argv.log'), 'utf8'), /^claude auth status --json$/m)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('오래된 로그인은 재로그인 안내를 정확히 한 번 낸다', () => {
  it('만료가 두 번 보여도 안내는 한 번이고, 다시 보내는 spawn 이 없다', async () => {
    const { spawn, calls } = fakeSpawn(() => ({ stderr: 'Login expired · Please run /login\n', code: 1 }))
    const status = { provider: 'claude', installed: true, loggedIn: true, method: 'claude.ai', plan: 'max', account: null }
    const consent = createConsent()
    consent.grant('claude', accountKey(status))
    const notice = createReloginNotice()

    const r1 = await sendWithConsent({ provider: 'claude', prompt: 'a', status, consent, spawn })
    const n1 = notice.check('claude', r1)
    const r2 = await sendWithConsent({ provider: 'claude', prompt: 'b', status, consent, spawn })
    const n2 = notice.check('claude', r2)

    assert.strictEqual(r1.ok, false)
    assert.deepStrictEqual(n1, { provider: 'claude', command: 'claude auth login', message: '로그인이 만료됐어요. 터미널에서 다시 로그인해 주세요.' })
    assert.strictEqual(n2, null)
    assert.strictEqual(calls.length, 2, '사용자가 보낸 두 번만 띄운다 — 재시도 없음')
  })

  it('다시 로그인하면(reset) 다음 만료를 또 알린다', () => {
    const notice = createReloginNotice()
    const expired = { ok: false, stderr: 'Anthropic profile login expired' }
    assert.ok(notice.check('claude', expired))
    notice.reset('claude')
    assert.ok(notice.check('claude', expired))
  })

  it('만료가 아닌 실패와 성공은 안내하지 않는다', () => {
    const notice = createReloginNotice()
    assert.strictEqual(notice.check('codex', { ok: false, stderr: 'rate limited' }), null)
    assert.strictEqual(notice.check('codex', { ok: true, stdout: 'Login expired' }), null)
    assert.strictEqual(isAuthExpired('Not logged in'), true)
  })
})

describe('로그인·로그아웃은 사용자 터미널에서 연다', () => {
  it('문서에 적힌 명령만 낸다', () => {
    assert.strictEqual(loginCommand('claude'), 'claude auth login')
    assert.strictEqual(loginCommand('claude', { headless: true }), 'claude setup-token')
    assert.strictEqual(loginCommand('codex'), 'codex login')
    assert.strictEqual(loginCommand('codex', { headless: true }), 'codex login --device-auth')
    assert.strictEqual(logoutCommand('claude'), 'claude auth logout')
    assert.strictEqual(logoutCommand('codex'), 'codex logout')
  })

  it('macOS 에서는 Terminal 에 고정 명령을 넘기고 출력을 안 읽는다', async () => {
    const { spawn, calls } = fakeSpawn(() => ({ code: 0 }))
    await openInTerminal('codex login', { spawn, platform: 'darwin' })
    assert.strictEqual(calls[0].bin, 'osascript')
    assert.ok(calls[0].args.join(' ').includes('do script "codex login"'))
    assert.strictEqual(calls[0].opts.stdio, 'ignore')
  })

  it('목록에 없는 명령은 띄우지 않는다', async () => {
    const { spawn, calls } = fakeSpawn(() => ({ code: 0 }))
    await assert.rejects(openInTerminal('rm -rf ~', { spawn, platform: 'darwin' }), /열 수 없는 명령/)
    assert.strictEqual(calls.length, 0)
  })

  it('macOS 가 아니면 직접 실행하라고 안내한다', async () => {
    const { spawn, calls } = fakeSpawn(() => ({ code: 0 }))
    await assert.rejects(openInTerminal('claude auth login', { spawn, platform: 'linux' }), /직접 실행/)
    assert.strictEqual(calls.length, 0)
  })
})
