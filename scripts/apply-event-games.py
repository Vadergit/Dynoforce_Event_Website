from pathlib import Path

path = Path("app/main.js")
source = path.read_text(encoding="utf-8")


def replace_once(old, new, label):
    global source
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, found {count}")
    source = source.replace(old, new, 1)


replace_once(
    'import { auth, db, storage } from "./firebase.js";\n',
    'import { auth, db, storage } from "./firebase.js";\nimport { bindEventGames, cleanupEventGames, eventGamesPageMarkup, updateEventGamesForce } from "./event-games.js";\nimport "./event-games.css";\n',
    "games imports",
)

replace_once(
    '  live: ["Live-Messseite", "Zentrale Arbeitsseite für den Organisator mit Gerät, Teilnehmer, Messwert und Top 10."],\n',
    '  live: ["Live-Messseite", "Zentrale Arbeitsseite für den Organisator mit Gerät, Teilnehmer, Messwert und Top 10."],\n  games: ["DynoForce Games", "Flappy Birds, Pong und Squirrel Rush als Einzelspieler mit einem DynoGrip."],\n',
    "page meta",
)

replace_once(
    'const focusedEventPages = ["live", "public", "display"];',
    'const focusedEventPages = ["live", "games", "public", "display"];',
    "focused event pages",
)

replace_once(
    '  const routedEventPage = ["setup", "branding", "live"].includes(page);',
    '  const routedEventPage = ["setup", "branding", "live", "games"].includes(page);',
    "route event pages",
)

replace_once(
    '  if (state.currentPage !== "live") return;\n\n  const setText = (id, value) => {',
    '  if (state.currentPage === "games") {\n    updateEventGamesForce({ force: getDisplayForceValue(), signedForce: state.signedForce, connected: state.connected });\n    return;\n  }\n  if (state.currentPage !== "live") return;\n\n  const setText = (id, value) => {',
    "game force updates",
)

replace_once(
    '      <button class="button primary guided-primary-action" id="guidedPrimaryAction" type="button" ${!writable || !online || !state.connected || state.connecting ? "disabled" : ""}>${primaryLabel}</button>\n      <div class="guided-safety-box"><strong>! &nbsp; Sicher testen</strong><span>Überschätze dich nicht und gib unaufgewärmt keine maximale Kraft. Bei Schmerzen sofort stoppen.</span></div>\n      ${guidedDailyLeadersMarkup()}',
    '      <button class="button primary guided-primary-action" id="guidedPrimaryAction" type="button" ${!writable || !online || !state.connected || state.connecting ? "disabled" : ""}>${primaryLabel}</button>\n      <button class="guided-games-entry" data-page="games" type="button" aria-label="DynoForce Spiele öffnen">\n        <span class="guided-games-entry-icon">🎮</span>\n        <span class="guided-games-entry-copy"><strong>Spiele</strong><small>Flappy Birds · Pong · Squirrel Rush</small></span>\n        <span class="guided-games-entry-arrow">→</span>\n      </button>\n      <div class="guided-safety-box"><strong>! &nbsp; Sicher testen</strong><span>Überschätze dich nicht und gib unaufgewärmt keine maximale Kraft. Bei Schmerzen sofort stoppen.</span></div>\n      ${guidedDailyLeadersMarkup()}',
    "start games button",
)

replace_once(
    '  const lockedPage = !state.user && ["dashboard", "setup", "branding", "live"].includes(page);',
    '  const lockedPage = !state.user && ["dashboard", "setup", "branding", "live", "games"].includes(page);',
    "locked games page",
)

replace_once(
    '          ${!lockedPage && page === "live" ? (USE_GUIDED_LIVE_UI ? guidedLivePageMarkup(publicUrl) : `',
    '          ${!lockedPage && page === "games" ? eventGamesPageMarkup({ connected: state.connected, currentForce: getDisplayForceValue() }) : ""}\n          ${!lockedPage && page === "live" ? (USE_GUIDED_LIVE_UI ? guidedLivePageMarkup(publicUrl) : `',
    "games page template",
)

replace_once(
    '      const targetEventId = ["setup", "branding", "live", "public", "display"].includes(page)',
    '      const targetEventId = ["setup", "branding", "live", "games", "public", "display"].includes(page)',
    "games navigation event id",
)

replace_once(
    '  root.innerHTML = template(state.currentPage);\n  bindGeneralUi();',
    '  if (state.currentPage !== "games") cleanupEventGames();\n  root.innerHTML = template(state.currentPage);\n  bindGeneralUi();',
    "games cleanup on render",
)

replace_once(
    '  if (state.user && state.currentPage === "live") bindLiveActions();\n  if (state.currentPage === "public") bindPublicActions();',
    '  if (state.user && state.currentPage === "live") bindLiveActions();\n  if (state.user && state.currentPage === "games") bindEventGames(root, { connected: state.connected, currentForce: getDisplayForceValue(), signedForce: state.signedForce });\n  if (state.currentPage === "public") bindPublicActions();',
    "games binder",
)

path.write_text(source, encoding="utf-8")
print("Event single-player games integrated into app/main.js")
