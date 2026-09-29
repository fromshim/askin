# askin 채팅 패널 BYOS 인증 계획 (Todo 11 Gate 1)

작성 2026-09-29. 대상 브랜치 `seungboshim-iconx/askin-sequential-impl`, 기준 커밋 `1b86b6f`.
이 문서는 Gate 1(기획)이다. 사람이 맨 아래 승인 줄을 직접 적기 전에는 Gate 2(구현)를 시작하지 않는다.

## 한 줄 요약

askin 은 인증을 하지 않는다. 사용자가 직접 설치한 `claude`·`codex` CLI 가 인증의 주체이고, askin 은
그 CLI 에 "로그인돼 있나"를 묻고, 로그인 명령을 사용자에게 안내하고, 실행 전에 "이 계정으로 돌린다"를
보여 줄 뿐이다. 토큰은 askin 프로세스에 들어오지 않는다. 사용자의 구독이나 키로 돌고, 개발자 크레딧은
끼지 않는다(BYOS).

## 근거 (2026-09-29 확인)

- Anthropic [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) — 제3자
  개발자가 자기 앱에 Claude.ai 로그인을 넣는 것, 사용자 대신 Free/Pro/Max 자격으로 요청을 보내는
  것, Claude.ai 자격·세션 토큰을 모으거나 저장하거나 중계하는 것을 허용하지 않는다. 로그인은 Anthropic
  자체 흐름으로 끝나야 한다. 반면 최종 사용자가 **수정하지 않은 Claude Code 바이너리**에 자기 구독으로
  로그인하는 것은 막지 않는다고 적는다. (문구는 라이선스 제한 때문에 요약했다)
- Claude Code [Authentication](https://code.claude.com/docs/en/authentication) — macOS 는
  Keychain 에 저장하고, 실패하면 `~/.claude/.credentials.json`(0600)에 쓴다. 인증 우선순위는
  `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` →
  프로필 → `/login` 구독 순이다. `claude setup-token` 은 1년짜리 토큰을 터미널에 찍기만 하고 저장하지
  않는다. 만료되면 `Login expired · Please run /login` 이 난다.
- Codex [Authentication](https://developers.openai.com/codex/auth) — ChatGPT 로그인과 API 키
  두 가지를 지원한다. 자격은 `~/.codex/auth.json`(평문)이나 OS 자격 저장소에 둔다. ChatGPT 세션은
  CLI 가 알아서 갱신한다.
- 로컬 실측(Claude Code 2.1.284, codex-cli 0.154.0, `--help` 만 봤고 로그인 상태는 안 바꿨다):
  - `claude auth status --json` 의 키: `loggedIn`, `authMethod`, `apiProvider`, `email`, `orgId`,
    `orgName`, `subscriptionType` 등. 토큰 값은 안 나온다.
  - `claude auth login [--claudeai|--console|--sso]`, `claude auth logout`, `claude setup-token`
  - `codex login status` 는 사람이 읽는 줄(`Logged in using ChatGPT`)과 종료 코드로 답한다.
  - `codex login [--device-auth|--with-api-key]`, `codex logout`

## 종료 기준 (Gate 1 exit criteria)

### 1. 제공자 (providers)

| 제공자 | 실행 파일 | 허용하는 인증 방식 | 누가 청구받나 |
|---|---|---|---|
| Claude Code | 사용자가 설치한 `claude`(수정 안 함, 번들 안 함) | claude.ai 구독 로그인, Console 로그인, 사용자 본인 API 키 | 사용자 |
| Codex CLI | 사용자가 설치한 `codex` | ChatGPT 로그인, 사용자 본인 API 키 | 사용자 |

askin 은 두 바이너리를 번들하지도 않고 미리 설치하지도 않는다. 없으면 설치 안내만 한다(Todo 10
`runChat` 의 ENOENT 안내와 같은 자리).

### 2. 스코프 (scopes)

askin 은 OAuth 클라이언트가 아니다. client id·client secret·redirect URI·스코프를 **하나도 갖지
않는다**. 스코프는 벤더 CLI 가 자기 로그인 흐름에서 정한다. askin 코드에 `client_id`, `client_secret`
문자열이 나오면 실패다(Todo 11 acceptance 의 grep).

### 3. 콜백 (loopback-or-scheme callback)

- 콜백 서버는 벤더 CLI 가 띄운다(Claude Code 의 로컬 콜백 서버, Codex 의 브라우저 흐름). askin 은
  loopback 포트도 커스텀 URL scheme(`askin://`)도 **등록하지 않는다**.
- 로그인 창은 시스템 브라우저로만 열린다. 벤더 CLI 가 연다. `BrowserWindow` 안에 로그인 페이지를
  띄우지 않는다.
- askin 이 로그인 명령을 실행하는 방법: 사용자의 터미널 앱에서 `claude auth login` / `codex login` 을
  연다(macOS 는 `open -a Terminal` 에 명령 스크립트를 넘긴다). 앱 안의 자식 프로세스로 돌리면서 stdout 의
  URL 이나 "Paste code here" 입력을 askin 이 중계하지 **않는다**. 붙여넣는 코드도 Claude 자체 흐름의
  일부라서, askin 이 받아 넘기면 "중계"가 된다.
- 로그인이 끝났는지는 `claude auth status --json` / `codex login status` 를 다시 불러 확인한다. 폴링은
  사용자가 "로그인했어요"를 누를 때 한 번만 한다(백그라운드 폴링 없음).

### 4. 비밀 저장 정책 (safeStorage-only)

- 벤더 CLI 의 자격 저장소(`~/.claude/.credentials.json`, macOS Keychain 항목, `~/.codex/auth.json`)는
  **읽지도, 복사하지도, 옮기지도 않는다**. 이 경로 문자열도 코드에 안 둔다(acceptance grep:
  `credentials.json`, `auth.json`).
- askin 이 저장할 수 있는 비밀은 딱 하나다. 사용자가 askin 안에 직접 넣은 **본인 API 키(BYOK)**.
  이것만 Electron `safeStorage.encryptString` 으로 암호화해서 `app.getPath('userData')` 아래 파일에 둔다.
  - `safeStorage.isEncryptionAvailable()` 가 false 면 **저장을 거부**한다(refuse). 평문으로 떨어지지
    않는다. Linux 에서 `getSelectedStorageBackend()` 가 `basic_text` 면 이것도 거부한다.
  - `localStorage`, `electron-store`, 평문 JSON 에는 비밀을 두지 않는다(acceptance grep).
  - 복호화한 키는 실행할 때 자식 프로세스 env 로만 넘긴다. claude 는 `ANTHROPIC_API_KEY`, codex 는
    `CODEX_API_KEY`(codex exec 전용 env,
    [Codex environment variables](https://developers.openai.com/codex/environment-variables)). 벤더
    저장소에 쓰는 `codex login --with-api-key` 는 쓰지 않는다. 렌더러로는 절대 안 보낸다. IPC 로는
    "키 있음/없음"만 간다.
- 로그에는 인증 방식과 만료 여부 **존재**만 적는다. 토큰, 키, 이메일은 로그·텔레메트리에 안 남긴다.

### 5. 로그아웃·철회 (logout/revoke)

| 대상 | askin 이 하는 일 | 실제 철회 주체 |
|---|---|---|
| Claude 구독 로그인 | 사용자 터미널에서 `claude auth logout` 을 연다 | Claude Code(`/logout` 이 자격을 지우고 철회한다) |
| Codex 로그인 | 사용자 터미널에서 `codex logout` 을 연다 | Codex CLI |
| askin BYOK 키 | safeStorage 파일을 지우고 메모리 값을 버린다 | askin |
| `CLAUDE_CODE_OAUTH_TOKEN` | 없음. askin 이 설정하지 않았으니 지우지도 않는다. 사용자에게 셸 프로필에서 지우라고 안내한다 | 사용자 |

### 6. 헤드리스 대안 (headless fallback)

브라우저 콜백이 안 닿는 환경(SSH, 컨테이너 등)을 위한 길이다. askin 은 안내만 하고 값을 받지 않는다.

- Claude: 사용자가 자기 터미널에서 `claude setup-token` 을 돌리고, 찍힌 토큰을 **자기 셸**에
  `CLAUDE_CODE_OAUTH_TOKEN` 으로 넣는다. askin 은 이 토큰을 입력받거나 저장하거나 env 에 주입하지
  않는다. 상속받은 env 에 이미 있으면 CLI 가 알아서 쓴다.
- Codex: `codex login --device-auth`(사용자 터미널에서).
- 둘 다: 본인 API 키(BYOK, 4절 정책).

### 7. 실행마다 계정 표시 + 동의 (per-run account display + opt-in)

- 채팅 전송 전에 main 프로세스가 상태를 묻는다(`claude auth status --json` / `codex login status`).
  결과에서 `loggedIn`, `authMethod`, `subscriptionType`, `email` 만 뽑아 렌더러로 보낸다.
- 입력창 위에 "Claude Code · claude.ai 구독(max) · a***@example.com 로 실행돼요"처럼 보여 준다.
  이메일은 화면에서만 가리고 로그에는 안 남긴다.
- 세션(창)마다 제공자별로 처음 한 번 "이 계정으로 실행" 동의를 받는다. 거절하면 **spawn 하지 않는다**
  (no-spawn-on-decline). 동의는 메모리에만 두고 디스크에 안 쓴다.
- 로그인 안 됨 → 전송 버튼 대신 "로그인 열기"(3절)를 보인다.
- 만료(`Login expired`, `Anthropic profile login expired`, `loggedIn:false` 로 바뀜) → 재로그인 안내를
  **한 번만** 띄운다. askin 은 갱신을 시도하지 않는다. 갱신하는 쪽은 벤더 CLI 하나뿐이다(single refresh
  writer). 오래된 토큰 사본으로 다시 시도하지도 않는다.

## 금지선 (Gate 2 에서도 그대로)

- 자체 Anthropic/OpenAI 구독 OAuth 클라이언트 구현, client id 하드코딩
- 벤더 CLI 자격 저장소 읽기·복사·이동, 토큰 금고
- `BrowserWindow` 안 로그인, 로그인 코드·URL 중계
- 평문 저장, `localStorage`/`electron-store` 에 비밀 두기
- 오래된 refresh 사본으로 재시도, askin 이 직접 refresh
- 개발자 크레딧·키로 사용자 요청 중계
- 토큰·키·이메일을 로그/텔레메트리에 남기기

## Gate 2 구현 개요 (승인 뒤)

- `src/auth.mjs`(새 파일). Electron 에 안 묶인 순수 모듈이고, spawn·safeStorage·fs 는 주입받는다
  (`runChat` 과 같은 방식). 그래서 테스트가 mock 만으로 돈다.
  - `detectStatus({ provider, spawn, env })`: 상태 명령을 돌려 `{ installed, loggedIn, method, plan, account }`
    를 낸다. account 는 가린 이메일이다.
  - `loginCommand` / `logoutCommand`: 사용자 터미널에 넘길 고정 명령. `openInTerminal`: macOS Terminal 에
    그 명령을 연다.
  - `createConsent()`: 창마다 메모리에 두는 동의. `sendWithConsent`: 동의가 없으면 spawn 하지 않는다.
  - `createReloginNotice()`: 만료가 보이면 재로그인 안내를 한 번만 낸다.
  - `createSecretStore({ safeStorage, file, fs })`: BYOK 키. safeStorage 를 못 쓰면 `refuse` 로 거부한다.
- `desktop/app/main.mjs`: `auth:status`, `auth:open-login`, `auth:open-logout`, `auth:consent`,
  `auth:key-set`, `auth:key-clear` IPC. `chat:send` 앞에서 동의를 확인하고 BYOK env 를 붙인다.
- `desktop/app/renderer.mjs`: 입력창 위 계정 줄, 동의 버튼, 로그인·로그아웃 열기, 본인 키 입력.
- 테스트 `test/oauth-safeStorage.test.mjs` 는 **mock 만** 쓴다(진짜 CLI 로 가는 갈래 없음):
  1. safeStorage 를 못 쓰면 거부한다. 테스트 이름에 `refuse` 를 넣는다
  2. 동의를 거절하면 spawn 이 한 번도 안 불린다
  3. 로그인된 fixture 에서 계정·방식이 보이고 동의 전 상태다
  4. 만료 fixture 에서 재로그인 안내가 정확히 한 번 나오고 재시도 spawn 이 없다
- acceptance 는 `.omo/plans/askin-sequential-impl.md` Todo 11 의 명령을 그대로 쓴다.

## 판단 (2026-09-29)

사용자가 2·3번은 직접 정했고, 1번은 에이전트에게 검증을 맡겼다. 결과는 다음과 같다.

1. **Anthropic 정책 → 로컬 구현은 진행해도 된다. 공개 배포 전에 다시 확인한다.**
   - 허용되는 쪽: [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) 는
     제3자가 금지되는 일을 셋으로 적는다. Claude.ai 로그인을 자기 앱에 넣기, 사용자 대신 구독 자격으로
     요청 보내기, 자격·세션 토큰을 모으거나 저장하거나 중계하기. askin 은 셋 다 안 한다. 로그인은
     Anthropic 자체 흐름(사용자 터미널의 `claude auth login`)으로 끝나고, askin 은 토큰을 안 본다. 같은
     페이지는 최종 사용자가 수정하지 않은 바이너리에 자기 구독으로 로그인하는 것은 막지 않는다고도 적는다.
   - 청구: `claude -p` 사용은 사용자 본인 플랜 앞으로 달린다. Anthropic 지원 문서
     [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
     은 `claude -p` 가 플랜 한도나 월 Agent SDK 크레딧에서 나간다고 적는다(판마다 문구가 다르다).
     어느 판이든 개발자 크레딧은 안 끼므로 BYOS 원칙은 지켜진다.
   - 조건: 바이너리를 번들·수정하지 않는다. 인증 방식을 막지 않는다. 사용료를 대신 내거나 되팔지 않는다.
     화면에는 "Claude Code" 를 무엇이 도는지 설명하는 평문으로만 쓰고, 제품·기능 이름이나 로고로 쓰지
     않는다.
   - 남는 불확실성: 앱이 Claude Code 를 부르는 것이 Legal 페이지의 "제품 안에서 Claude Code 를 실행"
     (Commercial Terms 동의 필요)에 드는지는 문서만으로 못 정한다. 공개 배포는 이번 계획의 Scope OUT
     이므로 **배포 전 확인 항목**으로 남긴다. 필요하면 Anthropic sales 에 묻는다.
   - Codex: [Codex auth](https://developers.openai.com/codex/auth) 는 ChatGPT 로그인과 API 키를 모두
     로컬 CLI 에서 지원하고, CLI 가 직접 갱신한다. askin 이 사용자 CLI 를 부르는 데 걸리는 문구는 없다.
     "신뢰할 수 없거나 공개된 환경에 Codex 실행을 노출하지 말라"는 경고는, 로컬 데스크톱에서 사용자가
     누를 때만 돈다는 것으로 충족한다.
2. **터미널 로그인 → 채택(사용자 결정).** 3절 그대로 간다.
3. **BYOK 키 저장 → Gate 2 에 넣는다(사용자 결정).** 4절 정책을 따른다. safeStorage 만 쓰고, 못 쓰면
   거부하고, 자식 env 로만 넘긴다.

## 승인

아래 줄은 사용자가 2026-09-29 채팅에서 "세 가지 판단은 자체 검증 및 수행해줘"라고 지시해서 에이전트가
대신 적었다. 원래 계획의 "사람이 직접 적는다" 절차에서 벗어난 것이며, 그 사실을 여기 남긴다.

SIGN-OFF: seungboshim 2026-09-29 — 1 로컬 진행·배포 전 재확인, 2 터미널 로그인 채택, 3 BYOK safeStorage 포함 (채팅 지시로 에이전트 대리 기재)
