// 첫 설치 안내. askin 은 이 Mac 에 이미 있는 것(Claude Code 전사, git, CLI 로그인)을 읽기만 하는
// 앱이라, 그것들이 없으면 화면이 비어 보인다. 무엇이 준비됐고 무엇이 없는지를 한 목록으로 낸다.
//
// 사실 모으기(main 이 부른다)와 목록 만들기(순수 함수)를 가른다. 목록 만들기는
// test/setup.test.mjs 가 잰다. git 은 부르지 않는다 — Xcode 개발 도구가 없는 Mac 에서
// /usr/bin/git 을 부르면 macOS 가 설치 창을 띄운다. 대신 xcode-select -p 로 도구가 깔렸는지만 본다.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// PATH 에서 실행 파일을 찾는다. 실행하지 않는다.
export function findOnPath(bin, pathValue, { isExecutable = defaultIsExecutable } = {}) {
  for (const dir of String(pathValue ?? '').split(':')) {
    if (!dir) continue
    const p = path.join(dir, bin)
    if (isExecutable(p)) return p
  }
  return null
}

function defaultIsExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function countDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).length
  } catch {
    return 0
  }
}

// /usr/bin/git 은 Xcode 개발 도구의 대리 실행 파일이다. 도구가 없으면 진짜 git 이 아니다.
function gitFact({ pathValue, platform, run = spawnSync, isExecutable } = {}) {
  const gitPath = findOnPath('git', pathValue, isExecutable ? { isExecutable } : undefined)
  if (!gitPath) return { ok: false, path: null }
  if (platform === 'darwin' && gitPath === '/usr/bin/git') {
    const r = run('xcode-select', ['-p'], { stdio: 'ignore', timeout: 3000 })
    return { ok: r.status === 0, path: gitPath, needsDevTools: r.status !== 0 }
  }
  return { ok: true, path: gitPath }
}

// main 이 부른다. claude·codex 상태는 이미 쓰는 detectStatus 결과를 받는다(두 번 안 묻는다).
export function gatherFacts({ claudeRoot, codexRoot, pathValue = process.env.PATH, platform = process.platform, claude, codex, run, isExecutable }) {
  return {
    claudeProjects: countDirs(claudeRoot),
    codexHistory: countDirs(codexRoot) > 0,
    git: gitFact({ pathValue, platform, run, isExecutable }),
    claude: { installed: !!claude?.installed, loggedIn: !!claude?.loggedIn },
    codex: { installed: !!codex?.installed, loggedIn: !!codex?.loggedIn },
  }
}

const DOCS = {
  claude: 'https://code.claude.com/docs/en/setup',
  codex: 'https://developers.openai.com/codex/cli',
  devTools: 'xcode-select --install',
}

// 목록. level: required(없으면 레포트가 빈다) · recommended(판정 일부가 빠진다) · optional(채팅 등).
// action 은 렌더러가 버튼으로 그린다. kind: login(터미널 로그인) · link(허용된 문서 주소).
export function setupChecklist(f) {
  const items = [
    {
      id: 'claude-history',
      level: 'required',
      ready: f.claudeProjects > 0,
      title: 'Claude Code 작업 기록',
      detail: f.claudeProjects > 0
        ? `프로젝트 ${f.claudeProjects}곳의 기록을 찾았어요`
        : 'askin 은 Claude Code 가 남긴 기록(~/.claude/projects)을 읽어요. Claude Code 로 작업을 한 번 하면 여기가 채워져요',
    },
    {
      id: 'git',
      level: 'recommended',
      ready: f.git.ok,
      title: 'git',
      detail: f.git.ok
        ? '문서가 가리키는 경로가 실제로 있는지 git 으로 확인해요'
        : f.git.needsDevTools
          ? 'Xcode 개발 도구가 없어요. 터미널에서 `xcode-select --install` 을 실행하면 git 이 생겨요. 없으면 "없는 경로" 판정만 빠져요'
          : 'git 을 못 찾았어요. 없으면 "없는 경로" 판정만 빠져요',
    },
    {
      id: 'claude-cli',
      level: 'optional',
      ready: f.claude.installed && f.claude.loggedIn,
      title: '채팅: Claude Code CLI',
      detail: !f.claude.installed
        ? '채팅 패널에서 고치려면 claude CLI 가 필요해요. 레포트만 볼 거면 없어도 돼요'
        : f.claude.loggedIn ? '로그인돼 있어요. 실행 전에 어느 계정인지 한 번 더 보여 드려요' : '설치돼 있지만 로그인이 필요해요',
      action: !f.claude.installed ? { kind: 'link', label: '설치 안내', url: DOCS.claude }
        : !f.claude.loggedIn ? { kind: 'login', label: '터미널에서 로그인', provider: 'claude' } : null,
    },
    {
      id: 'codex-cli',
      level: 'optional',
      ready: f.codex.installed && f.codex.loggedIn,
      title: '채팅: Codex CLI',
      detail: !f.codex.installed
        ? 'Codex 로 고치고 싶을 때만 필요해요'
        : f.codex.loggedIn ? '로그인돼 있어요' : '설치돼 있지만 로그인이 필요해요',
      action: !f.codex.installed ? { kind: 'link', label: '설치 안내', url: DOCS.codex }
        : !f.codex.loggedIn ? { kind: 'login', label: '터미널에서 로그인', provider: 'codex' } : null,
    },
    {
      id: 'codex-history',
      level: 'optional',
      ready: f.codexHistory,
      title: 'Codex 작업 기록',
      detail: f.codexHistory ? 'Codex 기록도 그래프에 같이 그려요' : 'Codex 를 안 쓰면 없어도 돼요',
    },
  ]
  return { items, needsAttention: items.some((i) => i.level === 'required' && !i.ready) }
}

// 렌더러가 열어도 되는 외부 주소. 이 목록 밖은 안 연다.
export const SETUP_LINKS = Object.freeze([DOCS.claude, DOCS.codex])

// "처음인가". userData 아래 작은 파일 하나. 비밀이 아니다.
export function readSeen(file, { fsImpl = fs } = {}) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'))?.seen === true
  } catch {
    return false
  }
}

export function markSeen(file, { fsImpl = fs, now = () => new Date().toISOString() } = {}) {
  fsImpl.mkdirSync(path.dirname(file), { recursive: true })
  fsImpl.writeFileSync(file, JSON.stringify({ seen: true, at: now() }))
}
