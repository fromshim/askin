const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

// A custom cursor field: DOM controls retain keyboard semantics, Canvas joins
// their moving centers. There is no background loop when the field is at rest.
function mountHarnessScene(scene) {
  const canvas = scene.querySelector('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;
  const points = [...scene.querySelectorAll('[data-point]')].map(element => ({
    element,
    id: element.dataset.point,
    depth: Number(element.dataset.depth),
    x: parseFloat(element.style.getPropertyValue('--x')) / 100,
    y: parseFloat(element.style.getPropertyValue('--y')) / 100,
    dx: 0, dy: 0,
  }));
  const byId = new Map(points.map(point => [point.id, point]));
  const edges = [
    ['project', 'agent', 'agent', false, -0.07],
    ['project', 'reviewer', 'agent', false, 0.06],
    ['project', 'skill', 'skill', false, 0.04],
    ['project', 'mcp', 'mcp', false, -0.04],
    ['agent', 'docs', 'declared', true, -0.18],
    ['project', 'qa', 'declared', true, 0.08],
    ['reviewer', 'mcp', 'declared', true, -0.14],
  ];
  let bounds, width = 0, height = 0, frame = 0, lastTime = 0;
  let boundsStale = false;
  let inView = false;
  let pointer = { x: 0, y: 0, active: false };
  let palette = {};

  const canMove = () => inView && !document.hidden && finePointer.matches && !reducedMotion.matches;
  function readPalette() {
    for (const kind of ['agent', 'skill', 'mcp']) {
      palette[kind] = getComputedStyle(scene.querySelector(`[data-kind="${kind}"] .map-disc`)).color;
    }
    palette.declared = getComputedStyle(scene.querySelector('.declaration')).stroke;
  }
  function draw() {
    context.clearRect(0, 0, width, height);
    for (const [from, to, kind, dashed, bend] of edges) {
      const a = byId.get(from), b = byId.get(to);
      const ax = a.x * width + a.dx, ay = a.y * height + a.dy;
      const bx = b.x * width + b.dx, by = b.y * height + b.dy;
      const selected = a.element.getAttribute('aria-pressed') === 'true' || b.element.getAttribute('aria-pressed') === 'true';
      const near = pointer.active ? Math.max(0, 1 - Math.hypot((ax + bx) / 2 - pointer.x, (ay + by) / 2 - pointer.y) / 180) : 0;
      context.beginPath();
      context.moveTo(ax, ay);
      context.quadraticCurveTo((ax + bx) / 2 - (by - ay) * bend, (ay + by) / 2 + (bx - ax) * bend, bx, by);
      context.strokeStyle = palette[kind];
      context.globalAlpha = selected ? 1 : (dashed ? 0.65 : 0.55) + near * 0.25;
      context.lineWidth = selected ? 1.8 : 1.2 + near * 0.4;
      context.setLineDash(dashed ? [3, 6] : []);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
  function place(point) {
    point.element.style.setProperty('--offset-x', `${point.dx.toFixed(3)}px`);
    point.element.style.setProperty('--offset-y', `${point.dy.toFixed(3)}px`);
  }
  function reset() {
    cancelAnimationFrame(frame);
    frame = 0; lastTime = 0; pointer.active = false;
    for (const point of points) { point.dx = point.dy = 0; place(point); }
    draw();
  }
  function tick(time) {
    frame = 0;
    if (!canMove()) { reset(); return; }
    const dt = Math.min(40, lastTime ? time - lastTime : 16.7);
    lastTime = time;
    const follow = 1 - Math.exp(-dt / 110);
    const radius = Math.min(160, width * 0.3);
    let settling = false;
    for (const point of points) {
      let targetX = 0, targetY = 0;
      if (pointer.active) {
        const vx = point.x * width - pointer.x, vy = point.y * height - pointer.y;
        const distance = Math.hypot(vx, vy);
        const influence = Math.max(0, 1 - distance / radius) ** 2;
        const force = influence * 22 * point.depth;
        targetX = (pointer.x / width - 0.5) * 16 * point.depth + vx / Math.max(1, distance) * force;
        targetY = (pointer.y / height - 0.5) * 12 * point.depth + vy / Math.max(1, distance) * force;
      }
      point.dx += (targetX - point.dx) * follow;
      point.dy += (targetY - point.dy) * follow;
      if (Math.abs(targetX - point.dx) + Math.abs(targetY - point.dy) > 0.025) settling = true;
      place(point);
    }
    draw();
    if (settling) frame = requestAnimationFrame(tick);
    else lastTime = 0;
  }
  function wake() {
    if (canMove() && !frame) frame = requestAnimationFrame(tick);
  }
  function measure() {
    bounds = scene.getBoundingClientRect();
    boundsStale = false;
    width = bounds.width; height = bounds.height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    readPalette(); reset();
  }
  scene.addEventListener('pointerenter', () => { bounds = scene.getBoundingClientRect(); boundsStale = false; });
  scene.addEventListener('pointermove', event => {
    if (!canMove() || event.pointerType === 'touch') return;
    if (boundsStale) { bounds = scene.getBoundingClientRect(); boundsStale = false; }
    pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top, active: true };
    wake();
  });
  scene.addEventListener('pointerleave', () => { pointer.active = false; wake(); });
  // Keyboard focus is stable even when a mouse is still over the scene.
  scene.addEventListener('focusin', reset);
  scene.addEventListener('click', draw);
  addEventListener('scroll', () => { boundsStale = true; if (pointer.active) { pointer.active = false; wake(); } }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  reducedMotion.addEventListener('change', reset);
  finePointer.addEventListener('change', reset);
  new ResizeObserver(measure).observe(scene);
  new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    if (!inView) reset();
  }).observe(scene);
  new MutationObserver(() => { readPalette(); draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readPalette(); draw(); });
  measure();
  scene.classList.add('canvas-ready');
}

mountHarnessScene(document.querySelector('.harness-scene'));

// Content is visible in server HTML. Each observer starts a one-shot animation
// only when its target enters; no hidden pending state or scroll polling.
const rootStyle = getComputedStyle(document.documentElement);
const easing = rootStyle.getPropertyValue('--ease-reveal').trim();
const textDuration = parseFloat(rootStyle.getPropertyValue('--motion-reveal'));
const graphicDuration = parseFloat(rootStyle.getPropertyValue('--motion-graphic'));
const running = new Set();
const revealTargets = new Map();
const addTargets = (selector, kind = 'text', stagger = false) => {
  document.querySelectorAll(selector).forEach((element, index) => {
    revealTargets.set(element, { kind, delay: stagger ? Math.min(index * 80, 160) : 0 });
  });
};
addTargets('.section-heading > *', 'text', true);
addTargets('.app-figure', 'graphic');
addTargets('.feature-notes > div', 'text', true);
addTargets('.principles-intro', 'text');
addTargets('.principle-list > article', 'evidence', true);
addTargets('.next-section > div:first-child', 'text');
addTargets('.command-panel', 'command');
addTargets('.start-section > div', 'text', true);

function animate(element, frames, options) {
  const animation = element.animate(frames, options);
  running.add(animation);
  animation.finished.then(() => running.delete(animation), () => running.delete(animation));
  return animation;
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const element = entry.target;
    const { kind, delay } = revealTargets.get(element);
    observer.unobserve(element);
    element.dataset.revealed = 'true';
    if (reducedMotion.matches || element.contains(document.activeElement)) continue;
    const graphic = kind === 'graphic';
    const transform = graphic ? 'translateY(28px) scale(0.985)' : `translateY(${kind === 'command' ? 12 : 18}px)`;
    const animation = animate(element, [{ opacity: 0, transform }, { opacity: 1, transform: 'none' }], {
      duration: graphic ? graphicDuration : textDuration, delay, easing, fill: 'backwards',
    });
    if (kind === 'evidence') animation.finished.then(() => {
      if (reducedMotion.matches || document.hidden) return;
      element.querySelectorAll('.evidence-dots .observed').forEach((dot, index) => {
        animate(dot, [{ opacity: 0.35, transform: 'scale(0.7)' }, { opacity: 1, transform: 'scale(1)' }], {
          duration: 320, delay: index * 25, easing,
        });
      });
    }, () => {});
  }
}, { rootMargin: '0px 0px -48px 0px', threshold: 0.12 });
for (const target of revealTargets.keys()) observer.observe(target);
function cancelReveals() {
  for (const animation of running) animation.cancel();
  running.clear();
}
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) cancelReveals(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelReveals(); });
document.addEventListener('focusin', event => {
  for (const target of revealTargets.keys()) if (target.contains(event.target)) {
    for (const animation of target.getAnimations({ subtree: true })) animation.cancel();
  }
});
