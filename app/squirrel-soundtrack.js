const SQUIRREL_SOUNDTRACK_URL = "https://dynoforce.web.app/1v1-assets/sounds/background_music_03.m4a";

const soundtrack = new Audio(SQUIRREL_SOUNDTRACK_URL);
soundtrack.preload = "auto";
soundtrack.loop = true;
soundtrack.volume = 0.26;

let primed = false;
let playing = false;

async function primeSoundtrack() {
  if (primed) return;
  primed = true;
  try {
    const oldVolume = soundtrack.volume;
    soundtrack.volume = 0;
    await soundtrack.play();
    soundtrack.pause();
    soundtrack.currentTime = 0;
    soundtrack.volume = oldVolume;
  } catch (_) {
    soundtrack.volume = 0.26;
  }
}

function squirrelIsRunning() {
  const page = document.querySelector(".event-games-page");
  if (!page) return false;

  const squirrelSelected = page.querySelector('[data-event-game="squirrel"].is-selected');
  if (!squirrelSelected) return false;

  const status = page.querySelector("#eventGameStatusText")?.textContent?.trim();
  const overlay = page.querySelector("#eventGameOverlay");
  const overlayHidden = overlay?.classList.contains("is-hidden");

  return status === "Spiel läuft" && overlayHidden;
}

function syncSoundtrack() {
  if (squirrelIsRunning()) {
    if (!playing) {
      soundtrack.play().then(() => {
        playing = true;
      }).catch(() => {});
    }
    return;
  }

  if (playing || !soundtrack.paused) {
    soundtrack.pause();
    playing = false;
    try {
      soundtrack.currentTime = 0;
    } catch (_) {}
  }
}

// Prime HTML audio from the same user interactions that are used to select
// games or connect the DynoGrip. This mirrors the Battle page's autoplay handling.
document.addEventListener("pointerdown", primeSoundtrack, { capture: true, once: false });
document.addEventListener("keydown", primeSoundtrack, { capture: true, once: false });

const app = document.getElementById("app");
if (app) {
  new MutationObserver(syncSoundtrack).observe(app, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class"],
  });
}

window.addEventListener("pagehide", () => {
  soundtrack.pause();
  playing = false;
});

syncSoundtrack();
