// 사이드바에 띄울 프로젝트 목록을 파일 하나에 담는다. 사용자가 고른 것만 들어간다.
//
// 전에는 `~/.claude.json` 의 projects 키를 통째로 읽었다. 그러면 한 번이라도 Claude Code 를
// 연 디렉터리가 전부 뜬다 — 실측(2026-09-02): 그 파일에 든 경로가 저장소·워크트리·임시
// 디렉터리를 가리지 않고 쌓여 있어서 사이드바가 목록이 아니라 이력이 됐다. 게다가 Codex 만
// 쓴 프로젝트는 거기 아예 없다(Codex 전사 기준 31곳 중 여럿이 그렇다). 그래서 고른 것만
// 담는 파일을 따로 둔다.
//
// 파일은 경로 문자열의 배열이다. 형태가 깨졌거나 파일이 없으면 빈 목록으로 본다 — 앱이
// 목록 파일 하나 때문에 안 뜨면 안 된다.
//
// 여기는 경로만 다룬다. 이름·문서 유무 같은 표시용 값은 desktop/app/main.mjs 가 얹는다
// (그쪽만 src/refs.mjs 를 읽는다).

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// 캐시가 `~/.harness-bro/cache` 에 있는 것과 같은 자리다(src/filecache.mjs). 제품 이름은
// askin 이지만 경로·환경변수는 harness-bro 를 그대로 둔다(결정 사항).
export const PROJECTS_FILE = process.env.ASKIN_PROJECTS_FILE ?? path.join(os.homedir(), '.harness-bro', 'projects.json')

export function readProjectPaths(file = PROJECTS_FILE) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((p) => typeof p === 'string' && p)
}

function writeProjectPaths(paths, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(paths, null, 2)}\n`)
}

// 실제로 디렉터리인 것만 낸다. 지웠거나 옮긴 프로젝트가 목록에 남아 있을 수 있는데, 그걸
// 클릭하면 harnessGraph() 가 빈 그래프를 조용히 낸다 — 없는 것은 아예 안 보이는 쪽이 맞다.
// 목록 파일에서 지우지는 않는다. 외장 디스크나 마운트가 잠깐 빠진 것일 수 있다.
export function listProjectPaths(file = PROJECTS_FILE) {
  return readProjectPaths(file).filter((p) => {
    try {
      return fs.statSync(p).isDirectory()
    } catch {
      return false
    }
  })
}

// 이미 있으면 다시 넣지 않는다. 추가한(또는 이미 있던) 경로를 절대경로로 돌려준다 —
// 부르는 쪽이 방금 추가한 항목을 목록에서 찾아 고를 수 있어야 한다.
export function addProjectPath(repoPath, file = PROJECTS_FILE) {
  const resolved = path.resolve(repoPath)
  const paths = readProjectPaths(file)
  if (!paths.includes(resolved)) {
    paths.push(resolved)
    writeProjectPaths(paths, file)
  }
  return resolved
}

export function removeProjectPath(repoPath, file = PROJECTS_FILE) {
  const resolved = path.resolve(repoPath)
  const paths = readProjectPaths(file)
  const next = paths.filter((p) => p !== resolved)
  if (next.length !== paths.length) writeProjectPaths(next, file)
  return next
}
