// 모델 원문 이름 → 짧은 표시 이름 변환을 잰다. 순수 함수라 DOM 없이 바로 테스트할 수 있다
// (desktop/app/renderer.mjs 의 다른 부분은 document.getElementById 를 모듈 로드 시점에
// 불러서 Node 테스트 러너에서 못 돌린다 — 그래서 이 파싱 규칙만 별도 모듈로 뗐다).
//   node --test test/model-name.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prettyModelName } from '../desktop/app/model-name.mjs'

// 실측(2026-09-02, 코디네이터가 원문 이름 전수로 뽑아 검사): 이 17종이 실제로 관측된
// 원문 모델 이름이다(Claude 세션 159개 · Codex 세션 다수 스캔). 마지막 하나
// (codex-auto-review)는 규칙에 안 맞는 값 — "파싱이 안 되면 원문 그대로" 갈래용이다.
const CASES = [
  ['claude-opus-5', 'Opus 5'],
  ['claude-opus-4-8', 'Opus 4.8'],
  ['claude-sonnet-5', 'Sonnet 5'],
  ['claude-sonnet-4-6', 'Sonnet 4.6'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
  ['claude-fable-5', 'Fable 5'],
  ['claude-fable-5-1', 'Fable 5.1'],
  ['gpt-5.6-sol', 'GPT 5.6 Sol'],
  ['gpt-5.6-terra', 'GPT 5.6 Terra'],
  ['gpt-5.6-luna', 'GPT 5.6 Luna'],
  ['gpt-5.5', 'GPT 5.5'],
  ['gpt-5.4', 'GPT 5.4'],
  ['gpt-5.4-mini', 'GPT 5.4 Mini'],
  ['gpt-5.3-codex', 'GPT 5.3 Codex'],
  ['gpt-5.2-codex', 'GPT 5.2 Codex'],
  ['gpt-5.1-codex-mini', 'GPT 5.1 Codex Mini'],
  ['codex-auto-review', 'codex-auto-review'], // 규칙에 안 맞아 원문 그대로
]

test('prettyModelName: 실측 17종이 코디네이터가 낸 표시 이름과 정확히 같다', () => {
  for (const [raw, pretty] of CASES) {
    assert.equal(prettyModelName(raw), pretty, `${raw} → ${prettyModelName(raw)} (기대값 ${pretty})`)
  }
})

test('prettyModelName: 파싱이 안 되면(claude-/gpt- 로 안 시작하면) 원문 그대로 낸다', () => {
  assert.equal(prettyModelName('codex-auto-review'), 'codex-auto-review')
  assert.equal(prettyModelName('unknown-model-xyz'), 'unknown-model-xyz')
})

test('prettyModelName: 새 모델이 늘어도 표시 이름이 서로 겹치면 안 된다', () => {
  // 지금 17종은 전부 유일하다. 모델이 늘 때 이 검사가 충돌을 잡는다 — 코디네이터 지시.
  const seen = new Map()
  for (const [raw] of CASES) {
    const pretty = prettyModelName(raw)
    const prevRaw = seen.get(pretty)
    assert.ok(!prevRaw || prevRaw === raw, `"${pretty}" 로 ${prevRaw} 와 ${raw} 가 충돌한다`)
    seen.set(pretty, raw)
  }
  assert.equal(seen.size, CASES.length, '표시 이름이 17종보다 적다 — 어딘가 충돌했다')
})
