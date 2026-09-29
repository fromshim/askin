// 채팅 패널의 BYOS 인증(docs/_inbox/oauth-byos-plan.md Gate 2).
//
// askin 은 인증을 하지 않는다. 사용자가 설치한 claude·codex CLI 가 인증 주체이고, 여기서는
//   - CLI 에 "로그인돼 있나"를 묻고(detectStatus)
//   - 로그인·로그아웃 명령을 사용자 터미널에 열고(openInTerminal)
//   - 실행 전에 계정을 보여 주고 동의를 받고(createConsent, sendWithConsent)
//   - 만료가 보이면 재로그인 안내를 한 번만 내고(createReloginNotice)
//   - 사용자가 askin 에 직접 넣은 본인 API 키만 safeStorage 로 암호화해 둔다(createSecretStore).
// 벤더 CLI 의 자격 저장소는 읽지도 복사하지도 않는다. 토큰은 이 프로세스에 안 들어온다.
// askin 이 갱신을 시도하지 않는다 — 갱신하는 쪽은 벤더 CLI 하나뿐이다.
//
// Electron 에 안 묶인다. spawn·safeStorage·fs 는 주입받는다(runChat 과 같은 방식) — 테스트는
// mock 만 쓴다(test/oauth-safeStorage.test.mjs).
import nodeFs from 'node:fs'
import path from 'node:path'
import { spawn as defaultSpawn } from 'node:child_process'
import { runChat } from './coach.mjs'

export const PROVIDERS = Object.freeze(['claude', 'codex'])

function assertProvider(provider) {
  if (!PROVIDERS.includes(provider)) throw new Error(`지원하지 않는 provider: ${provider}`)
}

// ── 상태 ────────────────────────────────────────────────────────────────

// 상태 명령을 돌려 종료 코드와 출력만 받는다. CLI 가 없으면 missing, 오래 걸리면 끊는다.
function runStatus(bin, args, { spawn, env, timeoutMs }) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v) } }
    let child
    try {
      child = spawn(bin, args, { env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      done({ missing: err.code === 'ENOENT', code: null, stdout, stderr: err.message })
      return
    }
    const timer = setTimeout(() => { child.kill?.('SIGTERM'); done({ missing: false, code: null, stdout, stderr, timedOut: true }) }, timeoutMs)
    child.stdout?.on('data', (c) => { stdout += c })
    child.stderr?.on('data', (c) => { stderr += c })
    child.on('error', (err) => done({ missing: err.code === 'ENOENT', code: null, stdout, stderr: err.message }))
    child.on('close', (code) => done({ missing: false, code, stdout, stderr }))
  })
}

// 화면에만 쓰는 가린 이메일. 로그에는 이것도 안 남긴다.
export function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return null
  const [user, domain] = email.split('@')
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(2, user.length - 1))}@${domain}`
}

function parseClaude(res) {
  let json
  try {
    json = JSON.parse(res.stdout)
  } catch {
    return { loggedIn: false, method: null, plan: null, account: null, error: '상태를 읽지 못했어요' }
  }
  return {
    loggedIn: json.loggedIn === true,
    method: typeof json.authMethod === 'string' ? json.authMethod : null,
    plan: typeof json.subscriptionType === 'string' ? json.subscriptionType : null,
    account: maskEmail(json.email),
    error: null,
  }
}

function parseCodex(res) {
  const text = `${res.stdout}\n${res.stderr}`
  const m = /Logged in using ([^\n]+)/i.exec(text)
  const loggedIn = res.code === 0 && !/not logged in/i.test(text)
  return { loggedIn, method: m ? m[1].trim() : null, plan: null, account: null, error: null }
}

// claude auth status --json / codex login status 를 묻는다. 두 명령 모두 토큰 값은 안 낸다.
// 반환: { provider, installed, loggedIn, method, plan, account, error }
export async function detectStatus({ provider, spawn = defaultSpawn, env, timeoutMs = 10_000 }) {
  assertProvider(provider)
  const [bin, args] = provider === 'claude' ? ['claude', ['auth', 'status', '--json']] : ['codex', ['login', 'status']]
  const res = await runStatus(bin, args, { spawn, env, timeoutMs })
  if (res.missing) return { provider, installed: false, loggedIn: false, method: null, plan: null, account: null, error: null }
  if (res.timedOut) return { provider, installed: true, loggedIn: false, method: null, plan: null, account: null, error: '상태 확인이 너무 오래 걸려요' }
  const parsed = provider === 'claude' ? parseClaude(res) : parseCodex(res)
  return { provider, installed: true, ...parsed }
}

// askin 에 본인 키를 넣었으면 그 키가 실행에 쓰인다(claude 는 -p 에서 ANTHROPIC_API_KEY 를 늘
// 쓰고, codex exec 는 CODEX_API_KEY 를 쓴다). 화면이 구독 계정을 보여 주면 거짓이 된다.
export function effectiveStatus(status, { hasKey = false } = {}) {
  if (!hasKey || !status.installed) return { ...status, viaKey: false }
  return { ...status, loggedIn: true, method: 'askin 에 저장한 본인 API 키', plan: null, account: null, viaKey: true }
}

// 동의를 계정에 묶는 열쇠. 계정이나 방식이 바뀌면 다시 묻는다.
export function accountKey(status) {
  return `${status.provider}|${status.method ?? ''}|${status.plan ?? ''}|${status.account ?? ''}`
}

// 사람이 읽는 한 줄. 입력창 위에 쓴다.
export function statusLine(status) {
  const name = status.provider === 'claude' ? 'Claude Code' : 'Codex CLI'
  if (!status.installed) return `${name} 가 설치돼 있지 않아요`
  if (!status.loggedIn) return `${name} 에 로그인돼 있지 않아요`
  const how = [status.method, status.plan && `(${status.plan})`].filter(Boolean).join(' ')
  return `${[name, how, status.account].filter(Boolean).join(' · ')} 로 실행돼요`
}

// ── 로그인·로그아웃 명령 ────────────────────────────────────────────────

const LOGIN = {
  claude: { browser: 'claude auth login', headless: 'claude setup-token' },
  codex: { browser: 'codex login', headless: 'codex login --device-auth' },
}
const LOGOUT = { claude: 'claude auth logout', codex: 'codex logout' }
const ALLOWED_COMMANDS = new Set([...Object.values(LOGIN).flatMap((v) => Object.values(v)), ...Object.values(LOGOUT)])

export function loginCommand(provider, { headless = false } = {}) {
  assertProvider(provider)
  return LOGIN[provider][headless ? 'headless' : 'browser']
}

export function logoutCommand(provider) {
  assertProvider(provider)
  return LOGOUT[provider]
}

// 사용자 터미널에서 명령을 연다. 로그인 URL·붙여넣는 코드는 벤더 CLI 와 사용자 사이에서만 오간다 —
// askin 은 출력을 안 읽는다(stdio: ignore). 고정 명령만 받는다(사용자 입력을 AppleScript 에 안 넣는다).
export function openInTerminal(command, { spawn = defaultSpawn, platform = process.platform } = {}) {
  if (!ALLOWED_COMMANDS.has(command)) return Promise.reject(new Error(`열 수 없는 명령: ${command}`))
  if (platform !== 'darwin') {
    return Promise.reject(new Error(`이 OS 에서는 터미널을 열지 못해요. 터미널에서 직접 실행해 주세요: ${command}`))
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      'osascript',
      ['-e', `tell application "Terminal" to do script "${command}"`, '-e', 'tell application "Terminal" to activate'],
      { shell: false, stdio: 'ignore' },
    )
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve({ command }) : reject(new Error(`터미널을 열지 못했어요(종료 코드 ${code}). 직접 실행: ${command}`))))
  })
}

// ── 동의 ────────────────────────────────────────────────────────────────

// 창(프로세스)마다 메모리에만 둔다. 디스크에 안 쓴다. provider 마다 계정 열쇠와 함께 기억한다.
export function createConsent() {
  const state = new Map() // provider -> { key, value: 'granted' | 'declined' }
  return {
    get(provider, key) {
      const s = state.get(provider)
      return s && s.key === key ? s.value : 'ask'
    },
    grant(provider, key) { state.set(provider, { key, value: 'granted' }) },
    decline(provider, key) { state.set(provider, { key, value: 'declined' }) },
    revoke(provider) { state.delete(provider) },
  }
}

// 동의가 있을 때만 CLI 를 띄운다. 묻는 중이거나 거절했으면 spawn 을 한 번도 안 부른다.
export async function sendWithConsent({ provider, prompt, cwd, env, status, consent, spawn = defaultSpawn, run = runChat }) {
  const decision = consent.get(provider, accountKey(status))
  if (decision === 'declined') return { ok: false, declined: true, stdout: '', stderr: '' }
  if (decision !== 'granted') return { ok: false, needsConsent: true, stdout: '', stderr: '' }
  return run({ provider, prompt, cwd, env, spawn })
}

// ── 만료 → 재로그인 안내 한 번 ──────────────────────────────────────────

// Claude Code 문서의 만료 문구와 codex 의 로그인 요구 문구. askin 은 갱신을 시도하지 않는다.
const EXPIRED = [/Login expired/i, /profile login expired/i, /Please run \/login/i, /not logged in/i, /please (re-?)?login/i]

export function isAuthExpired(text) {
  return EXPIRED.some((re) => re.test(String(text ?? '')))
}

// 같은 provider 의 만료는 한 번만 알린다. 사용자가 로그인을 다시 열거나 상태가 로그인됨으로
// 돌아오면 reset 한다. 안내만 낸다 — 이 모듈은 실패한 요청을 다시 보내지 않는다.
export function createReloginNotice() {
  const shown = new Set()
  return {
    check(provider, result) {
      if (result?.ok) return null
      if (!isAuthExpired(`${result?.stderr ?? ''}\n${result?.stdout ?? ''}`)) return null
      if (shown.has(provider)) return null
      shown.add(provider)
      return { provider, command: loginCommand(provider), message: '로그인이 만료됐어요. 터미널에서 다시 로그인해 주세요.' }
    },
    reset(provider) { shown.delete(provider) },
  }
}

// ── 본인 API 키(BYOK) ───────────────────────────────────────────────────

const KEY_ENV = { claude: 'ANTHROPIC_API_KEY', codex: 'CODEX_API_KEY' }

// 자식 프로세스 env 에만 붙인다. 렌더러로는 안 간다.
export function keyEnv(provider, key, base = process.env) {
  assertProvider(provider)
  return { ...base, [KEY_ENV[provider]]: key }
}

// safeStorage 로 암호화한 값만 파일에 둔다. safeStorage 를 못 쓰거나(Linux basic_text 포함)
// 평문으로 떨어질 상황이면 저장을 거부한다(refuse). 파일에는 base64 암호문만 있다.
export function createSecretStore({ safeStorage, file, fs = nodeFs }) {
  function usable() {
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') return false
    if (!safeStorage.isEncryptionAvailable()) return false
    const backend = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : null
    return backend !== 'basic_text'
  }
  function read() {
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8'))
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    } catch {
      return {}
    }
  }
  function write(v) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(v), { mode: 0o600 })
  }
  return {
    usable,
    has(provider) {
      assertProvider(provider)
      return typeof read()[provider] === 'string'
    },
    set(provider, key) {
      assertProvider(provider)
      const k = typeof key === 'string' ? key.trim() : ''
      if (!k) throw new Error('빈 키는 저장하지 않아요')
      if (!usable()) throw new Error('refuse: 이 기기에서는 키를 안전하게 암호화할 수 없어 저장하지 않아요')
      const v = read()
      v[provider] = safeStorage.encryptString(k).toString('base64')
      write(v)
    },
    // 복호화는 main 이 실행 직전에만 부른다. 못 풀면 null — 평문 대안으로 떨어지지 않는다.
    get(provider) {
      assertProvider(provider)
      const enc = read()[provider]
      if (typeof enc !== 'string' || !usable()) return null
      try {
        return safeStorage.decryptString(Buffer.from(enc, 'base64'))
      } catch {
        return null
      }
    },
    clear(provider) {
      assertProvider(provider)
      const v = read()
      if (!(provider in v)) return
      delete v[provider]
      if (Object.keys(v).length) write(v)
      else fs.rmSync(file, { force: true })
    },
  }
}
