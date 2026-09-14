# askin 랜딩페이지

기존 제품 정의·배포 현황은 BRIEF.md, 랜딩 구현 결정은 DESIGN.md를 참고한다.

## 로컬 실행

저장소 루트에서 실행한다.

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory site
```

브라우저에서 http://127.0.0.1:4173 를 연다. 빌드나 패키지 설치는 필요 없다.

## 검증

이미 Playwright와 Chrome을 사용할 수 있는 환경에서는 서버를 띄운 뒤 실행한다. 의존성을 저장소 루트에 추가하지 않는다.

```sh
node site/scripts/verify.mjs
# Playwright가 다른 곳에 설치되어 있다면:
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node site/scripts/verify.mjs
```

375/400/768/1280px의 라이트·다크 캡처, 가로 넘침, 버튼 44px, 테마 유지, 그래프 선택, 복사 성공·반복·실패, reduced-motion, JavaScript 없는 HTML을 검증한다. 캡처는 .impeccable/review/에 남고 커밋·배포에서 제외한다. 기존 앱 회귀 검사는 루트의 npm test.

## 배포

주소는 https://get-askin.vercel.app 이다. `askin-desktop.vercel.app` 과 `askin-xi.vercel.app` 도 같은 프로젝트를 가리킨다(`askin.vercel.app` 과 `askin-app.vercel.app` 은 남이 점유 중이라 못 쓴다).

Vercel에 올린다. Root Directory는 site, Framework Preset은 Other, 빌드 명령은 비운다. 별도 출력 폴더가 없는 정적 사이트다. .vercelignore가 제품 내부 문서와 검증 스크립트, 미사용 목업을 빼서 BRIEF.md·DESIGN.md·PRODUCT.md·.impeccable은 배포에 안 올라간다(실측으로 404 확인).

```sh
npm run deploy               # 미리보기 (저장소 루트에서)
npm run deploy -- --prod     # 프로덕션
```

`deploy` 스크립트는 `cd site && vercel` 이다. `--` 뒤에 준 인자는 vercel 명령 끝에 붙는다.

**배포는 이 명령으로만 한다.** GitHub 에 push 해도 자동 배포되지 않는다. Vercel Hobby 플랜은 개인 계정
저장소만 Git 연동을 지원하고 이 저장소는 `fromshim` 조직 소속이라 연결할 수 없다(`vercel git connect` 가
실패한다). push 는 소스 보관이고 배포는 따로다.

미리보기 URL은 Vercel 보호가 걸려 로그인 없이 안 열린다. 내용을 확인하려면 `vercel curl <url>`을 쓴다.

다운로드 버튼은 GitHub Releases를 가리킨다. 버전을 올리면 index.html의 #start 안 링크와 파일 크기 표시를 같이 고친다. 가격·라이선스는 아직 없고 임의로 넣지 않는다.

## 그래프와 모션

motion.js는 외부 컴포넌트나 라이브러리 없이 DOM 노드와 Canvas 연결선을 함께 움직인다. 커서 근처 노드의 작은 반발·시차와 부드러운 복귀, 한 번만 실행하는 섹션별 진입을 제공한다. 터치·reduced-motion에서는 커서 공간 효과를 끄고, 화면 밖·비활성 탭에서는 프레임을 멈춘다. JavaScript가 없어도 SVG 도해와 본문은 보인다.

추가 검증은 서버를 실행한 상태에서 node site/scripts/verify-motion.mjs로 실행한다. Playwright 모듈 경로는 위 PLAYWRIGHT_MODULE 방식으로 지정할 수 있다. 커서 이동·복귀, 연결선 재계산, 스크롤 진입·완료, 실행 중 reduced-motion 전환, 키보드·터치 선택을 확인한다.
