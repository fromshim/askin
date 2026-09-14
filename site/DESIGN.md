---
name: askin landing
description: 기존 askin 브랜드를 따르는 한국어 제품 소개
colors:
  primary: "light-dark(#7c3aed, #a78bfa)"
  primary-hover: "light-dark(#5b21b6, #c4b5fd)"
  on-primary: "light-dark(#fff, #20162e)"
  canvas: "light-dark(#fff, #0e0e10)"
  panel: "light-dark(#fff, #17171a)"
  panel-muted: "light-dark(#f7f7f8, #1d1d21)"
  ink: "light-dark(#17171a, #f2f2f3)"
  dim: "light-dark(#5b5b60, #b0b0b6)"
  faint: "light-dark(#727278, #a0a0a6)"
  line: "light-dark(#e3e3e6, #2b2b2f)"
  edge: "light-dark(#bebec6, #65656f)"
  skill: "light-dark(#2e9463, #7dd3a7)"
  mcp: "light-dark(#3b8ef0, #93c5fd)"
  danger: "light-dark(#b4232f, #ff9aa5)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, sans-serif"
    fontSize: "clamp(2.5rem, 4.5vw, 4.25rem)"
    fontWeight: 500
    lineHeight: 1.24
    letterSpacing: "-0.035em"
  headline:
    fontSize: "clamp(2rem, 3.3vw, 2.75rem)"
    fontWeight: 500
    lineHeight: 1.3
  body:
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  control: "8px"
  panel: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section-group: "48px"
  wide: "64px"
  spacious: "96px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
---

## Overview

**Creative North Star: "규칙과 실제 기록 사이를 보여주기"**

기존 desktop/tokens.md의 브랜드를 잇는다. 표현은 중립 표면과 명확한 한국어 위계에 집중하고, 색은 행동과 그래프 범주에 의미를 부여한다. 실제 근거와 설명용 예시는 화면에서 구분한다.

## Colors

밝은 테마와 어두운 테마는 같은 CSS 토큰 이름을 쓴다. 먼저 시스템 설정을 따르고 사용자가 바꾸면 로컬에 저장한다. 보라는 브랜드·버튼·포커스·에이전트에, 초록과 파랑은 그래프 범주에 쓴다. 본문은 중립색이다.

## Typography

시스템 한글 폰트와 400·500 무게는 기존 제품 브리프의 명시적 선택이다. 본문은 keep-all, 제목은 balance. 고정폭은 명령과 측정값에만 쓴다. 모바일 제목은 clamp(2.125rem, 8.8vw, 3.1rem), 소제목은 32px. 그래프 라벨은 최소 11px다.

## Layout

최대 폭 1160px, 일반 좌우 여백 24px, 모바일 20px. 데스크톱 섹션 진입 여백은 144px, 모바일은 88px다. 1000px 이하에서 히어로를 세로로, 600px 이하에서 나머지 두 열도 한 열로 바꾼다. 헤더 표면은 전체 폭을 채운다.

## Elevation & Depth

그림자는 없다. 명령과 그래프 설명은 중립 표면 차이로 구분하고, 실제 앱 캡처에는 얇은 테두리만 둔다. 실제 캡처의 밝은 표면은 다크 테마에서도 원본 그대로다.

## Shapes

컨트롤은 작게 둥글고, 캡처와 명령 패널은 더 넓게 둥글다. 원형은 연결 그래프의 노드와 범례, 워드마크 끝점에 사용한다.

## Components

주 버튼은 52px 이상, 모든 버튼은 최소 44px다. 포커스는 3px 보라색 외곽선과 5px 간격. 그래프 선택은 aria-pressed와 role=status로 전달한다. 복사 성공은 체크 아이콘과 스크린리더 문구, 실패는 화면 글자와 원문 선택으로 알린다. 상태 공간 높이를 유지한다.

색 전환은 120ms, 선택 피드백은 180ms. 그래프는 커서 주변의 작은 반발과 시차를 110ms 감쇠로 따라가며, Canvas 연결선은 노드 좌표와 함께 변한다. 커서가 떠나면 제자리로 돌아오고, 정지 후 프레임 루프를 끝낸다. 화면 밖·비활성 탭·터치에서는 공간 모션을 멈춘다.

스크롤 진입은 한 번만 실행한다. 텍스트는 18px/600ms, 앱 캡처는 28px·0.985배/760ms, 형제 지연은 80ms·최대 160ms다. easing은 cubic-bezier(.22, 1, .36, 1). 근거 점 여섯 개는 부모 진입 완료 뒤 짧게 강조한다. 서버 HTML에는 숨김 상태를 두지 않는다. reduced-motion에서는 위치·크기·보간과 부드러운 스크롤을 끈다. JavaScript 없이도 본문과 SVG 도해, 실제 캡처, 설치 상태를 읽을 수 있다.

## Do's and Don'ts

- Do 한국어 어절과 의미 단위로 줄바꿈한다.
- Do 원본 캡처와 설명용 예시의 성격을 밝힌다.
- Don't 배경 그라데이션이나 장식용 그림자를 추가한다.
- Don't 미구현 기능이나 가상의 수치를 현재 제품처럼 소개한다.

현재 워드마크는 타이포 왼쪽에 투명 배경의 보라색 연결 그래프 심벌을 둔다. 헤더 심벌은 32×36px, 모바일은 28×32px, 푸터는 24×28px이고 타이포와의 간격은 12px다. 고리·선 자체의 입체감 없이 채워진 원의 크기와 기울기로 원근을 표현한다. 래스터 심벌 색은 보라색 원본을 유지한다.
