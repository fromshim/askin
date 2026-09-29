// 채팅 패널이 CLI stdout 을 그릴 때 쓰는 마크다운 조각 나누기. DOM 을 안 만지는 순수 함수라
// 렌더러(desktop/app/renderer.mjs)와 node 테스트(test/chat.test.mjs)가 같이 쓴다.
//
// 코드 펜스(```)만 code 조각으로 가르고 나머지는 text 조각으로 둔다. 외부 CLI 출력을 믿을 수
// 없으므로 HTML 로 해석하지 않는다 — 렌더러는 조각을 textContent 로만 넣는다.
// 닫히지 않은 펜스(스트림이 끊긴 출력)는 끝까지를 code 로 본다.
export function markdownSegments(text) {
  const src = String(text ?? '')
  const out = []
  const fence = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g
  let last = 0
  for (const m of src.matchAll(fence)) {
    if (m.index > last) out.push({ type: 'text', text: src.slice(last, m.index) })
    out.push({ type: 'code', lang: m[1].trim() || null, text: m[2].replace(/\n$/, '') })
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ type: 'text', text: src.slice(last) })
  return out.filter((s) => s.type === 'code' || s.text.length > 0)
}
