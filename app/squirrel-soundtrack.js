const SQUIRREL_SOUNDTRACK_URL = "https://dynoforce.web.app/1v1-assets/sounds/background_music_03.m4a";

const soundtrack = new Audio(SQUIRREL_SOUNDTRACK_URL);
soundtrack.preload = "auto";
soundtrack.loop = true;
soundtrack.volume = 0.26;

let primed = false;
let playing = false;

async function primeSoundtrack() {
  if (primed) return;
  try {
    const oldVolume = soundtrack.volume;
    soundtrack.volume = 0;
    await soundtrack.play();
    soundtrack.pause();
    soundtrack.currentTime = 0;
    soundtrack.volume = oldVolume;
    primed = true;
  } catch (_) {
    soundtrack.volume = 0.26;
  }
}

function squirrelIsRunning() {
  const page = document.querySelector(".event-games-page");
  if (!page) return false;
  if (!page.querySelector('[data-event-game="squirrel"].is-selected')) return false;
  const status = page.querySelector("#eventGameStatusText")?.textContent?.trim();
  const overlayHidden = page.querySelector("#eventGameOverlay")?.classList.contains("is-hidden");
  return status === "Spiel läuft" && overlayHidden;
}

function stopSoundtrack() {
  if (soundtrack.paused && !playing) return;
  soundtrack.pause();
  playing = false;
  try { soundtrack.currentTime = 0; } catch (_) {}
}

function syncSoundtrack() {
  if (!squirrelIsRunning()) {
    stopSoundtrack();
    return;
  }
  if (playing && !soundtrack.paused) return;
  soundtrack.play().then(() => {
    playing = true;
  }).catch(() => {
    playing = false;
  });
}

// Prime audio only from genuine user interaction. No DOM observer is used here,
// so this helper cannot trigger render loops in the event application.
document.addEventListener("pointerdown", primeSoundtrack, { capture: true });
document.addEventListener("keydown", primeSoundtrack, { capture: true });

const soundtrackTimer = window.setInterval(syncSoundtrack, 150);
window.addEventListener("pagehide", () => {
  window.clearInterval(soundtrackTimer);
  stopSoundtrack();
});

syncSoundtrack();