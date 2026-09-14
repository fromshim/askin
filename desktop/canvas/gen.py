# askin 데스크톱 목업 열둘을 한 곳에서 뽑는다.
#
# CSS 는 desktop/askin-desktop-prototype.html 을 파일로 읽어서 뽑는다(extract_proto_css).
# 파이썬 상수로 박아두지 않는다 — 프로토타입이 바뀌면 다음 실행에서 그대로 따라간다.
# 마크업은 그 프로토타입의 클래스명을 그대로 옮겨 쓴다. 프로토타입에 없는 상태
# (세션 여러 개, 노드 대체 목록, 못 잰 축, 좁은 창 강제)만 EXTRA_CSS 에 최소로 더한다.
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
PROTO_PATH = ROOT.parent / "askin-desktop-prototype.html"


def extract_proto_css() -> str:
    """#askin-desktop-v1 안의 첫 <style> 블록만 파일에서 그대로 뽑는다."""
    html = PROTO_PATH.read_text(encoding="utf-8")
    marker = '<div id="askin-desktop-v1">'
    marker_idx = html.find(marker)
    if marker_idx == -1:
        raise RuntimeError(f"'{marker}' 를 {PROTO_PATH} 에서 못 찾았다")
    style_open = "<style>"
    style_start = html.find(style_open, marker_idx)
    if style_start == -1:
        raise RuntimeError("#askin-desktop-v1 안에서 <style> 여는 태그를 못 찾았다")
    style_start += len(style_open)
    style_end = html.find("</style>", style_start)
    if style_end == -1:
        raise RuntimeError("<style> 닫는 태그를 못 찾았다")
    css = html[style_start:style_end]
    if "#askin-desktop-v1" not in css or len(css) < 5000:
        raise RuntimeError("뽑은 CSS 가 비정상적으로 짧다. 프로토타입 형식이 바뀌었을 수 있다")
    return css


try:
    PROTO_CSS = extract_proto_css()
except Exception as exc:  # 억지로 복사해 넣지 않고 멈춘다
    print(f"[gen.py] 프로토타입 CSS 추출 실패: {exc}", file=sys.stderr)
    raise SystemExit(1)


# ── 프로토타입에 없는 상태만 메우는 최소 CSS. 화면마다 흩지 않고 여기 한 곳에만 둔다. ──
EXTRA_CSS = """
/* 창 아래끝 표시. 프로토타입도 목업도 내용만큼 세로로 늘어난다.
   실제 창은 세로 1080 이라 그 아래는 스크롤해야 보인다. 잘라내는 대신 선을 긋는다.
   무엇이 첫 화면에 들어오는지가 이 그림이 답해야 할 질문이라서다. */
#askin-desktop-v1[data-fold] .ask-window { position: relative; }
#askin-desktop-v1[data-fold] .ask-window::after {
  content: "여기까지가 창 높이 1080 안에 들어오는 첫 화면. 아래는 스크롤해야 보인다";
  position: absolute;
  z-index: 5;
  top: 1080px;
  right: 0;
  left: 0;
  padding: 5px 14px 4px;
  border-top: 1px dashed var(--ask-purple);
  background: var(--ask-bg);
  color: var(--ask-purple);
  font-size: 11px;
  text-align: right;
  pointer-events: none;
}

/* 프로토타입의 .ask-session-body 는 빈 상태 하나를 가운데 놓는 가로 flex 다.
   세션 행이 들어오면 세로로 쌓아야 한다. 프로토타입에 그 상태가 없어서 여기서 메운다. */
#askin-desktop-v1 .ask-session-body:has(.ask-session-row) {
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 2px;
  text-align: left;
}
#askin-desktop-v1 .ask-session-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 2px;
  font-size: 12px;
  color: var(--ask-dim);
}
#askin-desktop-v1 .ask-session-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--ask-purple);
}
#askin-desktop-v1 .ask-session-dot.is-done {
  background: transparent;
  border: 1.5px solid var(--ask-faint);
}
#askin-desktop-v1 .ask-session-meta {
  flex: 1;
  font-family: var(--ask-mono);
  font-variant-numeric: tabular-nums;
}
#askin-desktop-v1 .ask-session-state { color: var(--ask-faint); font-size: 11px; }
#askin-desktop-v1 .ask-call-flow {
  margin-top: 6px;
  padding: 0 2px;
  color: var(--ask-faint);
  font-family: var(--ask-mono);
  font-size: 11px;
}

#askin-desktop-v1 .ask-altlist-wrap { margin-top: 14px; }
#askin-desktop-v1 .ask-altlist-wrap h4 { margin: 0 0 6px; color: var(--ask-ink); font-size: 12px; font-weight: 500; }
#askin-desktop-v1 .ask-altlist { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
#askin-desktop-v1 .ask-altlist li {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 7px 9px;
  border: 1px solid var(--ask-line-soft);
  border-radius: 8px;
  font-size: 12px;
}
#askin-desktop-v1 .ask-altlist-arrow { color: var(--ask-faint); }
#askin-desktop-v1 .ask-altlist-to i { color: var(--ask-faint); font-style: normal; font-size: 11px; }
#askin-desktop-v1 .ask-altlist-count {
  margin-left: auto;
  color: var(--ask-dim);
  font-family: var(--ask-mono);
  font-variant-numeric: tabular-nums;
}

#askin-desktop-v1 .ask-unjudged-list { display: flex; flex-wrap: wrap; gap: 5px 8px; margin: 8px 0 0; padding: 0; list-style: none; }
#askin-desktop-v1 .ask-unjudged-list li {
  padding: 3px 8px;
  border: 1px solid var(--ask-line);
  border-radius: 999px;
  color: var(--ask-dim);
  font-size: 11px;
}

/* Narrow.dc.html 전용. 아트보드 폭 760px 는 프로토타입의 max-width:680px 보다 넓어
   실제 뷰포트로는 그 미디어쿼리가 안 걸린다. 정적 목업이 680px 이하의 실제 모습을
   보여줘야 해서, 같은 선택자·같은 값을 [data-force-narrow] 로 무조건 켠다.
   새 레이아웃이 아니라 프로토타입 559~570줄 규칙의 재생이다. */
#askin-desktop-v1[data-force-narrow] .ask-layout { grid-template-columns: 1fr; min-height: 0; }
#askin-desktop-v1[data-force-narrow] .ask-sidebar { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; }
#askin-desktop-v1[data-force-narrow] .ask-brand { grid-column: 1 / -1; }
#askin-desktop-v1[data-force-narrow] .ask-sidebar-label { display: none; }
#askin-desktop-v1[data-force-narrow] .ask-projects { grid-template-columns: repeat(2, minmax(0, 1fr)); }
#askin-desktop-v1[data-force-narrow] .ask-add-project { margin: 0; }
#askin-desktop-v1[data-force-narrow] .ask-main-panel,
#askin-desktop-v1[data-force-narrow] .ask-chat-panel { min-height: 620px; }

/* ── 레포트 재설계(2026-09-03). 프로토타입에 아직 없는 조각만 여기 둔다. ── */
/* 내 하네스 요약 띠. 다섯 칸, 서로 더하지 않는다 */
#askin-desktop-v1 .ask-summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin: 0 0 10px; }
#askin-desktop-v1 .ask-sum-tile { min-width: 0; padding: 9px 11px 8px; border: 1px solid var(--ask-line-soft); border-radius: 9px; background: var(--ask-bg); }
#askin-desktop-v1 .ask-sum-label { color: var(--ask-faint); font-size: 11px; }
#askin-desktop-v1 .ask-sum-value { margin-top: 1px; color: var(--ask-ink); font-size: 20px; font-weight: 500; line-height: 1.2; letter-spacing: -0.02em; }
#askin-desktop-v1 .ask-sum-sub { overflow: hidden; margin-top: 2px; color: var(--ask-dim); font-size: 11px; white-space: nowrap; text-overflow: ellipsis; }
/* 아쉬운 점 */
#askin-desktop-v1 .ask-weak-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-top: 14px; }
#askin-desktop-v1 .ask-weak-heading .ask-findings-heading { margin: 0; }
#askin-desktop-v1 .ask-count { margin-left: 4px; color: var(--ask-faint); font-family: var(--ask-mono); font-weight: 400; }
#askin-desktop-v1 .ask-weak-meta { min-height: 28px; padding: 0 4px; font-size: 12px; font-weight: 400; }
#askin-desktop-v1 .ask-chips { gap: 5px; color: var(--ask-dim); }
#askin-desktop-v1 .ask-chip { padding: 1px 7px; border: 1px solid var(--ask-line); border-radius: 999px; color: var(--ask-dim); font-size: 11px; font-weight: 400; }
#askin-desktop-v1 .ask-chip.is-tier { border-color: transparent; background: var(--ask-purple-soft); color: var(--ask-purple-ink); font-weight: 500; }
#askin-desktop-v1 .ask-chip.is-check { color: var(--ask-ink); font-weight: 500; }
#askin-desktop-v1 .ask-evidence { display: grid; gap: 2px; margin: 4px 0 0; color: var(--ask-dim); font-family: var(--ask-mono); font-size: 12px; }
#askin-desktop-v1 .ask-evidence b { color: var(--ask-ink); font-weight: 500; }
#askin-desktop-v1 .ask-caution { margin: 6px 0 0 !important; color: var(--ask-faint) !important; font-size: 12px; }
#askin-desktop-v1 .ask-recommend { margin: 8px 0 0 !important; color: var(--ask-ink) !important; font-size: 13px; line-height: 1.5; }
#askin-desktop-v1 .ask-recommend b { margin-right: 6px; color: var(--ask-purple-ink); font-weight: 500; }
#askin-desktop-v1 .ask-finding-actions { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
#askin-desktop-v1 .ask-dismiss { font-size: 12px; font-weight: 400; }
/* 세부 분석: 규칙(미터)과 습관(값·표본·설명) */
#askin-desktop-v1 .ask-section-sum { margin: -2px 0 8px; color: var(--ask-faint); font-size: 11px; }
#askin-desktop-v1 .ask-axis-list { gap: 9px; }
#askin-desktop-v1 .ask-meter { overflow: hidden; height: 5px; margin: 4px 0 3px; border-radius: 3px; background: var(--ask-line-soft); }
#askin-desktop-v1 .ask-meter i { display: block; height: 100%; border-radius: 3px; background: var(--ask-purple); }
#askin-desktop-v1 .ask-rule.is-warn .ask-meter i { background: var(--ask-danger); }
#askin-desktop-v1 .ask-rule.is-warn .ask-axis-value { color: var(--ask-danger); }
#askin-desktop-v1 .ask-axis-value small { color: var(--ask-faint); font-size: 11px; }
#askin-desktop-v1 .ask-habit-note { margin: 1px 0 0; color: var(--ask-faint); font-size: 11px; text-wrap: pretty; }
#askin-desktop-v1 .ask-habit-rec { margin: 4px 0 0; color: var(--ask-ink); font-size: 11px; }
#askin-desktop-v1 .ask-habit-rec b { margin-right: 4px; color: var(--ask-purple-ink); font-weight: 500; }
#askin-desktop-v1 .ask-footnote { margin: 8px 0 0; color: var(--ask-faint); font-size: 11px; text-wrap: pretty; }
/* 내 하네스 섹션. 현재 세션 패널과 같은 결의 헤더를 쓰고, 레포트와는 선으로 가른다 */
#askin-desktop-v1 .ask-harness { flex: 0 0 auto; border-bottom: 1px solid var(--ask-line); }
#askin-desktop-v1 .ask-harness-body { padding: 12px 15px 14px; }
#askin-desktop-v1 .ask-harness .ask-map-legend { margin-left: auto; }
#askin-desktop-v1 .ask-harness .ask-harness-map { min-height: 240px; }
/* 1080 창에 카드 셋과 세부 분석 토글까지 들어오게 조인 값. 실측: 그래프 300·띠 80 이면 셋째 카드가 y=1130 에서 끝난다 */
#askin-desktop-v1 .ask-summary { margin-bottom: 8px; }
#askin-desktop-v1 .ask-sum-tile { padding: 6px 10px 6px; }
#askin-desktop-v1 .ask-sum-value { font-size: 18px; }
#askin-desktop-v1 .ask-weak h3 { margin-bottom: 3px; font-size: 16px; }
#askin-desktop-v1 .ask-weak .ask-recommend { margin-top: 6px !important; }
#askin-desktop-v1 .ask-weak .ask-finding-actions { margin-top: 6px; }
#askin-desktop-v1 .ask-heading-note { color: var(--ask-faint); font-size: 11px; }
/* 아쉬운 점 카드 두 열 */
#askin-desktop-v1 .ask-weak-heading { margin-top: 0; }
#askin-desktop-v1 .ask-weak-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 28px; }
#askin-desktop-v1 .ask-weak-grid .ask-weak { padding: 10px 2px; }
#askin-desktop-v1[data-force-narrow] .ask-weak-grid { grid-template-columns: minmax(0, 1fr); }
/* 어느 도구 기록에서 온 값인지. 글자 배지. 실제 로고(SVG)는 앱에서 자산으로 넣는다 */
#askin-desktop-v1 .ask-detail-section h4 { display: flex; align-items: center; gap: 6px; }
#askin-desktop-v1 .ask-src { display: inline-block; padding: 0 6px; border: 1px solid var(--ask-line); border-radius: 4px; color: var(--ask-dim); font-size: 10px; font-weight: 500; line-height: 16px; }
#askin-desktop-v1 .ask-src.is-claude { border-color: #E3C9B8; color: #A65D3A; }
#askin-desktop-v1 .ask-src.is-codex { border-color: var(--ask-line); color: var(--ask-ink); }
/* 위 아쉬운 점 카드로 올라간 증상 표시 */
#askin-desktop-v1 .ask-chip.is-up { margin-left: 6px; padding: 0 6px; border-color: transparent; background: var(--ask-purple-soft); color: var(--ask-purple-ink); font-size: 10px; vertical-align: 1px; }
/* Handoff 아트보드 */
#askin-desktop-v1 .ask-handoff { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; align-items: start; }
#askin-desktop-v1 .ask-handoff .ask-chat-panel { min-height: 700px; }
#askin-desktop-v1 .ask-payload { margin-top: 12px; padding: 12px; border: 1px solid var(--ask-line-soft); border-radius: 9px; }
#askin-desktop-v1 .ask-payload h4 { margin: 0 0 6px; font-size: 12px; font-weight: 500; }
#askin-desktop-v1 .ask-payload ol { margin: 0; padding-left: 18px; color: var(--ask-dim); font-size: 12px; line-height: 1.55; }
#askin-desktop-v1 .ask-payload code { color: var(--ask-ink); font-family: var(--ask-mono); font-size: 11px; }
#askin-desktop-v1 .ask-caption { margin: 0 0 8px; color: var(--ask-faint); font-size: 12px; }
#askin-desktop-v1 .ask-ctx { display: grid; gap: 3px; font-size: 11px; }
#askin-desktop-v1 .ask-ctx b { color: var(--ask-ink); font-weight: 500; }
"""


SIZES = {}  # write() 가 받은 크기를 canvas.json 이 그대로 쓴다. 두 곳에 적으면 어긋난다.
# 높이는 **실측으로 맞춘다.** 넘치면 아트보드가 내용을 조용히 자른다 — 화면 아래쪽이 통째로
# 없어져도 파일은 정상으로 생긴다. 재는 법:
#   python3 -m http.server 8731 --directory desktop/canvas
#   브라우저에서 각 .dc.html 을 열고 document.getElementById('askin-desktop-v1').scrollHeight
# 실측(2026-09-04, 내 하네스 섹션 분리 + 카드 두 열 + 접힌 세션 기본, 창 1680): Main·Dark 1104 ·
# Details 2046. 선언값은 여기에 20px 남짓 여유를 둔 값이다. Main 은 세부 분석 토글(y=1076)까지 1080 창에 든다.


def write(name, w, h, content_html, bg="#FFFFFF"):
    SIZES[name] = (w, h)
    doc = (
        "<!doctype html>\n<html>\n<head>\n  <meta charset=\"utf-8\">\n"
        "  <script src=\"./support.js\"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n"
        f"  <style>body{{margin:0;background:{bg}}}</style>\n</helmet>\n"
        f"{content_html}\n"
        "</x-dc>\n</body>\n</html>\n"
    )
    (ROOT / name).write_text(doc, encoding="utf-8")
    print(name)


def root_open(width, color_scheme=None, force_narrow=False, fold=False):
    style_parts = [f"width:{width}px"]
    if color_scheme:
        style_parts.append(f"color-scheme:{color_scheme}")
    attrs = f' style="{";".join(style_parts)}"'
    if force_narrow:
        attrs += ' data-force-narrow="true"'
    if fold:
        attrs += ' data-fold="1080"'
    return f'<div id="askin-desktop-v1"{attrs}><style>{PROTO_CSS}{EXTRA_CSS}</style>'


ROOT_CLOSE = "</div>"


def titlebar(name):
    return (
        '<div class="ask-titlebar" aria-hidden="true">'
        '<span class="ask-window-dot"></span><span class="ask-window-dot"></span><span class="ask-window-dot"></span>'
        f'<span class="ask-titlebar-name">{name}</span></div>'
    )


def ask_window(sidebar_html, main_html, chat_html, name):
    return (
        '<section class="ask-window" aria-label="askin 데스크톱 앱 목업">'
        + titlebar(name)
        + f'<div class="ask-layout">{sidebar_html}{main_html}{chat_html}</div>'
        + "</section>"
    )


# ── 사이드바 ──────────────────────────────────────────────
def sidebar(current="harness-bro", extra_project=None):
    projects = ["harness-bro", "korean-tone", "web-app"]
    if extra_project and extra_project not in projects:
        projects.append(extra_project)
    rows = []
    for name in projects:
        cls = "ask-project is-current" if name == current else "ask-project"
        aria = ' aria-current="page"' if name == current else ""
        # 빼기 버튼은 실제 앱에서 hover·포커스일 때만 보인다(opacity:0). 목업은 정적이라
        # 그 상태를 못 만드니 지금 고른 항목에만 드러내 기능이 있다는 것만 보여준다.
        # 폴더를 지우는 게 아니라 목록에서만 뺀다.
        remove = (
            '<button class="ask-project-remove" type="button" style="opacity:1" aria-label="목록에서 빼기">×</button>'
            if name == current
            else ""
        )
        rows.append(
            f'<div class="ask-project-row"><button class="{cls}" type="button"{aria}>'
            '<span class="ask-project-mark" aria-hidden="true"></span>'
            f'<span class="ask-project-name">{name}</span></button>{remove}</div>'
        )
    return (
        '<aside class="ask-sidebar" aria-label="프로젝트">'
        '<div class="ask-brand"><span class="ask-brand-mark" aria-hidden="true"></span>askin</div>'
        '<div class="ask-sidebar-label">프로젝트</div>'
        f'<div class="ask-projects">{"".join(rows)}</div>'
        '<button class="ask-add-project" type="button"><span aria-hidden="true">＋</span> 프로젝트 추가</button>'
        "</aside>"
    )


def sidebar_minimal():
    return (
        '<aside class="ask-sidebar" aria-label="프로젝트">'
        '<div class="ask-brand"><span class="ask-brand-mark" aria-hidden="true"></span>askin</div>'
        '<button class="ask-add-project" type="button"><span aria-hidden="true">＋</span> 프로젝트 추가</button>'
        "</aside>"
    )


# ── 현재 세션 ─────────────────────────────────────────────
# 세션 제목은 넣지 않는다. 앱이 그 값을 안 뽑는다. turn 수·시각·도는 중 여부만 있다.
SESSION_EMPTY_BODY = (
    '<div class="ask-empty-copy"><span class="ask-empty-symbol" aria-hidden="true">○</span>'
    "<strong>작업을 시작하면 현재 세션이 보여요</strong>"
    "<span>turn, 마지막 기록, 에이전트 호출 흐름을 여기에서 확인해요.</span></div>"
)


def session_row(live, turn, ago):
    dot_cls = "ask-session-dot" if live else "ask-session-dot is-done"
    state = "도는 중" if live else "멈춤"
    return (
        f'<div class="ask-session-row"><span class="{dot_cls}" aria-hidden="true"></span>'
        f'<span class="ask-session-meta">turn {turn} · {ago}</span>'
        f'<span class="ask-session-state">{state}</span></div>'
    )


def call_flow_line(text):
    return f'<div class="ask-call-flow">{text}</div>'


def session_panel(collapsed=False, count=0, body=None):
    toggle_label = "현재 세션 펼치기" if collapsed else "현재 세션 접기"
    toggle_symbol = "⌄" if collapsed else "⌃"
    aria_expanded = "false" if collapsed else "true"
    cls = "ask-session is-collapsed" if collapsed else "ask-session"
    body_html = body if body is not None else SESSION_EMPTY_BODY
    return (
        f'<section class="{cls}">'
        '<header class="ask-panel-heading"><h1>현재 세션</h1>'
        f'<span class="ask-panel-heading-meta">{count}개</span>'
        f'<button class="ask-icon-button" type="button" aria-label="{toggle_label}" aria-expanded="{aria_expanded}">{toggle_symbol}</button>'
        "</header>"
        f'<div class="ask-session-body">{body_html}</div>'
        "</section>"
    )


# ── 하네스 연결 그래프 ────────────────────────────────────
GRAPH_NODES = [
    ("project", "project", "harness-bro", "50%", "51%"),
    ("main-agent", "agent", "main agent", "27%", "23%"),
    ("review-agent", "agent", "reviewer", "74%", "22%"),
    ("project-skill", "skill", "project skill", "25%", "78%"),
    ("global-skill", "skill", "global skill", "75%", "77%"),
    ("github-mcp", "mcp", "GitHub MCP", "11%", "52%"),
    ("docs-skill", "skill", "docs skill", "45%", "17%"),
    ("fs-mcp", "mcp", "filesystem", "89%", "51%"),
    ("qa-agent", "agent", "QA agent", "50%", "83%"),
]

GRAPH_PATHS = (
    '<path class="is-active" d="M350 167 C280 155 258 88 190 77"></path>'
    '<path class="is-active" d="M350 167 C425 150 455 86 521 74"></path>'
    '<path d="M350 167 C278 186 236 240 176 258"></path>'
    '<path d="M350 167 C428 190 466 239 527 256"></path>'
    '<path d="M190 77 C123 81 101 131 82 171"></path>'
    '<path d="M190 77 C230 64 275 52 318 56"></path>'
    '<path d="M521 74 C580 92 603 128 620 169"></path>'
    '<path d="M176 258 C236 278 277 278 321 272"></path>'
    '<path d="M527 256 C467 282 410 281 378 273"></path>'
    '<circle cx="350" cy="167" r="3"></circle>'
)

ZOOM_LABELS = {"far": "78%", "mid": "100%", "near": "118%"}


# 그래프 노드 아홉은 **예시**다. 이름·좌표·호출 수가 특정 저장소의 실제 값이 아니라 종류와
# 관계를 보여주는 배치다(main agent · docs skill · GitHub MCP …). 레포트 쪽(우선 고칠 것,
# 축 목록, 분석 근거)은 반대로 이 저장소를 실제로 재서 나온 값이다 — 목업이 없는 기능을
# 있는 것처럼 보이지 않게 하려고 그렇게 갈랐다.
def graph_node_button(key, kind, label, left, top, selected):
    sel_cls = " is-selected" if selected else ""
    pressed = "true" if selected else "false"
    return (
        f'<button class="ask-graph-node{sel_cls}" type="button" aria-pressed="{pressed}" '
        f'data-kind="{kind}" data-node="{key}" style="left:{left};top:{top};">'
        '<span class="ask-node-mark" aria-hidden="true"></span>'
        f'<span class="ask-node-label">{label}</span></button>'
    )


def harness_graph(zoom="mid", selected=None, scope_text="프로젝트 안 · 전역 연결 포함", popover_html=""):
    # selected 는 문자열 하나, 여러 개(집합/리스트), 또는 None(아무 노드도 안 고른 평상시) 을 받는다.
    selected_keys = {selected} if isinstance(selected, str) else set(selected or ())
    nodes = "".join(
        graph_node_button(k, kind, label, l, t, k in selected_keys)
        for k, kind, label, l, t in GRAPH_NODES
    )
    return (
        f'<div class="ask-harness-map" data-zoom="{zoom}" aria-label="harness-bro의 에이전트, 스킬, MCP 연결 지도">'
        f'<span class="ask-node-scope">{scope_text}</span>'
        '<div class="ask-map-viewport">'
        '<svg class="ask-map-lines" viewBox="0 0 700 330" preserveAspectRatio="none" role="img" '
        'aria-label="프로젝트에서 에이전트와 스킬, MCP로 이어지는 호출 관계">'
        f"{GRAPH_PATHS}</svg>{nodes}</div>"
        '<div class="ask-map-zoom" aria-label="그래프 확대 및 축소">'
        '<button type="button" aria-label="그래프 축소">−</button>'
        f'<output class="ask-map-zoom-output" aria-live="polite">{ZOOM_LABELS[zoom]}</output>'
        '<button type="button" aria-label="그래프 확대">＋</button>'
        f"</div>{popover_html}</div>"
    )


def map_heading(title="현재 하네스 연결"):
    return (
        '<div class="ask-map-heading">'
        f"<h3>{title}</h3>"
        '<div class="ask-map-legend" aria-label="노드 종류">'
        '<span class="is-agent"><i aria-hidden="true"></i>에이전트</span>'
        '<span class="is-skill"><i aria-hidden="true"></i>스킬</span>'
        '<span class="is-mcp"><i aria-hidden="true"></i>MCP</span>'
        "</div></div>"
    )


def node_popover(name, type_, model, calls, last, left, top, flip=False, shift_x=0, button_label="솔루션 채팅"):
    # 클릭한 노드와 같은 left/top(%) 에 놓고 transform 으로만 위/아래를 가른다 — 노드가
    # 옮겨지면 팝오버도 같이 움직인다. flip=False 면 노드 위(꼬리가 아래를 가리킴),
    # flip=True 면 그래프 위 경계에 걸려 노드 아래로 뒤집힌 모습(꼬리가 위를 가리킴)이다.
    # shift_x 는 옆 노드 라벨과 안 겹치게 좌우로 미세 조정할 때만 쓴다. 팝오버 박스가
    # 옮겨져도 꼬리(--ask-tail-x)는 반대로 보정해 원래 노드를 계속 가리킨다.
    flip_attr = ' data-flip="down"' if flip else ""
    offset = "40px" if flip else "calc(-100% - 40px)"
    style = (
        f"left:{left};top:{top};"
        f"transform:translate(calc(-50% - {shift_x}px), {offset});"
        f"--ask-tail-x:calc(50% + {shift_x}px);"
    )
    return (
        f'<div class="ask-node-popover" role="dialog" aria-label="{name} 상세"{flip_attr} '
        f'style="{style}">'
        '<button class="ask-popover-close" type="button" aria-label="닫기">×</button>'
        f'<div class="ask-popover-head"><strong>{name}</strong><small>{type_}</small></div>'
        '<dl class="ask-popover-stats">'
        f'<div><dt>모델</dt><dd>{model}</dd></div>'
        f'<div><dt>호출</dt><dd>{calls}</dd></div>'
        f'<div><dt>최근</dt><dd>{last}</dd></div>'
        "</dl>"
        f'<button class="ask-secondary ask-popover-action" type="button">{button_label}</button>'
        '<span class="ask-popover-tail" aria-hidden="true"></span>'
        "</div>"
    )


# ── 내 하네스 요약 띠 ─────────────────────────────────────
# 그래프 위에 다섯 칸. "내 하네싱은 이렇구나"가 그림(그래프)과 숫자(이 띠)로 같이 온다.
# 종합 점수가 아니다. 칸마다 자기 분모가 있고 서로 더하지 않는다(GitHub Pulse 식 병렬 블록).
# 이 저장소 실측(2026-09-03): harnessDocs 2 · agentDefs 1(전역) · skillIndex 295(전역 99 ·
# 플러그인 196) · 그래프 skill 노드 7(플러그인 2 · 내장 5) · mcp 노드 5(호출 267회) ·
# 훅 실행 9,638회 · 이벤트 키 64종(PreToolUse:Bash 같은 event:tool 단위) · 실패 0.
def summary_tile(label, value, sub):
    return (
        '<div class="ask-sum-tile">'
        f'<div class="ask-sum-label">{label}</div>'
        f'<div class="ask-sum-value">{value}</div>'
        f'<div class="ask-sum-sub">{sub}</div></div>'
    )


HOOK_EVENTS = 64
HOOK_EXEC = "9,638"

SUMMARY_DEFAULT = (
    summary_tile("규칙 문서", "2", "이 저장소 1 · 전역 1")
    + summary_tile("에이전트 정의", "1", "전역 1 · 호출 4회")
    + summary_tile("쓴 스킬", "7", "플러그인 2 · 내장 5 · 전역 정의 99개 중 0")
    + summary_tile("쓴 MCP", "5", "호출 267회 · playwright 220")
    + summary_tile("훅 실행", HOOK_EXEC, f"이벤트 {HOOK_EVENTS}종 · 실패 0")
)


def summary_strip(tiles=SUMMARY_DEFAULT):
    return f'<div class="ask-summary" aria-label="하네스 구성 요약">{tiles}</div>'


# ── 아쉬운 점 카드 ────────────────────────────────────────
# 카드 한 장은 다섯 줄을 넘지 않는다.
#   종류·범위·확실성 칩 → 제목(사실 한 문장) → 근거(어디서 봤나 + 원문) → (종류별 주의)
#   → 추천 한 줄 → 행동.
# 선택지 라디오는 두지 않는다. 판단은 채팅에서 한다. "추천: ~하면 ~가 없어져요/아껴요" 한 줄에
# 실측 수치가 있으면 수치를, 없으면 효과만 적는다. 숫자를 만들지 않는다.
# 같은 종류·같은 범위는 한 카드로 묶는다. 심링크 3건이 카드 석 장이던 것을 한 장으로.
def chip(text, cls=""):
    return f'<span class="ask-chip{(" " + cls) if cls else ""}">{text}</span>'


def weak_card(kicker, title, evidence_lines, recommend, caution=None, action="채팅에서 고치기", dismiss="문제 아님"):
    kick = "".join(chip(t, c) for t, c in kicker)
    ev = "".join(f"<div>{line}</div>" for line in evidence_lines)
    cau = f'<p class="ask-caution">{caution}</p>' if caution else ""
    return (
        '<article class="ask-finding ask-weak">'
        f'<div class="ask-finding-kicker ask-chips">{kick}</div>'
        f"<h3>{title}</h3>"
        f'<div class="ask-evidence">{ev}</div>'
        f"{cau}"
        f'<p class="ask-recommend"><b>추천</b>{recommend}</p>'
        '<div class="ask-finding-actions">'
        f'<button class="ask-secondary" type="button">{action}</button>'
        f'<button class="ask-quiet ask-dismiss" type="button">{dismiss}</button>'
        "</div></article>"
    )


def weak_heading(count, passing, unjudged):
    return (
        '<div class="ask-weak-heading">'
        f'<h3 class="ask-findings-heading">아쉬운 점 <span class="ask-count">{count}</span></h3>'
        f'<button class="ask-quiet ask-weak-meta" type="button">지키는 규칙 {passing} · 판정 불가 {unjudged} ›</button>'
        "</div>"
    )


# 앱이 지금 실제로 내는 것이다. src/fix.mjs 의 findings() 가 다섯 종류를 내는데, 이 저장소는
# 죽은 경로 1건 + 깨진 심링크 3건이다(2026-09-03 실측). 준수율 축 위반은 0건이라 2층 카드가
# 없다. 2층 카드의 모습은 Handoff.dc.html 이 korean-tone 실측값으로 보여준다.
#
# 죽은 경로 1건(origin/main)은 git ref 라 실제로는 경로가 아니다. 그래서 "확인 필요" 칩과
# 주의 문구가 붙고, "문제 아님"이 이 카드의 정답이다. 거짓 양성이 있다는 사실을 화면이 먼저
# 말한다(brew doctor 가 경고 앞에 면책을 두는 것과 같은 결).
# 카드는 세 층을 고정 순서로 둔다. 순위를 계산하지 않는다(종합 점수를 만들지 않는 것과 같은 결).
#   반복    손으로 되풀이한 일. 매번 사용자 시간이 나간다. 하네스(스킬·훅)로 바로 옮길 수 있다
#   규칙    적어둔 규칙인데 안 지킨 것. 비용 차액이 있으면 추천 문장에 붙는다
#   깨진 것 문서·링크가 가리키는데 없는 것. 잠복해 있다가 세션 하나를 헤매게 한다
# 손으로 반복한 명령 실측(2026-09-04, 메인 세션 전사의 <bash-input> 만, subagents/ 제외):
#   전 프로젝트 76건 45종 · 이 저장소 npm run desktop 7건(세션 2개) + brew install rust 1건.
#   fork 서브에이전트가 부모 프롬프트를 복사해 갖고 있어 subagents/ 를 넣으면 부푼다(8 → 9건).
#   같은 문자열을 Bash 도구가 돌린 적은 0회다. 3번 이상 친 것만 카드로 올린다(1~2번은 우연).
WEAK_DEFAULT = (
    weak_card(
        [("반복", "is-tier"), ("이 저장소", ""), ("확실", "")],
        "npm run desktop 을 7번 직접 쳤다",
        [
            "! npm run desktop  × 7 · 세션 2개 · 마지막 9월 3일",
            "에이전트가 대신 돌린 적 0회 · 3번 이상 친 다른 명령 없음",
        ],
        "자주 치는 명령은 스킬이나 훅으로 옮겨요. 세션마다 손으로 치던 일이 없어져요.",
    )
    + weak_card(
        [("깨진 것", "is-tier"), ("전역", ""), ("확실", "")],
        "전역 스킬 심링크 3개가 없는 곳을 가리킨다",
        [
            "~/.claude/skills/next-best-practices → ../../.agents/skills/next-best-practices <b>(없음)</b>",
            "vercel-react-best-practices · web-design-guidelines 도 같은 폴더를 가리킨다 <b>(없음)</b>",
        ],
        "실물이 있는 저장소에서 옮겨 오거나 링크를 지우면, 스킬 목록에 이름만 있고 못 읽는 항목 3개가 없어져요. 전역이라 모든 프로젝트에서 같이 사라져요.",
    )
    + weak_card(
        [("깨진 것", "is-tier"), ("전역", ""), ("확인 필요", "is-check")],
        "전역 CLAUDE.md:56 이 없는 경로를 가리킨다",
        [
            "<b>origin/main</b> — git 이 아는 경로 어디에도 없음",
            "원문: 작업 시작 전에 origin/main 위로 리베이스한다",
        ],
        "경로인지 확인하고 옮겨진 것이면 새 경로로 고쳐요. 매 세션 읽는 규칙에서 헛길 1건이 없어져요.",
        caution="경로가 아닐 수도 있어요. 실측으로 이런 건 셋에 하나가 경로가 아니었어요.",
    )
)


def detail_section(title, body, full_width=False):
    style = ' style="grid-column:1 / -1"' if full_width else ""
    return f'<section class="ask-detail-section"{style}><h4>{title}</h4><p>{body}</p></section>'


# ── 세부 분석: 규칙 · 습관 · 무엇을 봤나 ──────────────────
# 규칙(준수율)은 목표가 100% 라 미터를 그린다. 안 지키는 것부터, 지키는 것, 판정 불가 순.
# 값은 "27건 중 0건 위반 · 100%" 로 말한다. 0/24 같은 분수는 위반인지 준수인지 안 읽힌다.
def rule_row(label, total, violations, rule, unavailable=None):
    if unavailable:
        return (
            '<li class="ask-axis-item ask-rule is-muted">'
            f'<div class="ask-axis-row"><span class="ask-axis-name">{label}</span><span class="ask-axis-value">판정 불가</span></div>'
            f'<p class="ask-axis-why">{unavailable}</p></li>'
        )
    rate = (total - violations) / total
    pct = f"{rate * 100:.1f}%".replace(".0%", "%")
    warn = " is-warn" if violations else ""
    return (
        f'<li class="ask-axis-item ask-rule{warn}">'
        f'<div class="ask-axis-row"><span class="ask-axis-name">{label}</span>'
        f'<span class="ask-axis-value">{total}건 중 {violations}건 위반 · {pct}</span></div>'
        f'<div class="ask-meter" role="img" aria-label="{pct}"><i style="width:{rate * 100:.0f}%"></i></div>'
        f'<p class="ask-axis-why">{rule}</p></li>'
    )


# 습관(관찰값)은 목표가 없다. 좋다/나쁘다 색을 안 쓰고 값·표본·한 줄 설명만 둔다(Apple Health
# Trends 식). 추세는 주가 두 칸 이상 쌓인 축에만 그린다 — 이 저장소는 아직 한 칸이라 없다.
# 추천은 실측 내역이 있는 축(턴 마무리 훅 시간의 훅별 내역)에만 붙는다. 숫자를 만들지 않는다.
def habit_row(label, value, n, note, detail=None, recommend=None):
    rows = ""
    if detail:
        rows = "".join(f"<li><span>{k}</span><span>{v}</span></li>" for k, v in detail)
        rows = f'<ul class="ask-axis-detail">{rows}</ul>'
    rec = f'<p class="ask-habit-rec"><b>추천</b>{recommend}</p>' if recommend else ""
    return (
        '<li class="ask-axis-item ask-habit">'
        f'<div class="ask-axis-row"><span class="ask-axis-name">{label}</span>'
        f'<span class="ask-axis-value">{value} <small>· 표본 {n}</small></span></div>'
        f'<p class="ask-habit-note">{note}</p>{rows}{rec}</li>'
    )


def axis_section(title, items, summary=None, footnote=None):
    sum_html = f'<p class="ask-section-sum">{summary}</p>' if summary else ""
    foot = f'<p class="ask-footnote">{footnote}</p>' if footnote else ""
    return f'<section class="ask-detail-section"><h4>{title}</h4>{sum_html}<ul class="ask-axis-list">{"".join(items)}</ul>{foot}</section>'


# 어느 도구 기록에서만 얻는 값인지 배지로 단다. 둘 다면 둘 다, 파일 시스템에서 재는 것(깨진 링크)은 없다.
def src_badge(*names):
    return "".join(f'<span class="ask-src is-{n.lower()}">{n}</span>' for n in names)


UP = '<span class="ask-chip is-up">아쉬운 점</span>'


# 건수 한 줄. 위 아쉬운 점 카드로 올라간 증상에는 칩을 달아 둘이 같은 것임을 보인다.
# 0건도 그대로 적는다. "잡을 수 있는 증상이 무엇인지"가 이 카드가 답하는 질문이라서다.
def count_row(label, value, note=None, up=False, muted=False):
    cls = "ask-axis-item" + (" is-muted" if muted else "")
    why = f'<p class="ask-axis-why">{note}</p>' if note else ""
    return (
        f'<li class="{cls}"><div class="ask-axis-row"><span class="ask-axis-name">{label}{UP if up else ""}</span>'
        f'<span class="ask-axis-value">{value}</span></div>{why}</li>'
    )


def detail_card(title, rows, sources=(), summary=None, footnote=None, full_width=False):
    style = ' style="grid-column:1 / -1"' if full_width else ""
    sum_html = f'<p class="ask-section-sum">{summary}</p>' if summary else ""
    foot = f'<p class="ask-footnote">{footnote}</p>' if footnote else ""
    return (
        f'<section class="ask-detail-section"{style}><h4>{title}{src_badge(*sources)}</h4>{sum_html}'
        f'<ul class="ask-axis-list">{"".join(rows)}</ul>{foot}</section>'
    )


# 이 저장소를 실제로 재서 나온 값이다(2026-09-04, buildReport 전체 기간 + 별도 실측).
# 세부 분석은 주제별 카드 여덟이다. 위 아쉬운 점에 올라간 증상도 여기 다시 보인다(칩).
# 수집할 수 있는 증상은 전부 적고, 0건은 흐리게 둔다.
DETAILS_SECTIONS_DEFAULT = (
    detail_card(
        "규칙 · 모델", [
            rule_row("모델 명시", 27, 0, "~/.claude/CLAUDE.md:9  model 파라미터를 항상 명시한다"),
            rule_row("잡무 모델", 0, 0, "", unavailable="runner 위임이 없어 못 잰다. 잡무를 위임하면 재요"),
            # 차액은 규칙 위반이 있을 때만 생긴다. 실제 모델과 규칙 기본값의 API 요금 환산 차이다.
            count_row("비용 차액 · API 요금 환산", "$0", "위반이 없어 차액이 없어요. 월 단위로 환산해요", muted=True),
        ],
        sources=("Claude",), summary="2개 중 1개 지키는 중 · 1개는 잴 수 없었어요",
    )
    + detail_card(
        "관찰값 · 위임과 세션", [
            habit_row("병렬 비율", "45.0%", 20, "한 번 띄울 때 두 갈래 이상으로 나눈 비율"),
            habit_row("평균 갈래", "2.25", 20, "디스패치 한 번당 평균 갈래 수. 1.0 이면 병렬을 전혀 안 쓴 것"),
            habit_row("위임률", "11.1%", 6, "서브에이전트가 쓴 토큰 비율. 높다고 잘 쓴 게 아니다", detail=[("위임을 쓴 세션", "2/6")]),
            habit_row("서브에이전트 결말", "0.0%", 42, "끝난 상태를 아는 위임 중 completed 가 아닌 비율", detail=[("completed", "42")]),
            habit_row("가드 차단", "2.01", 149, "100턴당 몇 번 막혔나. user-rejected 는 사람이 막은 것",
                      detail=[("합계", "3건"), ("user-rejected", "2"), ("automode-unavailable", "1")]),
            habit_row("지금 도는 세션", "1", 6, "최근 15분 안에 전사가 자란 세션. 시점 값이라 추세가 없다"),
        ],
        sources=("Claude",), summary="목표가 없는 값이에요. 추세로만 봐요",
        footnote="주별 추세는 위임이 2주 이상 쌓이면 병렬 비율·평균 갈래·서브에이전트 결말에 그려요. 지금은 한 주뿐이에요.",
    )
    + detail_card(
        "캐싱", [
            habit_row("캐시 적중률", "98.0%", 6, "다시 읽은 문맥의 비율. 낮아지면 문맥이 자주 깨지고 있다는 뜻"),
            # 턴 = assistant 메시지 하나(message.id 로 파일을 넘어 중복 제거, <synthetic> 모델 제외).
            # 실측(2026-09-04): 이 저장소 13/2,040 · 전 프로젝트 239/17,722 = 1.35%(저장소별 0.32~3.88%).
            habit_row("캐시 읽기 없는 턴", "0.64%", "2,040턴", "문맥이 처음부터 다시 쌓인 턴. 메인 세션만"),
        ],
        sources=("Claude",), footnote="Codex 기록은 아직 안 섞였어요. 섞으면 축의 뜻이 바뀌어 옛 레포트와 비교하지 않아요.",
    )
    + detail_card(
        "훅", [
            rule_row("훅 무결성", 201, 0, "훅이 조용히 실패하면 규칙이 안 지켜져도 아무도 모른다"),
            habit_row(
                "턴 마무리 훅 시간", "403ms", 152, "턴이 끝날 때 Stop 훅 묶음이 먹는 평균 시간",
                detail=[
                    ("stop-review-gate-hook.mjs", "98ms × 148회"), ("gk", "96ms × 148회"), ("stop.py", "71ms × 148회"),
                    ("handoff.py", "58ms × 148회"), ("on-stop.sh", "35ms × 148회"),
                    ("claude-hook.sh", "42ms × 100회"), ("claude-hook.sh (2)", "52ms × 48회"),
                ],
                recommend="가장 무거운 stop-review-gate-hook.mjs 를 가볍게 하면 턴마다 최대 98ms 를 아껴요.",
            ),
        ],
        sources=("Claude",), summary="실행 9,638회 · 이벤트 64종 · 실패 0",
    )
    # 메인 세션 전사의 <bash-input> 만 센다. subagents/ 를 넣으면 fork 가 부모 프롬프트를 복사해 갖고 있어 부푼다.
    + detail_card(
        "반복 행동", [
            count_row("! npm run desktop", "7회", "세션 2개 · 마지막 9월 3일 · 에이전트가 대신 돌린 적 0회", up=True),
            count_row("! brew install rust", "1회", muted=True),
        ],
        sources=("Claude",), summary="손으로 친 명령 8건 2종 · 3번 이상만 아쉬운 점으로 올려요",
    )
    # 파일 시스템과 문서에서 잰다. 도구 배지가 없다. 하네스 활용·스킬 선언 무결성은 정의 파일의 문제라 여기 둔다.
    + detail_card(
        "깨진 링크와 정의", [
            count_row("문서가 가리키는데 없는 경로", "1건", "CLAUDE.md:56  origin/main · 경로가 아닐 수도 있어요", up=True),
            count_row("선언했는데 없는 스킬", "0건", muted=True),
            count_row("스킬 디렉터리의 깨진 심링크", "3건", "전역 · next-best-practices 외 2개", up=True),
            count_row("근거가 사라진 축", "0건", muted=True),
            count_row("모순 후보", "0건", "하네스 문서 3개를 쌍으로 봤어요", muted=True),
            rule_row("하네스 활용", 1, 0, "~/.claude/CLAUDE.md:72  안 쓰이는 규칙은 걷어낸다 · 정의 1개 모두 호출됨 · 전체 기간"),
            rule_row("스킬 선언 무결성", 0, 0, "", unavailable="에이전트가 선언한 스킬이 없어 못 잰다. 정의에 skills: 를 적으면 재요"),
        ],
        summary="잡을 수 있는 증상 7가지 중 2가지가 나왔어요",
    )
    # Codex 세션의 token_count 줄에 실린 rate_limits 에서 센다. 한도는 계정 단위라 전역이다.
    # resets_at 은 굴러가는 창의 끝이라(실측: 5시간 창에서 1,747개 값) 고정 사이클이 없다. 그래서
    # 5시간·1주 단위 고정 구간으로 잘라 "작업한 구간 중 100% 까지 쓴 구간" 비율을 낸다.
    # 실측(2026-09-04, 전체 기간): 5시간 구간 99개 중 2개, 주 24개 중 1개. 지금 52% · 44%.
    + detail_card(
        "한도", [
            count_row("5시간 한도를 다 쓴 구간", "99개 중 2개 · 2.0%", "작업한 5시간 구간 중 100% 까지 간 구간"),
            count_row("주간 한도를 다 쓴 주", "24주 중 1주 · 4.2%", "80% 를 넘긴 주는 3주"),
            count_row("지금", "5시간 52% · 주간 44%", "시점 값이라 추세가 없다"),
        ],
        sources=("Codex",), summary="계정 단위라 전역으로 재요. 창이 굴러가서 고정 사이클이 없어 5시간·1주 단위로 잘라 근사해요",
    )
    # 스킬 개수는 전역까지 센다(skillIndex 가 전 프로젝트를 훑는다). 범위를 안 밝히면
    # 이 저장소에 스킬이 295개 있는 것처럼 읽힌다.
    + detail_card(
        "무엇을 봤나",
        [count_row("Claude", "세션 6개 · 위임 45건 · 전사 1,166개"), count_row("Codex", "세션 4개 · token_count 255줄"),
         count_row("하네스", "에이전트 정의 1개 · 스킬 295개(전역 포함) · 하네스 문서 2개 · 기간 전체")],
        sources=("Claude", "Codex"), full_width=True,
    )
)


def details_block(is_open, sections):
    open_cls = " is-open" if is_open else ""
    aria = "true" if is_open else "false"
    symbol = "−" if is_open else "＋"
    label = "접기" if is_open else "펼치기"
    return (
        f'<button class="ask-details-toggle" type="button" aria-expanded="{aria}">'
        f'<span>{symbol}</span> 세부 분석 {label}</button>'
        f'<div class="ask-details{open_cls}"><div class="ask-details-grid">{sections}</div></div>'
    )


LEGEND = (
    '<div class="ask-map-legend" aria-label="노드 종류">'
    '<span class="is-agent"><i aria-hidden="true"></i>에이전트</span>'
    '<span class="is-skill"><i aria-hidden="true"></i>스킬</span>'
    '<span class="is-mcp"><i aria-hidden="true"></i>MCP</span>'
    "</div>"
)


# 내 하네스는 레포트와 시간 축이 다르다. 그래프와 요약 띠는 지금 파일에 있는 정의와 전체 기록의
# 호출을 보여주고(harnessGraph 는 창을 안 좁힌다), 레포트는 고른 기간(8월 1일 – 8월 31일)을 본다.
# 한 헤더 아래 두면 그래프가 그 달의 결과처럼 읽혀서 섹션을 갈랐다. 사용자가 짚었다(2026-09-04).
def harness_panel(summary=SUMMARY_DEFAULT, zoom="mid", selected=None):
    return (
        '<section class="ask-harness" aria-labelledby="ask-harness-title">'
        '<header class="ask-panel-heading"><h2 id="ask-harness-title">내 하네스</h2>'
        '<span class="ask-heading-note">지금 정의 · 호출 수는 전체 기록</span>'
        + LEGEND
        + "</header>"
        f'<div class="ask-harness-body">{summary_strip(summary)}{harness_graph(zoom=zoom, selected=selected)}</div>'
        "</section>"
    )


def report_result_view(weak=WEAK_DEFAULT, weak_count=3, passing=3, unjudged=2,
                       details_open=False, sections=DETAILS_SECTIONS_DEFAULT):
    return (
        '<div class="ask-report-view ask-result is-visible">'
        + weak_heading(weak_count, passing, unjudged)
        + f'<div class="ask-weak-grid">{weak}</div>'
        + details_block(details_open, sections)
        + "</div>"
    )


def report_empty_view():
    return (
        '<div class="ask-report-view ask-report-empty is-visible">'
        '<div><span class="ask-empty-symbol" aria-hidden="true">◇</span>'
        "<h3>아직 분석한 레포트가 없어요</h3>"
        "<p>분석하기를 눌러 하네스를 점검해봐요. 기간과 범위를 먼저 물어볼게요.</p>"
        '<button class="ask-primary" type="button">분석하기</button>'
        "</div></div>"
    )


def report_config_view():
    return (
        '<div class="ask-report-view is-visible">'
        '<form class="ask-analysis-form">'
        "<h3>무엇을 분석할까요?</h3>"
        "<p>레포트마다 기간과 점검 범위를 따로 저장해요.</p>"
        '<div class="ask-field"><label for="ask-period-select">분석 기간</label>'
        '<select class="ask-select" id="ask-period-select"><option>최근 7일</option><option>최근 4주</option>'
        "<option>전체 기간</option><option>직접 선택</option></select></div>"
        '<div class="ask-field"><label for="ask-scope-select">범위</label>'
        '<select class="ask-select" id="ask-scope-select"><option>harness-bro</option></select></div>'
        '<div class="ask-form-actions"><button class="ask-quiet" type="button">취소</button>'
        '<button class="ask-primary" type="submit">분석 시작</button></div>'
        "</form></div>"
    )


def report_loading_view(text):
    actions = (
        '<div class="ask-form-actions" style="justify-content:center;margin-top:14px">'
        '<button class="ask-quiet" type="button" disabled>취소</button>'
        '<button class="ask-primary" type="button" disabled>분석 중…</button></div>'
    )
    return (
        '<div class="ask-report-view ask-loading is-visible" aria-live="polite">'
        f'<div><div class="ask-loading-mark" aria-hidden="true"></div><strong>{text}</strong>{actions}</div>'
        "</div>"
    )


def report_panel(has_result, inner_view, period="", position=""):
    cls = "ask-report has-result" if has_result else "ask-report"
    return (
        f'<section class="{cls}" aria-labelledby="ask-report-title">'
        '<header class="ask-panel-heading">'
        '<h2 class="ask-report-heading-label" id="ask-report-title">분석 레포트</h2>'
        '<div class="ask-report-nav" aria-label="레포트 이동">'
        '<button class="ask-icon-button" type="button" aria-label="이전 레포트">‹</button>'
        f'<span class="ask-report-period">{period}</span>'
        '<button class="ask-icon-button" type="button" aria-label="다음 레포트">›</button>'
        "</div>"
        f'<span class="ask-panel-heading-meta">{position}</span>'
        "</header>"
        f'<div class="ask-report-stage">{inner_view}</div>'
        "</section>"
    )


# ── 채팅 패널 ─────────────────────────────────────────────
def orb(state="idle", label="준비됨"):
    return (
        f'<div class="ask-agent-orb" data-state="{state}" role="img" aria-label="askin 에이전트, {label}">'
        '<div class="ask-orb-core"></div>'
        '<div class="ask-orb-eyes" aria-hidden="true"><span class="ask-eye"></span><span class="ask-eye"></span></div>'
        "</div>"
    )


def msg_user(text):
    return f'<div class="ask-message is-user"><small>나</small><span>{text}</span></div>'


def msg_agent_row(text, state="idle", label="준비됨"):
    return (
        '<div class="ask-agent-message-row">'
        + orb(state, label)
        + f'<div class="ask-message is-agent"><small>askin</small><span>{text}</span></div>'
        + "</div>"
    )


def chat_tabs(active_label="새 대화", extra_tabs=()):
    tabs = [f'<button class="ask-chat-tab is-active" type="button" role="tab" aria-selected="true"><span>{active_label}</span></button>']
    for t in extra_tabs:
        tabs.append(f'<button class="ask-chat-tab" type="button" role="tab" aria-selected="false"><span>{t}</span></button>')
    return (
        '<div class="ask-chat-tabs" role="tablist" aria-label="로컬 채팅 세션">'
        + "".join(tabs)
        + '<span class="ask-tab-spacer"></span>'
        '<button class="ask-icon-button" type="button" aria-label="새 채팅">＋</button>'
        "</div>"
    )


SUGGESTIONS_PRE = ["하네스를 처음부터 설계하고 싶어", "서브에이전트를 적극적으로 쓰고 싶어", "반복 지시를 스킬로 만들고 싶어"]


def suggestions(items):
    btns = "".join(f'<button class="ask-suggestion" type="button">{t}</button>' for t in items)
    return f'<div class="ask-suggestions">{btns}</div>'


def chat_composer():
    return (
        '<div class="ask-chat-composer">'
        '<div class="ask-storage-note">이 프로젝트의 채팅은 로컬에 저장돼요</div>'
        '<div class="ask-composer-box">'
        '<label class="ask-sr-only" for="ask-model">모델</label>'
        '<select class="ask-model-select" id="ask-model"><option>Codex 구독 · Auto</option><option>Claude 구독 · Sonnet</option></select>'
        '<label class="ask-sr-only" for="ask-chat-input">메시지</label>'
        '<textarea class="ask-chat-input" rows="1" placeholder="무엇을 고치고 싶나요?"></textarea>'
        '<button class="ask-send" type="button" aria-label="메시지 보내기">↑</button>'
        "</div></div>"
    )


def chat_panel(tabs_html, body_inner):
    return (
        '<aside class="ask-chat-panel" aria-label="채팅">'
        + tabs_html
        + f'<div class="ask-chat-body">{body_inner}</div>'
        + chat_composer()
        + "</aside>"
    )


def chat_empty(active_label="새 대화", extra_tabs=("하네스 시작하기",), suggestion_items=SUGGESTIONS_PRE):
    body = '<div class="ask-chat-messages"></div>' + suggestions(suggestion_items)
    return chat_panel(chat_tabs(active_label, extra_tabs), body)


def chat_active():
    messages = (
        msg_user("지금 세션에서 뭐가 반복되고 있어?")
        + msg_agent_row("최근 기록을 보니 프로젝트 설명을 여러 세션에서 다시 읽고 있어. 규칙 파일로 옮기는 게 먼저일 것 같아.")
        + msg_user("그럼 그 파일부터 고쳐줘")
        + msg_agent_row("CLAUDE.md 에 공통 문맥을 옮겼어. 다음 세션부터는 반복해서 안 읽어.")
    )
    body = f'<div class="ask-chat-messages">{messages}</div>'
    return chat_panel(chat_tabs("공통 문맥 정리", extra_tabs=["하네스 시작하기"]), body)


# ═══════════════════════════════════════════════════════════
# page-1 「화면」
# ═══════════════════════════════════════════════════════════

# 1. Main — 레포트가 있는 기본 화면. 세션 패널은 접힌 것이 기본이다(note-session: 도는 세션은
# 보통 0~5개). 펼친 채로는 아쉬운 점 셋째 카드가 1080 창 밖으로 밀린다(실측: 카드 끝 y=1151).
main_session = session_panel(collapsed=True, count=2)
main_report = report_panel(True, report_result_view(), period="8월 1일 – 8월 31일", position="1 / 2")
main_html = f'<main class="ask-main-panel">{main_session}{harness_panel()}{main_report}</main>'
write(
    "Main.dc.html", 1680, 1120,
    root_open(1680, fold=True) + ask_window(sidebar("harness-bro"), main_html, chat_active(), "askin · harness-bro") + ROOT_CLOSE,
)

# 2. Expanded — 현재 세션을 펼친 상태. 세션 행과 호출 흐름이 보이고 레포트는 그만큼 내려간다.
collapsed_session = session_panel(
    collapsed=False, count=2,
    body=session_row(True, 12, "41분 전") + session_row(False, 34, "3시간 전")
    + call_flow_line("메인 → general-purpose 3회 → Explore 1회"),
)
collapsed_report = report_panel(True, report_result_view(), period="8월 1일 – 8월 31일", position="1 / 2")
collapsed_html = f'<main class="ask-main-panel">{collapsed_session}{harness_panel()}{collapsed_report}</main>'
write(
    "Expanded.dc.html", 1680, 1250,
    root_open(1680, fold=True) + ask_window(sidebar("harness-bro"), collapsed_html, chat_empty(), "askin · harness-bro") + ROOT_CLOSE,
)

# 3. Empty — 프로젝트를 갓 추가, 레포트 없음
empty_session = session_panel(collapsed=False, count=0)
empty_report = report_panel(False, report_empty_view())
empty_html = f'<main class="ask-main-panel">{empty_session}{empty_report}</main>'
write(
    "Empty.dc.html", 1680, 880,
    root_open(1680) + ask_window(sidebar("harness-bro"), empty_html, chat_empty(), "askin · harness-bro") + ROOT_CLOSE,
)

# 4. Config — 분석 설정 폼
config_session = session_panel(collapsed=False, count=0)
config_report = report_panel(False, report_config_view())
config_html = f'<main class="ask-main-panel">{config_session}{config_report}</main>'
write(
    "Config.dc.html", 1680, 880,
    root_open(1680) + ask_window(sidebar("harness-bro"), config_html, chat_empty(), "askin · harness-bro") + ROOT_CLOSE,
)

# 5. Scanning — 분석 중, 고정 높이 진행 상태
scanning_session = session_panel(collapsed=False, count=0)
scanning_report = report_panel(False, report_loading_view("전사 1,256개 중 812개를 읽었어요"))
scanning_html = f'<main class="ask-main-panel">{scanning_session}{scanning_report}</main>'
write(
    "Scanning.dc.html", 1680, 880,
    root_open(1680) + ask_window(sidebar("harness-bro"), scanning_html, chat_empty(), "askin · harness-bro") + ROOT_CLOSE,
)


# ═══════════════════════════════════════════════════════════
# page-2 「그래프 컴포넌트」— 그래프의 줌·선택 상태. Details·Handoff 는 레포트 흐름이 첫 페이지에서
# 한눈에 보이게 page-1 의 Main 오른쪽으로 옮겼다(2026-09-04, 사용자가 세부 레포트를 못 찾았다).
# ═══════════════════════════════════════════════════════════

# 6. Zoom — 줌 세 단계의 라벨 밀도
def zoom_block(zoom, caption):
    return (
        '<div style="flex:1;display:flex;flex-direction:column;gap:8px">'
        + harness_graph(zoom=zoom, selected="project")  # harness_graph 의 새 기본값(None)과 무관하게 지금 모습 유지
        + f'<p style="margin:0;padding:0 4px;color:var(--ask-faint);font-size:12px">{caption}</p>'
        + "</div>"
    )


zoom_row = (
    '<div style="display:flex;gap:16px;padding:16px;height:100%">'
    + zoom_block("far", "멀리 78% · 프로젝트와 선택 노드 이름만")
    + zoom_block("mid", "중간 100% · 1차 연결까지")
    + zoom_block("near", "가까이 118% · 전부")
    + "</div>"
)
write(
    "Zoom.dc.html", 1440, 440,
    root_open(1440) + f'<div class="ask-main-panel" style="min-height:0">{zoom_row}</div>' + ROOT_CLOSE,
)

# 7. NodePick — 노드를 고른 상태(팝오버) + 키보드용 대체 목록
# 그래프 둘을 위아래로 쌓아 각각 팝오버 하나씩만 보여준다. 280px 짜리 팝오버 둘을 한 그래프에
# 같이 띄우면 서로 겹치거나 다른 노드 라벨을 덮어(실측함), 아예 그래프를 나눴다.
# 위: global skill — 아래쪽 노드라 위로 열어도 여유가 있는 정상 배치. filesystem 라벨과
#    살짝 겹쳐 shift_x 로 40px 왼쪽으로 밀었다.
# 아래: main agent — 그래프 맨 위 경계에 가장 가까운 노드라 위로 열면 잘려서 아래로 뒤집힌다.
GLOBAL_SKILL_NODE = {
    "name": "global skill",
    "type_": "프로젝트 외부 스킬",
    "model": "호출 모델 상속",
    "calls": "18회",
    "last": "4일 전",
}
MAIN_AGENT_NODE = {
    "name": "main agent",
    "type_": "프로젝트 에이전트",
    "model": "Codex · Auto",
    "calls": "128회",
    "last": "3분 전",
}

ALTLIST_ROWS = [
    ("메인 에이전트", "reviewer", "서브에이전트", "23회"),
    ("메인 에이전트", "GitHub MCP", "MCP", "37회"),
    ("메인 에이전트", "docs skill", "전역 스킬", "9회"),
    ("메인 에이전트", "filesystem", "MCP", "96회"),
    ("메인 에이전트", "project skill", "프로젝트 내부 스킬", "41회"),
]


def altlist():
    rows = "".join(
        f"<li><span>{src}</span>"
        '<span class="ask-altlist-arrow" aria-hidden="true">→</span>'
        f'<span class="ask-altlist-to">{dst} <i>({kind})</i></span>'
        f'<span class="ask-altlist-count">{count}</span></li>'
        for src, dst, kind, count in ALTLIST_ROWS
    )
    return f'<div class="ask-altlist-wrap"><h4>키보드용 대체 목록</h4><ul class="ask-altlist">{rows}</ul></div>'


def nodepick_row(caption, **graph_kwargs):
    return (
        '<div style="margin-bottom:10px">'
        + harness_graph(zoom="mid", **graph_kwargs)
        + f'<p style="margin:6px 0 0;padding:0 2px;color:var(--ask-faint);font-size:12px">{caption}</p>'
        + "</div>"
    )


nodepick_inner = (
    map_heading()
    + nodepick_row(
        "정상 배치 — global skill 은 아래쪽 노드라 위로 열 여유가 있다.",
        selected="global-skill",
        popover_html=node_popover(**GLOBAL_SKILL_NODE, left="75%", top="77%", flip=False, shift_x=40),
    )
    + nodepick_row(
        "경계에서 뒤집힘 — main agent 는 그래프 맨 위 경계에 가장 가까워 위로 열면 잘려서 아래로 뒤집힌다.",
        selected="main-agent",
        popover_html=node_popover(**MAIN_AGENT_NODE, left="27%", top="23%", flip=True),
    )
    + altlist()
)
write(
    "NodePick.dc.html", 1180, 1040,
    root_open(1180) + f'<div class="ask-main-panel" style="padding:12px 16px 18px">{nodepick_inner}</div>' + ROOT_CLOSE,
)

# 8. Details — 세부 분석을 펼친 상태 + 판정 불가 칸
# 판정 불가는 이제 별도 칸이 아니라 축 목록 안에서 흐린 줄로 보인다(axis_item).
details_view = report_panel(True, report_result_view(details_open=True), period="8월 1일 – 8월 31일", position="1 / 2")
write(
    "Details.dc.html", 1180, 2070,
    root_open(1180) + f'<div class="ask-main-panel">{details_view}</div>' + ROOT_CLOSE,
)

# 8b. Handoff — 2층 카드(안 지키는 규칙)와 채팅으로 넘어가는 흐름.
# 이 저장소(harness-bro)에는 규칙 위반이 0건이라 2층 카드가 안 나온다. korean-tone 저장소를
# 실측(2026-09-03)해 그렸다: 모델 명시 40건 중 6건 위반, 몰린 곳 general-purpose 5/39 ·
# claude-code-guide 1/1. 표본 문구도 실제 위임 설명이다.
HANDOFF_CARD = weak_card(
    [("규칙", "is-tier"), ("전역 규칙", ""), ("확실", "")],
    "위임 40건 중 6건이 모델을 정하지 않고 나갔다",
    [
        "규칙: ~/.claude/CLAUDE.md:9  <b>model 파라미터를 항상 명시한다</b>",
        "몰린 곳: general-purpose 5/39 · claude-code-guide 1/1",
        "실제로 돈 모델: opus 3 · fable 2 · haiku 1 · 16.8일 동안 API 요금 환산 차액 $1.11",
    ],
    "model 을 명시하면(기본 sonnet) API 요금 환산으로 월 $2 정도 아껴요. 6건 중 5건이 부모 세션의 opus·fable 을 그대로 물려받았어요.",
)
# 채팅으로 넘길 때 두 선택지(design-concept.md "취약점에서 채팅으로"). 프로토타입의
# .ask-chat-choice 를 그대로 쓴다.
HANDOFF_CHOICE = (
    '<div class="ask-chat-choice" role="group" aria-label="어느 채팅에서 고칠까">'
    "<span>어느 채팅에서 고칠까요</span>"
    '<button class="ask-secondary" type="button">현재 채팅에 넣기</button>'
    '<button class="ask-primary" type="button">새 채팅으로 시작</button>'
    "</div>"
)
# 발견 하나가 채팅으로 갈 때 같이 가는 것. src/fix.mjs 의 instruction() 이 이미 만드는
# 지시서(저장소·고칠 것·건드릴 파일·건드리지 말 것·형제·거부 조건·끝나면)가 본문이고,
# 여기 적은 것은 그 위에 더 얹는 것이다. 준수율 위반에는 지금 지시서가 없다(findings 만 다룬다).
HANDOFF_PAYLOAD = (
    '<div class="ask-payload"><h4>채팅으로 같이 가는 것</h4><ol>'
    "<li>카드 제목과 추천 문장. 사용자가 무엇을 눌렀는지</li>"
    "<li>규칙 인용 <code>~/.claude/CLAUDE.md:9</code> 원문과 축이 재는 방식. 분모는 fork 를 뺀 위임, 위반은 model 없음</li>"
    "<li>차액의 근거. 위반 건마다 실제 모델과 토큰(message.id 로 중복 제거), 기준 모델 sonnet, 단가 기준(공개 API 2026-06). 구독 사용자에게는 환산치라는 말</li>"
    "<li>위반 6건의 세션 전사 경로. 실제 호출 문맥을 열어볼 수 있게</li>"
    "<li>몰린 곳 general-purpose 5/39. 어디를 먼저 볼지</li>"
    "<li>건드릴 파일 <code>~/.claude/CLAUDE.md</code> · <code>~/.claude/settings.json</code>. 전역이라 다른 저장소에도 같이 반영된다는 말</li>"
    "<li>지킬 것. 수정 전에 무엇을 바꿀지 먼저 묻기, 커밋 전 <code>git status --short</code></li>"
    "<li>끝나면. askin 이 다시 재서 위반이 0 이면 카드를 지운다. 확인은 앱이 한다</li>"
    "<li>출처. askin 이 전사를 실측해 만든 문서라는 한 줄</li>"
    "</ol></div>"
)


def msg_context(lines):
    inner = "".join(f"<div>{l}</div>" for l in lines)
    return (
        '<div class="ask-agent-message-row">'
        + orb("idle", "문맥 실림")
        + f'<div class="ask-message is-agent"><small>askin · 레포트에서</small><span class="ask-ctx">{inner}</span></div></div>'
    )


handoff_chat = chat_panel(
    chat_tabs("모델 명시 6건", extra_tabs=["새 대화"]),
    '<div class="ask-chat-messages">'
    + msg_context([
        "<b>위임 40건 중 6건이 모델을 정하지 않고 나갔다</b>",
        "규칙 ~/.claude/CLAUDE.md:9 · 몰린 곳 general-purpose 5/39",
        "표본 6건 전사 경로 · 건드릴 파일 2개 첨부",
        "끝나면 askin 이 다시 재서 카드를 지워요",
    ])
    + msg_agent_row("훅으로 강제할지, CLAUDE.md 문구만 손볼지부터 정하자. 6건 중 5건이 general-purpose 라 한 곳에서 새는 것 같아.")
    + msg_user("훅으로 막자")
    + msg_agent_row("PreToolUse 에 Agent 매처를 걸고 model 이 없으면 막는 스크립트를 제안할게. settings.json 에 넣기 전에 내용을 먼저 보여줄게.")
    + "</div>",
)
handoff_left = (
    '<p class="ask-caption">korean-tone 저장소 실측(2026-09-04). harness-bro 에는 규칙 위반이 없어 다른 저장소 값으로 그렸다. 잡무 모델 위반 4건(app-a)은 에이전트 정의에 model: haiku 가 있어 실제로 haiku 로 돌았고 차액이 0 이라 카드가 그렇게 말해야 한다.</p>'
    + HANDOFF_CARD + HANDOFF_CHOICE + HANDOFF_PAYLOAD
)
write(
    "Handoff.dc.html", 1180, 800,
    root_open(1180)
    + f'<div class="ask-main-panel" style="padding:12px 16px 18px"><div class="ask-handoff"><div>{handoff_left}</div>{handoff_chat}</div></div>'
    + ROOT_CLOSE,
)


# ═══════════════════════════════════════════════════════════
# page-3 「상태와 환경」
# ═══════════════════════════════════════════════════════════

# 9. FirstRun — 프로젝트가 하나도 없는 첫 실행
first_run_inner = (
    '<div class="ask-report-view ask-report-empty is-visible">'
    '<div><span class="ask-empty-symbol" aria-hidden="true">○</span>'
    "<h3>분석할 프로젝트를 추가해봐요</h3>"
    "<p>Claude Code 로 작업한 디렉터리를 고르면 기록을 읽어요.</p>"
    '<button class="ask-primary" type="button">프로젝트 추가</button>'
    "</div></div>"
)
first_run_html = (
    '<main class="ask-main-panel"><div class="ask-report" aria-labelledby="ask-report-title">'
    '<div class="ask-report-stage">' + first_run_inner + "</div></div></main>"
)
write(
    "FirstRun.dc.html", 1180, 880,
    root_open(1180) + ask_window(sidebar_minimal(), first_run_html, chat_empty(extra_tabs=()), "askin") + ROOT_CLOSE,
)

# 10. NoHarness — 하네스 문서가 없는 저장소
no_harness_inner = (
    '<div class="ask-report-view ask-report-empty is-visible">'
    '<div><span class="ask-empty-symbol" aria-hidden="true">◇</span>'
    "<h3>이 저장소엔 하네스 문서가 없어요</h3>"
    # 하네스 문서를 분모로 쓰는 축은 둘이다.
    # source: 'agents' 는 report.mjs 의 agentRows -> agentDefs(repo) 로 에이전트 정의 파일이 분모고,
    # 'declaredSkills' 는 declaredSkillRows(repo) 로 그 정의가 선언한 스킬이 분모다.
    # 훅 무결성('hooks')은 여기 안 든다. hookRows(sessionRows) 가 세션 전사의 훅 실행 기록에서
    # 나오므로 하네스 문서가 없어도 훅이 돌았으면 판정된다. 처음에 셋으로 적었다가 실측해서 고쳤다.
    "<p>지금 재면 <b>하네스 활용</b>과 <b>스킬 선언 무결성</b> 두 축을 못 재요. "
    "잴 게 없는 거지 0점이 아니에요.</p>"
    '<button class="ask-primary" type="button">채팅에서 같이 만들기</button>'
    "</div></div>"
)
no_harness_session = session_panel(collapsed=False, count=0)
no_harness_report = report_panel(False, no_harness_inner)
no_harness_html = f'<main class="ask-main-panel">{no_harness_session}{no_harness_report}</main>'
write(
    "NoHarness.dc.html", 1180, 880,
    root_open(1180)
    + ask_window(
        sidebar("docker-mysql", extra_project="docker-mysql"),
        no_harness_html,
        chat_empty(),
        "askin · docker-mysql",
    )
    + ROOT_CLOSE,
)

# 11. Narrow — 좁은 창. 컨셉이 아니라 프로토타입의 max-width:680px 결과를 그린다.
narrow_session = session_panel(
    collapsed=False, count=2,
    body=session_row(True, 12, "41분 전") + session_row(False, 34, "3시간 전")
    + call_flow_line("메인 → general-purpose 3회 → Explore 1회"),
)
narrow_report = report_panel(True, report_result_view(), period="8월 1일 – 8월 31일", position="1 / 2")
narrow_html = f'<main class="ask-main-panel">{narrow_session}{harness_panel()}{narrow_report}</main>'
write(
    "Narrow.dc.html", 760, 2290,
    root_open(760, force_narrow=True)
    + ask_window(sidebar("harness-bro"), narrow_html, chat_empty(), "askin · harness-bro")
    + ROOT_CLOSE,
)

# 12. Dark — Main 의 다크 모드. light-dark() 가 color-scheme 을 따라간다.
dark_session = session_panel(collapsed=True, count=2)  # Main 과 같은 상태
dark_report = report_panel(True, report_result_view(), period="8월 1일 – 8월 31일", position="1 / 2")
dark_html = f'<main class="ask-main-panel">{dark_session}{harness_panel()}{dark_report}</main>'
write(
    "Dark.dc.html", 1680, 1120,
    root_open(1680, color_scheme="dark", fold=True)
    + ask_window(sidebar("harness-bro"), dark_html, chat_active(), "askin · harness-bro")
    + ROOT_CLOSE,
    bg="#121019",
)


# ═══════════════════════════════════════════════════════════
# canvas.json
# ═══════════════════════════════════════════════════════════
CANVAS = {
    "artboards": [
        {"file": "Main.dc.html", "x": 0, "y": 0, "title": "현재 세션 + 레포트 기본 화면"},
        {"file": "Expanded.dc.html", "x": 4400, "y": 0, "title": "현재 세션을 펼친 상태"},
        {"file": "Empty.dc.html", "x": 6200, "y": 0, "title": "프로젝트를 갓 추가 · 레포트 없음"},
        {"file": "Config.dc.html", "x": 8000, "y": 0, "title": "분석 설정 폼"},
        {"file": "Scanning.dc.html", "x": 9800, "y": 0, "title": "분석 중"},
        {"file": "Zoom.dc.html", "x": 0, "y": 0, "page": "page-2", "title": "줌 세 단계의 라벨 밀도"},
        {"file": "NodePick.dc.html", "x": 1560, "y": 0, "page": "page-2", "title": "노드를 고른 상태 + 키보드 대체 목록"},
        {"file": "Details.dc.html", "x": 1800, "y": 0, "title": "세부 분석을 펼친 상태(카드 여덟) + 판정 불가"},
        {"file": "Handoff.dc.html", "x": 3100, "y": 0, "title": "아쉬운 점 카드에서 채팅으로"},
        {"file": "FirstRun.dc.html", "x": 0, "y": 0, "page": "page-3", "title": "프로젝트가 하나도 없는 첫 실행"},
        {"file": "NoHarness.dc.html", "x": 1300, "y": 0, "page": "page-3", "title": "하네스 문서가 없는 저장소"},
        {"file": "Narrow.dc.html", "x": 2600, "y": 0, "page": "page-3", "title": "좁은 창"},
        {"file": "Dark.dc.html", "x": 3480, "y": 0, "page": "page-3", "title": "Main 의 다크 모드"},
    ],
    "annotations": [
        {
            "id": "note-layers", "page": "page-1", "x": 0, "y": -260, "w": 560,
            "text": (
                "정보는 세 층이다.\n"
                "1층 — 내 하네스(지금 구조)와 아쉬운 점 카드 — 가 첫 화면에 같이 온다.\n"
                "2층 — 세부 분석 카드 여덟 — 은 펼쳐야 보인다.\n"
                "3층 — 축·분모·근거 전부 — 는 그 카드 안에 있다.\n\n"
                "종합 점수와 순위 계산은 없다. 카드 층(반복 → 규칙 → 깨진 것)은 고정 순서다."
            ),
        },
        {
            "id": "note-fold", "page": "page-1", "x": 1160, "y": -260, "w": 500,
            "text": (
                "점선은 1680×1080 창(앱 기본 창)의 아래끝이다.\n\n"
                "내 하네스(요약 띠 + 그래프 240px), 아쉬운 점 카드 셋, 세부 분석 토글(y=1076)까지 한 화면에 든다.\n"
                "세션 패널을 펼치거나(Expanded) 그래프를 300px 로 두면 셋째 카드가 밀린다(실측 y=1130).\n\n"
                "그래프와 레포트는 시간 축이 다르다. 그래프는 지금 정의와 전체 기록, 레포트는 고른 기간이다."
            ),
        },
        {
            "id": "note-session", "page": "page-1", "x": 620, "y": -260, "w": 480,
            "text": (
                "도는 세션은 실측으로 보통 0~5개다. 그래서 Main 은 접힌 상태가 기본이고, Expanded 가 펼친 모습이다.\n\n"
                "세션 제목은 넣지 않았다. 앱이 그 값을 안 뽑는다.\n"
                "있는 건 turn 수, 마지막 기록 시각, 도는 중 여부뿐이다."
            ),
        },
        {
            "id": "note-graph", "page": "page-2", "x": 0, "y": -260, "w": 560,
            "text": (
                "내 하네스는 레포트와 별개 섹션이다.\n"
                "지금 파일의 정의와 전체 기록의 호출을 보여주고, 기간을 좁히지 않는다.\n\n"
                "노드 종류는 색으로만 말하지 않는다. 범례와 노드 아래 글자가 항상 같이 있다.\n\n"
                "줌은 확대가 아니라 정보 밀도다. 멀리서는 이름을 줄이고 가까이서는 다 보여준다."
            ),
        },
        {
            "id": "note-unjudged", "page": "page-1", "x": 1800, "y": -260, "w": 480,
            "text": (
                "세부 분석은 주제별 카드 여덟이다. 잡을 수 있는 증상을 전부 적고 0건은 흐리게 둔다.\n"
                "위 아쉬운 점으로 올라간 증상에는 칩이 붙는다.\n\n"
                "판정 불가는 0% 가 아니다. 무엇이 없어서 못 재는지, 무엇이 쌓이면 재는지를 적는다.\n\n"
                "카드 제목 옆 배지는 그 값이 어느 도구 기록에서 왔는지다(Claude · Codex)."
            ),
        },
        {
            "id": "note-handoff", "page": "page-1", "x": 3100, "y": -260, "w": 480,
            "text": (
                "카드 하나가 채팅으로 갈 때 같이 가는 것.\n"
                "fix.mjs 의 instruction() 이 만드는 지시서가 본문이고, 그 위에 카드 제목·추천·사용자가 누른 것, "
                "규칙 원문, 표본 전사 경로, 차액 근거, 끝나면 앱이 다시 잰다는 말을 얹는다.\n\n"
                "값은 korean-tone 실측이다. 이 저장소에는 규칙 위반이 없다."
            ),
        },
        {
            "id": "note-narrow", "page": "page-3", "x": 2600, "y": -260, "w": 480,
            "text": (
                "여기서 컨셉과 프로토타입이 어긋난다.\n"
                "design-concept.md 는 사이드바를 아이콘 레일로 줄이고 채팅은 오른쪽 시트로 열자고 적었다.\n"
                "프로토타입 CSS 의 max-width:680px 는 사이드바를 위로 올려 가로로 눕힌다.\n\n"
                "이 그림은 프로토타입을 따랐다. 아이콘 레일은 아직 구현이 없다."
            ),
        },
    ],
    "pages": [
        {"id": "page-1", "name": "화면"},
        {"id": "page-2", "name": "그래프 컴포넌트"},
        {"id": "page-3", "name": "상태와 환경"},
    ],
    "launch": {"view": "canvas", "page": "page-1"},
}
# 프레임 크기는 write() 가 받은 값 하나에서만 온다. 여기 또 적으면 둘이 어긋난다.
for artboard in CANVAS["artboards"]:
    w, h = SIZES[artboard["file"]]
    artboard["w"], artboard["h"] = w, h

(ROOT / "canvas.json").write_text(json.dumps(CANVAS, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("canvas.json")


# ── 자가 점검. gen.py 를 실행하는 것 자체가 검증이다 ──────────
if __name__ == "__main__":
    for artboard in CANVAS["artboards"]:
        p = ROOT / artboard["file"]
        text = p.read_text(encoding="utf-8")
        for token in ("<x-dc>", "</helmet>", "</x-dc>", "#askin-desktop-v1"):
            assert token in text, f"{artboard['file']} 에 {token} 이 없다"
    json.loads((ROOT / "canvas.json").read_text(encoding="utf-8"))
    print(f"자가 점검 통과: 아트보드 {len(CANVAS['artboards'])}개 + canvas.json")
