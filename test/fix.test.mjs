// 갈래가 파일을 공유하면 두 에이전트가 같은 파일을 동시에 고친다.
// 조용히 깨지는 종류라 불변식으로 못박는다.
//   node --test test/fix.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { counts, findings, lanes, instruction, plan } from '../src/fix.mjs'

const report = (over = {}) => ({
  scope: { repo: '/repo' },
  refs: { deadPaths: [], brokenSkillRefs: [], danglingSkills: [] },
  contradictions: [],
  ...over,
})

test('파일이 안 겹치면 갈라진다', () => {
  const got = lanes([
    { files: ['/repo/a.md'], title: '1' },
    { files: ['/repo/b.md'], title: '2' },
  ])
  assert.equal(got.length, 2)
})

test('파일이 겹치면 한 갈래로 묶는다', () => {
  const got = lanes([
    { files: ['/repo/a.md'], title: '1' },
    { files: ['/repo/a.md'], title: '2' },
  ])
  assert.equal(got.length, 1)
  assert.equal(got[0].findings.length, 2)
})

test('겹침은 전이적이다', () => {
  // A는 a 를, B는 a 와 b 를, C는 b 를 건드린다. 셋이 한 갈래여야 한다.
  const got = lanes([
    { files: ['/repo/a.md'], title: 'A' },
    { files: ['/repo/a.md', '/repo/b.md'], title: 'B' },
    { files: ['/repo/b.md'], title: 'C' },
  ])
  assert.equal(got.length, 1)
  assert.equal(got[0].findings.length, 3)
})

test('어떤 두 갈래도 파일을 공유하지 않는다', () => {
  const files = ['a', 'b', 'c', 'd', 'e'].map((n) => `/repo/${n}.md`)
  // 여러 모양을 섞어 넣는다
  const list = [
    { files: [files[0]] },
    { files: [files[0], files[1]] },
    { files: [files[2]] },
    { files: [files[3], files[4]] },
    { files: [files[4]] },
    { files: [files[2]] },
  ]
  const got = lanes(list)
  const seen = new Map()
  for (const lane of got) {
    for (const f of lane.files) {
      assert.equal(seen.has(f), false, `${f} 가 ${seen.get(f)} 와 ${lane.id} 에 같이 있다`)
      seen.set(f, lane.id)
    }
  }
  // 건수는 하나도 안 잃는다
  assert.equal(
    got.reduce((n, l) => n + l.findings.length, 0),
    list.length,
  )
})

test('모순은 라벨이 아니라 파일로 갈래를 가른다', () => {
  const list = findings(
    report({
      contradictions: [
        {
          token: 'var',
          docs: ['agent:x', 'agent:y'],
          evidence: [
            { pol: 'neg', doc: 'agent:x', line: 'a', file: '/repo/x.md' },
            { pol: 'pos', doc: 'agent:y', line: 'b', file: '/repo/y.md' },
          ],
        },
      ],
    }),
  )
  assert.deepEqual(list[0].files, ['/repo/x.md', '/repo/y.md'])
})

test('지시서에 다른 갈래의 파일이 건드리지 말 것으로 들어간다', () => {
  const got = lanes([
    { files: ['/repo/a.md'], title: 'A', detail: '' },
    { files: ['/repo/b.md'], title: 'B', detail: '' },
  ])
  const text = instruction(got[0], got, { repo: '/repo' })
  assert.match(text, /건드리지 말 것/)
  assert.match(text, /b\.md/)
  assert.match(text, /읽기만 하고 쓰지 마라/)
})

test('갈래가 하나뿐이면 건드리지 말 것을 안 적는다', () => {
  const got = lanes([{ files: ['/repo/a.md'], title: 'A', detail: '' }])
  assert.doesNotMatch(instruction(got[0], got, { repo: '/repo' }), /건드리지 말 것/)
})

test('모순이 섞이면 건수로 확인하지 말라고 못박는다', () => {
  // 한 바퀴 돌려보고 알았다. var 모순을 해소했는데도 후보로 남았다.
  // 기계는 "A인데 단 B는 예외"와 "A와 B가 어긋난다"를 못 가른다.
  // 그런데 "안 줄었으면 고친 게 아니다"를 여기까지 적용하면 고쳐놓고 안 고쳤다고 읽는다.
  const withContra = plan(
    report({
      contradictions: [{ token: 'var', docs: ['a'], evidence: [{ pol: 'neg', doc: 'a', line: 'x', file: '/repo/x.md' }] }],
    }),
    { siblings: [] },
  )
  assert.match(withContra.lanes[0].prompt, /모순 후보는 건수로 확인하지 마라/)

  // 모순이 없는 갈래에는 이 말을 안 붙인다
  const plain = plan(
    report({ refs: { deadPaths: [{ doc: '/repo/a.md', token: 'x/y' }], brokenSkillRefs: [], danglingSkills: [] } }),
    { siblings: [] },
  )
  assert.doesNotMatch(plain.lanes[0].prompt, /건수로 확인하지 마라/)
})

test('판정이 필요한 건은 지시서 앞에서 그렇게 말한다', () => {
  const p = plan(
    report({
      contradictions: [
        {
          token: 'var',
          docs: ['agent:x'],
          evidence: [{ pol: 'neg', doc: 'agent:x', line: 'a', file: '/repo/x.md' }],
        },
      ],
    }),
  )
  assert.match(p.lanes[0].prompt, /판정이 필요한 건/)
  assert.match(p.lanes[0].prompt, /고치지 말고 그렇게 보고해라/)
})

test('고칠 게 없으면 갈래도 없다', () => {
  assert.equal(plan(report()).total, 0)
  assert.equal(plan(report()).lanes.length, 0)
})

test('죽은 경로는 원문 줄까지 준다', () => {
  // 토큰만 주면 지울지 고칠지 못 정한다
  const list = findings(
    report({
      refs: {
        deadPaths: [{ doc: '/repo/a.md', token: '.docs/PRD.md', how: '없음', line: '| PRD | `.docs/PRD.md` | 요구사항 |', lineNumber: 31 }],
        brokenSkillRefs: [],
        danglingSkills: [],
      },
    }),
  )
  assert.match(list[0].title, /a\.md:31/)
  assert.match(list[0].detail, /원문: \| PRD \|/)
})

test('검증에 지금 건수를 박는다', () => {
  const p = plan(
    report({
      refs: {
        deadPaths: [{ doc: '/repo/a.md', token: 'x/y', how: '없음' }],
        brokenSkillRefs: [],
        danglingSkills: [],
      },
    }),
    { siblings: [] },
  )
  // "줄었는지 확인해라"만으로는 확인이 안 된다
  assert.match(p.lanes[0].prompt, /문서가 가리키는데 없는 경로 \*\*1건\*\*/)
  assert.match(p.lanes[0].prompt, /늘었으면 뭔가 깨뜨린 것이다/)
})

test('형제 목록에서 내 파일과 다른 갈래 파일은 뺀다', () => {
  const got = lanes([
    { files: ['/repo/a.md'], title: 'A', detail: '' },
    { files: ['/repo/b.md'], title: 'B', detail: '' },
  ])
  const text = instruction(got[0], got, {
    repo: '/repo',
    siblings: ['/repo/a.md', '/repo/b.md', '/repo/c.md'],
  })
  const kin = text.split('## 같은 패턴이 있을 만한 곳')[1].split('##')[0]
  assert.match(kin, /c\.md/)
  assert.doesNotMatch(kin, /a\.md/) // 내 파일
  assert.doesNotMatch(kin, /b\.md/) // 다른 갈래가 고치는 중
})

test('죽은 경로 경고를 그 갈래에 있는 종류에 맞춘다', () => {
  // 예시를 고정 문구로 주고 있었는데 갈래와 무관할 때가 있었다. 남의 홈 절대 경로
  // 3건만 있는 갈래에 "타임존·색 나열이 그렇게 잡혔다"고 말했다.
  //
  // 실측(2026-08-27, 저장소 10곳):
  //   git 이 아는 경로 어디에도 없음  14건 중 거짓 5건 (36%)
  //   절대 경로가 없음                7건 중 거짓 1건 (14%). 나머지 6건이 남의 홈 경로다
  const dead = (how, token) => ({
    kind: 'dead-path',
    how,
    files: ['/repo/a.md'],
    title: 'a.md 가 없는 경로를 가리킨다',
    detail: `\`${token}\` — ${how}`,
  })

  const [tracked] = lanes([dead('git 이 아는 경로 어디에도 없음', 'Asia/Seoul')])
  const t = instruction(tracked, [tracked], {})
  assert.match(t, /경로가 아닌 것이 섞여 있다/)
  assert.match(t, /지우기 전에 그게 경로인지 먼저 판단해라/)
  assert.match(t, /새 경로로 고쳐라/)
  assert.doesNotMatch(t, /절대 경로가 있다/) // 없는 종류는 말하지 않는다

  const [abs] = lanes([dead('절대 경로가 없음', '/Users/남/repo/')])
  const a = instruction(abs, [abs], {})
  assert.match(a, /실재하지 않는 절대 경로가 있다/)
  assert.match(a, /대개 진짜다/)
  assert.match(a, /남의 머신 경로/)
  assert.doesNotMatch(a, /경로가 아닌 것이 섞여 있다/)

  // 죽은 경로가 없는 갈래에는 둘 다 안 붙인다
  const skill = { kind: 'broken-skill', files: ['/repo/b.md'], title: 'x', detail: 'y' }
  const [other] = lanes([skill])
  const o = instruction(other, [other], {})
  assert.doesNotMatch(o, /경로가 아닌 것이 섞여 있다/)
  assert.doesNotMatch(o, /절대 경로가 있다/)
})

test('상대경로가 어디 기준인지 적는다', () => {
  // 건드릴 파일이 상대경로인데 저장소 절대경로는 검증 명령에만 묻혀 있었다.
  // 남의 홈 경로를 "이 저장소 경로"로 고치는 갈래에서는 그게 답 자체다.
  const f = { kind: 'broken-skill', files: ['/repo/x/.claude/agents/a.md'], title: 't', detail: 'd' }
  const [lane] = lanes([f])
  assert.match(instruction(lane, [lane], { repo: '/repo/x' }), /저장소: `\/repo\/x`/)
  // 전 프로젝트 범위면 저장소가 없다
  assert.doesNotMatch(instruction(lane, [lane], {}), /^저장소:/m)
})

test('저장소 밖 파일을 고치는 갈래는 그렇게 말한다', () => {
  // 전역 에이전트의 깨진 스킬 선언은 저장소마다 똑같이 잡힌다. 실측: 전역 에이전트
  // 하나에 없는 스킬을 선언해두니 저장소 세 곳 전부에서 같은 건이 나왔다.
  const global = { kind: 'broken-skill', files: ['/home/me/.claude/agents/helper.md'], title: 'helper', detail: 'x' }
  const local = { kind: 'broken-skill', files: ['/repo/.claude/agents/mine.md'], title: 'mine', detail: 'y' }
  const grouped = lanes([global, local])
  const texts = grouped.map((l) => instruction(l, grouped, { repo: '/repo' }))
  const hits = texts.filter((t) => /이 저장소 밖 파일을 고친다/.test(t))
  assert.equal(hits.length, 1) // 전역 갈래에만 붙는다
  assert.match(hits[0], /helper/)
  assert.match(hits[0], /저장소별로 따로 고치지 마라/)
})

test('형제 목록에 전역 문서를 안 넣는다', () => {
  // harnessDocs 는 전역 CLAUDE.md 를 포함한다. 죽은 경로 검사에는 그게 맞지만
  // 형제 목록에는 안 맞다. 지시서 문구가 "이 저장소의 다른 하네스 문서다"인데
  // 전역이 섞여 저장소 다섯 곳 전부에서 반복 등장했다(2026-08-28 실측).
  //
  // 전역을 읽어 얻을 것은 다른 장치가 덮는다. 죽은 경로는 harnessDocs 가 전역을
  // 검사하고, 전역과 저장소가 어긋나는 모순은 harnessCorpus 가 쌍으로 잡는다.
  const report = {
    scope: { repo: '/repo' },
    refs: {
      deadPaths: [{ doc: '/repo/.claude/agents/a.md', token: 'x', how: '없음', line: 'y', lineNumber: 1 }],
      brokenSkillRefs: [],
      danglingSkills: [],
    },
    contradictions: [],
  }
  const p = plan(report)
  const kin = p.lanes[0].prompt.split('## 같은 패턴이 있을 만한 곳')[1] ?? ''
  assert.doesNotMatch(kin, /\.claude\/CLAUDE\.md/) // 홈의 전역 문서
  assert.doesNotMatch(kin, /^- `\//m) // 저장소 밖 절대경로가 없다
})

// 실측(2026-08-28): 이 저장소에서 깨진 심링크 3건이 잡히는데도 `--plan` 이
// "고칠 게 없다. 깨끗하다" 고 했다. 근거가 사라진 축도 몰랐다. 49회차와 같은 거짓말이다.
test('깨진 심링크도 고칠 것에 든다', () => {
  const got = findings(
    report({
      refs: {
        deadPaths: [],
        brokenSkillRefs: [],
        danglingSkills: [{ skill: 'next-best-practices', path: '/home/u/.claude/skills/next-best-practices', scope: 'global', target: '../../.agents/skills/next-best-practices' }],
      },
    }),
  )
  assert.equal(got.length, 1)
  assert.equal(got[0].kind, 'dangling-skill')
  assert.match(got[0].detail, /전역 → \.\.\/\.\.\/\.agents/) // 어디를 가리키다 깨졌는지
  // 전역 심링크는 이 저장소 밖이다. 저장소별로 따로 고치려 들면 안 된다.
  assert.match(instruction(lanes(got)[0], lanes(got), { repo: '/repo' }), /이 저장소 밖 파일을 고친다/)
})

test('심링크가 아니면 대상이 없다고 말한다', () => {
  // readlinkSync 가 던지면 target 이 null 로 온다. 그때 "null" 을 찍으면 안 된다.
  const got = findings(
    report({ refs: { deadPaths: [], brokenSkillRefs: [], danglingSkills: [{ skill: 's', path: '/p/s', scope: 'repo', target: null }] } }),
  )
  assert.match(got[0].detail, /대상을 읽을 수 없다/)
  assert.doesNotMatch(got[0].detail, /null/)
})

test('근거가 사라진 축은 판정을 사람에게 넘긴다', () => {
  // 고치는 길이 둘이다. 규칙을 일부러 바꿨으면 축을 고치고, 실수로 지웠으면 문서를 고친다.
  const got = findings(
    report({ citations: [{ axis: 'model-explicit', cite: '~/.claude/CLAUDE.md', file: '/home/u/.claude/CLAUDE.md', reason: '그 규칙이 없어 판정할 수 없다' }] }),
  )
  assert.equal(got.length, 1)
  assert.equal(got[0].kind, 'citation')
  assert.deepEqual(got[0].files, ['/home/u/.claude/CLAUDE.md']) // 문구가 아니라 실제 경로
  assert.equal(got[0].needsJudgement, true)
  assert.match(instruction(lanes(got)[0], lanes(got), { repo: '/repo' }), /판정이 필요한 건/)
})

test('근거가 사라진 축은 저장소와 무관하게 나온다', () => {
  // 실측(2026-08-28): 같은 리포트로 --all --html 은 이 갈래를 냈는데
  // --all --plan 은 "못 뽑는다"고만 했다. 한 사실을 두 곳이 다르게 말했다.
  const got = findings({
    scope: { repo: null },
    refs: { deadPaths: [], brokenSkillRefs: [], danglingSkills: [] },
    contradictions: [],
    citations: [{ axis: 'a', cite: '~/.claude/CLAUDE.md', file: '/h/.claude/CLAUDE.md', reason: 'r' }],
  })
  assert.equal(got.length, 1)
})

test('citations 를 모르는 리포트에도 안 죽는다', () => {
  // 옛 호출부는 이 값을 안 담는다. 갈래를 못 내는 것보다 없는 것으로 읽는 게 낫다.
  assert.deepEqual(findings(report()), [])
})

test('갈래를 세는 목록에 새로 든 두 종류가 있다', () => {
  // before 는 "다시 돌려서 줄었는지 봐라"의 기준이다. 빠지면 검증이 그 종류를 못 본다.
  const p = plan(
    report({
      refs: { deadPaths: [], brokenSkillRefs: [], danglingSkills: [{ skill: 's', path: '/p/s', scope: 'global', target: 'x' }] },
      citations: [{ axis: 'a', cite: 'c', file: '/f', reason: 'r' }],
    }),
  )
  assert.equal(p.total, 2)
  assert.match(p.lanes[0].prompt, /스킬 디렉터리의 깨진 심링크/)
  assert.match(p.lanes[0].prompt, /근거가 사라진 축/)
})

// 실측(2026-08-28, cc-system lane-1): 지시서를 받는 에이전트 눈으로 읽으니
// "지킬 것" 네 줄 중 셋이 이 갈래와 무관했다. 참고 대상을 주지도 않았는데
// "참고 대상도 실측해라" 를 말하고, 내용을 옮기지도 않는데 "삭제는 추가가 끝난 뒤에" 를
// 말했다. 42회차에 죽은 경로 경고는 갈래에 맞췄는데 이 절은 고정 문구였다.
test('지킬 것도 갈래에 있는 종류에 맞춘다', () => {
  const dead = findings(
    report({ refs: { deadPaths: [{ doc: '/repo/a.md', token: 'x', how: 'git 이 아는 경로 어디에도 없음' }], brokenSkillRefs: [], danglingSkills: [] } }),
  )
  const p1 = instruction(lanes(dead)[0], lanes(dead), { repo: '/repo' })
  assert.match(p1, /거부 조건/) // 지우는 것이 고치는 길에 있다
  assert.doesNotMatch(p1, /참고 대상도 실측/)
  assert.doesNotMatch(p1, /삭제는 추가가 끝난 뒤/)
  assert.doesNotMatch(p1, /이번 사이클/) // 받는 쪽은 그 사이클을 못 본다

  // 근거가 사라진 축은 지우는 일이 아니다. 문구를 되살리거나 축을 고친다
  const cite = findings(report({ citations: [{ axis: 'a', cite: 'c', file: '/f', reason: 'r' }] }))
  const p2 = instruction(lanes(cite)[0], lanes(cite), { repo: '/repo' })
  assert.doesNotMatch(p2, /거부 조건/)
  assert.match(p2, /git status --short/) // 이건 늘 붙는다
})

test('이 갈래가 맡은 몫을 종류별로 적는다', () => {
  // 총계만 주면 받는 쪽이 뺄셈을 해야 하고, 갈래가 동시에 도니까 총계가 얼마로
  // 떨어져야 하는지는 아무도 미리 모른다.
  const p = plan(
    report({
      refs: {
        deadPaths: [
          { doc: '/repo/a.md', token: 'x', how: 'h' },
          { doc: '/repo/a.md', token: 'y', how: 'h' },
          { doc: '/repo/b.md', token: 'z', how: 'h' },
        ],
        brokenSkillRefs: [],
        danglingSkills: [],
      },
    }),
  )
  const mine = p.lanes.find((l) => l.files.includes('/repo/a.md')).prompt
  assert.match(mine, /맡은 몫이다[\s\S]*문서가 가리키는데 없는 경로 \*\*2건\*\*/)
  assert.match(mine, /전체는 지금 이렇다[\s\S]*문서가 가리키는데 없는 경로 \*\*3건\*\*/)
})

test('검증 명령의 범위가 리포트와 같다', () => {
  // 전 프로젝트에서 뽑은 갈래에 --repo . 를 주면 받는 쪽이 딴 범위를 잰다.
  const all = plan({
    scope: { repo: null },
    refs: { deadPaths: [], brokenSkillRefs: [], danglingSkills: [] },
    contradictions: [],
    citations: [{ axis: 'a', cite: 'c', file: '/f', reason: 'r' }],
  })
  assert.match(all.lanes[0].prompt, /report\.mjs --all/)
  assert.doesNotMatch(all.lanes[0].prompt, /--repo \./)
})

// 상주가 "죽은 경로 3건 → 7건" 이라고 말하는데 기준선이 3 을 말하지 않았으면,
// 받는 사람은 처음 듣는 숫자에서 늘었다는 말을 듣는다. 기준선과 지시서가 같은 목록을 쓴다.
test('찾은 것을 종류별로 세는 곳이 하나다', () => {
  const r = report({
    refs: {
      deadPaths: [{ doc: '/repo/a.md', token: 'x', how: 'h' }],
      brokenSkillRefs: [{ agent: 'a', scope: 'repo', file: '/f', skill: 's', reason: 'r' }],
      danglingSkills: [{ skill: 's', path: '/p', scope: 'global', target: 't' }],
    },
    citations: [{ axis: 'a', cite: 'c', file: '/f', reason: 'r' }],
  })
  assert.deepEqual(counts(r), {
    '문서가 가리키는데 없는 경로': 1,
    '선언했는데 없는 스킬': 1,
    '스킬 디렉터리의 깨진 심링크': 1,
    '근거가 사라진 축': 1,
    '모순 후보': 0,
  })

  // 지시서의 "전체는 지금 이렇다" 가 같은 이름과 같은 수를 쓴다
  const prompt = plan(r).lanes[0].prompt
  for (const [name, n] of Object.entries(counts(r))) assert.match(prompt, new RegExp(`${name} \\*\\*${n}건\\*\\*`))
})

test('citations 를 모르는 리포트도 센다', () => {
  assert.equal(counts(report())['근거가 사라진 축'], 0)
})

// 실측(2026-08-28, 빈 홈): 처음 돌리는 사람에게 "문구를 되살려라"고 말하고 있었다.
// 그 파일이 아예 없는 사람에게 되살릴 문구는 없다.
test('근거를 못 읽는 것과 문구가 사라진 것은 고치는 길이 다르다', () => {
  const gone = findings(report({ citations: [{ axis: 'a', cite: '~/.claude/CLAUDE.md', file: '/f', reason: '~/.claude/CLAUDE.md 를 못 읽어 판정할 수 없다' }] }))
  assert.match(gone[0].detail, /자기 규칙으로 축을 쓰거나/)
  assert.doesNotMatch(gone[0].detail, /되살리/)

  const drifted = findings(report({ citations: [{ axis: 'a', cite: '~/.claude/CLAUDE.md', file: '/f', reason: '~/.claude/CLAUDE.md 에 그 규칙이 없어 판정할 수 없다: x' }] }))
  assert.match(drifted[0].detail, /문구를 되살리거나/)
})
