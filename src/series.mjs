// 추세를 데이터에서 직접 뽑는다. 스냅샷에서 뽑지 않는다.
//
// 스냅샷은 `--save` 를 돌린 시점에만 생긴다. 실측에서 5개 중 4개가 2분 안에 찍혀 있었다.
// 그걸로 선을 그으면 한 시간에 열 번 돌린 것과 열흘에 걸쳐 열 번 돌린 것이 똑같이 보인다.
// 위임에는 줄마다 `ts` 가 있으니 한 번 훑어서 진짜 시계열을 만들 수 있다.
// 게다가 소급된다. 스냅샷을 N번 쌓기를 기다릴 필요가 없다.
//
// 스냅샷은 제 몫이 따로 있다. 원본 전사가 정리돼도 집계는 남기는 것.

// 주 단위로 묶는다.
//
// 실측(2026-08-27)으로 위임 1,100건이 38일에 흩어져 있다.
//   일 단위: 32칸, 분모 최소 2건. 분모 2인 칸의 비율은 아무 뜻이 없다
//   주 단위: 6칸, 분모 최소 61건 중앙 135건. 전부 말이 되는 크기다
// 30일 이동창은 반대로 너무 매끄럽다. 연속한 두 점이 29일을 공유해서 이번 주 변화가 안 보인다.
export function weekStart(ts) {
  const d = new Date(ts)
  const back = (d.getUTCDay() + 6) % 7 // 월요일을 주의 시작으로
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

// 분모가 이보다 작은 칸은 비율을 내지 않는다.
// 표본이 없으면 0% 가 아니라 판정 불가라는 원칙이 여기도 그대로다.
export const MIN_SAMPLE = 20

// 추세를 못 그리는 이유는 셋이고, 셋이 서로 다른 행동으로 이어진다.
//   시점 값이다        → 물음 자체가 성립하지 않는다. 기다려도 안 나온다
//   칸마다 표본이 얇다  → 위임이 쌓이면 나온다
//   위임이 원천이 아니다 → 이 축은 주별로 영원히 안 나온다
//
// 실측(2026-08-28, korean-tone): 위임 40건인 저장소에서 병렬 비율·평균 갈래·
// 서브에이전트 결말 셋이 "세션이나 토큰이 있어야 계산된다"고 말했다. 셋 다 위임만으로
// 계산되는 축이다. 이유가 틀렸다. 얇아서 못 낸 것이지 못 낼 축이 아니다.
//
// 그릴 수 있으면 null 을 낸다. 그려도 되는지의 판정을 한 곳에 둔다. 터미널은
// weeks.length >= 2 로 보고 화면은 solid.length >= 2 로 봐서, 터미널이 값 없는 칸만
// 있는 축에 `주별: ···  ()` 를 찍고 있었다. 점 세 개와 빈 괄호가 아무 말도 안 한다.
export function trendGap(weeks, { noTrend = null } = {}) {
  if (noTrend) return noTrend
  if (!weeks.length) return '이 축은 주별로 나눌 수 없다. 세션이나 토큰이 있어야 계산된다'
  const solid = weeks.filter((w) => typeof w.rate === 'number').length
  if (solid >= 2) return null
  if (solid === 1) return '주별 값이 한 칸뿐이다. 선을 그리려면 두 칸이 있어야 한다'
  return `주별로 나누면 칸마다 표본이 ${MIN_SAMPLE}건에 못 미친다. 위임이 쌓이면 나온다`
}

// 위임을 원천으로 하는 축만 낸다. 세션·훅 축은 단위가 달라 여기 안 섞는다.
export function weeklySeries(rows, axes, { measure, observe, minSample = MIN_SAMPLE } = {}) {
  const buckets = new Map()
  for (const r of rows) {
    if (!r.ts) continue
    const k = weekStart(r.ts)
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(r)
  }

  // 준수율은 source 가 없으면 위임으로 본다. 관찰값은 명시한 것만 낸다.
  const mine = {
    compliance: (axes.compliance ?? axes).filter((a) => (a.source ?? 'delegations') === 'delegations'),
    observation: (axes.observation ?? []).filter((a) => a.source === 'delegations'),
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([start, group]) => {
      const thin = group.length < minSample
      const measured = measure ? measure({ delegations: group }, mine.compliance) : []
      // 관찰값도 위임만 있으면 되는 것은 같이 낸다. 세션·토큰이 필요한 축은 mine 에 안 들어온다.
      const watched = observe ? observe({ delegations: group }, mine.observation) : []
      return {
        start,
        delegations: group.length,
        axes: Object.fromEntries([
          ...measured.map((m) => [
            m.id,
            // 분모가 작으면 비율 대신 null 을 낸다. 작은 표본의 큰 흔들림을 추세로 읽으면 안 된다.
            m.total < minSample ? { rate: null, total: m.total, thin: true } : { rate: m.rate, total: m.total, violations: m.violations },
          ]),
          ...watched.map((o) => [o.id, thin ? { rate: null, total: group.length, thin: true } : { rate: o.value ?? null, total: o.n ?? group.length }]),
        ]),
      }
    })
}

// 터미널에 한 줄로 그린다. 값이 있는 칸만 점을 찍는다.
const BARS = '▁▂▃▄▅▆▇█'
export function sparkline(values, { min = 0, max = 1 } = {}) {
  const span = max - min || 1
  return values
    .map((v) => (v === null || v === undefined ? '·' : BARS[Math.min(BARS.length - 1, Math.floor(((v - min) / span) * BARS.length))]))
    .join('')
}
