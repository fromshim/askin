// 경로 판별이 이 검사의 전부다. 느슨하면 거짓 양성에 묻히고 빡빡하면 못 잡는다.
// 실측으로 걸러낸 거짓 양성들을 여기 고정한다. 139건에서 12건까지 줄인 근거다.
//   node --test test/refs.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { pathLike, deadPaths, skillIndex, danglingSkills, brokenSkillRefs } from '../src/refs.mjs'
import { measure, shortProject } from '../src/report.mjs'
import { isTempProject } from '../src/scan.mjs'

test('경로로 봐야 하는 것', () => {
  assert.equal(pathLike('lib/errors.ts'), 'lib/errors.ts')
  assert.equal(pathLike('docs/_inbox/scratch/'), 'docs/_inbox/scratch') // 끝 슬래시를 뗀다
  assert.equal(pathLike('CLAUDE.md:9'), null) // 디렉터리가 없으면 경로로 안 본다
  assert.equal(pathLike('~/.claude/CLAUDE.md:9'), `${os.homedir()}/.claude/CLAUDE.md`)
  assert.equal(pathLike('/Users/other/git/org-a/org-a/.docs/PRD.md'), '/Users/other/git/org-a/org-a/.docs/PRD.md')
})

test('경로가 아닌 것', () => {
  assert.equal(pathLike('/daily'), null) // 슬래시 명령
  assert.equal(pathLike('console.log'), null) // 코드 식별자
  assert.equal(pathLike('text-body-1/2'), null) // 타이포 토큰
  assert.equal(pathLike('@core/api/thread.ts'), null) // tsconfig 별칭
  assert.equal(pathLike('docs/_inbox/YYYY-MM-DD-slug.md'), null) // 자리표시자
  assert.equal(pathLike('apps/web/app/_components/ui|layout/'), null) // 대안 표기
  assert.equal(pathLike('.claude/workflows/*.js'), null) // 글롭
  assert.equal(pathLike('https://example.com/a/b'), null) // URL
  assert.equal(pathLike('createRequire(cwd/package.json)'), null) // 코드 조각
  assert.equal(pathLike('Foo.tsx'), null) // 디렉터리 없는 파일명은 다른 검사 몫
})

test('죽은 경로는 몇 번째 줄인지와 원문을 같이 준다', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-refs-'))
  fs.mkdirSync(path.join(repo, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'lib', 'here.ts'), '')
  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    ['# 규칙', '', '- 시간은 `lib/here.ts` 를 쓴다', '- 오류는 `lib/gone.ts` 를 쓴다', ''].join('\n'),
  )

  const found = deadPaths(repo, [path.join(repo, 'CLAUDE.md')])
  assert.equal(found.length, 1) // 실재하는 lib/here.ts 는 안 잡힌다
  assert.equal(found[0].token, 'lib/gone.ts')
  assert.equal(found[0].lineNumber, 4)
  assert.equal(found[0].line, '- 오류는 `lib/gone.ts` 를 쓴다')
})

test('표본이 없으면 0% 가 아니라 판정 불가다', () => {
  const axis = {
    id: 'x',
    label: 'x',
    rule: 'x',
    source: 'agents',
    precondition: (s) => s.delegations.length > 0,
    unavailable: '표본 없음',
    scope: () => true,
    violation: (a) => a.calls === 0,
  }
  const empty = measure({ delegations: [], agents: [{ name: 'a', calls: 0 }] }, [axis])
  assert.equal(empty[0].rate, null)
  assert.equal(empty[0].unavailable, '표본 없음')

  const some = measure({ delegations: [{ agentType: 'b' }], agents: [{ name: 'a', calls: 0 }] }, [axis])
  assert.equal(some[0].rate, 0) // 표본이 있으면 진짜로 0% 다
  assert.equal(some[0].unavailable, undefined)
})

test('임시 디렉터리는 프로젝트가 아니다', () => {
  // Claude Code 가 자기 스크래치패드에서 세션을 열면 그게 프로젝트로 잡힌다.
  // 실측에서 위임 1건짜리 스크래치패드가 준수율 0% 짜리 프로젝트로 끼어 있었다.
  assert.equal(isTempProject('-private-tmp-claude-501-x-scratchpad'), true)
  assert.equal(isTempProject('-tmp-foo'), true)
  assert.equal(isTempProject('-var-folders-ab-cd'), true)
  // 경로 안에 tmp 가 들어 있을 뿐인 진짜 프로젝트는 남긴다
  assert.equal(isTempProject('-Users-me-Projects-tmp-experiment'), false)
  assert.equal(isTempProject('-Users-me-Projects-real'), false)
})

test('몰린 곳은 건수와 분모를 같이 준다', () => {
  // 건수만 보이면 큰 프로젝트가 늘 앞에 온다.
  // 40건 중 6건과 566건 중 8건은 다른 얘기다.
  const rows = [
    ...Array(40).fill(0).map((_, i) => ({ project: 'small', agentType: 'x', model: i < 6 ? null : 'sonnet' })),
    ...Array(566).fill(0).map((_, i) => ({ project: 'big', agentType: 'x', model: i < 8 ? null : 'sonnet' })),
  ]
  const [m] = measure({ delegations: rows }, undefined, (r) => r.project)
  const small = m.concentration.find((c) => c.key === 'small')
  const big = m.concentration.find((c) => c.key === 'big')
  assert.deepEqual({ count: small.count, of: small.of }, { count: 6, of: 40 })
  assert.deepEqual({ count: big.count, of: big.of }, { count: 8, of: 566 })
  assert.ok(small.rate > big.rate) // 비율로는 작은 쪽이 더 나쁘다
})

test('worktree 슬러그를 사람이 읽을 만큼 줄인다', () => {
  assert.equal(
    shortProject('-Users-me-Projects-work-org-a-app-a--orca-workspaces-app-a-feat-monorepo-step-a'),
    'work-org-a-app-a (worktree a-feat-monorepo-step-a)',
  )
  assert.equal(shortProject('-Users-me-Projects-fromshim-korean-tone'), 'fromshim-korean-tone')
})

test('스킬과 에이전트가 어디 것인지 말한다', () => {
  // 전역에서 깨진 심링크가 저장소마다 보고된다. 실측: 저장소 12곳 전부에서 같은 3건.
  // 이름만 주면 사람이 이 저장소를 고치는 일로 읽는다.
  for (const hit of skillIndex(null).values()) {
    assert.ok(['repo', 'global', 'plugin'].includes(hit.scope), `scope 가 없다: ${hit.path}`)
  }
  for (const d of danglingSkills(null)) assert.ok(d.scope, `깨진 심링크에 scope 가 없다: ${d.skill}`)
  for (const b of brokenSkillRefs(null)) assert.ok(b.scope, `깨진 선언에 scope 가 없다: ${b.agent}`)
})

test('플러그인 스킬을 <플러그인>:<스킬> 로도 찾는다', () => {
  // 전사는 스킬을 두 이름으로 부른다. 짧은 이름만 넣어두면 복합 이름이 전부 못 찾음이 된다.
  // 실측(2026-09-01): 실제로 불린 스킬 25종 중 7종이 복합 이름이었고, 별칭을 넣기 전에는
  // skillIndex 가 25종 중 7종만 찾았다. 넣고 나서 14종이 됐다.
  const index = skillIndex(null)
  const aliases = [...index].filter(([, hit]) => hit.alias)
  for (const [name, hit] of aliases) {
    assert.ok(name.includes(':'), `별칭에 콜론이 없다: ${name}`)
    const short = name.slice(name.indexOf(':') + 1)
    assert.ok(index.has(short), `별칭만 있고 짧은 이름이 없다: ${name}`)
    assert.equal(index.get(short).path, hit.path, `${name} 과 ${short} 가 다른 곳을 가리킨다`)
  }
})

test('별칭이 깨진 심링크를 두 번 보고하지 않는다', () => {
  // 별칭은 정본과 같은 디렉터리를 가리킨다. danglingSkills 가 인덱스를 순회하므로
  // 안 거르면 깨진 심링크 하나가 짧은 이름과 복합 이름으로 두 번 나온다.
  const dangling = danglingSkills(null)
  const paths = dangling.map((d) => d.path)
  assert.equal(paths.length, new Set(paths).size, `같은 경로가 여러 번 보고된다: ${paths.join(', ')}`)
  for (const d of dangling) assert.ok(!d.skill.includes(':'), `별칭이 순회에 섞였다: ${d.skill}`)
})

test('스킬 하나짜리 플러그인도 인덱스에 든다', () => {
  // SKILL.md 가 skills/ 하위가 아니라 버전 디렉터리 바로 아래 있는 배치가 있다.
  // 실측(2026-09-01): SKILL.md 173개 중 셋이 그렇다(handoff, korean-tone, prompt-dna).
  // skills/ 만 보던 때는 이것들이 통째로 빠졌다.
  const index = skillIndex(null)
  for (const [name, hit] of index) {
    if (hit.alias || hit.scope !== 'plugin' || !hit.exists) continue
    // 인덱스에 든 플러그인 스킬은 자기 디렉터리에 SKILL.md 를 갖고 있어야 한다.
    assert.ok(
      fs.existsSync(path.join(hit.path, 'SKILL.md')),
      `SKILL.md 가 없는데 스킬로 잡혔다: ${name} (${hit.path})`,
    )
  }
})

test('세션 표본이 창을 넘는 정도를 센다', () => {
  // 세션은 창과 겹치면 잡는데 그 집계는 세션 전체 기간 값이다. 창으로 안 잘린다.
  // 실측(2026-08-27): 하루 창에 위임은 4건으로 좁혀지는데 턴은 838 이 그대로 들어왔다.
  // 창 밖으로 뻗는 세션이 하루 100%, 한 주 56%, 30일 8% 고 그 턴 몫이 100/87/25% 다.
  //
  // ROOT 는 모듈 상수라 프로세스를 새로 띄워야 바꿀 수 있다.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-span-'))
  const dir = path.join(root, '-Users-x-Projects-demo')
  fs.mkdirSync(dir, { recursive: true })
  const write = (id, start, end, turns) => {
    const lines = [
      JSON.stringify({ timestamp: start, cwd: '/Users/x/Projects/demo' }),
      ...Array.from({ length: turns }, () => JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 1 })),
      JSON.stringify({ timestamp: end, cwd: '/Users/x/Projects/demo' }),
    ]
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.join('\n') + '\n')
  }
  // 창 안에 든 세션 하나(턴 10), 창 밖으로 뻗는 세션 하나(턴 90)
  write('11111111-1111-1111-1111-111111111111', '2026-08-01T01:00:00Z', '2026-08-01T02:00:00Z', 10)
  write('22222222-2222-2222-2222-222222222222', '2026-07-01T01:00:00Z', '2026-08-05T02:00:00Z', 90)

  const run = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, ['src/report.mjs', '--all', '--json', '--no-cache', ...args], {
        encoding: 'utf8',
        env: { ...process.env, HARNESS_BRO_ROOT: root, HARNESS_BRO_STORE: path.join(root, 'snap.jsonl') },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ).scope

  const win = run('--since', '2026-08-01', '--until', '2026-08-02')
  assert.equal(win.sessions, 2) // 둘 다 창과 겹친다
  assert.equal(win.spanningSessions, 1) // 하나가 창 밖으로 뻗는다
  assert.equal(Math.round(win.spanningTurnShare * 100), 90) // 턴 90 / 100

  const all = run('--all-time')
  assert.equal(all.spanningSessions, 0) // 창이 없으면 뻗는 게 없다
  assert.equal(all.spanningTurnShare, 0)
})

test('깨진 심링크는 무엇을 가리키다 깨졌는지 낸다', () => {
  // 이름만 주면 어디를 고칠지 모른다. 실측(2026-08-28): 전역 깨진 심링크 3건이 다
  // `~/.agents/skills/...` 를 가리키는데 그 디렉터리가 없다. 실물은 옆 저장소에 있었다.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-link-'))
  const skills = path.join(repo, '.claude', 'skills')
  fs.mkdirSync(skills, { recursive: true })
  fs.symlinkSync('../../.nowhere/gone', path.join(skills, 'broken'))
  fs.mkdirSync(path.join(skills, 'alive'))

  const found = danglingSkills(repo).filter((d) => d.scope === 'repo')
  const broken = found.find((d) => d.skill === 'broken')
  assert.ok(broken, '깨진 심링크를 안 잡았다')
  assert.equal(broken.target, '../../.nowhere/gone')
  assert.equal(
    found.find((d) => d.skill === 'alive'),
    undefined,
  )
})

// 실측(2026-08-28, 빈 홈): 전역 CLAUDE.md 만 있는지 확인 없이 목록에 담고 있었다.
// 나머지 항목은 전부 existsSync 로 거른다. 없는 파일을 문서로 세면 읽지도 못한 채
// "죽은 경로 0건" 이 나오고 "비교할 문서가 1개뿐이다" 가 0개인데 1개라고 한다.
test('없는 전역 문서를 문서로 세지 않는다', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-home-'))
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-repo-'))
  const realHome = process.env.HOME
  try {
    process.env.HOME = empty
    // HOME 은 모듈이 읽을 때 굳는다. 자식 프로세스로 재야 실제 경로가 바뀐다.
    const out = execFileSync(process.execPath, ['-e', `
      import('${pathToFileURL(path.join(process.cwd(), 'src/refs.mjs')).href}').then((m) =>
        console.log(JSON.stringify(m.harnessDocs('${repo}'))))
    `], { encoding: 'utf8', env: { ...process.env, HOME: empty } })
    assert.deepEqual(JSON.parse(out), [])
  } finally {
    process.env.HOME = realHome
  }
})

// 실측(2026-08-28): 남의 하네스 모양으로 만들어보니 YAML 목록으로 쓴 skills 가
// 통째로 스킬 이름 하나가 됐다. `- pluginskill - missingskill (없음)` 이 없는 스킬로
// 보고되고, 선언 둘은 아예 안 세어졌다. 3건 중 2건 위반이 4건 중 2건으로 고쳐졌다.
test('skills 를 YAML 목록으로 써도 읽는다', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-yaml-'))
  fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true })
  fs.writeFileSync(
    path.join(repo, '.claude', 'agents', 'a.md'),
    '---\nname: reviewer\nskills:\n  - alpha\n  - "beta"\n---\nbody\n',
  )
  fs.writeFileSync(path.join(repo, '.claude', 'agents', 'b.md'), '---\nname: two\nskills: gamma, delta\n---\nbody\n')

  const broken = brokenSkillRefs(repo).map((b) => `${b.agent}:${b.skill}`)
  // 넷을 각각 센다. 없는 스킬이니 넷 다 잡힌다
  assert.deepEqual(broken.sort(), ['reviewer:alpha', 'reviewer:beta', 'two:delta', 'two:gamma'])
  // 따옴표는 이름의 일부가 아니다
  assert.equal(broken.some((b) => b.includes('"')), false)
})

test('접힌 여러 줄 값은 그대로 잇는다', () => {
  // `- ` 로 시작하지 않는 줄은 이어지는 문장이다. 목록 처리가 그걸 깨면 안 된다.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-fold-'))
  fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true })
  fs.writeFileSync(
    path.join(repo, '.claude', 'agents', 'a.md'),
    '---\nname: folded\nskills: alpha,\n  beta\n---\nbody\n',
  )
  assert.deepEqual(brokenSkillRefs(repo).map((b) => b.skill).sort(), ['alpha', 'beta'])
})

// 토큰마다 문서를 처음부터 훑고 있었다. 문서가 커질수록 제곱으로 는다.
// 실측(2026-08-28): 고유 토큰 2만 개짜리 문서 하나에 2585ms → 46ms.
test('큰 문서에서 죽은 경로가 제곱으로 느려지지 않는다', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-big-'))
  const lines = []
  for (let i = 0; i < 20000; i++) lines.push(`- see \`src/mod${i}/file.ts\` here`)
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), `# big\n${lines.join('\n')}`)

  const t = Date.now()
  const dead = deadPaths(repo, [path.join(repo, 'AGENTS.md')])
  const ms = Date.now() - t
  assert.equal(dead.length, 20000)
  // 46ms 로 쟀다. 제곱으로 돌아가면 2초를 넘는다. 사이가 넓어 흔들리지 않는다
  assert.ok(ms < 1500, `${ms}ms`)
})

test('같은 토큰이 여러 줄에 나오면 처음 나온 줄을 낸다', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-first-'))
  fs.writeFileSync(
    path.join(repo, 'AGENTS.md'),
    ['# doc', 'nothing here', 'first `src/gone.ts` mention', 'again `src/gone.ts` later'].join('\n'),
  )
  const [d] = deadPaths(repo, [path.join(repo, 'AGENTS.md')])
  assert.equal(d.lineNumber, 3)
  assert.match(d.line, /^first/)
})

test('한 줄에 토큰이 여럿이면 다 잡는다', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-many-'))
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'see `src/a.ts` and `src/b.ts` here\n')
  const dead = deadPaths(repo, [path.join(repo, 'AGENTS.md')])
  assert.deepEqual(dead.map((d) => d.token).sort(), ['src/a.ts', 'src/b.ts'])
  assert.deepEqual([...new Set(dead.map((d) => d.lineNumber))], [1])
})
