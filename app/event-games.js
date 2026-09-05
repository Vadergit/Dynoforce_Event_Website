const GAME_CONFIG = {
  flappy: {
    id: "flappy",
    title: "Flappy Birds",
    icon: "🐦",
    subtitle: "Steuere die Flughöhe direkt mit deiner Kraft.",
    help: "50 % Kraft hält dich ungefähr in der Mitte. Mehr Kraft lässt dich steigen, weniger Kraft sinken.",
  },
  pong: {
    id: "pong",
    title: "Pong",
    icon: "🏓",
    subtitle: "Halte den Ball mit deinem Kraft-Paddle im Spiel.",
    help: "Deine Kraft steuert das Paddle. Rechts ist eine Wand. Jeder erfolgreiche Rückprall am Paddle gibt 1 Punkt. Du hast eine Chance.",
  },
  squirrel: {
    id: "squirrel",
    title: "Squirrel Rush",
    icon: "🐿️",
    subtitle: "Spring über Hindernisse und sammle Punkte.",
    help: "Zieh oder drück kräftiger, um zu springen. Löse die Kraft wieder, damit der nächste Sprung bereit ist.",
  },
};

const PRESETS = [10, 20, 30, 40];
const READY_MIN = 0.42;
const READY_MAX = 0.58;
const READY_HOLD_MS = 320;

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
  raf: 0,
  lastFrame: 0,
  game: null,
  canvas: null,
  ctx: null,
};

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

export function eventGamesPageMarkup({ connected = false, currentForce = 0 } = {}) {
  runtime.connected = Boolean(connected);
  runtime.force = Number(currentForce || 0);
  const active = runtime.activeGame && GAME_CONFIG[runtime.activeGame] ? runtime.activeGame : "";
  return `
    <section class="event-games-page" aria-label="DynoForce Spiele">
      <div class="event-games-topline">
        <button class="button event-games-back" data-page="live" type="button">← Zur Challenge</button>
        <div class="event-games-intro">
          <div class="eyebrow">Einzelspieler</div>
          <h2>DynoForce Games</h2>
          <p>Ein DynoGrip. Drei Spiele. Deine Kraft ist die Steuerung.</p>
        </div>
        <div class="event-games-force-card ${connected ? "is-connected" : "is-disconnected"}">
          <span class="event-games-force-label">Aktuelle Kraft</span>
          <strong><span id="eventGamesForceValue">${Number(currentForce || 0).toFixed(1)}</span> kg</strong>
          <small id="eventGamesConnectionText">${connected ? "DynoGrip verbunden" : "DynoGrip nicht verbunden"}</small>
        </div>
      </div>

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

      <div class="event-games-arena" id="eventGamesArena">
        ${active ? "" : `
          <div class="event-games-empty-state">
            <div class="event-games-empty-icon">🎮</div>
            <h3>Wähle ein Spiel</h3>
            <p>Flappy Birds, Pong oder Squirrel Rush. Alle Spiele funktionieren mit einem einzigen DynoGrip.</p>
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

  if (runtime.activeGame && GAME_CONFIG[runtime.activeGame]) {
    mountActiveGame();
  } else {
    stopLoop();
  }
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
  if (!keepSelection) runtime.activeGame = "";
}

function selectGame(gameId) {
  if (!GAME_CONFIG[gameId]) return;
  runtime.activeGame = gameId;
  runtime.phase = "ready";
  runtime.score = 0;
  runtime.readySince = 0;

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
  runtime.game = createGameState(runtime.activeGame);

  arena.innerHTML = `
    <div class="event-game-shell ${runtime.activeGame === "pong" ? "is-pong" : ""}">
      <div class="event-game-toolbar">
        <div>
          <div class="eyebrow">${config.icon} ${escaped(config.title)}</div>
          <h3>${escaped(config.title)}</h3>
          <p>${escaped(config.help)}</p>
        </div>
        <div class="event-game-scorebox">
          <span>Punkte</span>
          <strong id="eventGameScore">0</strong>
          <small>Best: <span id="eventGameBest">${runtime.best[runtime.activeGame] || 0}</span></small>
        </div>
      </div>

      <div class="event-game-controls-row">
        <div class="event-game-presets" aria-label="Kraft-Preset">
          <span>Kraft-Preset</span>
          <div>
            ${PRESETS.map((value) => `<button class="event-game-preset ${runtime.preset === value ? "is-selected" : ""}" data-game-preset="${value}" type="button">${value} kg</button>`).join("")}
          </div>
        </div>
        <div class="event-game-live-force">
          <span>DynoGrip</span>
          <strong><span id="eventGameArenaForce">${runtime.force.toFixed(1)}</span> kg</strong>
          <div class="event-game-force-track" aria-hidden="true">
            <span class="event-game-force-ready-zone"></span>
            <span class="event-game-force-fill" id="eventGameForceFill"></span>
          </div>
        </div>
      </div>

      <div class="event-game-canvas-wrap">
        <canvas id="eventGameCanvas" width="900" height="500" aria-label="${escaped(config.title)} Spielfeld"></canvas>
        <div class="event-game-overlay" id="eventGameOverlay">
          <strong id="eventGameOverlayTitle">${runtime.connected ? "Bereit zum Start" : "DynoGrip verbinden"}</strong>
          <span id="eventGameOverlayText">${runtime.connected ? "Bring deine Kraft in den grünen Bereich. Das Spiel startet automatisch." : "Verbinde den DynoGrip oben rechts, um zu spielen."}</span>
        </div>
      </div>

      <div class="event-game-footer">
        <div class="event-game-status"><span class="dot ${runtime.connected ? "" : "off"}" id="eventGameStatusDot"></span><strong id="eventGameStatusText">${runtime.connected ? "Warte auf Startbereich" : "DynoGrip nicht verbunden"}</strong></div>
        <div class="event-game-footer-actions">
          <button class="button subtle" id="eventGameReset" type="button">Neu starten</button>
          <button class="button" id="eventGameChoose" type="button">Anderes Spiel</button>
        </div>
      </div>
    </div>
  `;

  runtime.canvas = arena.querySelector("#eventGameCanvas");
  runtime.ctx = runtime.canvas?.getContext("2d") || null;

  arena.querySelectorAll("[data-game-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      runtime.preset = Number(button.dataset.gamePreset || 20);
      arena.querySelectorAll("[data-game-preset]").forEach((item) => item.classList.toggle("is-selected", item === button));
      resetCurrentGame();
    });
  });
  arena.querySelector("#eventGameReset")?.addEventListener("click", resetCurrentGame);
  arena.querySelector("#eventGameChoose")?.addEventListener("click", () => {
    stopLoop();
    runtime.activeGame = "";
    runtime.phase = "menu";
    runtime.root?.querySelectorAll("[data-event-game]").forEach((button) => button.classList.remove("is-selected"));
    arena.innerHTML = `
      <div class="event-games-empty-state">
        <div class="event-games-empty-icon">🎮</div>
        <h3>Wähle ein Spiel</h3>
        <p>Flappy Birds, Pong oder Squirrel Rush. Alle Spiele funktionieren mit einem einzigen DynoGrip.</p>
      </div>`;
  });

  updateForceUi();
  startLoop();
}

function resetCurrentGame() {
  if (!runtime.activeGame) return;
  runtime.phase = "ready";
  runtime.score = 0;
  runtime.readySince = 0;
  runtime.game = createGameState(runtime.activeGame);
  setScore(0);
  setOverlay(
    runtime.connected ? "Bereit zum Start" : "DynoGrip verbinden",
    runtime.connected ? "Bring deine Kraft in den grünen Bereich. Das Spiel startet automatisch." : "Verbinde den DynoGrip oben rechts, um zu spielen.",
    true,
  );
  setStatus(runtime.connected ? "Warte auf Startbereich" : "DynoGrip nicht verbunden", runtime.connected);
}

function createGameState(gameId) {
  if (gameId === "flappy") {
    return {
      birdY: 250,
      pipes: [],
      pipeClock: 0,
      groundOffset: 0,
    };
  }
  if (gameId === "pong") {
    return {
      paddleY: 250,
      ballX: 455,
      ballY: 250,
      ballVx: -285,
      ballVy: -120,
    };
  }
  return {
    squirrelY: 390,
    squirrelVy: 0,
    grounded: true,
    jumpLatched: false,
    obstacles: [],
    obstacleClock: 0,
    groundOffset: 0,
  };
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
  const dt = clamp((now - (runtime.lastFrame || now)) / 1000, 0, 0.034);
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
    if (runtime.phase !== "gameover") {
      runtime.phase = "ready";
      setOverlay("DynoGrip verbinden", "Verbinde den DynoGrip oben rechts, um zu spielen.", true);
      setStatus("DynoGrip nicht verbunden", false);
    }
    return;
  }
  if (runtime.phase !== "ready") return;

  const ratio = forceRatio();
  const inReadyZone = ratio >= READY_MIN && ratio <= READY_MAX;
  if (!inReadyZone) {
    runtime.readySince = 0;
    setOverlay("Bereit zum Start", `Bring deine Kraft auf etwa ${Math.round(runtime.preset * 0.5)} kg in den grünen Bereich.`, true);
    setStatus("Warte auf Startbereich", true);
    return;
  }

  if (!runtime.readySince) runtime.readySince = now;
  const remaining = Math.max(0, READY_HOLD_MS - (now - runtime.readySince));
  if (remaining > 0) {
    setOverlay("Startbereit", "Halten …", true);
    setStatus("Startbereich erreicht", true);
    return;
  }
  beginGame();
}

function beginGame() {
  runtime.phase = "playing";
  runtime.score = 0;
  runtime.readySince = 0;
  runtime.game = createGameState(runtime.activeGame);
  setScore(0);
  setOverlay("", "", false);
  setStatus("Spiel läuft", true);
}

function gameOver(message) {
  runtime.phase = "gameover";
  runtime.best[runtime.activeGame] = Math.max(runtime.best[runtime.activeGame] || 0, runtime.score);
  const best = runtime.root?.querySelector("#eventGameBest");
  if (best) best.textContent = String(runtime.best[runtime.activeGame]);
  setOverlay("Game Over", `${message} · ${runtime.score} ${runtime.score === 1 ? "Punkt" : "Punkte"}`, true);
  setStatus("Neu starten für den nächsten Versuch", true);
}

function setScore(value) {
  runtime.score = Math.max(0, Math.floor(value));
  const node = runtime.root?.querySelector("#eventGameScore");
  if (node) node.textContent = String(runtime.score);
}

function setOverlay(title, text, visible) {
  const overlay = runtime.root?.querySelector("#eventGameOverlay");
  const titleNode = runtime.root?.querySelector("#eventGameOverlayTitle");
  const textNode = runtime.root?.querySelector("#eventGameOverlayText");
  if (titleNode) titleNode.textContent = title;
  if (textNode) textNode.textContent = text;
  overlay?.classList.toggle("is-hidden", !visible);
}

function setStatus(text, connectedStyle) {
  const node = runtime.root?.querySelector("#eventGameStatusText");
  const dot = runtime.root?.querySelector("#eventGameStatusDot");
  if (node) node.textContent = text;
  dot?.classList.toggle("off", !connectedStyle);
}

function updateForceUi() {
  const root = runtime.root;
  if (!root) return;
  const forceText = runtime.force.toFixed(1);
  const headerValue = root.querySelector("#eventGamesForceValue");
  const arenaValue = root.querySelector("#eventGameArenaForce");
  const connection = root.querySelector("#eventGamesConnectionText");
  const fill = root.querySelector("#eventGameForceFill");
  if (headerValue) headerValue.textContent = forceText;
  if (arenaValue) arenaValue.textContent = forceText;
  if (connection) connection.textContent = runtime.connected ? "DynoGrip verbunden" : "DynoGrip nicht verbunden";
  if (fill) fill.style.width = `${clamp(forceRatio() * 100, 0, 100)}%`;

  const forceCard = root.querySelector(".event-games-force-card");
  forceCard?.classList.toggle("is-connected", runtime.connected);
  forceCard?.classList.toggle("is-disconnected", !runtime.connected);
}

function updateFlappy(dt) {
  const game = runtime.game;
  const w = 900;
  const h = 500;
  const ground = 452;
  const ratio = clamp(forceRatio(), 0, 1);
  const targetY = ground - 42 - ratio * (ground - 92);
  game.birdY += (targetY - game.birdY) * Math.min(1, dt * 7.5);
  game.groundOffset = (game.groundOffset + 155 * dt) % 44;
  game.pipeClock -= dt;
  if (game.pipeClock <= 0) {
    const gap = 165;
    const margin = 78;
    const gapY = margin + Math.random() * (ground - gap - margin * 2);
    game.pipes.push({ x: w + 40, gapY, gap, scored: false });
    game.pipeClock = 1.55;
  }

  for (const pipe of game.pipes) {
    pipe.x -= 190 * dt;
    if (!pipe.scored && pipe.x + 62 < 178) {
      pipe.scored = true;
      setScore(runtime.score + 1);
    }
  }
  game.pipes = game.pipes.filter((pipe) => pipe.x > -90);

  const bird = { x: 178, y: game.birdY, r: 18 };
  if (bird.y - bird.r < 10 || bird.y + bird.r > ground) {
    gameOver("Du hast den Rand berührt");
    return;
  }
  for (const pipe of game.pipes) {
    const withinX = bird.x + bird.r > pipe.x && bird.x - bird.r < pipe.x + 62;
    const safeY = bird.y - bird.r > pipe.gapY && bird.y + bird.r < pipe.gapY + pipe.gap;
    if (withinX && !safeY) {
      gameOver("Rohr getroffen");
      return;
    }
  }
}

function drawFlappy(ctx) {
  const game = runtime.game;
  const w = 900;
  const h = 500;
  const ground = 452;
  ctx.fillStyle = "#edf6f4";
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(255,255,255,.72)";
  [[110,82,60],[380,118,48],[720,72,66]].forEach(([x,y,r]) => {
    ctx.beginPath(); ctx.arc(x,y,r*.38,0,Math.PI*2); ctx.arc(x+r*.34,y-8,r*.3,0,Math.PI*2); ctx.arc(x+r*.66,y,r*.34,0,Math.PI*2); ctx.fill();
  });
  ctx.fillStyle = "#d9e9df";
  ctx.beginPath(); ctx.moveTo(0,330); ctx.quadraticCurveTo(140,235,280,330); ctx.quadraticCurveTo(420,250,570,330); ctx.quadraticCurveTo(740,220,900,330); ctx.lineTo(900,452); ctx.lineTo(0,452); ctx.closePath(); ctx.fill();

  for (const pipe of game.pipes) {
    ctx.fillStyle = "#5e8f7c";
    ctx.fillRect(pipe.x, 0, 62, pipe.gapY);
    ctx.fillRect(pipe.x, pipe.gapY + pipe.gap, 62, ground - pipe.gapY - pipe.gap);
    ctx.fillStyle = "#416f60";
    ctx.fillRect(pipe.x - 6, pipe.gapY - 18, 74, 18);
    ctx.fillRect(pipe.x - 6, pipe.gapY + pipe.gap, 74, 18);
  }

  ctx.fillStyle = "#cbded1";
  ctx.fillRect(0, ground, w, h-ground);
  ctx.strokeStyle = "#8fb3a0";
  ctx.lineWidth = 3;
  for (let x = -game.groundOffset; x < w + 44; x += 44) {
    ctx.beginPath(); ctx.moveTo(x, ground+9); ctx.lineTo(x+22, ground+22); ctx.lineTo(x+44, ground+9); ctx.stroke();
  }

  const y = game.birdY;
  const tilt = clamp((250 - y) / 150, -0.28, 0.28);
  ctx.save();
  ctx.translate(178, y);
  ctx.rotate(tilt);
  ctx.fillStyle = "#f0b64c";
  ctx.beginPath(); ctx.ellipse(0,0,22,17,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = "#f8d878";
  ctx.beginPath(); ctx.ellipse(-8,5,13,8,-.35,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(10,-6,7,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = "#171717";
  ctx.beginPath(); ctx.arc(12,-6,2.7,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = "#d97735";
  ctx.beginPath(); ctx.moveTo(18,-1); ctx.lineTo(34,4); ctx.lineTo(18,8); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function updatePong(dt) {
  const game = runtime.game;
  const w = 760;
  const h = 430;
  const paddleH = 88;
  const ratio = clamp(forceRatio(), 0, 1);
  const targetY = 34 + (1 - ratio) * (h - 68 - paddleH) + paddleH / 2;
  game.paddleY += (targetY - game.paddleY) * Math.min(1, dt * 10);

  game.ballX += game.ballVx * dt;
  game.ballY += game.ballVy * dt;
  const r = 11;
  if (game.ballY - r <= 16) { game.ballY = 16 + r; game.ballVy = Math.abs(game.ballVy); }
  if (game.ballY + r >= h - 16) { game.ballY = h - 16 - r; game.ballVy = -Math.abs(game.ballVy); }
  if (game.ballX + r >= w - 26) { game.ballX = w - 26 - r; game.ballVx = -Math.abs(game.ballVx); }

  const paddleX = 42;
  const paddleTop = game.paddleY - paddleH / 2;
  if (game.ballVx < 0 && game.ballX - r <= paddleX + 15 && game.ballX + r >= paddleX && game.ballY >= paddleTop && game.ballY <= paddleTop + paddleH) {
    game.ballX = paddleX + 15 + r;
    const offset = clamp((game.ballY - game.paddleY) / (paddleH / 2), -1, 1);
    const speed = Math.min(470, Math.abs(game.ballVx) + 13);
    game.ballVx = speed;
    game.ballVy = offset * 250 + game.ballVy * 0.32;
    setScore(runtime.score + 1);
  }
  if (game.ballX < -20) gameOver("Ball verpasst");
}

function drawPong(ctx) {
  const game = runtime.game;
  const w = 900;
  const h = 500;
  ctx.fillStyle = "#f7f7f3";
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  const sx = w / 760;
  const sy = h / 430;
  ctx.scale(sx, sy);
  ctx.strokeStyle = "#d8ddd8";
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 12]);
  ctx.beginPath(); ctx.moveTo(380,22); ctx.lineTo(380,408); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#1f4f46";
  ctx.fillRect(42, game.paddleY - 44, 15, 88);
  ctx.fillStyle = "#c7d9d3";
  ctx.fillRect(728, 18, 8, 394);
  ctx.fillStyle = "#171717";
  ctx.beginPath(); ctx.arc(game.ballX, game.ballY, 11, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#6a675f";
  ctx.font = "700 12px Inter, Arial";
  ctx.fillText("DU", 38, 22);
  ctx.textAlign = "right";
  ctx.fillText("WAND", 738, 22);
  ctx.restore();
}

function updateSquirrel(dt) {
  const game = runtime.game;
  const groundY = 402;
  const ratio = forceRatio();
  game.groundOffset = (game.groundOffset + 235 * dt) % 52;

  if (ratio < 0.43) game.jumpLatched = false;
  if (game.grounded && ratio >= 0.62 && !game.jumpLatched) {
    game.jumpLatched = true;
    game.grounded = false;
    game.squirrelVy = -(410 + clamp((ratio - 0.62) / 0.38, 0, 1) * 150);
  }

  if (!game.grounded) {
    game.squirrelVy += 980 * dt;
    game.squirrelY += game.squirrelVy * dt;
    if (game.squirrelY >= groundY) {
      game.squirrelY = groundY;
      game.squirrelVy = 0;
      game.grounded = true;
    }
  }

  game.obstacleClock -= dt;
  if (game.obstacleClock <= 0) {
    const tall = Math.random() > 0.62;
    game.obstacles.push({ x: 940, w: tall ? 42 : 52, h: tall ? 88 : 54, scored: false });
    game.obstacleClock = 1.25 + Math.random() * 0.6;
  }
  for (const obstacle of game.obstacles) {
    obstacle.x -= 245 * dt;
    if (!obstacle.scored && obstacle.x + obstacle.w < 145) {
      obstacle.scored = true;
      setScore(runtime.score + 1);
    }
  }
  game.obstacles = game.obstacles.filter((obstacle) => obstacle.x > -80);

  const squirrel = { x: 145, y: game.squirrelY - 42, w: 56, h: 44 };
  for (const obstacle of game.obstacles) {
    const top = groundY + 23 - obstacle.h;
    const hit = squirrel.x + squirrel.w * 0.72 > obstacle.x && squirrel.x + 8 < obstacle.x + obstacle.w && squirrel.y + squirrel.h > top + 8;
    if (hit) {
      gameOver("Hindernis getroffen");
      return;
    }
  }
}

function drawSquirrel(ctx) {
  const game = runtime.game;
  const w = 900;
  const h = 500;
  const groundY = 425;
  ctx.fillStyle = "#f1f6ef";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#dbe8d8";
  for (let x = 40; x < w; x += 150) {
    ctx.beginPath(); ctx.arc(x, 280, 48, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 7, 280, 14, 145);
  }
  ctx.fillStyle = "#c8d7b9";
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.strokeStyle = "#91aa80";
  ctx.lineWidth = 3;
  for (let x = -game.groundOffset; x < w + 52; x += 52) {
    ctx.beginPath(); ctx.moveTo(x, groundY + 14); ctx.lineTo(x + 26, groundY + 4); ctx.lineTo(x + 52, groundY + 14); ctx.stroke();
  }

  for (const obstacle of game.obstacles) {
    const top = groundY + 23 - obstacle.h;
    ctx.fillStyle = obstacle.h > 60 ? "#815f43" : "#9a7757";
    ctx.fillRect(obstacle.x, top, obstacle.w, obstacle.h);
    ctx.fillStyle = "#6f5139";
    ctx.fillRect(obstacle.x - 5, top, obstacle.w + 10, 10);
  }

  const x = 145;
  const y = game.squirrelY - 42;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#a9693f";
  ctx.beginPath(); ctx.ellipse(26,25,25,18,-.08,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(47,12,14,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = "#c9824e";
  ctx.beginPath(); ctx.arc(4,18,19,0,Math.PI*2); ctx.arc(-5,8,15,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = "#171717";
  ctx.beginPath(); ctx.arc(52,9,2.6,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = "#8d5838";
  ctx.beginPath(); ctx.moveTo(42,-1); ctx.lineTo(47,-16); ctx.lineTo(54,1); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#70452e";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(20,39); ctx.lineTo(12,48); ctx.moveTo(37,39); ctx.lineTo(45,48); ctx.stroke();
  ctx.restore();
}

function drawCurrentGame() {
  const ctx = runtime.ctx;
  if (!ctx || !runtime.game) return;
  ctx.clearRect(0, 0, 900, 500);
  if (runtime.activeGame === "flappy") drawFlappy(ctx);
  if (runtime.activeGame === "pong") drawPong(ctx);
  if (runtime.activeGame === "squirrel") drawSquirrel(ctx);
}
