// 파일에서 뽑은 사실을 크기+mtime 으로 캐시한다.
//
// 전사 파일은 append-only 라 한 번 쓰인 줄이 안 바뀐다. 크기와 mtime 이 둘 다 같으면
// 같은 파일로 봐도 된다. 실측(2026-08-27)으로 1,252개 중 최근 1분에 바뀐 것이 1개다.
//
// 캐시가 없거나 깨져도 답은 같다. 느려질 뿐이다. 그래서 실패는 전부 조용히 넘긴다.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'

function cacheDir() {
  return process.env.HARNESS_BRO_CACHE ?? path.join(os.homedir(), '.harness-bro', 'cache')
}

// 캐시 파일은 보고 있는 뿌리마다 따로 둔다.
//
// 안 그러면 다른 뿌리를 한 번 보는 것만으로 캐시가 통째로 날아간다.
// 통째로 갈아 끼우는 방식이라 항목이 겹치지 않아도 앞의 것이 사라진다.
// 실제로 테스트가 임시 디렉터리를 보면서 진짜 캐시 1,252건을 4건으로 덮어썼다.
// 테스트에서 조심하는 것으로 막지 않고 파일을 갈라서 막는다.
//
// 가르는 것으로 덮어쓰기는 막았지만 쌓이는 것은 못 막았다. 실측(2026-08-27):
// 캐시 파일 174개 중 171개가 테스트 픽스처 잔재였다. 실제 데이터는 3개다.
// 테스트마다 새 임시 뿌리를 만들니 파일이 계속 늘고, 아래 prune 의 두 주 기준으로만
// 걷힌다. 그래서 `npm test` 가 HARNESS_BRO_CACHE 로 캐시를 격리한다(package.json).
// 뽑는 함수가 바뀌면 옛 캐시는 못 쓴다.
//
// 크기와 mtime 만 보면 파일이 안 바뀐 것만 확인한다. 뽑는 쪽이 바뀐 것은 못 본다.
// 실측(2026-08-27): 안 쓰는 세션 필드 여섯 개를 걷었는데 캐시가 안 바뀐 전사에 대해
// 옛 facts 를 계속 냈다. 무해한 경우였지만, 30·31회차에 훅과 도구 차단 집계를
// 고칠 때는 `--no-cache` 를 매번 붙여야 실측이 맞았다. 고친 로직을 캐시가 덮는다.
//
// 주석과 공백은 뗀다. 축 지문과 같은 이유다. 안 떼면 주석 한 줄에 캐시가 통째로 날아간다.
function fnStamp(fn) {
  const body = String(fn)
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    .replace(/\s+/g, '')
  return createHash('sha1').update(body).digest('hex').slice(0, 8)
}

export function fileCache(name, { enabled = true, root = '' } = {}) {
  const tag = createHash('sha1').update(String(root)).digest('hex').slice(0, 8)
  const file = path.join(cacheDir(), `${name}-${tag}.json`)
  const loaded = enabled ? load(file) : null
  const after = enabled ? {} : null
  let stamp = null
  let before = null
  let read = 0
  let reused = 0

  return {
    // extract 는 캐시가 안 맞을 때만 부른다. stat 이 실패하면 null 을 돌려준다.
    get(target, extract) {
      if (stamp === null) {
        stamp = fnStamp(extract)
        // 옛 캐시 파일은 평평한 맵이라 entries 가 없다. 그때도 안 쓴다
        before = loaded?.stamp === stamp ? loaded.entries : null
      }
      let st
      try {
        st = fs.statSync(target)
      } catch {
        return null
      }
      const hit = before?.[target]
      const fresh = hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs ? hit.facts : null
      const facts = fresh ?? extract(target)
      fresh ? reused++ : read++
      if (after) after[target] = { size: st.size, mtimeMs: st.mtimeMs, facts }
      return facts
    },
    // 여러 파일을 한 번에 뽑는 길. 밖에서 도는 스캐너를 쓸 때 필요하다.
    //
    // get() 은 파일마다 extract 를 부른다. 프로세스를 띄우는 스캐너에는 그 모양이 안 맞는다.
    // 낡은 것만 골라 한 번에 넘기고 결과를 받는다. **캐시가 맞으면 스캐너를 아예 안 부른다.**
    // 늘 부르면 캐시가 있을 때 오히려 느려진다. 실측: 맞을 때 18ms 대 430ms 다.
    //
    // 지문은 밖에서 준다. get() 은 JS 함수 소스를 해시하는데 밖의 스캐너는 그걸로 안 잡힌다.
    // 바이너리를 고쳐도 옛 캐시가 덮는다.
    getBatch(targets, { stamp: given, extract }) {
      if (stamp === null) {
        stamp = given
        before = loaded?.stamp === stamp ? loaded.entries : null
      }
      const seen = new Map()
      const stale = []
      const facts = new Map()
      for (const target of targets) {
        let st
        try {
          st = fs.statSync(target)
        } catch {
          continue
        }
        seen.set(target, st)
        const hit = before?.[target]
        if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
          facts.set(target, hit.facts)
          reused++
        } else stale.push(target)
      }
      if (stale.length) {
        for (const [target, v] of extract(stale)) {
          if (!seen.has(target)) continue
          facts.set(target, v)
          read++
        }
      }
      if (after) {
        for (const [target, v] of facts) {
          const st = seen.get(target)
          after[target] = { size: st.size, mtimeMs: st.mtimeMs, facts: v }
        }
      }
      return facts
    },
    save() {
      if (!after) return { read, reused }
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        // 통째로 갈아 끼운다. 반쯤 쓰다 죽으면 다음 번에 깨진 캐시를 읽게 된다.
        const tmp = `${file}.tmp`
        fs.writeFileSync(tmp, JSON.stringify({ stamp, entries: after }))
        fs.renameSync(tmp, file)
        prune(path.dirname(file))
      } catch {
        /* 캐시는 못 써도 답은 같다 */
      }
      return { read, reused }
    },
  }
}

function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// 오래 안 만진 캐시 파일을 걷는다.
//
// 캐시를 뿌리마다 가르면서 생긴 부작용이다. 한 번 훑은 뿌리마다 파일이 셋 남고 영영 안 지워진다.
// 실측에서 48개 중 27개가 임시 뿌리의 잔재였다. 바이트로는 작지만 개수가 안 멈춘다.
//
// 두 주 동안 안 만진 캐시는 그 뿌리를 더 안 본다는 뜻이다. 지워도 답은 같고 한 번 느릴 뿐이다.
const STALE_DAYS = 14

function prune(dir) {
  const cutoff = Date.now() - STALE_DAYS * 864e5
  for (const name of readdirSafe(dir)) {
    if (!name.endsWith('.json')) continue
    const target = path.join(dir, name)
    try {
      if (fs.statSync(target).mtimeMs < cutoff) fs.rmSync(target)
    } catch {
      /* 지우는 데 실패해도 그냥 둔다 */
    }
  }
}

function readdirSafe(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}
