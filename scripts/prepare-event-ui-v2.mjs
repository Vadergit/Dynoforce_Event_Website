import fs from "node:fs";

const mainPath = new URL("../app/main.js", import.meta.url);
const cssPath = new URL("../app/styles.css", import.meta.url);
let s = fs.readFileSync(mainPath, "utf8");
let css = fs.readFileSync(cssPath, "utf8");

function patch(from, to, label) {
  if (s.includes(to)) return;
  if (!s.includes(from)) throw new Error("Patch nicht gefunden: " + label);
  s = s.replace(from, to);
}

patch('    draftLastName: "",\n    attempts: [],', '    draftLastName: "",\n    gender: "",\n    draftGender: "",\n    attempts: [],', 'state');

patch(
  'function getResultsForDirection(direction = "all") {\n  if (direction === "all") return [...state.results];\n  return state.results.filter((entry) => resultDirectionKey(entry) === direction);\n}',
  'function normalizeGender(value) {\n  const normalized = String(value || "").trim().toLowerCase();\n  if (["male", "mann", "männlich", "m"].includes(normalized)) return "male";\n  if (["female", "frau", "weiblich", "w"].includes(normalized)) return "female";\n  return "";\n}\n\nfunction getResultsForDirection(direction = "all", gender = "all") {\n  return state.results.filter((entry) => {\n    const directionMatches = direction === "all" || resultDirectionKey(entry) === direction;\n    const genderMatches = gender === "all" || normalizeGender(entry.gender) === gender;\n    return directionMatches && genderMatches;\n  });\n}',
  'gender helpers',
);

const oldLeaderboard = s.slice(s.indexOf('function leaderboardSections(limit = 10) {'), s.indexOf('\nfunction normalizeForceMode', s.indexOf('function leaderboardSections(limit = 10) {')));
if (!oldLeaderboard.includes('const genders =')) {
  const newLeaderboard = 'function leaderboardSections(limit = 10) {\n  const mode = normalizeForceMode(state.event.forceMode);\n  const directions = mode === "Beide"\n    ? [{ key: "pull", label: "Ziehen" }, { key: "push", label: "Drücken" }]\n    : mode === "Ziehen"\n      ? [{ key: "pull", label: "Ziehen" }]\n      : [{ key: "push", label: "Drücken" }];\n  const genders = [{ key: "male", label: "Männer" }, { key: "female", label: "Frauen" }];\n  return directions.flatMap((direction) => genders.map((gender) => ({\n    key: direction.key,\n    gender: gender.key,\n    title: direction.label + " · " + gender.label,\n    items: getResultsForDirection(direction.key, gender.key).slice(0, limit),\n  })));\n}\n';
  s = s.replace(oldLeaderboard, newLeaderboard);
}

patch(
  '  const firstName = String(firstNameInput?.value ?? state.liveEntry.draftFirstName ?? "").trim();\n  const lastName = String(lastNameInput?.value ?? state.liveEntry.draftLastName ?? "").trim();\n  return { firstName, lastName, participantName: [firstName, lastName].filter(Boolean).join(" ").trim() };',
  '  const genderInput = document.querySelector(\'input[name="participantGender"]:checked\');\n  const firstName = String(firstNameInput?.value ?? state.liveEntry.draftFirstName ?? "").trim();\n  const lastName = String(lastNameInput?.value ?? state.liveEntry.draftLastName ?? "").trim();\n  const gender = normalizeGender(genderInput?.value ?? state.liveEntry.draftGender ?? "");\n  return { firstName, lastName, gender, participantName: [firstName, lastName].filter(Boolean).join(" ").trim() };',
  'read gender',
);
patch('  const { firstName, lastName } = readLiveParticipantInputs();\n  state.liveEntry.draftFirstName = firstName;\n  state.liveEntry.draftLastName = lastName;\n  return { firstName, lastName };', '  const { firstName, lastName, gender } = readLiveParticipantInputs();\n  state.liveEntry.draftFirstName = firstName;\n  state.liveEntry.draftLastName = lastName;\n  state.liveEntry.draftGender = gender;\n  return { firstName, lastName, gender };', 'draft gender');
patch('  const { firstName, lastName } = syncParticipantDraftFromInputs();\n  return firstName && lastName\n    ? normalizeParticipantNameForMatch(firstName, lastName)\n    : "";', '  const { firstName, lastName, gender } = syncParticipantDraftFromInputs();\n  return firstName && lastName && gender\n    ? normalizeParticipantNameForMatch(firstName, lastName) + "|" + gender\n    : "";', 'draft key');
patch('  const { firstName, lastName, participantName } = readLiveParticipantInputs();\n  if (!firstName || !lastName) {\n    setError("Bitte Vorname und Name vollständig eingeben.");', '  const { firstName, lastName, gender, participantName } = readLiveParticipantInputs();\n  if (!firstName || !lastName || !gender) {\n    setError("Bitte Vorname, Name und Kategorie Mann oder Frau auswählen.");', 'activation validation');
patch('  const participantKey = normalizeParticipantNameForMatch(firstName, lastName);', '  const participantKey = normalizeParticipantNameForMatch(firstName, lastName) + "|" + gender;', 'activation key');
patch('  state.liveEntry.draftLastName = lastName;\n  state.liveEntry.participantKey = participantKey;', '  state.liveEntry.draftLastName = lastName;\n  state.liveEntry.gender = gender;\n  state.liveEntry.draftGender = gender;\n  state.liveEntry.participantKey = participantKey;', 'activation state');
patch('    lastName: state.liveEntry.lastName,\n    participantName:', '    lastName: state.liveEntry.lastName,\n    gender: state.liveEntry.gender,\n    participantName:', 'participant parts');

patch('function findExistingParticipantResult(firstName, lastName, participantName, forceMode, results = state.results) {', 'function findExistingParticipantResult(firstName, lastName, participantName, forceMode, gender, results = state.results) {', 'find signature');
patch('    return entryName === targetName && resultDirectionKey(entry) === forceMode;', '    return entryName === targetName && resultDirectionKey(entry) === forceMode && normalizeGender(entry.gender) === normalizeGender(gender);', 'find match');

patch('function getResultPlacement(value, direction) {\n  const normalizedDirection = direction || "neutral";\n  const comparableResults = normalizeForceMode(state.event.forceMode) === "Beide"\n    ? state.results.filter((entry) => resultDirectionKey(entry) === normalizedDirection)\n    : state.results;', 'function getResultPlacement(value, direction, gender = state.liveEntry.gender) {\n  const normalizedDirection = direction || "neutral";\n  const normalizedGender = normalizeGender(gender);\n  const comparableResults = state.results.filter((entry) => {\n    const directionMatches = normalizeForceMode(state.event.forceMode) === "Beide" ? resultDirectionKey(entry) === normalizedDirection : true;\n    return directionMatches && normalizeGender(entry.gender) === normalizedGender;\n  });', 'placement');

patch('  if (state.guidedLiveStep === "name") return "name";\n  return "start";', '  if (state.guidedLiveStep === "name") return "name";\n  if (state.guidedLiveStep === "warmup") return "warmup";\n  return "start";', 'warmup state');
patch('function guidedLeaderboardMarkup() {\n  return leaderboardSections(5).map', 'function guidedLeaderboardMarkup() {\n  return leaderboardSections(3).map', 'top3');
patch('  if (step === "result") return guidedResultMarkup();\n  if (step === "name") {', '  if (step === "result") return guidedResultMarkup();\n  if (step === "warmup") {\n    return `\n      <div class="guided-screen guided-warmup-screen">\n        <div class="eyebrow">Sicher testen</div>\n        <h2>Bist du aufgewärmt?</h2>\n        <p>Für einen Maximalkraft-Test solltest du Finger, Hände, Arme und Schultern gut aufgewärmt haben.</p>\n        <div class="guided-choice-actions">\n          <button class="button primary" id="guidedWarmupYes" type="button">Ja, ich bin bereit</button>\n          <button class="button subtle" id="guidedWarmupNo" type="button">Nein, zurück zum Start</button>\n        </div>\n      </div>\n    `;\n  }\n  if (step === "name") {', 'warmup markup');

const lastNameField = '          <div class="field"><label for="participantLastNameInput">Name</label><input id="participantLastNameInput" value="${escapeHtml(state.liveEntry.draftLastName || "")}" placeholder="Nachname" autocomplete="family-name" enterkeyhint="done" /></div>\n';
const genderField = lastNameField + '          <fieldset class="guided-gender-field"><legend>Kategorie</legend><div class="guided-gender-options"><label><input type="radio" name="participantGender" value="male" ${state.liveEntry.draftGender === "male" ? "checked" : ""} /><span>Mann</span></label><label><input type="radio" name="participantGender" value="female" ${state.liveEntry.draftGender === "female" ? "checked" : ""} /><span>Frau</span></label></div></fieldset>\n';
patch(lastNameField, genderField, 'gender markup');
patch('        <p>${normalizeForceMode(state.event.forceMode) === "Beide" ? "Die besten 5 · separate Wertung für Ziehen und Drücken" : "Die besten 5 der aktuellen Challenge"}</p>', '        <p>Top 3 · getrennt nach Ziehen/Drücken und Mann/Frau</p>', 'top3 text');

patch('  state.liveEntry.draftLastName = "";\n  state.liveEntry.attempts = [];', '  state.liveEntry.draftLastName = "";\n  state.liveEntry.gender = "";\n  state.liveEntry.draftGender = "";\n  state.liveEntry.attempts = [];', 'reset');
patch('  const { firstName, lastName, participantName } = getParticipantNameParts();\n  if (!firstName || !lastName) {\n    setError("Bitte Vorname und Name eingeben.");', '  const { firstName, lastName, gender, participantName } = getParticipantNameParts();\n  if (!firstName || !lastName || !gender) {\n    setError("Bitte Vorname, Name und Kategorie Mann oder Frau auswählen.");', 'final validation');
patch('        group.direction,\n        nextResults,', '        group.direction,\n        gender,\n        nextResults,', 'find call');
patch('        participantName,\n        value: group.finalValue,', '        participantName,\n        gender,\n        value: group.finalValue,', 'payload');
patch('        placement: getResultPlacement(leaderboardValue, group.direction),', '        placement: getResultPlacement(leaderboardValue, group.direction, gender),', 'placement call');
patch('      participantName: savedName,\n      directionResults,', '      participantName: savedName,\n      gender,\n      directionResults,', 'completed gender');

patch('      draftLastName: "",\n      attempts: [],', '      draftLastName: "",\n      gender: "",\n      draftGender: "",\n      attempts: [],', 'new event');
patch('    state.guidedLiveStep = "name";\n    clearError();', '    state.guidedLiveStep = "warmup";\n    clearError();', 'start warmup');
patch('  root.querySelector("#guidedConnectPanel")?.addEventListener("click", async () => {', '  root.querySelector("#guidedWarmupYes")?.addEventListener("click", () => {\n    state.guidedLiveStep = "name";\n    clearError();\n    render();\n  });\n  root.querySelector("#guidedWarmupNo")?.addEventListener("click", returnGuidedLiveToStart);\n  root.querySelector("#guidedConnectPanel")?.addEventListener("click", async () => {', 'warmup actions');
patch('  root.querySelector("#participantLastNameInput")?.addEventListener("change", syncParticipantInputs);\n  root.querySelector("#activateParticipantButton")', '  root.querySelector("#participantLastNameInput")?.addEventListener("change", syncParticipantInputs);\n  root.querySelectorAll(\'input[name="participantGender"]\').forEach((input) => input.addEventListener("change", syncParticipantInputs));\n  root.querySelector("#activateParticipantButton")', 'gender binding');

const marker = '/* DynoForce gender + warmup extension */';
if (!css.includes(marker)) {
  css += '\n\n' + marker + '\n.guided-choice-actions{width:min(100%,470px);margin:28px auto 0;display:grid;gap:12px}.guided-choice-actions .button{min-height:56px;font-size:16px;font-weight:800}.guided-gender-field{margin:2px 0 4px;padding:0;border:0}.guided-gender-field legend{margin-bottom:8px;font-size:13px;font-weight:700;color:var(--muted)}.guided-gender-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.guided-gender-options label{cursor:pointer}.guided-gender-options input{position:absolute;opacity:0;pointer-events:none}.guided-gender-options span{min-height:50px;display:grid;place-items:center;border:1px solid var(--line);border-radius:14px;background:var(--surface-muted);font-weight:800;transition:160ms ease}.guided-gender-options input:checked+span{border-color:var(--primary);background:var(--primary-soft);color:var(--primary);box-shadow:0 0 0 2px var(--primary-soft)}.guided-leaderboard-column{overflow-y:auto!important}.guided-ranking-section+.guided-ranking-section{margin-top:10px}.guided-ranking-list li{min-height:36px}@media(max-width:480px){.guided-gender-options{grid-template-columns:1fr}}\n';
}

fs.writeFileSync(mainPath, s);
fs.writeFileSync(cssPath, css);
console.log("DynoForce Event UI vorbereitet.");
