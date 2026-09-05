const app = document.getElementById("app");

function placeGamesButton() {
  if (!app) return;

  const forceColumn = app.querySelector(".guided-force-column");
  const qrBlock = forceColumn?.querySelector(".guided-qr-block");
  const button = app.querySelector(".guided-games-entry");

  if (!forceColumn || !qrBlock || !button) return;

  const title = button.querySelector(".guided-games-entry-copy strong");
  const subtitle = button.querySelector(".guided-games-entry-copy small");

  if (title && title.textContent !== "Spiele ausprobieren") {
    title.textContent = "Spiele ausprobieren";
  }
  if (subtitle && subtitle.textContent !== "Flappy Birds · Pong · Squirrel Rush") {
    subtitle.textContent = "Flappy Birds · Pong · Squirrel Rush";
  }

  if (button.parentElement !== forceColumn || button.nextElementSibling !== qrBlock) {
    forceColumn.insertBefore(button, qrBlock);
  }
}

if (app) {
  let scheduled = false;
  const schedulePlacement = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      placeGamesButton();
    });
  };

  new MutationObserver(schedulePlacement).observe(app, {
    childList: true,
    subtree: true,
  });

  placeGamesButton();
}
