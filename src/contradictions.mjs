// 모순 후보를 좁힌다. 판정은 하지 않는다.
//
// 설계상 여기까지가 기계 몫이다. "같은 주제를 다루는 문서 쌍"을 찾아주고
// 실제로 어긋나는지는 Claude 가 읽고 판정한다.
//
// 만들기 전에 세어보기로 했고(2026-08-27), 접는 기준이 20건이었다. 통과했다.
// 좁히는 규칙을 다 넣은 뒤 실제 저장소에서 0~1건이다.
// 문서 221개짜리를 만들어 재보면 28건이다. 상한으로는 안 줄어든다.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { agentDefs, skillIndex } from './refs.mjs'

const NEGATIVE = /(금지|않는다|말라|하지\s*마|지양|피한다|쓰지|없이|불가|never|don't|do not|avoid|forbidden|\bno\b)/i
const POSITIVE = /(한다|해야|필수|반드시|항상|우선|쓴다|사용|따른다|must|always|only|required|\buse\b)/i

// 문서가 서로를 가리키는 이름은 주제가 아니다.
const POINTERS = new Set(['CLAUDE.md', 'AGENTS.md', 'package.json', 'README.md', 'tsconfig.json', 'api-docs'])

// 슬래시 명령 이름도 주제가 아니다.
//
// 스킬이 많은 하네스에서 후보 35건 중 7건이 이거였다. 한 스킬은 "이럴 때 `/review` 를
// 호출하라"고 하고 다른 스킬은 "이미 `/review` 를 돌렸으면 두 번 하지 말라"고 한다.
// 같은 명령을 각자 다른 상황에서 말하는 것이지 대립이 아니다.
// 실측: 실제 저장소에서는 하나도 안 뺐다. 진짜 후보를 버리지 않는다.
const SLASH_COMMAND = /^\/[\w-]+$/

// 방향은 줄이 아니라 토큰이 속한 절에서 잰다.
//
// "긴 className 은 `cn()` 4분할 — 백틱·배열 `.join()` 금지" 한 줄에
// 권장(`cn()`)과 금지(`.join()`)가 같이 들어 있다. 줄 단위로 재면 둘이 같은 방향으로 묶여
// 없는 대립이 생기고, 진짜 대립은 묻힌다.
// 나누기 전에 백틱 구간을 가린다. `cn()` `.join()` `Promise.all()` 처럼
// 토큰 자체에 괄호가 있어서, 안 가리면 토큰이 쪼개져 절을 못 찾고 줄 전체로 되돌아간다.
//
// 가릴 때 쓰는 표식은 사용자 정의 영역 문자(U+E000)다. 하네스 문서에 나올 일이 없다.
// 처음엔 NUL 바이트였는데, 그러면 git 이 이 파일을 바이너리로 봐서 diff 가 안 나온다.
export function clauseAround(line, token) {
  const spans = []
  const masked = line.replace(/`[^`\n]*`/g, (m) => {
    spans.push(m)
    return `${spans.length - 1}`
  })
  const unmask = (s) => s.replace(/(\d+)/g, (_, i) => spans[Number(i)])
  // 문장 경계(`. `)도 절을 가른다. "배열 .join() 금지. cn() 을 쓴다" 가 한 줄에 온다.
  const clauses = masked.split(/[—·,()]|\s+-\s+|[.:]\s/).map(unmask)
  return clauses.find((c) => c.includes(token)) ?? line
}

// "A 대신 B", "use B over A", "A → B" 는 한 절 안에 버릴 것과 쓸 것이 같이 있다.
// 이걸 안 가르면 버릴 쪽이 권장으로 잡혀 없는 대립이 생긴다.
// 실측: 이 규칙 하나가 남은 거짓 양성 4건을 전부 지웠다.
const REPLACEMENT = /(대신|→|->|instead of|rather than|over\s)/i

export function polarity(text, token) {
  const swap = text.match(REPLACEMENT)
  if (swap && token) {
    const at = text.indexOf(token)
    const marker = swap.index
    if (at !== -1) {
      // "대신"·"→" 는 앞의 것을 버리고 뒤의 것을 쓴다. "over"·"rather than" 은 반대다.
      const firstIsRejected = !/over\s|rather than|instead of/i.test(swap[0])
      const before = at < marker
      return before === firstIsRejected ? 'neg' : 'pos'
    }
  }
  const neg = NEGATIVE.test(text)
  const pos = POSITIVE.test(text)
  if (neg && !pos) return 'neg'
  if (pos && !neg) return 'pos'
  if (neg && pos) return 'both'
  return null
}

// 하네스 문서 전부. 선언된 스킬의 SKILL.md 까지 포함한다.
// 문서에 적힌 모순 셋 중 하나가 스킬과 CLAUDE.md 사이였다.
export function harnessCorpus(repo) {
  // scope 를 같이 낸다. 문서 수만 세면 전역 것만으로 채워진 저장소를 못 가른다.
  // 실측(2026-08-27): harness-bro 는 CLAUDE.md 도 AGENTS.md 도 없는데 "하네스 문서
  // 2개"로 나왔다. 전역 CLAUDE.md 와 전역 에이전트 정의 둘이다. 이 저장소 규칙은 0개다.
  // 있는지 보고 담는다. 없는 파일을 세면 "비교할 문서가 1개뿐이다" 가 0개인데 1개라고 한다.
  const globalDoc = path.join(os.homedir(), '.claude', 'CLAUDE.md')
  const out = fs.existsSync(globalDoc) ? [[globalDoc, 'global:CLAUDE.md', 'global']] : []
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const p = path.join(repo, name)
    if (fs.existsSync(p)) out.push([p, `repo:${name}`, 'repo'])
  }
  const skills = skillIndex(repo)
  for (const agent of agentDefs(repo)) {
    out.push([agent.file, `agent:${agent.name}`, agent.scope])
    for (const name of agent.skills) {
      const hit = skills.get(name)
      if (!hit?.exists) continue
      const sp = path.join(hit.path, 'SKILL.md')
      if (fs.existsSync(sp)) out.push([sp, `skill:${name}`, hit.scope])
    }
  }
  return [...new Map(out.map((x) => [x[0], x])).values()]
}

// 문서가 둘 미만이면 후보가 구조적으로 나올 수 없다.
// 그때의 "0건"은 "모순이 없다"가 아니라 "비교할 게 없다"다.
// 실측: harness-bro·omija·korean-tone 이 전역 CLAUDE.md 하나뿐이라 늘 0건이었다.
export const MIN_DOCS = 2

export function judgeable(repo, corpus = harnessCorpus(repo)) {
  return corpus.length >= MIN_DOCS
}

// 흔한 토큰을 문서 개수로 버리는 상한이 있었는데 걷어냈다.
//
// 재보니 어느 크기에서도 제 일을 안 했다. 실제 저장소(문서 5~11개)에서는 상한을
// 없애도 후보 수가 그대로였고(0건, 1건), 문서 221개 하네스에서는 35건 중 8건만
// 버렸다. 남은 거짓 양성은 상한을 2로 조여도 통과했다. 문서 개수는 토큰이
// 주제를 좁히는지와 상관이 없다.
export function candidates(repo, { corpus = harnessCorpus(repo) } = {}) {
  const byToken = new Map()
  for (const [file, label] of corpus) {
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      for (const match of line.match(/`[^`\n]{2,40}`/g) ?? []) {
        const token = match.slice(1, -1).trim()
        if (POINTERS.has(token)) continue
        if (SLASH_COMMAND.test(token)) continue
        if (!/^[\w@.\-*:/<>'()[\]]+$/.test(token)) continue // 파싱 찌꺼기
        const pol = polarity(clauseAround(line, token), token)
        if (!pol) continue
        if (!byToken.has(token)) byToken.set(token, new Map())
        const docs = byToken.get(token)
        if (!docs.has(label)) docs.set(label, [])
        // 라벨과 파일을 같이 남긴다. 라벨은 사람이 읽고 파일은 고칠 때 쓴다.
        // 라벨만 남기면 "어느 파일을 건드려야 하나"에 답할 수 없다.
        if (docs.get(label).length < 3) docs.get(label).push({ pol, line: line.trim(), file })
      }
    }
  }

  const out = []
  for (const [token, docs] of byToken) {
    if (docs.size < 2) continue // 문서 쌍이 안 된다
    const entries = [...docs.entries()].flatMap(([doc, ls]) => ls.map((l) => ({ doc, ...l })))
    const pols = new Set(entries.map((e) => e.pol))
    // 한쪽이 금지고 다른 쪽이 권장일 때만 후보다. 같은 방향이면 그냥 반복이다.
    //
    // `both` 를 neg 쪽에도 세보고 되돌렸다. 문서 221개 하네스에서 10건이 늘었는데
    // 전부 거짓 양성이었다. "NEVER use `X`" 가 never 와 use 때문에 both 로 잡히고,
    // 두 문서가 똑같은 문장을 반복하는 것까지 대립으로 올라온다.
    // both 를 pos 쪽으로만 쓰는 게 그 반복을 막는 장치였다.
    if (!pols.has('neg') || !(pols.has('pos') || pols.has('both'))) continue
    out.push({ token, docs: [...docs.keys()], evidence: entries })
  }
  return out
}
