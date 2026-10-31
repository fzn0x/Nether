// What a built-in theme draws behind the app (ADR 0049), on a canvas under
// everything that takes no pointer: kana drifting up in rainbow colors for
// Anime, and for Pixel grid, cells lighting around the pointer, each in its
// own color, scattering pixels. Neither draws while the window is hidden;
// with reduced motion asked for, the kana stand still and no pixels fly;
// and the grid draws nothing once its cells have faded.
import { useEffect, useRef } from "react";

export type Effect = "kana" | "pixels";

/** Sizes the canvas to the window, sharp on dense screens; returns its context. */
function fit(canvas: HTMLCanvasElement): CanvasRenderingContext2D | undefined {
  const scale = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * scale);
  canvas.height = Math.round(innerHeight * scale);
  const context = canvas.getContext("2d");
  context?.setTransform(scale, 0, 0, scale, 0, 0);
  return context ?? undefined;
}

const dark = () => document.documentElement.dataset.mode !== "light";
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Runs `frame` each animation frame while the window shows, until stopped. */
function loop(frame: (now: number) => boolean): { start: () => void; stop: () => void } {
  let id: number | undefined;
  const tick = (now: number) => {
    id = undefined;
    if (document.hidden) return;
    if (frame(now)) id = requestAnimationFrame(tick);
  };
  return {
    start: () => {
      id ??= requestAnimationFrame(tick);
    },
    stop: () => {
      if (id !== undefined) cancelAnimationFrame(id);
      id = undefined;
    },
  };
}

const hiragana = [0x3041, 0x3096] as const;
const katakana = [0x30a1, 0x30fa] as const;

function randomKana(): string {
  const [from, to] = Math.random() < 0.5 ? hiragana : katakana;
  return String.fromCharCode(from + Math.floor(Math.random() * (to - from + 1)));
}

interface Glyph {
  text: string;
  x: number;
  y: number;
  size: number;
  speed: number;
  sway: number;
  phase: number;
  hue: number;
  hueSpeed: number;
  alpha: number;
}

function glyph(atBottom: boolean): Glyph {
  const size = 16 + Math.random() * 26;
  return {
    text: randomKana(),
    x: Math.random() * innerWidth,
    y: atBottom ? innerHeight + size : Math.random() * innerHeight,
    size,
    // Larger ones nearer, and faster.
    speed: 10 + size * 0.9 + Math.random() * 12,
    sway: 6 + Math.random() * 18,
    phase: Math.random() * Math.PI * 2,
    hue: Math.random() * 360,
    hueSpeed: 25 + Math.random() * 45,
    alpha: 0.35 + Math.random() * 0.4,
  };
}

function kana(canvas: HTMLCanvasElement): () => void {
  let context = fit(canvas);
  const count = () => Math.round(Math.min(70, Math.max(24, (innerWidth * innerHeight) / 22000)));
  const glyphs = Array.from({ length: count() }, () => glyph(false));
  let last = 0;

  const draw = (now: number, dt: number) => {
    if (context === undefined) return;
    context.clearRect(0, 0, innerWidth, innerHeight);
    const light = !dark();
    for (const item of glyphs) {
      item.y -= item.speed * dt;
      item.hue = (item.hue + item.hueSpeed * dt) % 360;
      if (item.y < -item.size) Object.assign(item, glyph(true));
      const x = item.x + Math.sin(now / 1400 + item.phase) * item.sway;
      context.font = `${String(Math.round(item.size))}px "Yu Gothic", "Hiragino Sans", "Noto Sans JP", "Meiryo", sans-serif`;
      context.fillStyle = light
        ? `hsl(${String(Math.round(item.hue))} 85% 52% / ${String(item.alpha * 0.8)})`
        : `hsl(${String(Math.round(item.hue))} 95% 68% / ${String(item.alpha)})`;
      context.fillText(item.text, x, item.y);
    }
  };

  const frames = loop((now) => {
    // Thirty frames a second are smooth enough for drifting, at half the work.
    if (now - last < 32) return true;
    const dt = last === 0 ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    draw(now, dt);
    return true;
  });

  const restart = () => {
    frames.stop();
    last = 0;
    if (reducedMotion()) draw(performance.now(), 0);
    else frames.start();
  };
  const onResize = () => {
    context = fit(canvas);
    while (glyphs.length < count()) glyphs.push(glyph(false));
    glyphs.length = Math.min(glyphs.length, count());
    restart();
  };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const mode = new MutationObserver(restart);
  mode.observe(document.documentElement, { attributeFilter: ["data-mode"] });
  addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", restart);
  motion.addEventListener("change", restart);
  restart();
  return () => {
    frames.stop();
    removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", restart);
    motion.removeEventListener("change", restart);
    mode.disconnect();
  };
}

const cell = 28;

/** A cell's own hue, the same each time it lights. */
function hueOf(column: number, row: number): number {
  const hash = Math.imul((column * 73856093) ^ (row * 19349663), 0x9e3779b1) >>> 0;
  return hash % 360;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
  size: number;
}

function pixels(canvas: HTMLCanvasElement): () => void {
  let context = fit(canvas);
  /** Lit cells, by column and row, and how brightly. */
  const lit = new Map<string, { column: number; row: number; glow: number }>();
  const particles: Particle[] = [];
  let last = 0;
  let pointer: { x: number; y: number } | undefined;

  const drawGrid = (light: boolean) => {
    if (context === undefined) return;
    context.strokeStyle = light ? "rgb(20 24 33 / 6%)" : "rgb(232 236 242 / 5%)";
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0.5; x < innerWidth; x += cell) {
      context.moveTo(x, 0);
      context.lineTo(x, innerHeight);
    }
    for (let y = 0.5; y < innerHeight; y += cell) {
      context.moveTo(0, y);
      context.lineTo(innerWidth, y);
    }
    context.stroke();
  };

  const draw = (dt: number): boolean => {
    if (context === undefined) return false;
    const light = !dark();
    context.clearRect(0, 0, innerWidth, innerHeight);
    drawGrid(light);
    for (const [key, item] of lit) {
      item.glow -= dt * 1.4;
      if (item.glow <= 0) {
        lit.delete(key);
        continue;
      }
      const hue = String(hueOf(item.column, item.row));
      context.fillStyle = light
        ? `hsl(${hue} 80% 55% / ${String(item.glow * 0.55)})`
        : `hsl(${hue} 90% 60% / ${String(item.glow * 0.7)})`;
      context.fillRect(item.column * cell + 1, item.row * cell + 1, cell - 1, cell - 1);
    }
    for (let at = particles.length - 1; at >= 0; at--) {
      const item = particles[at];
      if (item === undefined) continue;
      item.life -= dt;
      if (item.life <= 0) {
        particles.splice(at, 1);
        continue;
      }
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      item.vy += 60 * dt;
      context.fillStyle = `hsl(${String(item.hue)} 95% ${light ? "50%" : "65%"} / ${String(Math.min(1, item.life * 1.6))})`;
      // Snapped to whole pixels, as pixels are.
      context.fillRect(Math.round(item.x), Math.round(item.y), item.size, item.size);
    }
    return lit.size > 0 || particles.length > 0;
  };

  const frames = loop((now) => {
    const dt = last === 0 ? 1 / 60 : Math.min(0.1, (now - last) / 1000);
    last = now;
    const more = draw(dt);
    if (!more) last = 0;
    return more;
  });

  const light = (x: number, y: number) => {
    const column = Math.floor(x / cell);
    const row = Math.floor(y / cell);
    for (let dc = -2; dc <= 2; dc++) {
      for (let dr = -2; dr <= 2; dr++) {
        const distance = Math.hypot(dc, dr);
        if (distance > 2.3) continue;
        const glow = 1 - distance / 2.6;
        const key = `${String(column + dc)},${String(row + dr)}`;
        const known = lit.get(key);
        if (known === undefined) lit.set(key, { column: column + dc, row: row + dr, glow });
        else known.glow = Math.max(known.glow, glow);
      }
    }
    if (reducedMotion()) return;
    const moved = pointer === undefined ? 0 : Math.hypot(x - pointer.x, y - pointer.y);
    const count = Math.min(6, Math.floor(moved / 6));
    for (let made = 0; made < count; made++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 90;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: 0.5 + Math.random() * 0.6,
        hue: hueOf(column + Math.round(Math.cos(angle) * 2), row + Math.round(Math.sin(angle) * 2)),
        size: 2 + Math.round(Math.random() * 2),
      });
    }
    // Never more than the eye follows.
    if (particles.length > 240) particles.splice(0, particles.length - 240);
  };

  const onMove = (event: PointerEvent) => {
    light(event.clientX, event.clientY);
    pointer = { x: event.clientX, y: event.clientY };
    frames.start();
  };
  const redraw = () => {
    context = fit(canvas);
    draw(0);
  };
  const onVisible = () => {
    if (!document.hidden) frames.start();
  };
  // Light or dark changed: the grid in the other's colors.
  const mode = new MutationObserver(() => {
    draw(0);
  });
  mode.observe(document.documentElement, { attributeFilter: ["data-mode"] });
  addEventListener("pointermove", onMove, { passive: true });
  addEventListener("resize", redraw);
  document.addEventListener("visibilitychange", onVisible);
  // The grid alone until the pointer moves.
  draw(0);
  return () => {
    frames.stop();
    removeEventListener("pointermove", onMove);
    removeEventListener("resize", redraw);
    document.removeEventListener("visibilitychange", onVisible);
    mode.disconnect();
  };
}

export default function ThemeEffect(props: { readonly effect: Effect }) {
  const { effect } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    return effect === "kana" ? kana(element) : pixels(element);
  }, [effect]);
  return <canvas ref={canvas} className="theme-effect" aria-hidden="true" />;
}
