#!/bin/bash
# claude / codex 대역. test/chat.test.mjs 가 이 파일을 .omo/evidence/task-10-mockbin/claude 와
# .../codex 로 복사해 PATH 앞에 둔다. 진짜 CLI 를 부르지 않으므로 구독 크레딧을 안 쓴다.
#
# 받은 argv 를 한 줄로 남긴다(plan Todo 10: printf '%s %s\n' "$(basename "$0")" "$*").
# 로그는 mockbin 의 부모(.omo/evidence/)에 쓴다 — runChat 이 cwd 를 다른 저장소로 줘도
# 같은 파일에 쌓이게. MOCK_ARGV_LOG 로 바꿀 수 있다.
#
# 조절 스위치(테스트 전용):
#   MOCK_EXIT=<n>        stderr 에 실패 문구를 쓰고 n 으로 끝낸다
#   MOCK_READ_STDIN=1    claude 로 불려도 stdin 을 EOF 까지 읽는다(진짜 claude -p 처럼).
#                        호출자가 stdin 을 안 닫으면 여기서 멈춘다 — 행 방지 검증용
set -u
name="$(basename "$0")"
log="${MOCK_ARGV_LOG:-$(cd "$(dirname "$0")/.." && pwd)/task-10-argv.log}"
printf '%s %s\n' "$name" "$*" >> "$log"

stdin_text=""
if [ "$name" = "codex" ] || [ "${MOCK_READ_STDIN:-}" = "1" ]; then
  stdin_text="$(cat)"
fi

if [ -n "${MOCK_EXIT:-}" ] && [ "${MOCK_EXIT}" != "0" ]; then
  printf 'mock %s: 로그인이 필요합니다\n' "$name" >&2
  exit "$MOCK_EXIT"
fi

case "$name" in
  claude)
    # claude -p <prompt>: 프롬프트는 argv 두 번째 자리로 온다
    printf '# Mock Claude response\n\n받은 지시: %s\n\n```sh\nnpm test\n```\n' "${2:-}"
    ;;
  codex)
    # codex exec -: 프롬프트는 stdin 으로 온다
    printf '# Mock Codex response\n\n받은 지시: %s\n' "$stdin_text"
    ;;
  *)
    printf 'mock: 모르는 이름 %s\n' "$name" >&2
    exit 64
    ;;
esac
