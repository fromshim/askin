// 카드 층의 데이터 층. buildReport() 를 안 부른다 — 손으로 만든 report 픽스처로
// cards()·handoff()·ignored 만 잰다. 사용자 데이터(~/.harness-bro, ~/.claude)를 안 건드린다.
//   node --test test/coach.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inventory, cards, handoff, loadIgnored, saveIgnored, ignoredPath } from '../src/coach.mjs'
import { NO_DEFINITION } from '../src/graph.mjs'

function baseReport(over = {}) {
  return {
    scope: { repo: '/repo' },
    compliance: [],
    refs: { deadPaths: [], brokenSkillRefs: [], danglingSkills: [] },
    citations: [],
    contradictions: [],
    ...over,
  }
}

// ── inventory ────────────────────────────────────────────────────────

test('inventory 가 저장소 갈래를 저장소 폴더에서만 센다', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-coach-'))
  try {
    fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(repo, '.claude', 'agents', 'my-agent.md'), '---\nname: my-agent\n---\n')
    fs.mkdirSync(path.join(repo, '.claude', 'skills', 'my-skill'), { recursive: true })
    fs.writeFileSync(path.join(repo, '.claude', 'skills', 'my-skill', 'SKILL.md'), '# my-skill')
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# 규칙')

    const graph = {
      nodes: [
        { id: 'agent:my-agent', kind: 'agent', scope: 'repo', name: 'my-agent', calls: 5 },
        // 정의가 없는(builtin) 에이전트 노드. calls 가 크지만 합계에 안 들어가야 한다.
        { id: 'agent:general-purpose', kind: 'agent', scope: NO_DEFINITION, name: 'general-purpose', calls: 999 },
        { id: 'skill:my-skill', kind: 'skill', scope: 'repo', name: 'my-skill', calls: 2 },
      ],
      edges: [],
    }

    const inv = inventory(repo, graph)
    // harnessDocs 는 CLAUDE.md 뿐 아니라 저장소 scope 인 에이전트 정의 파일도 하네스
    // 문서로 친다(refs.mjs) — CLAUDE.md + my-agent.md 로 2다.
    assert.equal(inv.docs.repo, 2)
    assert.equal(inv.agents.repo, 1)
    assert.equal(inv.agents.total, inv.agents.global + inv.agents.repo)
    // 정의가 있는 노드(scope repo/global)만 더한다 — builtin 노드의 999 는 안 들어간다.
    assert.equal(inv.agents.calls, 5)
    assert.equal(inv.skills.usedByScope.repo, 1)
    assert.equal(inv.skills.definedByScope.repo, 1)
    assert.equal(
      inv.skills.defined,
      Object.values(inv.skills.definedByScope).reduce((a, b) => a + b, 0),
    )
    assert.equal(inv.hooks, null) // report.hookRows 를 볼 길이 없는 시그니처라 늘 null
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('inventory 가 스킬 usedByScope 네 갈래를 다 채운다', () => {
  const graph = {
    nodes: [
      { id: 'skill:design', kind: 'skill', scope: 'builtin', name: 'design', calls: 1 },
      { id: 'agent:x', kind: 'agent', scope: 'builtin', name: 'x', calls: 1 },
    ],
    edges: [],
  }
  const inv = inventory('/nonexistent-repo-xyz', graph)
  assert.deepEqual(Object.keys(inv.skills.usedByScope).sort(), ['builtin', 'global', 'plugin', 'repo'].sort())
  assert.equal(inv.skills.usedByScope.builtin, 1)
  assert.equal(inv.skills.usedByScope.repo, 0)
})

test('inventory 의 mcp 는 노드가 없으면 top 이 null 이다', () => {
  const inv = inventory('/nonexistent-repo-xyz', { nodes: [], edges: [] })
  assert.equal(inv.mcp.used, 0)
  assert.equal(inv.mcp.calls, 0)
  assert.equal(inv.mcp.top, null)
})

test('inventory 의 mcp top 은 호출이 가장 많은 서버다', () => {
  const graph = {
    nodes: [
      { id: 'mcp:playwright', kind: 'mcp', scope: 'unknown', name: 'playwright', calls: 20 },
      { id: 'mcp:mobbin', kind: 'mcp', scope: 'unknown', name: 'mobbin', calls: 5 },
    ],
    edges: [],
  }
  const inv = inventory('/nonexistent-repo-xyz', graph)
  assert.equal(inv.mcp.used, 2)
  assert.equal(inv.mcp.calls, 25)
  assert.deepEqual(inv.mcp.top, { name: 'playwright', calls: 20 })
})

// ── cards: broken ────────────────────────────────────────────────────

test('죽은 경로 1건은 전역 칩이 붙은 카드 한 장이다', () => {
  const report = baseReport({
    refs: {
      deadPaths: [
        {
          doc: '/Users/x/.claude/CLAUDE.md',
          token: 'origin/main',
          line: '- 작업 시작 전에 `origin/main` 위로 리베이스한다',
          lineNumber: 56,
          how: 'git 이 아는 경로 어디에도 없음',
        },
      ],
      brokenSkillRefs: [],
      danglingSkills: [],
    },
  })
  const list = cards(report)
  assert.equal(list.length, 1)
  const card = list[0]
  assert.equal(card.tier, 'broken')
  assert.equal(card.kind, 'dead-path')
  assert.equal(card.scope, 'global') // /Users/x/.claude 는 /repo 밖이다
  assert.equal(card.sure, false)
  assert.equal(card.count, 1)
  assert.match(card.title, /^전역 CLAUDE\.md:56 가 없는 경로를 가리킨다$/)
  assert.match(card.caution, /셋에 하나/)
  assert.equal(card.findings.length, 1)
  assert.deepEqual(card.files, ['/Users/x/.claude/CLAUDE.md'])
})

test('같은 종류·같은 범위의 심링크 3건이 카드 한 장으로 묶인다', () => {
  const report = baseReport({
    refs: {
      deadPaths: [],
      brokenSkillRefs: [],
      danglingSkills: [
        { skill: 'a', path: '/Users/x/.claude/skills/a', scope: 'global', target: '../../.agents/skills/a' },
        { skill: 'b', path: '/Users/x/.claude/skills/b', scope: 'global', target: '../../.agents/skills/b' },
        { skill: 'c', path: '/Users/x/.claude/skills/c', scope: 'global', target: '../../.agents/skills/c' },
      ],
    },
  })
  const list = cards(report)
  assert.equal(list.length, 1)
  assert.equal(list[0].count, 3)
  assert.match(list[0].title, /전역 스킬 심링크 3개가 없는 곳을 가리킨다/)
  assert.equal(list[0].sure, true) // 존재 확인은 fs.existsSync 로 확정한 사실이다
  // 최대 3줄까지는 넘침 표시가 없다
  assert.equal(list[0].evidence.length, 3)
  assert.ok(!list[0].evidence.some((l) => l.startsWith('외 ')))
})

test('저장소 안 심링크는 전역 칩이 안 붙는다', () => {
  const report = baseReport({
    refs: {
      deadPaths: [],
      brokenSkillRefs: [],
      danglingSkills: [{ skill: 'a', path: '/repo/.claude/skills/a', scope: 'repo', target: '../x' }],
    },
  })
  const [card] = cards(report)
  assert.equal(card.scope, 'repo')
  assert.equal(card.title, '스킬 심링크 1개가 없는 곳을 가리킨다')
})

test('4건이 넘으면 근거 줄이 외 N건으로 접힌다', () => {
  const report = baseReport({
    refs: {
      deadPaths: [],
      brokenSkillRefs: [],
      danglingSkills: [1, 2, 3, 4].map((n) => ({
        skill: `s${n}`,
        path: `/repo/.claude/skills/s${n}`,
        scope: 'repo',
        target: `../${n}`,
      })),
    },
  })
  const [card] = cards(report)
  assert.equal(card.count, 4)
  assert.equal(card.evidence.length, 4)
  assert.equal(card.evidence.at(-1), '외 1건')
})

test('모순 후보의 근거가 저장소·전역에 걸치면 scope 가 mixed 다', () => {
  const report = baseReport({
    contradictions: [
      {
        token: 'var',
        docs: ['agent:x', 'agent:y'],
        evidence: [
          { pol: 'neg', doc: 'agent:x', line: 'a', file: '/repo/CLAUDE.md' },
          { pol: 'pos', doc: 'agent:y', line: 'b', file: '/Users/x/.claude/CLAUDE.md' },
        ],
      },
    ],
  })
  const [card] = cards(report)
  assert.equal(card.kind, 'contradiction')
  assert.equal(card.scope, 'mixed')
  assert.match(card.title, /^전역·저장소 /)
  assert.match(card.caution, /후보만 좁혔다/)
})

test('broken 카드는 fix.mjs KIND_NAMES 순서를 따른다', () => {
  const report = baseReport({
    refs: {
      deadPaths: [{ doc: '/repo/CLAUDE.md', token: 'a/b', line: 'x', lineNumber: 1, how: '뿌리에서 찾을 수 없음' }],
      brokenSkillRefs: [],
      danglingSkills: [{ skill: 's', path: '/repo/.claude/skills/s', scope: 'repo', target: '../x' }],
    },
  })
  const list = cards(report)
  const kinds = list.map((c) => c.kind)
  assert.deepEqual(kinds, ['dead-path', 'dangling-skill']) // dead-path 가 dangling-skill 보다 먼저다
})

test('문제 아님으로 무시한 id 는 다시 안 나온다', () => {
  const report = baseReport({
    refs: {
      deadPaths: [{ doc: '/repo/CLAUDE.md', token: 'a/b', line: 'x', lineNumber: 1, how: '뿌리에서 찾을 수 없음' }],
      brokenSkillRefs: [],
      danglingSkills: [],
    },
  })
  const [card] = cards(report)
  const filtered = cards(report, { ignored: [card.id] })
  assert.equal(filtered.length, 0)
})

test('같은 report 로 두 번 불러도 카드 id 가 같다', () => {
  const report = baseReport({
    refs: {
      deadPaths: [{ doc: '/repo/CLAUDE.md', token: 'a/b', line: 'x', lineNumber: 1, how: '뿌리에서 찾을 수 없음' }],
      brokenSkillRefs: [],
      danglingSkills: [],
    },
  })
  assert.deepEqual(
    cards(report).map((c) => c.id),
    cards(report).map((c) => c.id),
  )
})

// ── cards: rule ──────────────────────────────────────────────────────

test('위반이 있고 판정 가능한 축만 규칙 카드가 된다', () => {
  const report = baseReport({
    compliance: [
      {
        id: 'model-explicit',
        label: '모델 명시',
        rule: '~/.claude/CLAUDE.md:9  model 파라미터를 항상 명시한다',
        total: 10,
        violations: 2,
        rate: 0.8,
        samples: ['general-purpose model=없음', 'runner model=없음'],
        concentration: [{ key: 'general-purpose', count: 2, of: 5, rate: 0.4 }],
      },
      {
        id: 'chore-model',
        label: '잡무 모델',
        rule: '~/.claude/CLAUDE.md  판단이 필요 없는 잡무는 haiku 로 보낸다',
        total: 0,
        violations: 0,
        rate: null,
        unavailable: '이 범위에 위임 기록이 없다',
        samples: [],
      },
      {
        id: 'hook-integrity',
        label: '훅 무결성',
        rule: '훅이 조용히 실패하면 규칙이 안 지켜져도 아무도 모른다',
        total: 5,
        violations: 0,
        rate: 1,
        samples: [],
      },
    ],
  })
  const list = cards(report)
  assert.equal(list.length, 1)
  const card = list[0]
  assert.equal(card.tier, 'rule')
  assert.equal(card.axisId, 'model-explicit')
  assert.equal(card.kind, null)
  assert.equal(card.sure, true)
  assert.equal(card.count, 2)
  assert.equal(card.scope, 'global') // ~/.claude/CLAUDE.md 는 /repo 밖이다
  assert.match(card.title, /^전역 모델 명시 10건 중 2건 위반$/)
  assert.deepEqual(card.evidence, ['general-purpose model=없음', 'runner model=없음'])
  assert.match(card.recommend, /model 을 명시하면 위반 2건이 없어져요\./)
})

test('규칙 카드가 rule → broken 순으로 온다', () => {
  const report = baseReport({
    compliance: [
      {
        id: 'model-explicit',
        label: '모델 명시',
        rule: '~/.claude/CLAUDE.md:9  model 파라미터를 항상 명시한다',
        total: 4,
        violations: 1,
        rate: 0.75,
        samples: ['x model=없음'],
      },
    ],
    refs: {
      deadPaths: [{ doc: '/repo/CLAUDE.md', token: 'a/b', line: 'x', lineNumber: 1, how: '뿌리에서 찾을 수 없음' }],
      brokenSkillRefs: [],
      danglingSkills: [],
    },
  })
  const list = cards(report)
  assert.deepEqual(
    list.map((c) => c.tier),
    ['rule', 'broken'],
  )
})

test('근거 파일이 없는 규칙(스킬 선언·훅)은 저장소 범위로 잡고 기본 문구를 쓴다', () => {
  const report = baseReport({
    compliance: [
      {
        id: 'skill-declared-exists',
        label: '스킬 선언 무결성',
        rule: '에이전트가 선언한 스킬이 실재해야 한다',
        total: 4,
        violations: 4,
        rate: 0,
        samples: ['a → x (없음)', 'a → y (없음)', 'a → z (없음)', 'a → w (없음)'],
      },
    ],
  })
  const [card] = cards(report)
  assert.equal(card.scope, 'repo')
  assert.equal(card.evidence.length, 4)
  assert.equal(card.evidence.at(-1), '외 1건')
  assert.match(card.recommend, /선언을 지우거나 스킬을 만들면 위반 4건이 없어져요\./)
})

test('표에 없는 사용자 축도 기본 문구로 카드가 된다', () => {
  const report = baseReport({
    compliance: [
      {
        id: 'my-custom-axis',
        label: '내 규칙',
        rule: '/repo/CLAUDE.md  내가 정한 규칙',
        total: 5,
        violations: 5,
        rate: 0,
        samples: ['s1'],
      },
    ],
  })
  const [card] = cards(report)
  assert.equal(card.scope, 'repo') // /repo/CLAUDE.md 는 저장소 안이다
  assert.match(card.recommend, /규칙을 지키면 위반 5건이 없어져요\./)
})

// ── handoff ──────────────────────────────────────────────────────────

test('handoff 가 broken 카드에 fix.mjs 지시서를 그대로 싣는다', () => {
  const report = baseReport({
    refs: {
      deadPaths: [
        { doc: '/repo/CLAUDE.md', token: 'lib/gone.ts', line: '- 오류는 `lib/gone.ts` 를 쓴다', lineNumber: 3, how: '뿌리에서 찾을 수 없음' },
      ],
      brokenSkillRefs: [],
      danglingSkills: [],
    },
  })
  const [card] = cards(report)
  const md = handoff(card, report)
  assert.match(md, /^# /)
  assert.match(md, /추천: /)
  assert.match(md, /askin 이 전사를 실측해 만든 문서다\. 수정 전에 무엇을 바꿀지 먼저 물어라\./)
  assert.match(md, /## 고칠 것/) // fix.mjs instruction() 이 만드는 절
  assert.match(md, /lib\/gone\.ts/)
})

test('handoff 가 rule 카드에 규칙·재는 방식·몰린 곳·표본·건드릴 파일·끝나면을 담는다', () => {
  const report = baseReport({
    compliance: [
      {
        id: 'model-explicit',
        label: '모델 명시',
        rule: '~/.claude/CLAUDE.md:9  model 파라미터를 항상 명시한다',
        total: 10,
        violations: 2,
        rate: 0.8,
        samples: ['general-purpose model=없음', 'runner model=없음'],
        concentration: [{ key: 'general-purpose', count: 2, of: 5, rate: 0.4 }],
      },
    ],
  })
  const [card] = cards(report)
  const md = handoff(card, report)
  assert.match(md, /^# /)
  assert.match(md, /## 규칙/)
  assert.match(md, /model 파라미터를 항상 명시한다/)
  assert.match(md, /## 이 축이 재는 방식/)
  assert.match(md, /분모는 fork 를 뺀 위임, 위반은 model 없음/)
  assert.match(md, /## 몰린 곳/)
  assert.match(md, /general-purpose\s+2\/5/)
  assert.match(md, /## 표본/)
  assert.match(md, /general-purpose model=없음/)
  assert.match(md, /## 건드릴 파일/)
  assert.match(md, /전역 문서가 섞여 있다/) // ~/.claude/CLAUDE.md 가 /repo 밖이다
  assert.match(md, /## 끝나면/)
  assert.match(md, /report\.mjs --repo \/repo/)
  assert.match(md, /## 출처/)
})

test('handoff 는 repo 를 안 주면 report.scope.repo 를 쓴다', () => {
  const report = baseReport({
    scope: { repo: '/repo' },
    compliance: [
      { id: 'model-explicit', label: '모델 명시', rule: '~/.claude/CLAUDE.md:9  model 파라미터를 항상 명시한다', total: 1, violations: 1, rate: 0, samples: ['x'] },
    ],
  })
  const [card] = cards(report)
  const md = handoff(card, report)
  assert.match(md, /report\.mjs --repo \/repo/)
})

// ── 문제 아님 ────────────────────────────────────────────────────────

test('없는 파일을 읽으면 빈 목록이다', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-ignored-')), 'nope.json')
  assert.deepEqual(loadIgnored(file), [])
})

test('저장하고 읽으면 그대로 돌아온다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-ignored-'))
  const file = path.join(dir, 'ignored.json')
  saveIgnored(['broken:dead-path:global', 'rule:model-explicit'], file)
  assert.deepEqual(loadIgnored(file), ['broken:dead-path:global', 'rule:model-explicit'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('HARNESS_BRO_IGNORED 로 경로를 바꿀 수 있다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-ignored-'))
  const file = path.join(dir, 'custom.json')
  const prev = process.env.HARNESS_BRO_IGNORED
  process.env.HARNESS_BRO_IGNORED = file
  try {
    assert.equal(ignoredPath(), file)
    saveIgnored(['x'])
    assert.deepEqual(loadIgnored(), ['x'])
  } finally {
    if (prev === undefined) delete process.env.HARNESS_BRO_IGNORED
    else process.env.HARNESS_BRO_IGNORED = prev
    fs.rmSync(dir, { recursive: true, force: true })
  }
})


// 요약 띠의 훅 칸은 report.hookTotals 를 그대로 받는다. 안 넘기면 판정 불가(null)다.
// 여기서 세션을 다시 세면 같은 합을 두 곳에서 내게 된다(CLAUDE.md "같은 판정을 두 곳에 두지 않는다").
test('inventory 의 hooks 는 report.hookTotals 를 그대로 받고, 없으면 null 이다', () => {
  const graph = { nodes: [], edges: [] }
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bro-coach-inv-'))
  assert.equal(inventory(repo, graph).hooks, null)
  assert.deepEqual(inventory(repo, graph, { hooks: { runs: 9638, events: 64, fail: 0 } }).hooks, { runs: 9638, events: 64, fail: 0 })
})
