// 비용 추정 기준.
// 공식 가격 페이지(2026-06 기준)를 인용하고, 그 시점의 상대 가중치를 동결한다.
// 이 값은 청구 금액이 아니라 규칙 위반으로 인한 추정 차액을 계산할 때만 쓴다.

export const RATE_BASIS = {
  basisDate: '2026-06',
  sources: [
    'https://www.anthropic.com/pricing',
    'https://openai.com/api/pricing/',
  ],
  // 백만 토큰당 USD 가중치. 실제 달러 절대값이 아니라 모델 간 상대 비용을 맞춘다.
  models: {
    haiku: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheCreate: 1.0 },
    sonnet: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreate: 3.75 },
    opus: { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreate: 18.75 },
  },
  // 창 합계를 월 단위로 환산한다.
  // monthly = window_sum * (30 / max(window_days, 1))
  monthly(window_sum, window_days) {
    return window_sum * (30 / Math.max(window_days, 1))
  },
}
