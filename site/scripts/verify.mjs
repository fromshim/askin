const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true, channel:'chrome'});
const errors = [];
const screenshots = new URL('../.impeccable/review/', import.meta.url).pathname;
for (const theme of ['light', 'dark']) {
  for (const width of [375, 400, 768, 1280]) {
    const page = await browser.newPage({viewport:{width,height:900},colorScheme:theme});
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:4173');
    await page.locator('img').evaluateAll(images => images.forEach(image => { image.loading = 'eager'; }));
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await page.evaluate(() => Promise.allSettled(document.getAnimations().map(animation => animation.finished)));
    // A full-page capture can trigger observers while Chrome tiles offscreen
    // content. Freeze spatial motion so the capture records the resting page.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.getAnimations().length === 0);
    // Async offscreen images can be loaded without being rasterized yet.
    await page.locator('.app-figure').scrollIntoViewIfNeeded();
    await page.locator('.app-figure img').evaluate(image => image.decode());
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({path:`${screenshots}${theme}-${width}.png`,fullPage:true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow ${width} ${theme}`);
    const buttons = await page.locator('button:visible').evaluateAll(nodes => nodes.map(n => ({label:n.getAttribute('aria-label') || n.textContent.trim(),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
    assert(buttons.every(b=>b.width>=44 && b.height>=44), JSON.stringify(buttons));
    await page.close();
  }
}
const context = await browser.newContext({permissions:['clipboard-read','clipboard-write'],colorScheme:'light'});
const page = await context.newPage();
await page.goto('http://127.0.0.1:4173');
await page.getByRole('button',{name:'어두운 화면으로 전환'}).click();
await page.reload();
assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
await page.locator('[data-node="docs"]').click();
assert.equal(await page.locator('#node-title').textContent(), '스킬 · docs skill');
await page.locator('[data-node="docs"]').click();
assert.equal(await page.locator('#node-title').textContent(), '적어둔 연결과 실제 쓴 연결');
await page.getByRole('button',{name:'지시서 생성 명령 복사'}).click();
assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'node src/report.mjs --plan');
await page.getByRole('button',{name:'지시서 생성 명령 복사'}).click();
await page.waitForFunction(() => document.querySelector('.copy-status').textContent.includes('2번째 복사'));
assert.match(await page.locator('.copy-status').textContent(),/2번째 복사/);
await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('denied'))},configurable:true}));
await page.getByRole('button',{name:'지시서 생성 명령 복사'}).click();
await page.waitForFunction(() => document.querySelector('.copy-status').textContent.includes('직접 복사'));
assert.match(await page.locator('.copy-status').textContent(),/직접 복사/);
assert.equal(await page.evaluate(()=>getSelection().toString()),'node src/report.mjs --plan');
await page.emulateMedia({reducedMotion:'reduce'});
assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
assert.equal(await page.locator('.theme-toggle').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
await context.close();
const nojs = await browser.newContext({javaScriptEnabled:false});
const plain = await nojs.newPage();
await plain.goto('http://127.0.0.1:4173');
assert.equal(await plain.locator('h1').count(),1);
assert.equal(await plain.locator('h2').count(),4);
await plain.locator('.app-figure img').scrollIntoViewIfNeeded();
await plain.waitForFunction(() => document.querySelector('.app-figure img').complete);
assert.equal(await plain.locator('.app-figure img').evaluate(n=>n.complete && n.naturalWidth>0),true);
assert.equal(await plain.getByText('macOS 다운로드 준비 중').isVisible(),true);
await nojs.close();
await browser.close();
assert.deepEqual(errors,[]);
console.log('PASS: 8 viewport/theme captures; no overflow; 44px controls; theme persistence; graph selection; clipboard success/repeat/failure; reduced motion; server HTML; no JS errors.');
