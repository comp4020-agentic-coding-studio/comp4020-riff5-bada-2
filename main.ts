import {
  effectiveSpeed,
  nextTheme,
  rectsOverlap,
  rescaleObstacleX,
  tryJump,
  type GadgetKind,
  type Rect,
} from "./game-logic.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const status = document.querySelector<HTMLElement>("#status")!;

const GROUND_RATIO = 0.72;
const GRAVITY = 2200;
const JUMP_VELOCITY = -830;
const PLAYER_SIZE = 30;
const BASE_SPEED = 300;
const SPEED_RAMP = 5;
const MIN_GAP = 240;
const MAX_GAP = 460;
const BEST_KEY = "jump-best-distance";
const IDLE_OBSTACLE_RATIO = 0.62;
const IDLE_OBSTACLE_HEIGHT = 46;
const MAX_JUMPS = 2;
const SHORT_MIN_HEIGHT = 26;
const SHORT_MAX_HEIGHT = 54;
const TALL_MIN_HEIGHT = 145;
const TALL_MAX_HEIGHT = 165;
const TALL_AFTER_COUNT = 2;
const TALL_CHANCE = 0.35;
const GADGET_SIZE = 20;
const GADGET_EVERY = 3;
const GADGET_FLOAT_HEIGHT = 95;
const GADGET_LEAD = 130;
const SLOW_DURATION = 4;
const SLOW_FACTOR = 0.55;

// Each "destination": background, ground line, obstacle and text colour.
const THEMES = [
  { bg: "#e8e4da", ground: "#3a3a3a", obstacle: "#3a3a3a", text: "#3a3a3a" },
  { bg: "#dfeee6", ground: "#1f5c46", obstacle: "#1f5c46", text: "#1f5c46" },
  { bg: "#f3e6d8", ground: "#7a3b1e", obstacle: "#7a3b1e", text: "#7a3b1e" },
  { bg: "#e3e6f5", ground: "#2f3a7a", obstacle: "#2f3a7a", text: "#2f3a7a" },
];

type Phase = "idle" | "running" | "over";

interface Obstacle {
  x: number;
  w: number;
  h: number;
  tall: boolean;
}

interface Gadget {
  x: number;
  kind: GadgetKind;
}

let width = 0;
let height = 0;
let groundY = 0;

let phase: Phase = "idle";
let playerY = 0;
let velocityY = 0;
let obstacles: Obstacle[] = [];
let gadgets: Gadget[] = [];
let speed = BASE_SPEED;
let distance = 0;
let best = readBest();
let slowTimer = 0;
let theme = 0;

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? 0);
  } catch {
    return 0;
  }
}
let lastTime = 0;
let sinceLastSpawn = 0;
let nextGap = randomGap();
let fallRotation = 0;
let resetTimer = 0;
let jumpsUsed = 0;
let obstaclesSpawned = 0;

function randomGap(): number {
  return MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP);
}

// Synthesised, so a static site ships zero audio assets. Created lazily on
// the first jump (always a user gesture) since autoplay policies block an
// AudioContext started any earlier.
let audioCtx: AudioContext | null = null;

function tone(
  freq: number,
  duration: number,
  type: OscillatorType,
  gain: number,
  delay = 0,
): void {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  const start = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(gain, start + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(env);
  env.connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + duration);
}

function playJumpSound(isDoubleJump: boolean): void {
  tone(isDoubleJump ? 660 : 440, 0.1, "square", 0.1);
}

function playGadgetSound(kind: GadgetKind): void {
  if (kind === "slow") {
    tone(320, 0.22, "triangle", 0.14);
  } else {
    tone(523.25, 0.09, "sine", 0.12);
    tone(783.99, 0.14, "sine", 0.12, 0.09);
  }
}

function playGameOverSound(): void {
  tone(180, 0.3, "sawtooth", 0.12);
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const oldWidth = width;
  width = rect.width;
  height = rect.height;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  groundY = height * GROUND_RATIO;
  if (phase === "idle") {
    playerY = groundY - PLAYER_SIZE;
  } else if (oldWidth > 0 && width !== oldWidth) {
    for (const o of obstacles) o.x = rescaleObstacleX(o.x, oldWidth, width);
  }
}

function playerRect(): Rect {
  return {
    x: Math.max(40, width * 0.12),
    y: playerY,
    w: PLAYER_SIZE,
    h: PLAYER_SIZE,
  };
}

function obstacleRect(o: Obstacle): Rect {
  return { x: o.x, y: groundY - o.h, w: o.w, h: o.h };
}

function gadgetRect(g: Gadget): Rect {
  return {
    x: g.x,
    y: groundY - GADGET_FLOAT_HEIGHT,
    w: GADGET_SIZE,
    h: GADGET_SIZE,
  };
}

function startRun(): void {
  phase = "running";
  playerY = groundY - PLAYER_SIZE;
  velocityY = JUMP_VELOCITY;
  jumpsUsed = 1; // the launching press is jump 1
  obstacles = [];
  gadgets = [];
  obstaclesSpawned = 0;
  distance = 0;
  speed = BASE_SPEED;
  slowTimer = 0;
  theme = 0;
  sinceLastSpawn = 0;
  nextGap = randomGap();
}

function resetToIdle(): void {
  phase = "idle";
  playerY = groundY - PLAYER_SIZE;
  velocityY = 0;
  jumpsUsed = 0;
  obstacles = [];
  gadgets = [];
  slowTimer = 0;
  fallRotation = 0;
  distance = 0;
  status.textContent = "";
}

function endRun(): void {
  phase = "over";
  resetTimer = 0.6;
  best = Math.max(best, Math.floor(distance));
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch {
    // storage may be unavailable (private browsing, blocked, full); the
    // round still ends and the best score still shows for this session.
  }
  status.textContent = `${Math.floor(distance)}. Best ${best}.`;
  playGameOverSound();
}

function jump(): void {
  if (phase === "idle") {
    startRun();
    playJumpSound(false);
    return;
  }
  if (phase === "over") {
    if (resetTimer <= 0) resetToIdle();
    return;
  }
  const result = tryJump(jumpsUsed, MAX_JUMPS);
  jumpsUsed = result.jumpsUsed;
  if (result.allowed) {
    velocityY = JUMP_VELOCITY;
    playJumpSound(result.jumpsUsed === MAX_JUMPS);
  }
}

function update(dt: number, now: number): void {
  if (phase === "running") {
    velocityY += GRAVITY * dt;
    playerY += velocityY * dt;
    if (playerY > groundY - PLAYER_SIZE) {
      playerY = groundY - PLAYER_SIZE;
      velocityY = 0;
      jumpsUsed = 0;
    }
    if (slowTimer > 0) slowTimer = Math.max(0, slowTimer - dt);
    const moveSpeed = effectiveSpeed(speed, slowTimer > 0, SLOW_FACTOR);

    speed += SPEED_RAMP * dt;
    distance += moveSpeed * dt * 0.05;
    sinceLastSpawn += dt;
    if (sinceLastSpawn * moveSpeed >= nextGap) {
      sinceLastSpawn = 0;
      nextGap = randomGap();
      obstaclesSpawned += 1;
      const tall =
        obstaclesSpawned > TALL_AFTER_COUNT && Math.random() < TALL_CHANCE;
      const h = tall
        ? TALL_MIN_HEIGHT + Math.random() * (TALL_MAX_HEIGHT - TALL_MIN_HEIGHT)
        : SHORT_MIN_HEIGHT +
          Math.random() * (SHORT_MAX_HEIGHT - SHORT_MIN_HEIGHT);
      obstacles.push({ x: width + 20, w: 22, h, tall });
      if (obstaclesSpawned % GADGET_EVERY === 0) {
        const kind: GadgetKind = Math.random() < 0.5 ? "slow" : "theme";
        gadgets.push({ x: width + 20 + GADGET_LEAD, kind });
      }
    }
    for (const o of obstacles) o.x -= moveSpeed * dt;
    obstacles = obstacles.filter((o) => o.x + o.w > -10);
    for (const g of gadgets) g.x -= moveSpeed * dt;
    gadgets = gadgets.filter((g) => g.x + GADGET_SIZE > -10);

    const p = playerRect();
    for (const o of obstacles) {
      if (rectsOverlap(p, obstacleRect(o))) {
        endRun();
        break;
      }
    }
    gadgets = gadgets.filter((g) => {
      if (!rectsOverlap(p, gadgetRect(g))) return true;
      if (g.kind === "slow") slowTimer = SLOW_DURATION;
      else theme = nextTheme(theme, THEMES.length);
      playGadgetSound(g.kind);
      return false;
    });
  } else if (phase === "over") {
    resetTimer -= dt;
    fallRotation = Math.min(Math.PI / 2, fallRotation + dt * 6);
  } else {
    playerY = groundY - PLAYER_SIZE + Math.sin(now / 300) * 4;
  }
}

function draw(): void {
  const palette = THEMES[theme];
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = palette.ground;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();

  for (const o of obstacles) {
    ctx.fillStyle = o.tall ? "#2f5d8a" : palette.obstacle;
    ctx.fillRect(o.x, groundY - o.h, o.w, o.h);
  }
  for (const g of gadgets) {
    const r = gadgetRect(g);
    ctx.fillStyle = g.kind === "slow" ? "#c9962f" : "#2fb8a3";
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (phase === "idle") {
    const iw = 22;
    ctx.fillStyle = palette.obstacle;
    ctx.fillRect(
      width * IDLE_OBSTACLE_RATIO,
      groundY - IDLE_OBSTACLE_HEIGHT,
      iw,
      IDLE_OBSTACLE_HEIGHT,
    );
  }

  const p = playerRect();
  if (phase === "idle") {
    const pulse = 0.35 + 0.25 * Math.sin(lastTime / 260);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#d1495b";
    ctx.beginPath();
    ctx.arc(p.x + p.w / 2, p.y + p.h / 2, p.w * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
  if (phase === "over") ctx.rotate(fallRotation);
  ctx.fillStyle = "#d1495b";
  ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  ctx.restore();

  ctx.fillStyle = palette.text;
  ctx.font = "16px ui-monospace, monospace";
  ctx.textAlign = "right";
  ctx.fillText(String(Math.floor(distance)), width - 16, 28);
  if (best > 0) {
    ctx.globalAlpha = 0.5;
    ctx.fillText(String(best), width - 16, 48);
    ctx.globalAlpha = 1;
  }
}

function loop(time: number): void {
  const dt = lastTime ? Math.min(0.05, (time - lastTime) / 1000) : 0;
  lastTime = time;
  update(dt, time);
  draw();
  requestAnimationFrame(loop);
}

function onInput(e: Event): void {
  e.preventDefault();
  jump();
}

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" && e.code !== "ArrowUp" && e.code !== "Enter") return;
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active !== canvas &&
    active !== document.body
  )
    return;
  onInput(e);
});
canvas.addEventListener("pointerdown", onInput);
window.addEventListener("resize", resize);

resize();
requestAnimationFrame(loop);
