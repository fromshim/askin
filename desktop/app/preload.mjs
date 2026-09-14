// contextBridge 로 IPC 다섯 개를 감싼 함수만 페이지에 내보낸다. ipcRenderer 자체는 절대 넘기지 않는다 —
// 그러면 렌더러가 임의 채널로 뭐든 보낼 수 있게 되어 contextIsolation 을 두는 의미가 없어진다.
//
// protoCss 는 IPC 가 아니다 — preload 는 contextIsolation 과 무관하게 항상 완전한 node 접근을
// 갖는 특권 컨텍스트라(그게 preload 의 존재 이유다), 여기서 파일을 동기로 읽어 문자열 값으로
// 노출하는 것만으로 충분하다. index.html 이 페이지 파싱 중 맨 처음 이 값을 <style> 에 넣으므로
// main.mjs 의 did-finish-load(늦게 온다) 를 기다리다 스타일 없는 첫 프레임이 그려지는 경합이 없다.

import { contextBridge, ipcRenderer } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROTOTYPE_PATH = path.join(__dirname, '..', 'askin-desktop-prototype.html')

// desktop/canvas/gen.py 의 extract_proto_css() 와 같은 규칙: #askin-desktop-v1 안의 첫
// <style> 블록만 프로토타입 파일에서 그대로 뽑는다. CSS 를 이 파일에 베껴 넣지 않는다 —
// 프로토타입이 바뀌면 다음 실행에서 그대로 따라간다.
function extractPrototypeCss() {
  const html = fs.readFileSync(PROTOTYPE_PATH, 'utf8')
  const marker = '<div id="askin-desktop-v1">'
  const markerIdx = html.indexOf(marker)
  if (markerIdx === -1) throw new Error(`'${marker}' 를 ${PROTOTYPE_PATH} 에서 못 찾았다`)
  const styleOpen = '<style>'
  const styleStart = html.indexOf(styleOpen, markerIdx)
  if (styleStart === -1) throw new Error('#askin-desktop-v1 안에서 <style> 여는 태그를 못 찾았다')
  const start = styleStart + styleOpen.length
  const end = html.indexOf('</style>', start)
  if (end === -1) throw new Error('<style> 닫는 태그를 못 찾았다')
  const css = html.slice(start, end)
  if (!css.includes('#askin-desktop-v1') || css.length < 5000) {
    throw new Error('뽑은 CSS 가 비정상적으로 짧다. 프로토타입 형식이 바뀌었을 수 있다')
  }
  return css
}

contextBridge.exposeInMainWorld('askin', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  // 폴더 고르기 창은 메인 프로세스가 연다. { projects, added } 를 돌려준다 — added 는
  // 취소했으면 null 이다.
  addProject: () => ipcRenderer.invoke('projects:add'),
  removeProject: (repoPath) => ipcRenderer.invoke('projects:remove', repoPath),
  loadGraph: (repoPath) => ipcRenderer.invoke('graph:load', repoPath),
  // 그래프보다 오래 걸린다(실측 545ms ~ 5.4초). 렌더러가 그래프를 먼저 그리고 이걸 기다린다.
  loadReport: (repoPath) => ipcRenderer.invoke('report:load', repoPath),
  // "지시서 복사" 버튼. 카드 하나를 마크다운 지시서로 바꿔 받는다 — 렌더러가 클립보드에 담는다.
  coachHandoff: (repoPath, cardId) => ipcRenderer.invoke('coach:handoff', repoPath, cardId),
  // "문제 아님" 버튼. 카드 id 를 무시 목록에 쌓고 갱신된 레포트를 다시 받으라고 렌더러가 부른다.
  coachIgnore: (repoPath, cardId) => ipcRenderer.invoke('coach:ignore', repoPath, cardId),
  protoCss: extractPrototypeCss(),
})
