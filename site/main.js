const themeButton = document.querySelector('.theme-toggle');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const currentTheme = () => document.documentElement.dataset.theme || (systemTheme.matches ? 'dark' : 'light');
function showThemeAction() {
  const dark = currentTheme() === 'dark';
  themeButton.setAttribute('aria-label', dark ? '밝은 화면으로 전환' : '어두운 화면으로 전환');
  themeButton.querySelector('use').setAttribute('href', `assets/icons.svg#${dark ? 'sun' : 'moon'}`);
}
themeButton.hidden = false;
showThemeAction();
systemTheme.addEventListener('change', showThemeAction);
themeButton.addEventListener('click', () => {
  const theme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('askin.site.theme', theme); } catch { /* The current page can still switch themes. */ }
  showThemeAction();
});
const descriptions = {
  agent: ['에이전트 · main agent', '프로젝트 작업을 맡는 에이전트예요. 이 예시에서는 프로젝트와 실제 호출로 연결돼 있어요.'],
  reviewer: ['에이전트 · reviewer', '검토를 맡기는 에이전트예요. 실선으로 연결돼 있어 실제 호출한 관계를 뜻해요.'],
  skill: ['스킬 · project skill', '작업에 필요한 지침을 담은 스킬이에요. 정의만 있는지, 실제로 호출됐는지 함께 살펴봐요.'],
  mcp: ['MCP · filesystem', '에이전트가 외부 도구와 연결되는 자리예요. 연결 그래프에서 어떤 도구를 썼는지 볼 수 있어요.'],
  docs: ['스킬 · docs skill', '점선은 선언해둔 관계를 뜻해요. 선언이 있다는 사실과 실제로 호출됐다는 사실을 구분해요.'],
  qa: ['에이전트 · QA agent', '이 예시에서는 선언된 연결만 있어요. 실제 호출이 없다고 해서 곧바로 문제라고 판정하지는 않아요.'],
};
const nodes = document.querySelectorAll('[data-node]');
for (const node of nodes) {
  node.setAttribute('aria-pressed', 'false');
  node.addEventListener('click', () => {
    const selected = node.getAttribute('aria-pressed') === 'true';
    for (const other of nodes) other.setAttribute('aria-pressed', 'false');
    node.setAttribute('aria-pressed', String(!selected));
    const [title, description] = selected
      ? ['적어둔 연결과 실제 쓴 연결', '실선은 실제 호출, 점선은 선언한 연결이에요. 이름을 누르면 역할을 볼 수 있어요.']
      : descriptions[node.dataset.node];
    document.querySelector('#node-title').textContent = title;
    document.querySelector('#node-description').textContent = description;
  });
}
for (let i = 0; i < 40; i++) {
  const dot = document.createElement('i');
  if (i < 6) dot.className = 'observed';
  document.querySelector('.evidence-dots').append(dot);
}
const copyButton = document.querySelector('.copy-button');
const copyStatus = document.querySelector('.copy-status');
copyButton.hidden = false;
let copies = 0;
copyButton.addEventListener('click', async () => {
  copyButton.disabled = true;
  copyButton.setAttribute('aria-busy', 'true');
  try {
    await navigator.clipboard.writeText(document.querySelector('#plan-command').textContent);
    copyButton.querySelector('use').setAttribute('href', 'assets/icons.svg#check');
    copyStatus.replaceChildren();
    const message = document.createElement('span');
    message.className = 'sr-only';
    message.textContent = `명령을 복사했어요. ${++copies}번째 복사.`;
    copyStatus.append(message);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#plan-command'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    copyStatus.textContent = '복사하지 못했어요. 선택된 명령을 직접 복사해 주세요.';
    copyButton.querySelector('use').setAttribute('href', 'assets/icons.svg#copy');
  } finally {
    copyButton.disabled = false;
    copyButton.removeAttribute('aria-busy');
  }
});
