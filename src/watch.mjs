// 전사가 자라면 다시 재고, **나빠진 것만** 말한다.
//
// 알림의 실패 모드는 두 가지고 방향이 반대다.
//   너무 말이 많으면 아무도 안 본다
//   너무 말이 없으면 있으나 마나다
//
// 설계 문서가 고른 선은 "준수율이 떨어지거나 죽은 자산이 생기면"이다.
// 그래서 좋아진 것은 스냅샷에만 조용히 쌓고 말하지 않는다.

import fs from 'node:fs'
import { ROOT } from './scan.mjs'
import { comparable } from './snapshot.mjs'

// 무엇을 말할지 정하는 곳. 순수 함수라 눈으로 안 봐도 시험할 수 있다.
//
// 두 인자의 모양이 다르다. before 는 스냅샷(숫자만 남긴 것)이고 after 는 방금 잰 리포트다.
// 스냅샷에는 모순 후보의 토큰 이름이 없어서, 무엇이 새로 생겼는지 말하려면 리포트가 필요하다.
export function worseThings(before, after) {
  if (!before) return [] // 첫 측정에는 비교할 것이 없다
  const out = []

  for (const now of after.compliance) {
    const was = before.compliance?.[now.id]
    if (!was || was.rate === null || now.rate === null) continue
    // 재는 방식이 바뀐 축은 나빠진 게 아니다. 도구를 고쳐서 숫자가 움직인 것이다.
    // 실측: 서브에이전트 훅을 분모에 넣었더니 훅 무결성이 99.88% 에서 99.85% 로
    // 내려갔다. 그때 상주 중이었다면 "나빠졌다"고 알렸을 것이다.
    if (!comparable(was, now)) continue
    // 반올림해서 같아 보이는 흔들림은 말하지 않는다
    const diff = now.rate - was.rate
    if (diff >= -0.0005) continue
    out.push({
      kind: 'compliance',
      label: now.label,
      text: `${now.label} ${(was.rate * 100).toFixed(1)}% → ${(now.rate * 100).toFixed(1)}% (위반 ${was.violations}건 → ${now.violations}건)`,
    })
  }

  for (const [key, label] of [
    ['deadPaths', '문서가 가리키는데 없는 경로'],
    ['brokenSkillRefs', '선언했는데 없는 스킬'],
    ['danglingSkills', '스킬 디렉터리의 깨진 심링크'],
  ]) {
    const was = before.refs?.[key]
    const now = after.refs[key].length
    if (was === undefined || now <= was) continue
    out.push({ kind: 'refs', label, text: `${label} ${was}건 → ${now}건` })
  }

  // 근거가 사라진 축은 죽은 자산이다. 그 축은 판정에서 빠지는데, 준수율 갈래는
  // rate 가 null 이면 그냥 넘어가서 아무 말도 안 했다. 규칙 하나에 눈이 감긴 것을
  // 상주만 모르고 있었다.
  //
  // 분모가 비어 판정 불가가 된 것과는 다르다. 그건 창이 조용한 것이고 늘 일어난다.
  // 근거가 사라진 것은 하네스 문서가 바뀐 것이라 사람이 할 일이 있다.
  const wasCites = before.citations
  if (wasCites !== undefined && after.citations.length > wasCites) {
    out.push({
      kind: 'citation',
      label: '근거가 사라진 축',
      // 단위를 건으로 맞춘다. 기준선과 지시서가 "근거가 사라진 축 N건" 이라고 쓴다.
      // 셋이 같은 것을 다른 단위로 세면 받는 쪽이 같은 줄인지 대조하지 못한다.
      text: `근거가 사라진 축 ${wasCites}건 → ${after.citations.length}건: ${after.citations.map((c) => c.axis).join(', ')}`,
    })
  }

  const wasContra = before.contradictions
  if (wasContra !== undefined && after.contradictions.length > wasContra) {
    out.push({
      kind: 'contradiction',
      label: '모순 후보',
      text: `모순 후보 ${wasContra}건 → ${after.contradictions.length}건: ${after.contradictions.map((c) => c.token).join(', ')}`,
    })
  }

  return out
}

// fs.watch 는 한 번 저장에도 여러 번 운다. 게다가 세션이 도는 동안 전사가 계속 자란다.
// 그래서 조용해질 때까지 기다렸다가 한 번만 잰다.
export function watch({ onQuiet, root = ROOT, debounceMs = 2000, signal } = {}) {
  let timer = null
  let pending = 0

  const bump = () => {
    pending++
    clearTimeout(timer)
    timer = setTimeout(() => {
      const n = pending
      pending = 0
      onQuiet(n)
    }, debounceMs)
  }

  let watcher
  try {
    watcher = fs.watch(root, { recursive: true }, bump)
  } catch (e) {
    throw new Error(`전사 디렉터리를 감시할 수 없다: ${root}\n${e.message}`)
  }

  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    watcher.close()
  })
  return {
    close() {
      clearTimeout(timer)
      watcher.close()
    },
  }
}
