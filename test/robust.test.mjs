// 감시 모드는 지금 쓰이는 중인 전사를 읽는다. 마지막 줄이 잘려 있는 게 정상이다.
// 거기서 터지면 상주가 안 된다.
//   node --test test/robust.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { brokenSkillRefs, deadPaths } from '../src/refs.mjs'
import { delegations, sessions, transcriptPass } from '../src/scan.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-robust-'))
const S = path.join(root, 'proj', '55555555-5555-5555-5555-555555555555')
fs.mkdirSync(path.join(S, 'subagents'), { recursive: true })

// 정상 줄 하나 쓰고, 그다음 줄을 쓰다 말았다
fs.writeFileSync(
  `${S}.jsonl`,
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-01T00:00:00Z',
    cwd: '/r',
    message: { model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 5 } },
  }) +
    '\n' +
    '{"type":"assistant","message":{"id":"msg_1","content":[{"type":"tool_use","id":"toolu_x","name":"Agent"',
)
fs.writeFileSync(path.join(S, 'subagents', 'agent-a.meta.json'), JSON.stringify({ agentType: 'runner', model: 'haiku' }))

// 빈 파일, JSON 이 아닌 파일, 깨진 meta.json
fs.writeFileSync(path.join(root, 'proj', '66666666-6666-6666-6666-666666666666.jsonl'), '')
fs.writeFileSync(path.join(root, 'proj', '77777777-7777-7777-7777-777777777777.jsonl'), 'not json at all\n')
const B = path.join(root, 'proj', '88888888-8888-8888-8888-888888888888', 'subagents')
fs.mkdirSync(B, { recursive: true })
fs.writeFileSync(path.join(B, 'agent-b.meta.json'), '{"agentType": 깨짐')

const opt = { cache: false }

test('쓰다 만 마지막 줄에서 안 터진다', () => {
  const s = sessions(root, opt).find((x) => x.sessionId.startsWith('55555555'))
  assert.equal(s.lines, 1) // 온전한 줄만 센다
  // 잘린 줄의 timestamp 를 사실로 삼지 않는다
  assert.equal(s.startedAt, s.endedAt)
})

test('잘린 줄의 도구 호출은 안 믿는다', () => {
  // 다 쓰이고 나면 다음 읽기에 잡힌다. 반쯤 읽은 것을 사실로 삼지 않는다.
  assert.equal(transcriptPass(root, opt).dispatch.size, 0)
})

test('빈 파일과 JSON 이 아닌 파일을 넘어간다', () => {
  const ss = sessions(root, opt)
  assert.equal(ss.length, 3)
  for (const id of ['66666666', '77777777']) {
    assert.equal(ss.find((x) => x.sessionId.startsWith(id)).lines, 0)
  }
})

test('깨진 meta.json 은 위임으로 안 센다', () => {
  const d = delegations(root, opt)
  assert.equal(d.length, 1)
  assert.equal(d[0].agentType, 'runner')
})

test('토큰은 온전한 줄에서만 걷는다', () => {
  const t = transcriptPass(root, opt).tokens.get('55555555-5555-5555-5555-555555555555')
  assert.equal(t.main.in, 10)
  assert.equal(t.main.out, 5)
})

test('없는 --repo 는 리포트를 내지 않고 죽는다', () => {
  // 없는 경로로 돌리면 모든 축이 "기록이 없다"로 빠진다. 오타인지 안 쓴 저장소인지
  // 사람이 가릴 수 없어서, 숫자를 보여주기 전에 멈춘다
  const run = () =>
    execFileSync(process.execPath, ['src/report.mjs', '--repo', path.join(root, '없다')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  assert.throws(run, (e) => {
    assert.equal(e.status, 1)
    assert.match(e.stderr, /그런 디렉터리가 없다/)
    assert.equal(e.stdout, '') // 리포트를 한 줄도 안 낸다
    return true
  })
})

// CLI 인자가 망가져도 조용히 틀린 답을 내지 않는다.
//
// 실측(2026-08-27): `--since 어제` 가 문자열 비교에서 전부 걸러져 0건이 나오고
// "최근 NaN일" 이 찍혔다. `--since --all` 은 since="--all" 로 들어와 필터가 조용히
// 무력화되고 위임 1,067건 전부가 통과했다. 오타인지 정말 없는 건지 가릴 수 없다.
const cli = (...args) => {
  try {
    execFileSync(process.execPath, ['src/report.mjs', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stderr: '' }
  } catch (e) {
    return { status: e.status, stderr: e.stderr ?? '' }
  }
}

test('날짜로 못 읽는 인자는 리포트를 내지 않고 죽는다', () => {
  for (const bad of ['어제', '2026-13-45', 'yesterday']) {
    const r = cli('--all', '--since', bad)
    assert.equal(r.status, 1, `--since ${bad} 가 통과했다`)
    assert.match(r.stderr, /날짜로 못 읽었다/)
  }
})

test('창이 뒤집히면 죽는다', () => {
  const r = cli('--all', '--since', '2026-08-27', '--until', '2026-08-01')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /창이 비었다/)
})

test('창을 두 번 말하면 죽는다', () => {
  // 실측(2026-08-28): `--all-time --since 2026-08-20` 이 --since 만 먹혔다.
  // --all-time 은 아무 일도 안 하고 아무 말도 안 했다. 위임 272건으로 좁혀졌다.
  const r = cli('--all', '--all-time', '--since', '2026-08-20')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /창은 하나여야 한다/)

  // --until 은 다르다. 처음부터 그 날까지라 창이 하나다. 이 길을 막으면 안 된다.
  assert.equal(cli('--all', '--all-time', '--until', '2026-08-20').status, 0)
})

test('값을 빠뜨린 인자는 죽는다', () => {
  // `--since --all` 이 since="--all" 로 들어와 필터가 무력화됐다
  for (const name of ['since', 'until', 'repo', 'html']) {
    const r = cli(`--${name}`)
    assert.equal(r.status, 1, `--${name} 값 없음이 통과했다`)
    assert.match(r.stderr, new RegExp(`--${name} 에 값이 없다`))
  }
  assert.match(cli('--since', '--all').stderr, /--since 에 값이 없다/)
})

test('미래 창에 "최근 -N일" 을 쓰지 않는다', async () => {
  // 스냅샷 키에 음수나 NaN 이 박히면 그 창이 영영 자기와만 견준다
  const { scopeKey } = await import('../src/snapshot.mjs')
  assert.equal(scopeKey({ repo: null, since: '2027-01-01', until: null }), '(전 프로젝트) @2027-01-01~')
  assert.match(scopeKey({ repo: null, since: '어제', until: null }), /어제~/)
  assert.doesNotMatch(scopeKey({ repo: null, since: '어제', until: null }), /NaN/)
})

test('--json 은 어떤 조합에서도 순수 JSON 만 낸다', () => {
  // --save 메시지를 stdout 에 넣었더니 JSON 앞에 붙어서 jq 가 죽었다.
  // "Invalid numeric literal at line 1, column 13". 사람용 말은 stderr 로 간다.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-pure-'))
  const dir = path.join(root, '-Users-x-Projects-demo')
  fs.mkdirSync(path.join(dir, '11111111-1111-1111-1111-111111111111', 'subagents'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, '11111111-1111-1111-1111-111111111111.jsonl'),
    JSON.stringify({ timestamp: '2026-08-01T00:00:00Z', cwd: '/Users/x/Projects/demo' }) + '\n',
  )
  const env = {
    ...process.env,
    HARNESS_BRO_ROOT: root,
    HARNESS_BRO_STORE: path.join(root, 'snap.jsonl'),
    HARNESS_BRO_CACHE: path.join(root, 'cache'),
  }
  const stdout = (...args) =>
    execFileSync(process.execPath, ['src/report.mjs', '--all', '--json', ...args], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

  // 두 번 부른다. 두 번째는 "안 쌓았다" 쪽으로 간다
  for (const args of [['--save'], ['--save'], ['--all-time', '--save'], []]) {
    const out = stdout(...args)
    assert.doesNotThrow(() => JSON.parse(out), `--json ${args.join(' ')} 출력이 JSON 이 아니다`)
    assert.ok(out.trimStart().startsWith('{'), `--json ${args.join(' ')} 앞에 딴 게 붙었다`)
  }
})

test('전 프로젝트 범위에서 --plan 은 "깨끗하다"고 하지 않는다', () => {
  // 죽은 참조·깨진 스킬 선언·모순 후보는 저장소가 있어야 검사한다. --all 은 다 건너뛰고
  // refs 가 전부 0 으로 온다. 그런데 "고칠 게 없다. 깨끗하다"고 말했다.
  // 실측(2026-08-28): 저장소별로 돌리니 app-a 12건, org-a 33건이었다.
  const out = execFileSync(process.execPath, ['src/report.mjs', '--all', '--plan'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.doesNotMatch(out, /깨끗하다/)
  assert.match(out, /못 뽑는다/)
  assert.match(out, /--repo/)
})

test('전 프로젝트 리포트는 저장소 축을 건너뛴다고 말한다', () => {
  // 절이 아예 안 나오니 "없다"로 읽힌다. README 에는 적혀 있지만 화면에는 없었다.
  const all = execFileSync(process.execPath, ['src/report.mjs', '--all'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.match(all, /저장소 축.*건너뛴다/)
  // 저장소를 고르면 안 나온다
  const one = execFileSync(process.execPath, ['src/report.mjs', '--repo', '.'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.doesNotMatch(one, /저장소 축.*건너뛴다/)
})

// 남의 하네스에는 깨진 것이 섞여 있다. 실측(2026-08-28)으로 만들어본 것들이다.
// 죽지 않는 것이 먼저고, 못 읽은 것을 읽은 척하지 않는 것이 그다음이다.
test('깨진 하네스 파일에 죽지 않는다', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-broke-'))
  fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true })
  // 닫히지 않은 frontmatter. 믿을 수 없으니 선언을 세지 않는다
  fs.writeFileSync(path.join(repo, '.claude', 'agents', 'unclosed.md'), '---\nname: a\nskills: alpha\n\nbody\n')
  // frontmatter 가 아예 없다
  fs.writeFileSync(path.join(repo, '.claude', 'agents', 'plain.md'), 'just text\n')
  // 빈 파일
  fs.writeFileSync(path.join(repo, '.claude', 'agents', 'empty.md'), '')

  assert.deepEqual(brokenSkillRefs(repo), [])
  assert.deepEqual(deadPaths(repo, []), [])
})

test('자기를 가리키는 심링크를 깨진 것으로 센다', () => {
  const skills = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-loop-'))
  const self = path.join(skills, 'loop')
  fs.symlinkSync(self, self)
  assert.equal(fs.existsSync(self), false) // 순환은 존재하지 않는 것으로 나온다
})
