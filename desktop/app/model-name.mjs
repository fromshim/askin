// 원문 모델 이름(claude-opus-5·gpt-5.6-sol 같은 값)을 사람이 읽기 좋은 짧은 이름으로 바꾼다
// — "Opus 5"·"Sonnet 5"·"GPT 5.6 Sol" 꼴이다(코디네이터 지시, 2026-09-02).
//
// 파싱은 이 표시 층에서만 한다. src/graph.mjs 는 원문 그대로 담는다 — 원문을 잃으면 나중에
// 못 되돌린다. renderer.mjs 가 이 함수를 불러 modelName() 안에서 쓴다.
//
// 파싱이 안 되면 원문 그대로 낸다. 억지로 예쁘게 만들면 그게 진짜 모델인지 아닌지가 흐려진다
// (CLAUDE.md: "문자열만 보고 못 가르는 것이 있다 ... 틀릴 수 있음을 지시서가 말한다").
//
// 실측(2026-09-02, 코디네이터가 원문 이름 전수로 검사): claude-*·gpt-* 17종을 이 규칙에
// 넣으면 서로 다른 이름으로 전부 갈리고 충돌이 0건이다 — test/model-name.test.mjs 가 그 17종을
// 그대로 넣어 유일성을 지킨다. 모델이 늘어 충돌이 생기면 그 검사가 잡는다.
export function prettyModelName(raw) {
  if (raw.startsWith('claude-')) {
    const rest = raw.slice('claude-'.length).replace(/-\d{8}$/, '') // 끝의 릴리스 날짜를 뗀다
    const parts = rest.split('-')
    return `${capitalize(parts[0])} ${parts.slice(1).join('.')}`.trim()
  }
  if (raw.startsWith('gpt-')) {
    const parts = raw.slice('gpt-'.length).split('-')
    return 'GPT ' + parts.map((p) => (/^[\d.]+$/.test(p) ? p : capitalize(p))).join(' ')
  }
  return raw
}

function capitalize(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : word
}
