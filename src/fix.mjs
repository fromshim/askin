// 찾은 것을 고칠 수 있는 모양으로 바꾼다. 고치지는 않는다.
//
// 앱이 Claude Code 를 대신하지 않는다. 앱이 하는 것은 기계가 정확히 할 수 있는 두 가지다.
//   1. 어느 파일을 건드려야 하는지 모으는 것
//   2. 파일이 겹치지 않는 갈래로 가르는 것
//
// 2번이 이 파일의 이유다. 설계 문서의 "실행 단계에서 지킬 것" 첫 줄이
// "파일이 겹치지 않는 갈래로만 나눈다. 겹치면 한 갈래로 묶는다" 인데,
// 손으로 하면 겹치는 것을 놓치고 같은 파일을 두 에이전트가 동시에 고친다.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { harnessDocs } from './refs.mjs'

// 종류를 한 표에 둔다. 이름이 두 곳에 있으면 갈래의 몫과 전체가 다른 말로 세어진다.
//   지시서의 "이 갈래가 맡은 몫"     kind → 이름
//   지시서의 "전체는 지금 이렇다"    이름 → 건수
// 한쪽만 고치면 받는 쪽이 두 목록을 대조할 수 없다.
const KINDS = [
  ['dead-path', '문서가 가리키는데 없는 경로', (r) => r.refs.deadPaths.length],
  ['broken-skill', '선언했는데 없는 스킬', (r) => r.refs.brokenSkillRefs.length],
  ['dangling-skill', '스킬 디렉터리의 깨진 심링크', (r) => r.refs.danglingSkills.length],
  ['citation', '근거가 사라진 축', (r) => r.citations?.length ?? 0],
  ['contradiction', '모순 후보', (r) => r.contradictions.length],
]
// 데스크톱 앱도 같은 이름을 쓴다. 이름을 렌더러에 베껴 넣으면 종류를 하나 늘릴 때
// 화면과 터미널이 다른 말을 한다.
export const KIND_NAMES = Object.fromEntries(KINDS.map(([kind, name]) => [kind, name]))

// 리포트가 찾은 것을 종류별로 센다. 지시서의 "전체는 지금 이렇다" 와 상주의 기준선이
// 같은 목록을 써야 한다. 상주가 "죽은 경로 3건 → 7건" 이라고 말하는데 기준선이 3 을
// 말하지 않았으면, 받는 사람은 처음 듣는 숫자에서 늘었다는 말을 듣는다.
export function counts(report) {
  return Object.fromEntries(KINDS.map(([, name, count]) => [name, count(report)]))
}

// 리포트에서 고칠 거리를 뽑는다. 각 건은 자기가 건드릴 파일을 안다.
export function findings(report) {
  const out = []
  for (const d of report.refs.deadPaths) {
    out.push({
      kind: 'dead-path',
      how: d.how,
      files: [d.doc],
      title: `${path.basename(d.doc)}${d.lineNumber ? `:${d.lineNumber}` : ''} 가 없는 경로를 가리킨다`,
      // 토큰만 주면 지울지 고칠지 못 정한다. 원문 줄이 있어야 판단이 선다.
      detail: [`\`${d.token}\` — ${d.how ?? '찾을 수 없음'}`, d.line ? `원문: ${d.line}` : null]
        .filter(Boolean)
        .join('\n    '),
    })
  }
  for (const b of report.refs.brokenSkillRefs) {
    out.push({
      kind: 'broken-skill',
      files: [b.file],
      title: `${b.agent} 가 없는 스킬을 선언한다`,
      // 고치는 길이 둘이다. 죽은 경로에는 42회차에 안내를 붙였는데 여기는 없었다.
      detail: `\`${b.skill}\` — ${b.reason}\n    선언을 지우거나 그 스킬을 만들어라. 옆 저장소에 같은 이름이 있으면 이 저장소나 전역으로 옮겨야 보인다`,
    })
  }
  // 깨진 심링크는 스킬 디렉터리에 있다. 대개 전역이라 이 저장소 밖이다.
  // 지시서의 "저장소 밖 파일을 고친다" 갈래가 그걸 말한다.
  //
  // 실측(2026-08-28): 이 저장소에서 깨진 심링크 3건이 잡히는데도 `--plan` 이
  // "고칠 게 없다. 깨끗하다" 고 했다. 49회차와 같은 거짓말이다.
  for (const d of report.refs.danglingSkills) {
    out.push({
      kind: 'dangling-skill',
      files: [d.path],
      title: `${d.skill} 심링크가 없는 곳을 가리킨다`,
      detail:
        `${d.scope === 'global' ? '전역' : '이 저장소'} → ${d.target ?? '대상을 읽을 수 없다'}\n` +
        '    심링크를 지우거나 대상을 되살려라. 실물이 다른 저장소에 있으면 거기서 옮겨야 보인다',
    })
  }
  // 근거가 사라진 축. 그 축은 판정에서 빠지는데 `--plan` 은 모르고 있었다.
  //
  // 고치는 길이 둘이고 어느 쪽인지는 사람이 안다. 규칙을 일부러 바꿨으면 축을 고치고,
  // 실수로 지웠으면 문서를 고친다. 기계가 고를 수 없으니 판정을 넘긴다.
  for (const c of report.citations ?? []) {
    out.push({
      kind: 'citation',
      files: [c.file ?? c.cite],
      title: `${c.axis} 축의 근거를 이 하네스에서 못 찾는다`,
      // 못 읽는 것과 문구가 사라진 것은 고치는 길이 다르다.
      //
      // 실측(2026-08-28, 빈 홈): 처음 돌리는 사람에게 "문구를 되살려라"고 말하고 있었다.
      // 그 파일이 아예 없는 사람에게 되살릴 문구는 없다. 기본 축은 이 도구를 만든
      // 사람의 규칙을 가리키니, 남의 기계에서는 자기 축을 쓰는 것이 답이다.
      detail:
        `${c.reason}\n` +
        (c.reason?.includes('못 읽어')
          ? '    그 파일이 없다. 기본 축은 만든 사람의 규칙을 가리킨다.\n' +
            '    `~/.harness-bro/axes.mjs` 에 자기 규칙으로 축을 쓰거나, 그 파일에 규칙을 적어라'
          : '    문구를 되살리거나 축의 `rule` 을 지금 문구로 고쳐라.\n' +
            '    규칙을 일부러 바꿨다면 축을 고치는 쪽이다. 그 축은 지금 판정에서 빠져 있다'),
      needsJudgement: true,
    })
  }
  for (const c of report.contradictions) {
    out.push({
      kind: 'contradiction',
      files: [...new Set(c.evidence.map((e) => e.file).filter(Boolean))],
      title: `\`${c.token}\` 을 두 문서가 반대로 말한다`,
      detail: c.evidence.map((e) => `[${e.pol}] ${e.doc}\n      ${e.line}`).join('\n    '),
      needsJudgement: true, // 기계는 후보만 좁혔다. 진짜 모순인지는 읽어봐야 안다
    })
  }
  return out
}

// 파일이 겹치는 것끼리만 묶는다. 안 겹치면 갈라서 동시에 돌린다.
//
// 여기서 "겹친다"는 전이적이다. A와 B가 f1 을 같이 건드리고 B와 C가 f2 를 같이 건드리면
// A·B·C 가 한 갈래여야 한다. 그래서 연결 요소를 찾는다.
export function lanes(list) {
  const byFile = new Map()
  for (const [i, f] of list.entries()) {
    for (const file of f.files) {
      if (!byFile.has(file)) byFile.set(file, [])
      byFile.get(file).push(i)
    }
  }

  const parent = list.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const union = (a, b) => {
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent[rb] = ra
  }
  for (const idxs of byFile.values()) for (const i of idxs.slice(1)) union(idxs[0], i)

  const groups = new Map()
  for (const i of list.keys()) {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(list[i])
  }

  return [...groups.values()]
    .map((items, n) => ({
      id: `lane-${n + 1}`,
      files: [...new Set(items.flatMap((f) => f.files))].sort(),
      findings: items,
      needsJudgement: items.some((f) => f.needsJudgement),
    }))
    .sort((a, b) => b.findings.length - a.findings.length)
    .map((lane, n) => ({ ...lane, id: `lane-${n + 1}` }))
}

// 갈래 하나를 지시서로 만든다.
//
// 설계 문서의 "실행 단계에서 지킬 것" 여섯 줄이 여기 들어간다.
// 그 목록은 이번 사이클에 병렬 편집을 여러 번 돌리며 실제로 데인 것들이다.
export function instruction(lane, allLanes, { repo, verify, before, siblings = [] } = {}) {
  const others = allLanes.filter((l) => l.id !== lane.id).flatMap((l) => l.files)
  const rel = (f) => (repo && f.startsWith(repo) ? path.relative(repo, f) : f)
  const mine = new Set(lane.files)
  // "형제 파일에서도 찾아라"고 시키면서 형제가 누군지 안 알려주면 지시가 안 선다.
  const kin = siblings.filter((f) => !mine.has(f) && !others.includes(f))

  // 죽은 경로는 절반이 거짓 양성이다. 받는 쪽이 그걸 모르면 멀쩡한 문구를 지운다.
  //
  // 실측(2026-08-27, app-a): 12건 중 6건이 경로가 아니었다. `Asia/Seoul`(타임존),
  // `red/amber/green`(색 나열), `/settings/me`(라우트), `text-title/body/label/badge`
  // (Tailwind 클래스 나열). 나머지 6건은 옛 구조를 말하는 진짜 죽은 참조였다.
  //
  // 규칙으로 걸러보려 했지만 못 가른다. `text-title/body/label/badge` 와
  // `apps/web/lib/utils` 는 토큰만 보면 같은 모양이다. 그래서 판정을 정확하게
  // 만드는 대신 틀릴 수 있음을 알린다.
  // 죽은 경로 경고를 이 갈래에 실제로 있는 종류에 맞춘다.
  //
  // 예시를 고정 문구로 주고 있었는데 갈래와 무관할 때가 있었다. 남의 홈 절대 경로
  // 3건만 있는 갈래에 "타임존·색 나열이 그렇게 잡혔다"고 말한다. 받는 쪽이 명백한
  // 진짜를 놓고 "경로가 아닐 수도 있다"를 읽는다.
  //
  // 실측(2026-08-27, 저장소 10곳):
  //   git 이 아는 경로 어디에도 없음  14건 중 거짓 5건 (36%)
  //   절대 경로가 없음                7건 중 거짓 1건 (14%). 나머지 6건이 남의 홈 경로다
  const deadHows = new Set(lane.findings.filter((f) => f.kind === 'dead-path').map((f) => f.how))
  const hasTracked = [...deadHows].some((h) => h?.includes('git'))
  const hasAbsolute = [...deadHows].some((h) => h?.includes('절대'))

  // 전역 하네스를 고치는 갈래는 이 저장소를 고치는 게 아니다.
  //
  // 전역 에이전트의 깨진 스킬 선언은 저장소마다 똑같이 잡힌다. 실측: 전역 에이전트
  // 하나에 없는 스킬을 선언해두니 저장소 세 곳 전부에서 같은 건이 나왔다.
  // 말해주지 않으면 저장소별로 따로 고치려 들고, 이미 고쳐진 것을 안 고쳤다고 읽는다.
  const outside = repo ? lane.files.filter((f) => !f.startsWith(repo)) : []

  const body = [
    `# ${lane.id}: 하네스 고치기 (${lane.findings.length}건)`,
    '',
    // 아래 파일 목록이 상대경로다. 어디 기준인지 안 적으면 받는 쪽이 모른다.
    // 남의 홈 경로를 "이 저장소 경로"로 고치는 갈래에서는 그게 답 자체다.
    ...(repo ? [`저장소: \`${repo}\``, ''] : []),
    ...(lane.needsJudgement
      ? ['이 갈래에는 **판정이 필요한 건**이 섞여 있다. 기계는 후보만 좁혔다.', '실제로 어긋나는지 먼저 읽고 판단해라. 아니라고 판단하면 고치지 말고 그렇게 보고해라.', '']
      : []),
    ...(outside.length
      ? [
          '**이 갈래는 이 저장소 밖 파일을 고친다.** 전역 하네스라 다른 저장소 리포트에도',
          '같은 건이 나온다. 한 번 고치면 전부에서 사라지니 저장소별로 따로 고치지 마라.',
          '',
        ]
      : []),
    ...(hasTracked
      ? [
          '**경로처럼 생겼지만 경로가 아닌 것이 섞여 있다.** 실측하면 셋에 하나쯤이다.',
          '타임존(`Asia/Seoul`), 색 나열(`red/amber/green`),',
          '슬래시로 묶은 클래스 표기(`text-title/body/label/badge`) 가 그렇게 잡혔다.',
          '',
          '그래서 **지우기 전에 그게 경로인지 먼저 판단해라.** 경로가 아니면 문구를 건드리지 말고',
          '그렇게 보고해라. 경로인데 옮겨진 것이면 지우지 말고 새 경로로 고쳐라.',
          '',
        ]
      : []),
    ...(hasAbsolute
      ? [
          '**실재하지 않는 절대 경로가 있다.** 이쪽은 대개 진짜다(실측 7건 중 6건).',
          '남의 머신 경로를 그대로 가져온 것이면 이 저장소 경로로 고쳐라.',
          '앱 라우트(`/settings/me`)처럼 파일이 아닌 것이면 건드리지 말고 보고해라.',
          '',
        ]
      : []),
    '## 고칠 것',
    '',
    ...lane.findings.map((f, i) => `${i + 1}. **${f.title}**\n    ${f.detail}`),
    '',
    '## 건드릴 파일',
    '',
    ...lane.files.map((f) => `- \`${rel(f)}\``),
    '',
  ]

  if (others.length) {
    body.push(
      '## 건드리지 말 것',
      '',
      '다른 갈래가 동시에 이 파일들을 고치고 있다. **읽기만 하고 쓰지 마라.**',
      '',
      ...others.map((f) => `- \`${rel(f)}\``),
      '',
    )
  }

  if (kin.length) {
    body.push(
      '## 같은 패턴이 있을 만한 곳',
      '',
      '이 저장소의 다른 하네스 문서다. 고친 패턴이 여기에도 있는지 **읽어서 확인해라.**',
      '고칠 게 있으면 고치지 말고 보고해라. 이 갈래의 몫이 아니다.',
      '',
      ...kin.map((f) => `- \`${rel(f)}\``),
      '',
    )
  }

  // 지킬 것도 갈래에 있는 종류에 맞춘다.
  //
  // 42회차에 죽은 경로 경고는 갈래에 맞췄는데 이 절은 고정 문구로 남아 있었다.
  // 실측(2026-08-28, cc-system lane-1): 네 줄 중 셋이 이 갈래와 무관했다.
  // 참고 대상을 주지도 않았는데 "참고 대상도 실측해라" 를 말하고, 내용을 옮기지도
  // 않는데 "삭제는 추가가 끝난 뒤에 해라" 를 말했다. 받는 쪽은 무엇이 자기 일인지
  // 가리는 데 먼저 힘을 쓴다.
  //
  // "이번 사이클에 실제로 발동해서" 도 걷었다. 받는 에이전트는 그 사이클을 못 본다.
  const rules = ['- 커밋 전에 `git status --short` 로 내 파일만 올라가는지 확인해라']
  // 지우는 것이 고치는 길에 있는 종류. 죽은 경로는 절반이 거짓 양성이라 이 줄이 핵심이다.
  if (lane.findings.some((f) => ['dead-path', 'broken-skill', 'dangling-skill'].includes(f.kind))) {
    rules.unshift('- **거부 조건.** 지우기 전에 그게 진짜 죽은 것인지 대조해라. 아니면 지우지 말고 그렇게 보고해라')
  }
  body.push('## 지킬 것', '', ...rules, '',
    '## 끝나면',
    '',
    '```bash',
    // 범위가 리포트와 같아야 한다. 전 프로젝트에서 뽑은 갈래에 `--repo .` 를 주면
    // 받는 쪽이 딴 범위를 재고 "안 줄었다"고 읽는다. 근거가 사라진 축은 저장소와
    // 무관하게 나오니 실제로 이 경우가 생긴다.
    verify ??
      `node ${path.join(path.dirname(fileURLToPath(import.meta.url)), 'report.mjs')} ${repo ? `--repo ${repo}` : '--all'}`,
    '```',
  )

  // "건수가 줄었는지 확인해라"만으로는 확인이 안 된다. 지금 몇 건인지를 줘야 한다.
  //
  // 총계만 주면 받는 쪽이 뺄셈을 해야 한다. 게다가 갈래들이 동시에 도니까 총계가
  // 얼마로 떨어져야 하는지는 아무도 미리 모른다. 그래서 총계 대신 **이 갈래의 몫**을
  // 종류별로 적는다. 자기 몫이 사라졌는지는 총계와 무관하게 확인할 수 있다.
  if (before) {
    const mine = {}
    for (const f of lane.findings) mine[KIND_NAMES[f.kind] ?? f.kind] = (mine[KIND_NAMES[f.kind] ?? f.kind] ?? 0) + 1
    body.push(
      '',
      '이 갈래가 맡은 몫이다. 끝나면 이만큼 줄어 있어야 한다.',
      '',
      ...Object.entries(mine).map(([k, v]) => `- ${k} **${v}건**`),
      '',
      '전체는 지금 이렇다. 다른 갈래도 같이 도니까 총계는 이보다 더 줄 수 있다.',
      '',
      ...Object.entries(before).map(([k, v]) => `- ${k} **${v}건**`),
      '',
      '안 줄었으면 고친 게 아니다. 늘었으면 뭔가 깨뜨린 것이다.',
    )
  } else {
    body.push('', '다시 돌려서 이 갈래가 맡은 건수가 줄었는지 확인해라. 안 줄었으면 고친 게 아니다.')
  }

  // 모순 후보만은 건수로 확인이 안 된다.
  //
  // 실제로 한 바퀴 돌려보고 알았다. `var` 모순을 해소했는데도 후보로 남았다.
  // 기계는 "A인데 단 B는 예외"와 "A와 B가 어긋난다"를 못 가른다. 둘 다 방향이 반대인 절이다.
  // 그게 설계대로다. 기계는 후보만 좁히고 판정은 사람이 한다.
  // 그런데 "안 줄었으면 고친 게 아니다"를 여기까지 적용하면 고쳐놓고 안 고쳤다고 읽는다.
  if (lane.needsJudgement) {
    body.push(
      '',
      '**모순 후보는 건수로 확인하지 마라.** 고쳐도 후보로 남을 수 있다.',
      '한쪽에 예외를 달아 맞춰도 기계 눈에는 여전히 방향이 반대인 두 절이다.',
      '두 문서를 다시 읽어서 이제 같은 말을 하는지로 확인하고, 무엇을 어떻게 맞췄는지 보고해라.',
    )
  }

  return body.join('\n')
}

export function plan(report, opts = {}) {
  const list = findings(report)
  const grouped = lanes(list)
  const before = counts(report)
  // 형제는 이 저장소의 하네스 문서 전부다.
  // 결함이 잡힌 파일로만 목록을 만들면 늘 비어서, "형제에서도 찾아라"가 아무 데도 안 가리킨다.
  // 정작 봐야 할 것은 아직 아무것도 안 잡힌 문서다. 못 잡은 것이 거기 있을 수 있다.
  //
  // 전역 문서는 뺀다. harnessDocs 는 전역 CLAUDE.md 를 포함하는데(죽은 경로 검사에는
  // 그게 맞다) 형제 목록에는 안 맞다. 지시서 문구가 "이 저장소의 다른 하네스 문서다"인데
  // 전역이 섞여 저장소마다 반복 등장했다. 실측(2026-08-28): 저장소 다섯 곳 전부에서 나왔다.
  //
  // 전역을 읽어 얻을 것도 이미 다른 장치가 덮는다. 죽은 경로는 harnessDocs 가 전역을
  // 검사하고, 전역과 저장소가 어긋나는 모순은 harnessCorpus 가 쌍으로 잡는다.
  // 실측으로도 전역 CLAUDE.md 의 죽은 경로 0건, 모순 후보에 전역 포함 0건이었다.
  const inRepo = (f) => report.scope.repo && f.startsWith(`${report.scope.repo}/`)
  const siblings = opts.siblings ?? (report.scope.repo ? harnessDocs(report.scope.repo).filter(inRepo) : [])
  return {
    total: list.length,
    lanes: grouped.map((lane) => ({
      ...lane,
      prompt: instruction(lane, grouped, { repo: report.scope.repo, before, siblings, ...opts }),
    })),
  }
}
