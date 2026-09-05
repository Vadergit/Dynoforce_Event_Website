const GAME_CONFIG = {
  flappy: {
    id: "flappy",
    title: "Flappy Battle",
    icon: "🐦",
    subtitle: "Steuere den Vogel mit deiner Kraft.",
    instructions: ["Mehr Kraft lässt den Vogel steigen.", "Weniger Kraft lässt ihn sinken.", "Weiche den Hindernissen aus."],
  },
  pong: {
    id: "pong",
    title: "Force Pong",
    icon: "🏓",
    subtitle: "Spiele mit deiner Kraft gegen den Computer.",
    instructions: ["Mehr Kraft bewegt den Schläger nach oben.", "Weniger Kraft bewegt ihn nach unten.", "Verpasst du den Ball, ist die Runde vorbei."],
  },
  squirrel: {
    id: "squirrel",
    title: "Squirrel Rush",
    icon: "🐿️",
    subtitle: "Springe mit dem Eichhörnchen nach oben.",
    instructions: ["Kurz lösen und dann Kraft geben.", "Mehr Kraft sorgt für einen höheren Sprung.", "Ziele auf die nächste Plattform."],
  },
};

const PRESETS = [10, 20, 30, 40];
const READY_MIN = 0.42;
const READY_MAX = 0.58;
const READY_HOLD_MS = 180;
const ASSET_ROOT = "https://dynoforce.web.app/1v1-assets/";
const SOUND_ROOT = `${ASSET_ROOT}sounds/`;
const BATTLE_SOUNDS = {
  start: ["shared_game_start_01.wav", "shared_game_start_02.wav"],
  flappyTurn: "flappy_agitated_bird_01.wav",
  flappyPoint: "flappy_point_up_01.wav",
  gameOver: "shared_game_over_01.wav",
  squirrelPoint: "shared_point_01.wav",
  squirrelJump: "squirrel_rush_jump_01.wav",
  squirrelBoost: "squirrel_rush_jump_02.wav",
  squirrelFall: "squirrel_rush_fall_01.wav",
};

const runtime = {
  root: null,
  activeGame: "",
  preset: 20,
  force: 0,
  signedForce: 0,
  connected: false,
  phase: "menu",
  score: 0,
  best: { flappy: 0, pong: 0, squirrel: 0 },
  readySince: 0,
  requiresRelease: false,
  raf: 0,
  lastFrame: 0,
  game: null,
  canvas: null,
  ctx: null,
};

const soundCooldowns = new Map();
let audioContext = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function forceRatio() {
  return clamp(runtime.force / Math.max(1, runtime.preset), 0, 1.35);
}

function escaped(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function playSound(file, volume = 0.25, cooldown = 120, key = file) {
  const now = performance.now();
  const previous = soundCooldowns.get(key) || 0;
  if (now - previous < cooldown) return;
  soundCooldowns.set(key, now);
  try {
    const audio = new Audio(SOUND_ROOT + file);
    audio.volume = clamp(volume, 0, 1);
    audio.play().catch(() => {});
  } catch (_) {}
}

function beep(frequency = 630, duration = 0.03) {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.05, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    osc.connect(gain).connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + duration);
  } catch (_) {}
}

function canvasSpec(gameId) {
  if (gameId === "flappy") return { width: 470, height: 400, pixelScale: 2, contextScaleX: 470 / 400, maxWidth: "820px" };
  if (gameId === "squirrel") return { width: 400, height: 340, pixelScale: 2, contextScaleX: 1, maxWidth: "820px" };
  return { width: 900, height: 765, pixelScale: 1, contextScaleX: 1, maxWidth: "820px" };
}

export function eventGamesPageMarkup({ connected = false, currentForce = 0 } = {}) {
  runtime.connected = Boolean(connected);
  runtime.force = Number(currentForce || 0);
  const active = runtime.activeGame && GAME_CONFIG[runtime.activeGame] ? runtime.activeGame : "";
  return `
    <section class="event-games-page" aria-label="DynoForce Spiele">
      <div class="event-games-navigation">
        <button class="button event-games-back" data-page="live" type="button">← Zur Challenge</button>
        <div class="event-games-selector" role="list" aria-label="Spiel auswählen">
          ${Object.values(GAME_CONFIG).map((game) => `
            <button class="event-game-card ${active === game.id ? "is-selected" : ""}" data-event-game="${game.id}" type="button" role="listitem">
              <span class="event-game-card-icon">${game.icon}</span>
              <span class="event-game-card-copy">
                <strong>${escaped(game.title)}</strong>
                <small>${escaped(game.subtitle)}</small>
              </span>
              <span class="event-game-card-arrow">→</span>
            </button>
          `).join("")}
        </div>
      </div>

      <div class="event-games-arena" id="eventGamesArena">
        ${active ? "" : `
          <div class="event-games-empty-state">
            <div class="event-games-empty-icon">🎮</div>
            <h3>Wähle ein Spiel</h3>
            <p>Flappy Battle, Force Pong oder Squirrel Rush.</p>
          </div>
        `}
      </div>
    </section>
  `;
}

export function bindEventGames(root, { connected = false, currentForce = 0, signedForce = 0 } = {}) {
  runtime.root = root;
  runtime.connected = Boolean(connected);
  runtime.force = Number(currentForce || 0);
  runtime.signedForce = Number(signedForce || 0);

  root.querySelectorAll("[data-event-game]").forEach((button) => {
    button.addEventListener("click", () => selectGame(button.dataset.eventGame));
  });

  if (runtime.activeGame && GAME_CONFIG[runtime.activeGame]) mountActiveGame();
  else stopLoop();
  updateForceUi();
}

export function updateEventGamesForce({ force = 0, signedForce = 0, connected = false } = {}) {
  runtime.force = Number(force || 0);
  runtime.signedForce = Number(signedForce || 0);
  runtime.connected = Boolean(connected);
  updateForceUi();
}

export function cleanupEventGames({ keepSelection = true } = {}) {
  stopLoop();
  runtime.root = null;
  runtime.canvas = null;
  runtime.ctx = null;
  runtime.game = null;
  runtime.phase = keepSelection && runtime.activeGame ? "ready" : "menu";
  runtime.readySince = 0;
  runtime.requiresRelease = false;
  if (!keepSelection) runtime.activeGame = "";
}

function selectGame(gameId) {
  if (!GAME_CONFIG[gameId]) return;
  runtime.activeGame = gameId;
  runtime.phase = "ready";
  runtime.score = 0;
  runtime.readySince = 0;
  runtime.requiresRelease = false;

  runtime.root?.querySelectorAll("[data-event-game]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.eventGame === gameId);
  });
  mountActiveGame();
}

function mountActiveGame() {
  const arena = runtime.root?.querySelector("#eventGamesArena");
  const config = GAME_CONFIG[runtime.activeGame];
  if (!arena || !config) return;

  stopLoop();
  runtime.phase = "ready";
  runtime.score = 0;
  runtime.readySince = 0;
  runtime.requiresRelease = false;
  runtime.game = createGameState(runtime.activeGame);
  const spec = canvasSpec(runtime.activeGame);

  arena.innerHTML = `
    <div class="event-game-shell ${runtime.activeGame === "pong" ? "is-pong" : ""}">
      <div class="event-game-play-layout">
        <aside class="event-game-side-card event-game-guide" aria-label="Spielanleitung">
          <div class="eyebrow">So spielst du</div>
          <p class="event-game-guide-start">Das Spiel startet automatisch, sobald du mit deiner Kraft den grünen Bereich erreichst.</p>
          <ol>
            ${config.instructions.map((instruction) => `<li>${escaped(instruction)}</li>`).join("")}
          </ol>
        </aside>

        <div class="event-game-canvas-column">
          <div class="event-game-canvas-wrap" style="max-width:${spec.maxWidth}">
            <canvas id="eventGameCanvas" width="${spec.width * spec.pixelScale}" height="${spec.height * spec.pixelScale}" aria-label="${escaped(config.title)} Spielfeld"></canvas>
            <div class="event-game-overlay ${runtime.connected ? "show-settings" : "is-connect-prompt"}" id="eventGameOverlay" ${runtime.connected ? "" : `role="button" tabindex="0" aria-label="DynoGrip verbinden"`}>
              <div class="event-game-overlay-message">
                <strong id="eventGameOverlayTitle">${runtime.connected ? "Bereit zum Start" : "DynoGrip verbinden"}</strong>
                <span id="eventGameOverlayText">${runtime.connected ? "Bring deine Kraft in den grünen Bereich. Das Spiel startet automatisch." : "Hier tippen, um den DynoGrip zu verbinden."}</span>
              </div>
              <div class="event-game-overlay-settings" aria-label="Spieleinstellungen">
                <div class="event-game-live-force">
                  <span>Aktuelle Kraft</span>
                  <strong><span id="eventGameArenaForce">${runtime.force.toFixed(1)}</span> kg</strong>
                  <div class="event-game-force-track" aria-hidden="true">
                    <span class="event-game-force-ready-zone"></span>
                    <span class="event-game-force-fill" id="eventGameForceFill"></span>
                  </div>
                </div>
                <div class="event-game-presets" aria-label="Kraft auswählen">
                  <span>Passende Stärke wählen</span>
                  <div>
                    ${PRESETS.map((value) => `<button class="event-game-preset ${runtime.preset === value ? "is-selected" : ""}" data-game-preset="${value}" type="button">${value} kg</button>`).join("")}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside class="event-game-result" id="eventGameResult" aria-live="polite">
          <div class="eyebrow" id="eventGameResultLabel">${runtime.activeGame === "pong" ? "Spielstand" : "Punkte"}</div>
          <strong id="eventGameResultValue">${runtime.activeGame === "pong" ? "0 : 0" : "0 Punkte"}</strong>
          <span id="eventGameResultBest">Bestwert: ${runtime.best[runtime.activeGame] || 0}</span>
        </aside>
      </div>
    </div>
  `;

  runtime.canvas = arena.querySelector("#eventGameCanvas");
  runtime.ctx = runtime.canvas?.getContext("2d") || null;
  runtime.ctx?.setTransform(spec.pixelScale * spec.contextScaleX, 0, 0, spec.pixelScale, 0, 0);

  arena.querySelectorAll("[data-game-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      runtime.preset = Number(button.dataset.gamePreset || 20);
      arena.querySelectorAll("[data-game-preset]").forEach((item) => item.classList.toggle("is-selected", item === button));
      resetCurrentGame();
    });
  });
  const connectFromGame = () => {
    if (!runtime.connected) runtime.root?.querySelector("#connectToggle")?.click();
  };
  arena.querySelector("#eventGameOverlay")?.addEventListener("click", connectFromGame);
  arena.querySelector("#eventGameOverlay")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    connectFromGame();
  });
  updateForceUi();
  startLoop();
}

function resetCurrentGame() {
  if (!runtime.activeGame) return;
  runtime.phase = "ready";
  runtime.score = 0;
  runtime.readySince = 0;
  runtime.requiresRelease = runtime.connected && runtime.force >= 2;
  runtime.game = createGameState(runtime.activeGame);
  setScore(0);
  setOverlay(
    runtime.connected ? "Bereit zum Start" : "DynoGrip verbinden",
    runtime.connected ? "Bring deine Kraft in den grünen Bereich. Das Spiel startet automatisch." : "Hier tippen, um den DynoGrip zu verbinden.",
    true,
  );
}

function createGameState(gameId) {
  if (gameId === "flappy") return createFlappyState();
  if (gameId === "pong") return createPongState();
  return { accumulator: 0, squirrel: createSquirrelState(Date.now()) };
}

function startLoop() {
  stopLoop();
  runtime.lastFrame = performance.now();
  runtime.raf = requestAnimationFrame(frame);
}

function stopLoop() {
  if (runtime.raf) cancelAnimationFrame(runtime.raf);
  runtime.raf = 0;
  runtime.lastFrame = 0;
}

function frame(now) {
  if (!runtime.canvas || !runtime.ctx || !runtime.activeGame) {
    runtime.raf = 0;
    return;
  }
  const dt = clamp((now - (runtime.lastFrame || now)) / 1000, 0, 0.035);
  runtime.lastFrame = now;

  processStartGate(now);
  if (runtime.phase === "playing") {
    if (runtime.activeGame === "flappy") updateFlappy(dt);
    if (runtime.activeGame === "pong") updatePong(dt);
    if (runtime.activeGame === "squirrel") updateSquirrel(dt);
  }
  drawCurrentGame();
  runtime.raf = requestAnimationFrame(frame);
}

function processStartGate(now) {
  if (!runtime.connected) {
    runtime.readySince = 0;
    if (runtime.phase !== "gameover") runtime.phase = "ready";
    setOverlay("DynoGrip verbinden", "Hier tippen, um den DynoGrip zu verbinden.", true);
    return;
  }
  if (runtime.requiresRelease) {
    runtime.readySince = 0;
    if (runtime.force < 2) {
      runtime.requiresRelease = false;
      runtime.phase = "ready";
      setOverlay("Bereit zum Start", "Bring deine Kraft erneut in den grünen Bereich.", true);
    } else {
      setOverlay("Bereit für die nächste Runde", "Löse den DynoGrip kurz, bis die Kraft unter 2 kg fällt.", true);
    }
    return;
  }
  if (runtime.phase !== "ready") return;

  const ratio = forceRatio();
  const inReadyZone = ratio >= READY_MIN && ratio <= READY_MAX;
  if (!inReadyZone) {
    runtime.readySince = 0;
    setOverlay("Bereit zum Start", `Bring deine Kraft auf etwa ${Math.round(runtime.preset * 0.5)} kg in den grünen Bereich. Danach startet das Spiel automatisch.`, true);
    return;
  }

  if (!runtime.readySince) runtime.readySince = now;
  const remaining = Math.max(0, READY_HOLD_MS - (now - runtime.readySince));
  if (remaining > 0) {
    setOverlay("Startbereit", "Halten …", true);
    return;
  }
  beginGame();
}

function beginGame() {
  runtime.phase = "playing";
  runtime.score = 0;
  runtime.readySince = 0;
  runtime.requiresRelease = false;
  runtime.game = createGameState(runtime.activeGame);
  setScore(0);
  setOverlay("", "", false);
  const startSound = BATTLE_SOUNDS.start[Math.floor(Math.random() * BATTLE_SOUNDS.start.length)];
  playSound(startSound, 0.25, 500, "start");
}

function gameOver(message) {
  if (runtime.phase === "gameover") return;
  runtime.phase = "gameover";
  runtime.readySince = 0;
  runtime.requiresRelease = true;
  runtime.best[runtime.activeGame] = Math.max(runtime.best[runtime.activeGame] || 0, runtime.score);
  updateGameResult("finished");
  setOverlay("Nächste Runde", `${message}. Löse den DynoGrip kurz unter 2 kg.`, true);
}

function updateGameResult(mode = "current") {
  const label = runtime.root?.querySelector("#eventGameResultLabel");
  const value = runtime.root?.querySelector("#eventGameResultValue");
  const best = runtime.root?.querySelector("#eventGameResultBest");
  if (!label || !value || !best) return;
  label.textContent = mode === "finished" ? "Letzte Runde" : runtime.activeGame === "pong" ? "Spielstand" : "Punkte";
  if (runtime.activeGame === "pong" && runtime.game) {
    value.textContent = `${runtime.game.playerScore || 0} : ${runtime.game.cpuScore || 0}`;
  } else {
    value.textContent = `${runtime.score} ${runtime.score === 1 ? "Punkt" : "Punkte"}`;
  }
  best.textContent = `Bestwert: ${runtime.best[runtime.activeGame] || 0}`;
}

function setScore(value) {
  runtime.score = Math.max(0, Math.floor(value));
  if (runtime.phase !== "gameover") updateGameResult("current");
}

function setOverlay(title, text, visible) {
  const overlay = runtime.root?.querySelector("#eventGameOverlay");
  const titleNode = runtime.root?.querySelector("#eventGameOverlayTitle");
  const textNode = runtime.root?.querySelector("#eventGameOverlayText");
  if (titleNode) titleNode.textContent = title;
  if (textNode) textNode.textContent = text;
  overlay?.classList.toggle("is-hidden", !visible);
  overlay?.classList.toggle("show-settings", visible && runtime.connected && (runtime.phase === "ready" || runtime.phase === "gameover"));
  overlay?.classList.toggle("is-connect-prompt", visible && !runtime.connected);
  if (overlay) {
    const connectPrompt = visible && !runtime.connected;
    if (connectPrompt) {
      overlay.setAttribute("role", "button");
      overlay.setAttribute("tabindex", "0");
      overlay.setAttribute("aria-label", "DynoGrip verbinden");
    } else {
      overlay.removeAttribute("role");
      overlay.removeAttribute("tabindex");
      overlay.removeAttribute("aria-label");
    }
  }
}

function updateForceUi() {
  const root = runtime.root;
  if (!root) return;
  const forceText = runtime.force.toFixed(1);
  const arenaValue = root.querySelector("#eventGameArenaForce");
  const fill = root.querySelector("#eventGameForceFill");
  if (arenaValue) arenaValue.textContent = forceText;
  if (fill) fill.style.width = `${clamp(forceRatio() * 100, 0, 100)}%`;
}

const FLAPPY = {
  width: 400,
  height: 400,
  birdSize: 32,
  birdX: 80,
  pipeWidth: 65,
  pipeGap: 105,
  pipeSpeed: 9,
  groundHeight: 50,
  citySpeed: 2.6,
  spawnFrames: 35,
  spawnX: 530,
  exitX: -77,
  fps: 30,
};
const FLAPPY_PIPE_COLORS = ["#4CAF50", "#43A047", "#388E3C", "#2E7D32"];

function makeFlappyClouds() {
  return Array.from({ length: 6 }, (_, id) => ({ id, x: Math.random() * 400, y: 20 + Math.random() * 100, size: 30 + Math.random() * 40, speed: 0.3 + Math.random() * 0.4, opacity: 0.4 + Math.random() * 0.4 }));
}

function makeFlappyBuildings() {
  const result = [];
  const colors = ["#1a2a3a", "#1e2e3e", "#223344", "#263848"];
  let x = 0;
  let id = 0;
  while (x < 400) {
    const width = 25 + Math.random() * 35;
    const rows = 2 + Math.floor(Math.random() * 4);
    const cols = Math.floor(width / 10);
    const windows = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.random() > 0.3 ? 0.6 : 0.2));
    result.push({ id: id++, x, width, height: 40 + Math.random() * 60, color: colors[Math.floor(Math.random() * colors.length)], antenna: Math.random() > 0.7, windows });
    x += width + 5 + Math.random() * 15;
  }
  return result;
}

function createFlappyState() {
  const initialRatio = clamp(forceRatio(), 0, 1);
  return {
    frame: 0,
    accumulator: 0,
    elapsed: 0,
    pipeId: 1,
    pipes: [],
    clouds: makeFlappyClouds(),
    buildings: makeFlappyBuildings(),
    bird: { y: 200, targetY: 200, velocity: 0, angle: 0, visualAngle: 0, wing: 0, smoothed: initialRatio, alive: true, fallElapsed: 0, fallStartY: 0, deadLanded: false },
  };
}

function spawnFlappyPipe(game) {
  game.pipes.push({ id: game.pipeId++, x: FLAPPY.spawnX, gapY: Math.random() * 145 + 50, passed: false, color: FLAPPY_PIPE_COLORS[Math.floor(Math.random() * FLAPPY_PIPE_COLORS.length)] });
}

function killFlappy() {
  const bird = runtime.game.bird;
  if (!bird.alive) return;
  bird.alive = false;
  bird.fallElapsed = 0;
  bird.fallStartY = bird.y;
  playSound(BATTLE_SOUNDS.gameOver, 0.48, 3000, "flappy-over");
}

function flappyPhysicsFrame() {
  const game = runtime.game;
  const bird = game.bird;
  if (!bird.alive) return;
  game.frame++;
  const raw = clamp(forceRatio(), 0, 1);
  const delta = raw - bird.smoothed;
  const absDelta = Math.abs(delta);
  if (absDelta > 0.03) {
    bird.smoothed += delta * (absDelta > 0.2 ? 0.60 : 0.24);
    if (absDelta > 0.16) playSound(BATTLE_SOUNDS.flappyTurn, 0.20, 420, "flappy-turn");
  }
  bird.targetY = 334 - bird.smoothed * 318;
  const previous = bird.y;
  bird.y = previous + (bird.targetY - previous) * 0.24;
  bird.velocity = bird.y - previous;
  if (game.frame % 4 === 0) bird.wing = (bird.wing + 1) % 3;
  for (const pipe of game.pipes) pipe.x -= 9;
  game.pipes = game.pipes.filter((pipe) => pipe.x >= FLAPPY.exitX);
  if (game.frame === 1 || (game.frame > 1 && (game.frame - 1) % 35 === 0)) spawnFlappyPipe(game);
  for (const pipe of game.pipes) {
    if (!pipe.passed && pipe.x + 65 < 80) {
      pipe.passed = true;
      setScore(runtime.score + 1);
      playSound(BATTLE_SOUNDS.flappyPoint, 0.26, 90, "flappy-point");
    }
  }
  const top = bird.y - 16;
  const bottom = bird.y + 16;
  const left = 64;
  const right = 96;
  for (const pipe of game.pipes) {
    if (right > pipe.x && left < pipe.x + 65 && (top < pipe.gapY || bottom > pipe.gapY + 105)) {
      killFlappy();
      return;
    }
  }
  if (top < 0 || bottom > 350) killFlappy();
}

function updateFlappy(dt) {
  const game = runtime.game;
  const bird = game.bird;
  game.elapsed += dt;
  if (bird.alive) {
    game.accumulator = Math.min(game.accumulator + dt, 4 / 30);
    let steps = 0;
    while (game.accumulator + 0.000001 >= 1 / 30 && steps < 4) {
      game.accumulator = Math.max(0, game.accumulator - 1 / 30);
      steps++;
      flappyPhysicsFrame();
      if (!bird.alive) break;
    }
  } else if (!bird.deadLanded) {
    bird.fallElapsed = Math.min(0.8, bird.fallElapsed + dt);
    bird.y = Math.min(334, bird.fallStartY + 480 * bird.fallElapsed);
    bird.angle = bird.fallElapsed / 0.8 * 720;
    if (bird.fallElapsed >= 0.8) {
      bird.deadLanded = true;
      gameOver("Du bist abgestürzt");
    }
  }
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, w, h, r, color) {
  roundedRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawFlappyCloud(ctx, cloud, x) {
  const s = cloud.size;
  ctx.fillStyle = `rgba(255,255,255,${cloud.opacity * 0.9})`;
  ctx.beginPath();
  ctx.ellipse(x + s * 0.5, cloud.y + s * 0.3, s * 0.5, s * 0.3, 0, 0, Math.PI * 2);
  ctx.ellipse(x + s * 0.85, cloud.y + s * 0.35, s * 0.35, s * 0.25, 0, 0, Math.PI * 2);
  ctx.ellipse(x + s * 1.15, cloud.y + s * 0.4, s * 0.3, s * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawFlappyBackdrop(ctx, game) {
  const visualFrame = game.frame + clamp(game.accumulator * 30, 0, 1);
  const sky = ctx.createLinearGradient(0, 0, 0, 400);
  sky.addColorStop(0, "#4FC3F7");
  sky.addColorStop(0.48, "#81D4FA");
  sky.addColorStop(1, "#B3E5FC");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 400, 400);
  ctx.fillStyle = "rgba(255,245,157,.3)";
  ctx.beginPath();
  ctx.arc(335, 55, 35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#FFF59D";
  ctx.beginPath();
  ctx.arc(335, 55, 25, 0, Math.PI * 2);
  ctx.fill();
  for (const cloud of game.clouds) {
    const offset = -((visualFrame * cloud.speed) % 400);
    for (const tile of [0, 400, 800]) drawFlappyCloud(ctx, cloud, cloud.x + offset + tile);
  }
  const cityOffset = -((visualFrame * 2.6) % 400);
  for (const tile of [0, 400, 800]) {
    for (const building of game.buildings) {
      const x = building.x + cityOffset + tile;
      const y = 350 - building.height;
      fillRoundRect(ctx, x, y, building.width, building.height, 2, building.color);
      if (building.antenna) {
        ctx.fillStyle = "#37474F";
        ctx.fillRect(x + building.width / 2 - 1, y - 12, 2, 12);
      }
      for (let row = 0; row < building.windows.length; row++) {
        const cols = building.windows[row].length;
        const spacing = building.width / (cols + 1);
        for (let col = 0; col < cols; col++) fillRoundRect(ctx, x + spacing * (col + 1) - 2.5, y + 6 + row * 12, 5, 6, 1, `rgba(255,224,130,${building.windows[row][col]})`);
      }
    }
  }
}

function drawFlappyPipeBody(ctx, x, y, w, h, color) {
  if (h <= 0) return;
  fillRoundRect(ctx, x, y, w, h, 4, color);
  fillRoundRect(ctx, x + 4, y, 8, h, 4, "rgba(255,255,255,.25)");
  ctx.fillStyle = "rgba(0,0,0,.2)";
  ctx.fillRect(x + w - 12, y, 12, h);
  for (let sy = y; sy < y + h; sy += 15) {
    ctx.fillStyle = "rgba(255,255,255,.1)";
    ctx.fillRect(x + 15, sy, 3, 8);
  }
}

function drawFlappyPipeCap(ctx, x, y, w, color) {
  fillRoundRect(ctx, x, y, w, 24, 4, color);
  fillRoundRect(ctx, x + 4, y + 4, 10, 16, 3, "rgba(255,255,255,.3)");
  ctx.fillStyle = "rgba(0,0,0,.2)";
  ctx.fillRect(x + w - 14, y, 14, 24);
  ctx.fillStyle = "rgba(0,0,0,.15)";
  ctx.fillRect(x, y + 21, w, 3);
}

function drawFlappyPipe(ctx, pipe, interpolation) {
  const x = pipe.x - interpolation * 9;
  const bottom = pipe.gapY + 105;
  drawFlappyPipeBody(ctx, x, 0, 65, pipe.gapY, pipe.color);
  drawFlappyPipeCap(ctx, x - 6, pipe.gapY - 24, 77, pipe.color);
  drawFlappyPipeBody(ctx, x, bottom, 65, 350 - bottom, pipe.color);
  drawFlappyPipeCap(ctx, x - 6, bottom, 77, pipe.color);
}

function drawFlappyGround(ctx, game) {
  const visualFrame = game.frame + clamp(game.accumulator * 30, 0, 1);
  const offset = -((visualFrame * 9) % 400);
  ctx.fillStyle = "#8B4513";
  ctx.fillRect(0, 350, 400, 50);
  for (const tile of [0, 400, 800]) {
    const x0 = offset + tile;
    ctx.fillStyle = "#4CAF50";
    ctx.fillRect(x0, 350, 400, 15);
    for (let i = 0; i < 20; i++) fillRoundRect(ctx, x0 + i * 20, 365 - (8 + i % 3 * 3), 12, 8 + i % 3 * 3, 6, "#66BB6A");
    ctx.fillStyle = "#6D4C41";
    ctx.fillRect(x0, 362, 400, 38);
    for (let i = 0; i < 15; i++) {
      ctx.fillStyle = `rgba(93,64,55,${0.3 + i % 3 * 0.2})`;
      ctx.beginPath();
      ctx.arc(x0 + (i * 37) % 400 + 3, 373 + i % 4 * 8, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawFlappyBird(ctx, bird, interpolation) {
  const visualY = bird.alive ? bird.y + (bird.targetY - bird.y) * (1 - Math.pow(1 - 0.24, interpolation)) : bird.y;
  const targetTilt = clamp(bird.velocity * 3, -25, 45);
  if (bird.alive) bird.visualAngle += (targetTilt - bird.visualAngle) * 0.42;
  const tilt = bird.alive ? bird.visualAngle : bird.angle;
  const wing = [-20, 0, 20][bird.wing];
  ctx.save();
  ctx.translate(80, visualY);
  ctx.rotate(tilt * Math.PI / 180);
  ctx.globalAlpha = bird.alive ? 1 : 0.8;
  fillRoundRect(ctx, -16, -14, 32, 28, 14, "#FFD54F");
  fillRoundRect(ctx, -12, -12, 20, 12, 10, "rgba(255,255,255,.3)");
  fillRoundRect(ctx, -22, -4, 12, 8, 4, "#FFB74D");
  ctx.save();
  ctx.translate(-5, 3);
  ctx.rotate(wing * Math.PI / 180);
  fillRoundRect(ctx, -7, -5, 14, 10, 7, "#FFA726");
  ctx.restore();
  fillRoundRect(ctx, -2, -10, 10, 10, 5, "#fff");
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  roundedRectPath(ctx, -2, -10, 10, 10, 5);
  ctx.stroke();
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.arc(4, -5, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(4.8, -6, 1.5, 0, Math.PI * 2);
  ctx.fill();
  fillRoundRect(ctx, 12, -6, 14, 6, 3, "#FF7043");
  fillRoundRect(ctx, 12, -1, 12, 5, 3, "#E64A19");
  fillRoundRect(ctx, 0, 0, 6, 4, 3, "rgba(255,138,128,.5)");
  ctx.restore();
}

function drawFlappy(ctx) {
  const game = runtime.game;
  const interpolation = clamp(game.accumulator * 30, 0, 1);
  ctx.clearRect(0, 0, 400, 400);
  drawFlappyBackdrop(ctx, game);
  for (const pipe of game.pipes) drawFlappyPipe(ctx, pipe, interpolation);
  drawFlappyGround(ctx, game);
  drawFlappyBird(ctx, game.bird, interpolation);
}

const PONG_WIDTH = 900;
const PONG_HEIGHT = 765;
const PONG_X_SPEED = 480.2;
const PONG_Y_SPEED = 434;
const PONG_HIT_IMPULSE = 3.36;

function createPongState() {
  return { ball: { x: PONG_WIDTH / 2, y: PONG_HEIGHT / 2, vx: (Math.random() > 0.5 ? 1 : -1) * PONG_X_SPEED, vy: (Math.random() - 0.5) * PONG_Y_SPEED, r: 11 }, playerY: PONG_HEIGHT / 2, cpuY: PONG_HEIGHT / 2, playerScore: 0, cpuScore: 0 };
}

function getPongField() {
  return { x: 18, y: 18, w: PONG_WIDTH - 36, h: PONG_HEIGHT - 36, paddleW: 18, paddleH: 88, sideInset: 30 };
}

function scorePong(direction) {
  beep(900, 0.06);
  const game = runtime.game;
  const field = getPongField();
  game.ball.x = field.x + field.w / 2;
  game.ball.y = field.y + field.h / 2;
  game.ball.vx = direction * PONG_X_SPEED;
  game.ball.vy = (Math.random() - 0.5) * PONG_Y_SPEED;
  runtime.score = game.playerScore;
  setScore(runtime.score);
  if (game.cpuScore >= 1) gameOver("Ball verpasst");
}

function updatePong(dt) {
  const game = runtime.game;
  const field = getPongField();
  const top = field.y + 18;
  const bottom = field.y + field.h - 18;
  const targetPlayer = top + (bottom - top) * (1 - clamp(forceRatio(), 0, 1));
  game.playerY += (targetPlayer - game.playerY) * Math.min(1, dt * 10);
  const cpuTarget = clamp(game.ball.y + game.ball.vy * 0.035, top + field.paddleH / 2, bottom - field.paddleH / 2);
  const cpuMaxStep = (430 + Math.min(180, Math.abs(game.ball.vx) * 0.12)) * dt;
  game.cpuY += clamp(cpuTarget - game.cpuY, -cpuMaxStep, cpuMaxStep);
  const ball = game.ball;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  if (ball.y - ball.r < top) { ball.y = top + ball.r; ball.vy = Math.abs(ball.vy); }
  if (ball.y + ball.r > bottom) { ball.y = bottom - ball.r; ball.vy = -Math.abs(ball.vy); }
  const leftX = field.x + field.sideInset;
  const rightX = field.x + field.w - field.sideInset - field.paddleW;
  if (ball.vx < 0 && ball.x - ball.r < leftX + field.paddleW && ball.x > leftX && Math.abs(ball.y - game.playerY) < field.paddleH / 2) {
    ball.x = leftX + field.paddleW + ball.r;
    ball.vx = Math.abs(ball.vx) * 1.10;
    ball.vy += (ball.y - game.playerY) * PONG_HIT_IMPULSE;
    beep(630, 0.03);
  }
  if (ball.vx > 0 && ball.x + ball.r > rightX && ball.x < rightX + field.paddleW && Math.abs(ball.y - game.cpuY) < field.paddleH / 2) {
    ball.x = rightX - ball.r;
    ball.vx = -Math.abs(ball.vx) * 1.10;
    ball.vy += (ball.y - game.cpuY) * PONG_HIT_IMPULSE;
    beep(630, 0.03);
  }
  if (ball.x + ball.r < field.x) { game.cpuScore++; scorePong(-1); }
  else if (ball.x - ball.r > field.x + field.w) { game.playerScore++; scorePong(1); }
}

function drawPong(ctx) {
  const game = runtime.game;
  const field = getPongField();
  ctx.clearRect(0, 0, PONG_WIDTH, PONG_HEIGHT);
  ctx.fillStyle = "#081018";
  ctx.fillRect(0, 0, PONG_WIDTH, PONG_HEIGHT);
  ctx.save();
  ctx.lineWidth = 9;
  ctx.strokeStyle = "#ffffff";
  roundedRectPath(ctx, field.x, field.y, field.w, field.h, 28);
  ctx.stroke();
  roundedRectPath(ctx, field.x + 5, field.y + 5, field.w - 10, field.h - 10, 23);
  ctx.clip();
  ctx.fillStyle = "#101820";
  ctx.fillRect(field.x + 5, field.y + 5, field.w - 10, field.h - 10);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 4;
  for (let y = field.y + 30; y < field.y + field.h - 30; y += 28) {
    ctx.beginPath();
    ctx.moveTo(field.x + field.w / 2, y);
    ctx.lineTo(field.x + field.w / 2, y + 14);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.font = `1000 ${Math.max(82, Math.min(150, field.h * 0.24))}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${game.playerScore} : ${game.cpuScore}`, field.x + field.w / 2, field.y + field.h / 2);
  const leftX = field.x + field.sideInset;
  const rightX = field.x + field.w - field.sideInset - field.paddleW;
  ctx.fillStyle = "#4bcfff";
  roundedRectPath(ctx, leftX, game.playerY - field.paddleH / 2, field.paddleW, field.paddleH, 6);
  ctx.fill();
  ctx.fillStyle = "#ff7098";
  roundedRectPath(ctx, rightX, game.cpuY - field.paddleH / 2, field.paddleW, field.paddleH, 6);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(game.ball.x, game.ball.y, game.ball.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.textBaseline = "alphabetic";
  ctx.font = "800 12px Inter, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.48)";
  ctx.textAlign = "left";
  ctx.fillText(`DU · ${runtime.force.toFixed(1)} kg`, field.x + 18, field.y + field.h - 18);
  ctx.textAlign = "center";
  ctx.fillText(`Preset ${runtime.preset.toFixed(0)} kg`, field.x + field.w / 2, field.y + field.h - 18);
  ctx.textAlign = "right";
  ctx.fillText("CPU", field.x + field.w - 18, field.y + field.h - 18);
  ctx.restore();
}

const SQUIRREL_WORLD = { width: 400, height: 300, playerWidth: 32, playerHeight: 24, minY: 28, startX: 72, takeoff: 0.29, reset: 0.12 };
const SQUIRREL_TUNING = { gravity: 325, releaseDropAcceleration: 1240, minJumpVelocity: 148, maxJumpVelocity: 220, liftThresholdRatio: 0.35, liftAcceleration: 1190, repressLiftImpulse: 180, liftSeconds: 0.27, platformGapMax: 180 };
const SQUIRREL_POSES = {
  A: { membrane: "M -12 -12 Q -3 -6 3 -3 Q 12 0 24 5 Q 8 11 -17 12 Z", far: "M -8 -8 Q 2 -5 17 1 Q 5 7 -13 8 Z", front: "M 7 -2 Q 15 1 24 5", rear: "M -3 4 Q -9 9 -17 12", tail: "M -12 2 Q -29 -13 -35 1 Q -37 13 -24 15 Q -14 15 -9 8 Q -23 9 -25 2 Q -25 -4 -17 0 Z" },
  B: { membrane: "M -8 -8 Q -1 -5 4 -2 Q 11 0 19 4 Q 6 8 -12 9 Z", far: "M -6 -6 Q 2 -3 14 1 Q 4 5 -10 6 Z", front: "M 7 -1 Q 13 1 19 4", rear: "M -3 4 Q -7 7 -12 9", tail: "M -12 3 Q -27 -9 -33 2 Q -35 12 -24 14 Q -15 14 -10 8 Q -22 9 -24 3 Q -24 -2 -17 1 Z" },
  C: { membrane: "M -16 -18 Q -5 -8 3 -3 Q 13 0 26 5 Q 11 13 1 18 Q -8 14 -21 10 Z", far: "M -11 -12 Q 0 -6 20 2 Q 7 9 -16 9 Z", front: "M 7 -2 Q 17 1 26 5", rear: "M -3 4 Q -11 9 -21 10", tail: "M -13 2 Q -30 -13 -36 0 Q -38 13 -24 16 Q -13 16 -8 8 Q -23 10 -26 2 Q -25 -5 -17 0 Z" },
  D: { membrane: "M -13 -18 Q -4 -8 3 -4 Q 12 -1 23 4 Q 8 10 -16 12 Z", far: "M -9 -12 Q 1 -6 17 1 Q 6 7 -13 8 Z", front: "M 7 -3 Q 15 0 23 4", rear: "M -3 3 Q -10 9 -16 12", tail: "M -12 4 Q -28 -9 -35 3 Q -36 15 -23 16 Q -13 15 -9 9 Q -22 10 -25 4 Q -24 -2 -17 1 Z" },
  F: { membrane: "M -13 -17 Q -4 -8 3 -3 Q 13 0 25 6 Q 11 14 -2 18 Q -11 13 -20 10 Z", far: "M -10 -11 Q 1 -5 19 3 Q 7 10 -16 9 Z", front: "M 7 -2 Q 16 2 25 6", rear: "M -3 4 Q -11 9 -20 10", tail: "M -13 1 Q -31 -12 -36 1 Q -37 14 -23 16 Q -12 15 -8 7 Q -23 10 -26 1 Q -25 -5 -17 -1 Z" },
};
const squirrelPosePaths = Object.fromEntries(Object.entries(SQUIRREL_POSES).map(([name, pose]) => [name, Object.fromEntries(Object.entries(pose).map(([key, d]) => [key, new Path2D(d)]))]));
const squirrelImages = { background: new Image(), themes: [] };
squirrelImages.background.src = `${ASSET_ROOT}squirrel/forest-run-seamless-v2.png`;
for (const theme of ["log", "moss", "branches", "rock", "autumn"]) {
  const parts = {};
  for (const part of ["top", "middle", "bottom"]) {
    const image = new Image();
    image.src = `${ASSET_ROOT}squirrel/platforms/${theme}-${part}.png`;
    parts[part] = image;
  }
  squirrelImages.themes.push(parts);
}

function squirrelRandom(state) {
  state.seed = (state.seed * 1664525 + 1013904223) % 4294967296;
  return state.seed / 4294967296;
}
function squirrelRange(state, min, max) { return min + squirrelRandom(state) * (max - min); }
function squirrelGenerateTo(state, targetX) {
  let lastPlatform = state.platforms[state.platforms.length - 1];
  while (lastPlatform.x + lastPlatform.width < targetX) {
    let gap = squirrelRange(state, 50, Math.max(50, SQUIRREL_TUNING.platformGapMax));
    const y = clamp(lastPlatform.y + squirrelRange(state, -68, 62), 172, 272);
    if (y < lastPlatform.y - 34 && gap > 90) gap = squirrelRange(state, 76, 90);
    const platform = { id: state.nextId++, x: lastPlatform.x + lastPlatform.width + gap, y, width: squirrelRange(state, 76, 168) };
    state.platforms.push(platform);
    lastPlatform = platform;
  }
}
function createSquirrelState(seed) {
  const state = { seed: Math.abs(Math.floor(seed)) % 4294967296, nextId: 1, elapsed: 0, distance: 0, score: 0, jumps: 0, lastScoredPlatformId: 0, cameraX: 0, playerX: 72, playerY: 216, previousY: 216, velocityY: 0, grounded: true, armed: false, airPressArmed: false, liftBudget: SQUIRREL_TUNING.liftSeconds, rotation: 0, gameOver: false, platforms: [{ id: 0, x: -200, y: 240, width: 520 }] };
  squirrelGenerateTo(state, 1300);
  return state;
}
function stepSquirrel(state, ratioInput, dt) {
  const events = { jumped: false, boosted: false, landed: false, gameOver: false };
  if (state.gameOver) return events;
  const ratio = clamp(ratioInput, 0, 1);
  const tuning = SQUIRREL_TUNING;
  const step = clamp(dt, 0, 1 / 20);
  const speed = Math.min(188, 112 + state.elapsed * 1.8);
  state.elapsed += step;
  state.previousY = state.playerY;
  state.playerX += speed * step;
  state.cameraX = Math.max(0, state.playerX - SQUIRREL_WORLD.startX);
  squirrelGenerateTo(state, state.playerX + 900);
  if (state.grounded) {
    const support = state.platforms.find((p) => state.playerX + 24 > p.x && state.playerX - 11.2 < p.x + p.width && Math.abs(state.playerY + 24 - p.y) < 7);
    if (support) { state.playerY = support.y - 24; state.velocityY = 0; state.liftBudget = tuning.liftSeconds; }
    else state.grounded = false;
    if (ratio < SQUIRREL_WORLD.reset) state.armed = true;
    if (state.armed && ratio >= SQUIRREL_WORLD.takeoff) {
      const effort = clamp((ratio - SQUIRREL_WORLD.takeoff) / (1 - SQUIRREL_WORLD.takeoff), 0, 1);
      state.velocityY = -(tuning.minJumpVelocity + Math.pow(effort, 0.85) * (tuning.maxJumpVelocity - tuning.minJumpVelocity));
      state.grounded = false;
      state.armed = false;
      state.airPressArmed = false;
      state.jumps++;
      events.jumped = true;
    }
  }
  if (!state.grounded) {
    if (ratio < SQUIRREL_WORLD.reset) state.airPressArmed = true;
    if (state.airPressArmed && ratio >= tuning.liftThresholdRatio) { state.velocityY -= tuning.repressLiftImpulse; state.airPressArmed = false; events.boosted = true; }
    if (ratio > tuning.liftThresholdRatio && state.liftBudget > 0) {
      const effort = clamp((ratio - tuning.liftThresholdRatio) / (1 - tuning.liftThresholdRatio), 0, 1);
      const lift = Math.pow(effort, 1.25);
      state.velocityY -= tuning.liftAcceleration * lift * step;
      state.liftBudget = Math.max(0, state.liftBudget - step * (0.35 + lift));
    }
    const released = clamp(1 - ratio / tuning.liftThresholdRatio, 0, 1);
    const down = tuning.gravity + tuning.releaseDropAcceleration * Math.pow(released, 0.7);
    state.velocityY = Math.max(-365, state.velocityY + down * step);
    state.playerY += state.velocityY * step;
    if (state.playerY < SQUIRREL_WORLD.minY) { state.playerY = SQUIRREL_WORLD.minY; state.velocityY = Math.max(0, state.velocityY); }
    state.rotation += ((0.28 - ratio * 0.64) - state.rotation) * (1 - Math.exp(-step * 10));
    if (state.velocityY >= 0) {
      const previousBottom = state.previousY + 24;
      const nextBottom = state.playerY + 24;
      const landing = state.platforms.find((p) => state.playerX + 22.4 > p.x && state.playerX - 9.6 < p.x + p.width && previousBottom <= p.y + 3 && nextBottom >= p.y);
      if (landing) {
        state.playerY = landing.y - 24;
        state.velocityY = 0;
        state.grounded = true;
        state.armed = ratio < SQUIRREL_WORLD.reset;
        state.airPressArmed = false;
        state.rotation = 0;
        if (landing.id !== state.lastScoredPlatformId) { state.score++; state.lastScoredPlatformId = landing.id; }
        events.landed = true;
      }
    }
  }
  state.distance = Math.max(0, (state.playerX - 72) / 18);
  state.platforms = state.platforms.filter((p) => p.x + p.width > state.cameraX - 180);
  if (state.playerY > 355) { state.gameOver = true; events.gameOver = true; }
  return events;
}
function updateSquirrel(dt) {
  const game = runtime.game;
  game.accumulator = Math.min(0.08, game.accumulator + dt);
  let steps = 0;
  while (game.accumulator >= 1 / 60 && steps < 4) {
    game.accumulator -= 1 / 60;
    steps++;
    const events = stepSquirrel(game.squirrel, clamp(forceRatio(), 0, 1), 1 / 60);
    setScore(game.squirrel.score);
    if (events.jumped) playSound(BATTLE_SOUNDS.squirrelJump, 0.12, 180, "squirrel-jump");
    if (events.boosted) playSound(BATTLE_SOUNDS.squirrelBoost, 0.12, 180, "squirrel-boost");
    if (events.landed) playSound(BATTLE_SOUNDS.squirrelPoint, 0.20, 180, "squirrel-point");
    if (events.gameOver) { playSound(BATTLE_SOUNDS.squirrelFall, 0.36, 2500, "squirrel-fall"); gameOver("Du bist abgestürzt"); break; }
  }
}
function squirrelThemeIndex(id) {
  const target = Math.max(0, Math.floor(Math.abs(id)));
  let first = 0, cluster = 0, previous = -1;
  while (first <= target) {
    const seeded = Math.sin((cluster + 1) * 12.9898) * 43758.5453;
    const hash = Math.floor((seeded - Math.floor(seeded)) * 1e9);
    const size = (10 + (hash % 5)) * 2;
    let theme = Math.floor(hash / 3) % 5;
    if (theme === previous) theme = (theme + 1 + (hash % 4)) % 5;
    if (target < first + size) return theme;
    first += size;
    previous = theme;
    cluster++;
  }
  return 0;
}
function drawImageSlice(ctx, image, x, y, w, h) {
  if (!image.complete || !image.naturalWidth) { ctx.fillStyle = "#6d5135"; ctx.fillRect(x, y, w, h); return; }
  const srcRatio = image.naturalWidth / image.naturalHeight;
  const dstRatio = w / h;
  let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
  if (srcRatio > dstRatio) { sw = image.naturalHeight * dstRatio; sx = (image.naturalWidth - sw) / 2; }
  else { sh = image.naturalWidth / dstRatio; sy = (image.naturalHeight - sh) / 2; }
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
}
function drawSquirrelPlatform(ctx, platform, state) {
  const x = platform.x - state.cameraX - 2;
  const y = platform.y - 1;
  const w = platform.width + 4;
  const theme = squirrelImages.themes[squirrelThemeIndex(platform.id)];
  drawImageSlice(ctx, theme.top, x, y, w, 11);
  drawImageSlice(ctx, theme.middle, x, y + 8, w, 20);
  drawImageSlice(ctx, theme.bottom, x, y + 27, w, 9);
}
function fillPath(ctx, path, fill, stroke = "#66432F", line = 1.2) {
  ctx.fillStyle = fill;
  ctx.fill(path);
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = line; ctx.stroke(path); }
}
function strokePath(ctx, path, stroke, line = 2) { ctx.strokeStyle = stroke; ctx.lineWidth = line; ctx.lineCap = "round"; ctx.stroke(path); }
function drawSquirrelCharacter(ctx, state, ratio) {
  const airborne = !state.grounded;
  const poseName = state.velocityY < -90 ? "D" : state.velocityY > 150 ? "F" : ratio >= 0.82 ? "C" : ratio < 0.56 ? "B" : "A";
  const pose = squirrelPosePaths[poseName];
  ctx.save();
  ctx.translate(state.playerX - state.cameraX, state.playerY + 12);
  ctx.rotate(state.rotation);
  if (!airborne) { ctx.fillStyle = "rgba(12,31,31,.24)"; ctx.beginPath(); ctx.ellipse(0, 13, 18, 4, 0, 0, Math.PI * 2); ctx.fill(); }
  if (airborne) { fillPath(ctx, pose.far, "#C58A50"); strokePath(ctx, new Path2D("M 3 -2 Q 10 0 18 2"), "#70472E", 2.1); }
  ctx.save();
  ctx.rotate((airborne ? -5 : 8) * Math.PI / 180);
  fillPath(ctx, airborne ? pose.tail : new Path2D("M -12 3 Q -28 -17 -35 -3 Q -37 10 -24 14 Q -15 15 -9 8 Q -23 9 -25 1 Q -25 -5 -17 0 Z"), "#A86F45", "#66432F", 1.5);
  strokePath(ctx, new Path2D("M -18 3 Q -27 -7 -31 0 Q -31 7 -22 9"), "#D59B64", 2.2);
  ctx.restore();
  ctx.fillStyle = "#9B6842";
  ctx.strokeStyle = "#70472E";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(1, 0, airborne ? 13 : 14, airborne ? 8 : 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (!airborne) strokePath(ctx, new Path2D("M -4 7 L -9 13 M 7 7 L 12 12"), "#66432F", 2.6);
  if (airborne) {
    fillPath(ctx, pose.membrane, "#F0C77E", "#66432F", 1.5);
    strokePath(ctx, pose.front, "#70472E", 2.5);
    strokePath(ctx, pose.rear, "#70472E", 2.5);
    strokePath(ctx, new Path2D("M 6 -2 Q 2 4 -5 7"), "#D99E58", 1.25);
  }
  ctx.fillStyle = "#B77B4D";
  ctx.beginPath();
  ctx.arc(14, -7, 9, 0, Math.PI * 2);
  ctx.fill();
  fillPath(ctx, new Path2D("M 8 -13 L 10 -21 L 16 -14 Z"), "#8C593A", "#66432F", 1);
  fillPath(ctx, new Path2D("M 10 -15 L 11 -18 L 13 -15 Z"), "#E4A982", null);
  ctx.fillStyle = "#E3BE91";
  ctx.beginPath();
  ctx.ellipse(20, -5, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#172027";
  ctx.beginPath();
  ctx.arc(16, -9, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(16.6, -9.7, 0.65, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#38241D";
  ctx.beginPath();
  ctx.arc(25, -5, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function drawSquirrel(ctx) {
  const state = runtime.game.squirrel;
  ctx.clearRect(0, 0, 400, 340);
  ctx.save();
  ctx.translate(0, 20);
  const offset = -(((state.cameraX * 0.075 % 480) + 480) % 480);
  if (squirrelImages.background.complete && squirrelImages.background.naturalWidth) {
    for (const tile of [-1, 0, 1, 2]) ctx.drawImage(squirrelImages.background, offset + tile * 480, -20, 480.75, 340);
  } else {
    ctx.fillStyle = "#70c4d8";
    ctx.fillRect(0, -20, 400, 340);
  }
  const travel = ((state.cameraX * 0.55) % 1300 + 1300) % 1300;
  const birdX = 470 - travel;
  const birdY = 54 + Math.sin(state.cameraX * 0.025) * 7;
  ctx.save();
  ctx.translate(birdX, birdY);
  ctx.fillStyle = "rgba(49,93,97,.72)";
  for (const pathData of ["M0 3 Q6 -4 12 2 Q18 -5 25 2 Q18 0 12 6 Q6 0 0 3 Z", "M-34 15 Q-29 10 -24 14 Q-19 9 -13 14 Q-19 13 -24 17 Q-29 13 -34 15 Z", "M34 20 Q38 16 43 19 Q47 15 52 19 Q47 18 43 22 Q38 18 34 20 Z"]) ctx.fill(new Path2D(pathData));
  ctx.restore();
  const mist = ctx.createLinearGradient(0, -20, 0, 320);
  mist.addColorStop(0, "rgba(221,243,234,0)");
  mist.addColorStop(0.42, "rgba(221,243,234,.04)");
  mist.addColorStop(0.7, "rgba(221,243,234,.18)");
  mist.addColorStop(1, "rgba(234,246,236,.48)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, -20, 400, 340);
  for (const platform of state.platforms) {
    if (platform.x + platform.width > state.cameraX - 20 && platform.x < state.cameraX + 440) drawSquirrelPlatform(ctx, platform, state);
  }
  drawSquirrelCharacter(ctx, state, clamp(forceRatio(), 0, 1));
  ctx.restore();
}

function drawCurrentGame() {
  const ctx = runtime.ctx;
  if (!ctx || !runtime.game) return;
  if (runtime.activeGame === "flappy") drawFlappy(ctx);
  else if (runtime.activeGame === "pong") drawPong(ctx);
  else if (runtime.activeGame === "squirrel") drawSquirrel(ctx);
}
