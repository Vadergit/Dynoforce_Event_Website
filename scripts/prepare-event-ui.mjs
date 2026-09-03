import fs from "node:fs";

const mainPath = new URL("../app/main.js", import.meta.url);
const cssPath = new URL("../app/styles.css", import.meta.url);

let source = fs.readFileSync(mainPath, "utf8");
let css = fs.readFileSync(cssPath, "utf8");

const replaceOnce = (from, to, label) => {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Patch nicht gefunden: ${label}`);
  source = source.replace(from, to);
};

replaceOnce(
`    draftLastName: "",
    attempts: [],`,
`    draftLastName: "",
    gender: "",
    draftGender: "",
    attempts: [],`,
"liveEntry gender state",
);

replaceOnce(
`function getResultsForDirection(direction = "all") {
  if (direction === "all") return [...state.results];
  return state.results.filter((entry) => resultDirectionKey(entry) === direction);
}
`,
`function normalizeGender(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["male", "mann", "männlich", "m"].includes(normalized)) return "male";
  if (["female", "frau", "weiblich", "w"].includes(normalized)) return "female";
  return "";
}

function formatGenderLabel(value) {
  const gender = normalizeGender(value);
  if (gender === "male") return "Mann";
  if (gender === "female") return "Frau";
  return "Nicht zugeordnet";
}

function getResultsForDirection(direction = "all", gender = "all") {
  return state.results.filter((entry) => {
    const directionMatches = direction === "all" || resultDirectionKey(entry) === direction;
    const genderMatches = gender === "all" || normalizeGender(entry.gender) === gender;
    return directionMatches && genderMatches;
  });
}
`,
"gender result helpers",
);

replaceOnce(
`function leaderboardSections(limit = 10) {
  const mode = normalizeForceMode(state.event.forceMode);
  if (mode === "Beide") {
    return [
      { key: "pull", title: "Rangliste Ziehen", items: getResultsForDirection("pull").slice(0, limit) },
      { key: "push", title: "Rangliste Drücken", items: getResultsForDirection("push").slice(0, limit) },
    ];
  }
  if (mode === "Ziehen") {
    return [{ key: "pull", title: "Rangliste Ziehen", items: getResultsForDirection("pull").slice(0, limit) }];
  }
  if (mode === "Drücken") {
    return [{ key: "push", title: "Rangliste Drücken", items: getResultsForDirection("push").slice(0, limit) }];
  }
  return [{ key: "all", title: "Rangliste", items: state.results.slice(0, limit) }];
}
`,
`function leaderboardSections(limit = 10) {
  const mode = normalizeForceMode(state.event.forceMode);
  const directions = mode === "Beide"
    ? [{ key: "pull", label: "Ziehen" }, { key: "push", label: "Drücken" }]
    : mode === "Ziehen"
      ? [{ key: "pull", label: "Ziehen" }]
      : [{ key: "push", label: "Drücken" }];
  const genders = [{ key: "male", label: "Männer" }, { key: "female", label: "Frauen" }];
  return directions.flatMap((direction) => genders.map((gender) => ({
    key: direction.key,
    gender: gender.key,
    title: `${direction.label} · ${gender.label}`,
    items: getResultsForDirection(direction.key, gender.key).slice(0, limit),
  })));
}
`,
"gender leaderboard sections",
);

replaceOnce(
`  const firstName = String(firstNameInput?.value ?? state.liveEntry.draftFirstName ?? "").trim();
  const lastName = String(lastNameInput?.value ?? state.liveEntry.draftLastName ?? "").trim();
  return { firstName, lastName, participantName: [firstName, lastName].filter(Boolean).join(" ").trim() };`,
`  const genderInput = document.querySelector('input[name="participantGender"]:checked');
  const firstName = String(firstNameInput?.value ?? state.liveEntry.draftFirstName ?? "").trim();
  const lastName = String(lastNameInput?.value ?? state.liveEntry.draftLastName ?? "").trim();
  const gender = normalizeGender(genderInput?.value ?? state.liveEntry.draftGender ?? "");
  return { firstName, lastName, gender, participantName: [firstName, lastName].filter(Boolean).join(" ").trim() };`,
"read gender input",
);

replaceOnce(
`  const { firstName, lastName } = readLiveParticipantInputs();
  state.liveEntry.draftFirstName = firstName;
  state.liveEntry.draftLastName = lastName;
  return { firstName, lastName };`,
`  const { firstName, lastName, gender } = readLiveParticipantInputs();
  state.liveEntry.draftFirstName = firstName;
  state.liveEntry.draftLastName = lastName;
  state.liveEntry.draftGender = gender;
  return { firstName, lastName, gender };`,
"sync gender draft",
);

replaceOnce(
`  const { firstName, lastName } = syncParticipantDraftFromInputs();
  return firstName && lastName
    ? normalizeParticipantNameForMatch(firstName, lastName)
    : "";`,
`  const { firstName, lastName, gender } = syncParticipantDraftFromInputs();
  return firstName && lastName && gender
    ? `${normalizeParticipantNameForMatch(firstName, lastName)}|${gender}`
    : "";`,
"participant key gender",
);

replaceOnce(
`  const { firstName, lastName, participantName } = readLiveParticipantInputs();
  if (!firstName || !lastName) {
    setError("Bitte Vorname und Name vollständig eingeben.");`,
`  const { firstName, lastName, gender, participantName } = readLiveParticipantInputs();
  if (!firstName || !lastName || !gender) {
    setError("Bitte Vorname, Name und Kategorie Mann oder Frau auswählen.");`,
"activation gender validation",
);

replaceOnce(
`  const participantKey = normalizeParticipantNameForMatch(firstName, lastName);`,
`  const participantKey = `${normalizeParticipantNameForMatch(firstName, lastName)}|${gender}`;`,
"activation participant key",
);

replaceOnce(
`  state.liveEntry.draftLastName = lastName;
  state.liveEntry.participantKey = participantKey;`,
`  state.liveEntry.draftLastName = lastName;
  state.liveEntry.gender = gender;
  state.liveEntry.draftGender = gender;
  state.liveEntry.participantKey = participantKey;`,
"activation gender state",
);

replaceOnce(
`    lastName: state.liveEntry.lastName,
    participantName:`,
`    lastName: state.liveEntry.lastName,
    gender: state.liveEntry.gender,
    participantName:`,
"participant parts gender",
);

replaceOnce(
`function findExistingParticipantResult(firstName, lastName, participantName, forceMode, results = state.results) {`,
`function findExistingParticipantResult(firstName, lastName, participantName, forceMode, gender, results = state.results) {`,
"existing result gender signature",
);

replaceOnce(
`    return entryName === targetName && resultDirectionKey(entry) === forceMode;`,
`    return entryName === targetName && resultDirectionKey(entry) === forceMode && normalizeGender(entry.gender) === normalizeGender(gender);`,
"existing result gender match",
);

replaceOnce(
`function getResultPlacement(value, direction) {
  const normalizedDirection = direction || "neutral";
  const comparableResults = normalizeForceMode(state.event.forceMode) === "Beide"
    ? state.results.filter((entry) => resultDirectionKey(entry) === normalizedDirection)
    : state.results;`,
`function getResultPlacement(value, direction, gender = state.liveEntry.gender) {
  const normalizedDirection = direction || "neutral";
  const normalizedGender = normalizeGender(gender);
  const comparableResults = state.results.filter((entry) => {
    const directionMatches = normalizeForceMode(state.event.forceMode) === "Beide"
      ? resultDirectionKey(entry) === normalizedDirection
      : true;
    return directionMatches && normalizeGender(entry.gender) === normalizedGender;
  });`,
"gender placement",
);

replaceOnce(
`  if (state.guidedLiveStep === "name") return "name";
  return "start";`,
`  if (state.guidedLiveStep === "name") return "name";
  if (state.guidedLiveStep === "warmup") return "warmup";
  return "start";`,
"warmup guided step",
);

replaceOnce(
`function guidedLeaderboardMarkup() {
  return leaderboardSections(5).map`,
`function guidedLeaderboardMarkup() {
  return leaderboardSections(3).map`,
"guided top three",
);

replaceOnce(
`  if (step === "result") return guidedResultMarkup();
  if (step === "name") {`,
`  if (step === "result") return guidedResultMarkup();
  if (step === "warmup") {
    return `
      <div class="guided-screen guided-warmup-screen">
        <div class="eyebrow">Sicher testen</div>
        <h2>Bist du aufgewärmt?</h2>
        <p>Für einen Maximalkraft-Test solltest du Finger, Hände, Arme und Schultern gut aufgewärmt haben.</p>
        <div class="guided-choice-actions">
          <button class="button primary" id="guidedWarmupYes" type="button">Ja, ich bin bereit</button>
          <button class="button subtle" id="guidedWarmupNo" type="button">Nein, zurück zum Start</button>
        </div>
      </div>
    `;
  }
  if (step === "name") {`,
"warmup screen markup",
);

replaceOnce(
`          <div class="field"><label for="participantLastNameInput">Name</label><input id="participantLastNameInput" value="${escapeHtml(state.liveEntry.draftLastName || "")}" placeholder="Nachname" autocomplete="family-name" enterkeyhint="done" /></div>
          <button class="button primary" id="activateParticipantButton"`,
`          <div class="field"><label for="participantLastNameInput">Name</label><input id="participantLastNameInput" value="${escapeHtml(state.liveEntry.draftLastName || "")}" placeholder="Nachname" autocomplete="family-name" enterkeyhint="done" /></div>
          <fieldset class="guided-gender-field"><legend>Kategorie</legend><div class="guided-gender-options"><label><input type="radio" name="participantGender" value="male" ${state.liveEntry.draftGender === "male" ? "checked" : ""} /><span>Mann</span></label><label><input type="radio" name="participantGender" value="female" ${state.liveEntry.draftGender === "female" ? "checked" : ""} /><span>Frau</span></label></div></fieldset>
          <button class="button primary" id="activateParticipantButton"`,
"gender selector markup",
);

replaceOnce(
`        <p>${normalizeForceMode(state.event.forceMode) === "Beide" ? "Die besten 5 · separate Wertung für Ziehen und Drücken" : "Die besten 5 der aktuellen Challenge"}</p>`,
`        <p>Top 3 · getrennt nach Ziehen/Drücken und Mann/Frau</p>`,
"guided leaderboard description",
);

replaceOnce(
`  state.liveEntry.draftLastName = "";
  state.liveEntry.attempts = [];`,
`  state.liveEntry.draftLastName = "";
  state.liveEntry.gender = "";
  state.liveEntry.draftGender = "";
  state.liveEntry.attempts = [];`,
"reset gender",
);

replaceOnce(
`  const { firstName, lastName, participantName } = getParticipantNameParts();
  if (!firstName || !lastName) {
    setError("Bitte Vorname und Name eingeben.");`,
`  const { firstName, lastName, gender, participantName } = getParticipantNameParts();
  if (!firstName || !lastName || !gender) {
    setError("Bitte Vorname, Name und Kategorie Mann oder Frau auswählen.");`,
"finalize gender validation",
);

replaceOnce(
`        group.direction,
        nextResults,`,
`        group.direction,
        gender,
        nextResults,`,
"existing result call gender",
);

replaceOnce(
`        participantName,
        value: group.finalValue,`,
`        participantName,
        gender,
        value: group.finalValue,`,
"result payload gender",
);

replaceOnce(
`        placement: getResultPlacement(leaderboardValue, group.direction),`,
`        placement: getResultPlacement(leaderboardValue, group.direction, gender),`,
"result placement gender",
);

replaceOnce(
`      participantName: savedName,
      directionResults,`,
`      participantName: savedName,
      gender,
      directionResults,`,
"completed result gender",
);

replaceOnce(
`                <div class="field"><label>Resultat in kg</label><input data-result-value="${entry.id}" type="number" min="0" step="0.1" value="${Number(entry.value || 0).toFixed(1)}" /></div>`,
`                <div class="field"><label>Kategorie</label><select data-result-gender="${entry.id}"><option value="">Nicht zugeordnet</option><option value="male" ${normalizeGender(entry.gender) === "male" ? "selected" : ""}>Mann</option><option value="female" ${normalizeGender(entry.gender) === "female" ? "selected" : ""}>Frau</option></select></div>
                <div class="field"><label>Resultat in kg</label><input data-result-value="${entry.id}" type="number" min="0" step="0.1" value="${Number(entry.value || 0).toFixed(1)}" /></div>`,
"result editor gender",
);

replaceOnce(
`async function updateResultEntry(resultId, firstName, lastName, value) {`,
`async function updateResultEntry(resultId, firstName, lastName, value, gender) {`,
"update result gender signature",
);

replaceOnce(
`  const participantName = `${cleanFirstName} ${cleanLastName}`.trim();
  try {`,
`  const participantName = `${cleanFirstName} ${cleanLastName}`.trim();
  const normalizedGender = normalizeGender(gender);
  if (!normalizedGender) {
    setError("Bitte für das Resultat Mann oder Frau auswählen.");
    render();
    return;
  }
  try {`,
"update result gender validation",
);

replaceOnce(
`      participantName,
      value: Number(numericValue.toFixed(1)),`,
`      participantName,
      gender: normalizedGender,
      value: Number(numericValue.toFixed(1)),`,
"update firestore gender",
);

replaceOnce(
`            participantName,
            value: Number(numericValue.toFixed(1)),`,
`            participantName,
            gender: normalizedGender,
            value: Number(numericValue.toFixed(1)),`,
"update local gender",
);

replaceOnce(
`      draftLastName: "",
      attempts: [],`,
`      draftLastName: "",
      gender: "",
      draftGender: "",
      attempts: [],`,
"new event live gender",
);

replaceOnce(
`    state.guidedLiveStep = "name";
    clearError();`,
`    state.guidedLiveStep = "warmup";
    clearError();`,
"primary goes warmup",
);

replaceOnce(
`  root.querySelector("#guidedConnectPanel")?.addEventListener("click", async () => {`,
`  root.querySelector("#guidedWarmupYes")?.addEventListener("click", () => {
    state.guidedLiveStep = "name";
    clearError();
    render();
  });
  root.querySelector("#guidedWarmupNo")?.addEventListener("click", returnGuidedLiveToStart);
  root.querySelector("#guidedConnectPanel")?.addEventListener("click", async () => {`,
"warmup actions",
);

replaceOnce(
`  root.querySelector("#participantLastNameInput")?.addEventListener("change", syncParticipantInputs);
  root.querySelector("#activateParticipantButton")`,
`  root.querySelector("#participantLastNameInput")?.addEventListener("change", syncParticipantInputs);
  root.querySelectorAll('input[name="participantGender"]').forEach((input) => input.addEventListener("change", syncParticipantInputs));
  root.querySelector("#activateParticipantButton")`,
"gender input binding",
);

replaceOnce(
`      const value = root.querySelector(`[data-result-value="${resultId}"]`)?.value || "";
      await updateResultEntry(resultId, firstName, lastName, value);`,
`      const value = root.querySelector(`[data-result-value="${resultId}"]`)?.value || "";
      const gender = root.querySelector(`[data-result-gender="${resultId}"]`)?.value || "";
      await updateResultEntry(resultId, firstName, lastName, value, gender);`,
"result editor binding gender",
);

const cssMarker = "/* DynoForce gender + warmup extension */";
if (!css.includes(cssMarker)) {
  css += `\n\n${cssMarker}\n.guided-choice-actions { width:min(100%,470px); margin:28px auto 0; display:grid; gap:12px; }\n.guided-choice-actions .button { min-height:56px; font-size:16px; font-weight:800; }\n.guided-gender-field { margin:2px 0 4px; padding:0; border:0; }\n.guided-gender-field legend { margin-bottom:8px; font-size:13px; font-weight:700; color:var(--muted); }\n.guided-gender-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }\n.guided-gender-options label { cursor:pointer; }\n.guided-gender-options input { position:absolute; opacity:0; pointer-events:none; }\n.guided-gender-options span { min-height:50px; display:grid; place-items:center; border:1px solid var(--line); border-radius:14px; background:var(--surface-muted); font-weight:800; transition:160ms ease; }\n.guided-gender-options input:checked + span { border-color:var(--primary); background:var(--primary-soft); color:var(--primary); box-shadow:0 0 0 2px var(--primary-soft); }\n.guided-leaderboard-column { overflow-y:auto !important; }\n.guided-ranking-section + .guided-ranking-section { margin-top:10px; }\n.guided-ranking-list li { min-height:36px; }\n@media (max-width:480px) { .guided-gender-options { grid-template-columns:1fr; } }\n`;
}

fs.writeFileSync(mainPath, source);
fs.writeFileSync(cssPath, css);
console.log("DynoForce Event UI vorbereitet.");
