// Finder·Dock 으로 띄운 macOS 앱은 셸 설정을 안 읽는다. PATH 가 /usr/bin:/bin:/usr/sbin:/sbin
// 뿐이라 ~/.local/bin 의 claude·codex, /opt/homebrew/bin 의 git 을 못 찾는다.
// 실측(2026-09-29): 그 PATH 로 띄우니 설치된 claude 를 "설치돼 있지 않아요"라고 했다.
//
// 그래서 main 이 뜰 때 한 번, 사용자의 로그인 셸에 PATH 를 물어 지금 PATH 와 합친다(VS Code 와
// 같은 방식). 셸이 느리거나 망가져 있으면 제한 시간 뒤 포기하고, 흔한 설치 위치 중 실제로
// 있는 것만 뒤에 붙인다. 순수 함수라 exec·existsSync 를 주입받는다(test/shell-path.test.mjs).
import os from 'node:os'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const MARK = '__ASKIN_PATH__'

// claude 네이티브 설치(~/.local/bin), 옛 claude 로컬 설치(~/.claude/local), Homebrew(arm·intel),
// npm 전역·bun·volta. 없는 폴더는 안 붙인다.
export function fallbackDirs(home) {
  return [
    `${home}/.local/bin`,
    `${home}/.claude/local`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    `${home}/.npm-global/bin`,
    `${home}/.bun/bin`,
    `${home}/.volta/bin`,
  ]
}

// 로그인 셸의 PATH. rc 파일이 찍는 인사말·경고 사이에서 표식으로 감싼 값만 뽑는다.
export function loginShellPath({ shell, exec = execFileSync, timeoutMs = 3000 } = {}) {
  if (!shell) return null
  try {
    const out = exec(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const m = new RegExp(`${MARK}([^\\n]*?)${MARK}`).exec(String(out))
    return m && m[1] ? m[1] : null
  } catch {
    return null // 시간 초과·셸 없음·rc 오류. 뒤의 기본 위치로 버틴다
  }
}

// 앞에 나온 것이 이긴다. 빈 칸과 중복은 뺀다.
export function mergePath(...lists) {
  const seen = new Set()
  const out = []
  for (const list of lists) {
    const parts = Array.isArray(list) ? list : String(list ?? '').split(':')
    for (const p of parts) {
      if (!p || seen.has(p)) continue
      seen.add(p)
      out.push(p)
    }
  }
  return out.join(':')
}

export function resolvedPath({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  exec = execFileSync,
  existsSync = fs.existsSync,
} = {}) {
  if (platform === 'win32') return env.PATH ?? ''
  const login = loginShellPath({ shell: env.SHELL || '/bin/zsh', exec })
  // 지금 PATH 가 앞이다 — 사용자가 일부러 앞에 둔 것(테스트의 mock 폴더 포함)을 로그인 셸 값이
  // 덮지 않게. Finder 로 뜬 앱은 지금 PATH 에 claude 가 없으니 뒤의 로그인 셸 값에서 찾는다.
  return mergePath(env.PATH, login, fallbackDirs(home).filter((d) => existsSync(d)))
}
