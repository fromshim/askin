// 하네스가 가리키는 것이 실재하는지 본다. 전사가 아니라 파일 시스템이 원천이다.
//
// 여기서도 사실만 모은다. "안 쓰이는 에이전트가 문제인가"는 축이 판정한다.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const HOME = os.homedir()

// 스킬은 세 곳에 산다. 저장소, 전역, 플러그인.
// 전역 스킬 98개 중 38개가 심링크라 존재 확인은 existsSync 로 해야 한다.
// readdirSync 의 isDirectory() 는 심링크를 디렉터리로 안 쳐서 60개만 잡힌다.
export function skillIndex(repo) {
  const index = new Map()
  const add = (name, hit) => {
    if (!index.has(name)) index.set(name, hit) // 앞선 것이 이긴다
  }

  const roots = [['global', path.join(HOME, '.claude', 'skills')]]
  if (repo) roots.unshift(['repo', path.join(repo, '.claude', 'skills')])
  for (const [scope, root] of roots) {
    for (const name of readdirNames(root)) {
      const full = path.join(root, name)
      // scope 를 남긴다. 전역에서 깨진 심링크가 저장소마다 보고되는데, 이름만
      // 주면 사람이 저장소 문제로 읽는다. 실측: 저장소 12곳 전부에서 같은 3건이 나왔다.
      add(name, { path: full, exists: fs.existsSync(full), scope })
    }
  }

  for (const { name, dir, plugin } of findPluginSkills()) {
    const hit = { path: dir, exists: fs.existsSync(dir), scope: 'plugin' }
    add(name, hit)
    // 전사는 플러그인 스킬을 `<플러그인>:<스킬>` 로도 부른다. 실측(2026-09-01): 실제로 불린
    // 스킬 25종 중 7종이 그 꼴이고, 짧은 이름만 넣어두면 전부 "못 찾음"이 된다.
    //
    // 별칭은 조회용이라 `alias` 를 달아 순회에서 빼야 한다. 안 그러면 깨진 심링크 하나가
    // 짧은 이름과 복합 이름으로 두 번 보고된다. danglingSkills 가 그 판정을 한 곳에서 한다.
    if (plugin) add(`${plugin}:${name}`, { ...hit, alias: true })
  }
  return index
}

// 플러그인 스킬은 배치가 한 가지가 아니다. 실측(2026-09-01) `~/.claude/plugins` 아래
// SKILL.md 173개 중 165개가 `<플러그인>/<버전>/skills/<스킬>/` 이고, 셋은 SKILL.md 가
// 버전 디렉터리 바로 아래 있는 스킬 하나짜리 플러그인이다(handoff, korean-tone, prompt-dna).
// 나머지 넷은 figma 의 `workflow-skills/` 인데 전사에서 불린 적이 없어 안 잡는다.
//
// 못 잡는 것이 하나 더 있다. `design`·`loop`·`artifact-*` 같은 내장 스킬은 파일 시스템에
// 없다. 실물이 임시 경로(`/private/tmp/.../bundled-skills/<버전>/`)라 재부팅하면 사라진다.
// 정적 목록을 박으면 Claude Code 가 올라갈 때마다 낡는다. 지금은 안 잡는 쪽을 골랐다.
// 관측된 피해가 없어서다. 에이전트 정의가 선언한 스킬이 0건이라 brokenSkillRefs 가
// 거짓 양성을 못 낸다. 하네스 연결 그래프를 그릴 때 다시 봐야 한다.
function findPluginSkills() {
  const out = []
  const base = path.join(HOME, '.claude', 'plugins')
  const walk = (dir, depth) => {
    if (depth > 5) return
    for (const e of readdirEntries(dir)) {
      if (!e.isDirectory()) continue
      const full = path.join(dir, e.name)
      const parts = path.relative(base, full).split(path.sep)
      // `cache/<마켓플레이스>/<플러그인>/...` 에서 세 번째가 플러그인 이름이다.
      // `marketplaces/<마켓플레이스>/skills/...` 에는 플러그인 층이 없어 별칭도 없다.
      const plugin = parts[0] === 'cache' && parts.length >= 3 ? parts[2] : null
      if (e.name === 'skills') {
        for (const name of readdirNames(full)) out.push({ name, dir: path.join(full, name), plugin })
        continue
      }
      // 스킬 하나짜리 플러그인. 그때 스킬 이름은 플러그인 이름이다(전사: `handoff:handoff`).
      if (plugin && parts.length === 4 && fs.existsSync(path.join(full, 'SKILL.md'))) {
        out.push({ name: plugin, dir: full, plugin })
      }
      walk(full, depth + 1)
    }
  }
  walk(base, 0)
  return out
}

// 에이전트 정의. frontmatter 만 읽는다.
export function agentDefs(repo) {
  const out = []
  for (const [scope, dir] of [
    ['repo', repo && path.join(repo, '.claude', 'agents')],
    ['global', path.join(HOME, '.claude', 'agents')],
  ]) {
    if (!dir) continue
    for (const file of readdirNames(dir)) {
      if (!file.endsWith('.md')) continue
      const full = path.join(dir, file)
      const fm = frontmatter(full)
      if (!fm) continue
      out.push({
        name: fm.name ?? file.slice(0, -3),
        scope,
        file: full,
        model: fm.model ?? null,
        skills: splitList(fm.skills),
      })
    }
  }
  return out
}

// 선언한 스킬이 실재하나. 문서의 "깨진 스킬 링크" 검사다.
export function brokenSkillRefs(repo) {
  const index = skillIndex(repo)
  const out = []
  for (const agent of agentDefs(repo)) {
    for (const skill of agent.skills) {
      const hit = index.get(skill)
      // 에이전트 scope 를 남긴다. 전역 에이전트의 깨진 선언은 저장소마다 반복
      // 보고되는데, 어디 것인지 안 말하면 이 저장소를 고치는 일로 읽힌다.
      const where = { agent: agent.name, scope: agent.scope, file: agent.file, skill }
      if (!hit) out.push({ ...where, reason: '그런 스킬이 없음' })
      else if (!hit.exists) out.push({ ...where, reason: `심링크가 깨짐 (${hit.path})` })
    }
  }
  return out
}

// 스킬 디렉터리 자체의 깨진 심링크. 아무도 선언하지 않았으면 무해하지만 알고는 있어야 한다.
export function danglingSkills(repo) {
  const out = []
  for (const [name, hit] of skillIndex(repo)) {
    // 별칭(`<플러그인>:<스킬>`)은 같은 디렉터리를 가리킨다. 안 거르면 깨진 심링크 하나가
    // 짧은 이름과 복합 이름으로 두 번 나온다.
    if (hit.alias) continue
    if (!hit.exists) {
      // 심링크가 무엇을 가리키다 깨졌는지 같이 낸다. 이름만 주면 어디를 고칠지 모른다.
      // 실측(2026-08-28): 전역 깨진 심링크 3건이 다 `~/.agents/skills/...` 를 가리키는데
      // 그 디렉터리가 없다. 실물은 org-a/org-a/.claude/skills/ 에 있다.
      let target = null
      try {
        target = fs.readlinkSync(hit.path)
      } catch {
        /* 심링크가 아니면 대상이 없다 */
      }
      out.push({ skill: name, path: hit.path, scope: hit.scope, target })
    }
  }
  return out
}

// 문서가 가리키는 경로가 실재하나.
// 백틱 안의 토큰만 본다. 산문에서 뽑으면 거짓 양성이 감당이 안 된다.
//
// 저장소 뿌리에서만 재면 안 된다. 모노레포라 문서마다 기준점이 다르다.
// `app/_components/` 는 실재하지만 `apps/web/app/_components/` 에 있다.
// 그래서 git 이 아는 파일 목록에 대고 꼬리 일치로 본다.
export function deadPaths(repo, docs = harnessDocs(repo)) {
  const tracked = trackedPaths(repo)
  const deps = dependencyNames(repo)
  const out = []
  for (const doc of docs) {
    let text
    try {
      text = fs.readFileSync(doc, 'utf8')
    } catch {
      continue
    }
    // 토큰과 그 토큰이 처음 나온 줄을 한 번에 모은다.
    //
    // 전에는 토큰마다 `lines.findIndex` 로 문서를 처음부터 훑었다. 문서가 커질수록
    // 제곱으로 는다. 실측(2026-08-28): 고유 토큰 2만 개짜리 문서 하나에 2.6초였다.
    // 백틱 안에는 줄바꿈이 못 들어가니 줄 단위로 모아도 같은 토큰이 나온다.
    const first = new Map()
    text.split('\n').forEach((line, i) => {
      for (const raw of line.match(/`[^`\n]+`/g) ?? []) if (!first.has(raw)) first.set(raw, [i + 1, line.trim()])
    })
    for (const [raw, [lineNumber, line]] of first) {
      const token = raw.slice(1, -1).trim()
      const target = pathLike(token)
      if (!target) continue
      // next/image 처럼 의존성의 하위 경로는 파일이 아니다
      if (deps.has(target.split('/')[0])) continue
      // 고칠 사람은 토큰만 보고는 지울지 고칠지 못 정한다. 원문 줄을 같이 준다.
      const where = { doc, token, line, lineNumber }
      if (target.startsWith('/')) {
        if (!fs.existsSync(target)) out.push({ ...where, how: '절대 경로가 없음' })
        continue
      }
      if (fs.existsSync(path.join(repo ?? '.', target))) continue
      if (!tracked || !matchesTracked(tracked, target)) {
        out.push({ ...where, how: tracked ? 'git 이 아는 경로 어디에도 없음' : '뿌리에서 찾을 수 없음' })
      }
    }
  }
  return out
}

// 저장소에 실재하는 경로 전부.
//
// git 목록만으로는 부족하다. `docs/_inbox/` 처럼 .gitignore 에 걸린 것도 실재한다.
// 파일 시스템도 걷되 node_modules 와 빌드 산출물은 뺀다.
// 실측: git 이 아는 것 531개, 실제 파일 10,454개.
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo', '.venv'])

function trackedPaths(repo) {
  if (!repo) return null
  const paths = new Set()
  try {
    const out = execFileSync('git', ['-C', repo, 'ls-files'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      // git 에러 원문이 리포트 위로 새면 도구가 고장난 것처럼 보인다. 아래 catch 가 이미 처리한다
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    for (const p of out.split('\n')) if (p) paths.add(p)
  } catch {
    /* git 저장소가 아닐 수 있다 */
  }
  const walk = (dir, rel) => {
    for (const e of readdirEntries(dir)) {
      if (SKIP_DIRS.has(e.name)) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      paths.add(r)
      if (e.isDirectory()) walk(path.join(dir, e.name), r)
    }
  }
  walk(repo, '')
  return paths.size ? [...paths] : null
}

function matchesTracked(tracked, target) {
  const needle = `/${target}`
  return tracked.some((p) => p === target || p.startsWith(`${target}/`) || p.includes(`${needle}/`) || p.endsWith(needle))
}

// 모노레포라 루트 package.json 에 없는 의존성이 많다. next 가 그랬다.
// package.json 이 10개 있고 next 는 apps/web 쪽에만 있다.
function dependencyNames(repo) {
  const names = new Set()
  if (!repo) return names
  const walk = (dir, depth) => {
    if (depth > 3) return
    for (const e of readdirEntries(dir)) {
      if (SKIP_DIRS.has(e.name)) continue
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1)
      else if (e.name === 'package.json') {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(dir, e.name), 'utf8'))
          for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
            for (const name of Object.keys(pkg[field] ?? {})) names.add(name)
          }
        } catch {
          /* 깨진 package.json 은 넘어간다 */
        }
      }
    }
  }
  walk(repo, 0)
  return names
}

// 경로처럼 생겼는가. 아니면 null.
// 여기가 이 검사의 전부다. 너무 느슨하면 거짓 양성에 묻히고 너무 빡빡하면 못 잡는다.
//
// 처음엔 파일명만 있어도 통과시켰더니 후보가 139건 나왔고 대부분이 거짓이었다.
// `Foo.tsx` 같은 건 저장소 어딘가를 가리키는 언급이지 뿌리에서 잰 경로가 아니다.
// 그건 다른 검사(예시 코드의 심볼이 저장소에 있나) 몫이라 여기서 뺀다.
export function pathLike(token) {
  if (/\s/.test(token)) return null // 명령줄이나 문장
  if (/^https?:|^[a-z]+:\/\//i.test(token)) return null // URL
  if (/[*<>{}()|$?[\]]/.test(token)) return null // 글롭, 자리표시자, 코드 조각, 대안 표기
  if (/YYYY|MM-DD|\bslug\b|\bNN\b|\.\.\./.test(token)) return null // 템플릿
  if (token.startsWith('@')) return null // @core/api 같은 tsconfig 별칭이나 스코프 패키지

  const stripped = token.replace(/:\d+(-\d+)?$/, '').replace(/\/$/, '') // 줄번호와 끝 슬래시를 뗀다
  if (!stripped.includes('/')) return null // 디렉터리 구분이 없으면 경로로 안 본다
  if (/^\/[^/]+$/.test(stripped)) return null // /daily 같은 슬래시 명령
  if (/^[\w.-]+\/\d+$/.test(stripped)) return null // text-body-1/2 같은 토큰

  if (stripped.startsWith('~/')) return path.join(HOME, stripped.slice(2))
  return stripped
}

export function harnessDocs(repo) {
  // 전역 CLAUDE.md 도 있는지 본다. 나머지 항목은 전부 existsSync 로 거르는데 이 줄만
  // 빠져 있었다. 남의 기계에는 그 파일이 없을 수 있다. 실측(2026-08-28): 빈 홈에서
  // 문서 목록에 없는 파일 1개가 담겨, 읽지도 못한 채 "죽은 경로 0건" 이 나왔다.
  const globalDoc = path.join(HOME, '.claude', 'CLAUDE.md')
  const out = fs.existsSync(globalDoc) ? [globalDoc] : []
  if (repo) {
    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      const p = path.join(repo, name)
      if (fs.existsSync(p)) out.push(p)
    }
    for (const a of agentDefs(repo)) if (a.scope === 'repo') out.push(a.file)
  }
  return out
}

function frontmatter(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  if (!text.startsWith('---')) return null
  const end = text.indexOf('\n---', 3)
  if (end === -1) return null
  const out = {}
  let key = null
  for (const line of text.slice(4, end).split('\n')) {
    const m = line.match(/^([a-zA-Z_-]+):\s*(.*)$/)
    if (m) {
      key = m[1]
      out[key] = m[2].trim()
    } else if (key && line.trim()) {
      // YAML 목록과 접힌 값을 가른다.
      //
      // `- item` 줄은 항목이지 이어지는 문장이 아니다. 공백으로 이으면
      // skills 가 통째로 스킬 이름 하나가 된다. 실측(2026-08-28): 남의 하네스 모양으로
      // 만들어보니 `- pluginskill - missingskill (없음)` 이 없는 스킬로 보고됐다.
      // 선언 둘을 못 읽고 있지도 않은 것 하나를 만들어냈다.
      const item = line.trim().match(/^-\s+(.*)$/)
      if (item) out[key] = out[key] ? `${out[key]}, ${item[1]}` : item[1]
      else out[key] += ' ' + line.trim()
    }
  }
  return out
}

function splitList(v) {
  if (!v || v === '>' || v === '|') return []
  return v
    .split(',')
    // 목록 항목은 따옴표로 감싸기도 한다. `- "foo"` 가 `"foo"` 라는 이름이 되면 안 된다.
    .map((s) => s.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .filter(Boolean)
}

function readdirNames(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function readdirEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}
