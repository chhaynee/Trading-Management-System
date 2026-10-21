/**
 * background.js — Animated starfield canvas.
 *
 * Self-contained: owns its own RAF loop, respects prefers-reduced-motion,
 * and restarts cleanly on window resize.
 */

export function initBackground() {
  const canvas = document.getElementById('star-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let stars = [], W, H, raf;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function make() {
    stars = Array.from({ length: 220 }, () => ({
      x:  Math.random() * W,
      y:  Math.random() * H,
      r:  Math.random() * 1.15 + 0.2,
      a:  Math.random() * 0.5 + 0.1,
      vx: (Math.random() - 0.5) * 0.055,
      vy: Math.random() * 0.055 + 0.008,
      tp: Math.random() * Math.PI * 2,
      ts: Math.random() * 0.018 + 0.005,
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    for (const s of stars) {
      const alpha = s.a * (0.4 + 0.6 * Math.sin(t * s.ts + s.tp));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.fill();
      s.x += s.vx;
      s.y += s.vy;
      if (s.y > H + 2) { s.y = -2; s.x = Math.random() * W; }
      if (s.x < -2)    s.x = W + 2;
      if (s.x > W + 2) s.x = -2;
    }
    raf = requestAnimationFrame(draw);
  }

  function start() {
    cancelAnimationFrame(raf);
    resize();
    make();
    raf = requestAnimationFrame(draw);
  }

  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const enabled = () => !mq.matches && !document.hidden && !document.body.classList.contains('focus-mode');
  const sync = () => { if (enabled()) start(); else cancelAnimationFrame(raf); };
  sync();
  mq.addEventListener('change', sync);
  window.addEventListener('tms-view-preferences', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('resize', () => { if (enabled()) start(); });
}
