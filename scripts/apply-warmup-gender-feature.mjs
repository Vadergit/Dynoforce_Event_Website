import fs from "node:fs";

const mainPath = "app/main.js";
const stylesPath = "app/styles.css";
let source = fs.readFileSync(mainPath, "utf8");
let styles = fs.readFileSync(stylesPath, "utf8");

function replaceOnce(label, before, after) {
  if (!source.includes(before)) throw new Error(`Missing main.js target: ${label}`);
  source = source.replace(before, after);
}

function replaceRegex(label, regex, replacement) {
  if (!regex.test(source)) throw new Error(`Missing main.js regex target: ${label}`);
  source = source.replace(regex, replacement);
}

// Persist gender in every live-entry state initializer.
const initializerNeedle = '    draftLastName: "",\n    attempts: [],';
if (!source.includes(initializerNeedle)) throw new Error("Missing liveEntry initializer");
source = source.replaceAll(
  initializerNeedle,
  '    draftLastName: "",\n    gender: "",\n    draftGender: "",\n    attempts: [],',
);

replaceRegex(
  "gender-aware leaderboard helpers",
  /function getResultsForDirection\(direction = "all"\) \{[\s\S]*?\nfunction normalizeForceMode\(value\) \{/,
  `function normalizeGender(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["male", "mann", "m"].includes(normalized)) return "male";
  if (["female", "frau", "w", "f"].includes(normalized)) return "female";
  return "unknown";
}

function formatGenderLabel(value) {
  const gender = normalizeGender(value);
  if (gender === "male") return "Mann";
  if (gender === "female") return "Frau";
  return "Nicht zugeordnet";
}

function resultGenderKey(result) {
  return normalizeGender(result?.gender || result?.sex || result?.category);
}

function getResultsForDirection(direction = "all") {
  if (direction === "all") return [...state.results];
  return state.results.filter((entry) => resultDirectionKey(entry) === direction);
}

function getResultsForCategory(direction = "all", gender = "all") {
  return state.results.filter((entry) => {
    const directionMatches = direction === "all" || resultDirectionKey(entry) === direction;
    const genderMatches = gender === "all" || resultGenderKey(entry) === gender;
    return directionMatches && genderMatches;
  });
}

function getTodayWinnersByDirection() {
  const todayKey = toLocalDayKey(new Date());
  const todaysResults = state.results.filter((entry) => toLocalDayKey(resultCreatedAtDate(entry)) === todayKey);
  return {
    all: todaysResults[0] || null,
    pull: todaysResults.find((entry) => resultDirectionKey(entry) === "pull") || null,
    push: todaysResults.find((entry) => resultDirectionKey(entry) === "push") || null,
  };
}

function getOverallWinnersByDirection() {
  return {
    all: state.results[0] || null,
    pull: getResultsForDirection("pull")[0] || null,
    push: getResultsForDirection("push")[0] || null,
  };
}

function leaderboardSections(limit = 10) {
  const mode = normalizeForceMode(state.event.forceMode);
  const directions = mode === "Beide"
    ? [
        { key: "pull", title: "Ziehen" },
        { key: "push", title: "Drücken" },
      ]
    : mode === "Ziehen"
      ? [{ key: "pull", title: "Ziehen" }]
      : mode === "Drücken"
        ? [{ key: "push", title: "Drücken" }]
        : [{ key: "all", title: "Rangliste" }];
  const genders = [
    { key: "male", title: "Mann" },
    { key: "female", title: "Frau" },
  ];

  return directions.flatMap((direction) => genders.map((gender) => ({
    key: \`${"${direction.key}-${gender.key}"}\`,
    direction: direction.key,
    gender: gender.key,
    title: direction.key === "all" ? gender.title : \`${"${direction.title} · ${gender.title}"}\`,
    items: getResultsForCategory(direction.key, gender.key).slice(0, limit),
  })));
}

function normalizeForceMode(value) {`,
);

replaceRegex(
  "participant input reader",
  /function readLiveParticipantInputs\(\) \{[\s\S]*?\n\}/,
  `function readLiveParticipantInputs() {
  const firstNameInput = document.getElementById("participantFirstNameInput");
  const lastNameInput = document.getElementById("participantLastNameInput");
  const selectedGenderInput = document.querySelector('input[name="participantGender"]:checked');
  const firstName = String(firstNameInput?.value ?? state.liveEntry.draftFirstName ?? "").trim();
  const lastName = String(lastNameInput?.value ?? state.liveEntry.draftLastName ?? "").trim();
  const selectedGender = selectedGenderInput?.value ?? state.liveEntry.draftGender ?? "";
  const gender = normalizeGender(selectedGender);
  return {
    firstName,
    lastName,
    gender: gender === "unknown" ? "" : gender,
    participantName: [firstName, lastName].filter(Boolean).join(" ").trim(),
  };
}`,
);

replaceRegex(
  "participant draft sync",
  /function syncParticipantDraftFromInputs\(\) \{[\s\S]*?\n\}/,
  `function syncParticipantDraftFromInputs() {
  const { firstName, lastName, gender } = readLiveParticipantInputs();
  state.liveEntry.draftFirstName = firstName;
  state.liveEntry.draftLastName = lastName;
  state.liveEntry.draftGender = gender;
  return { firstName, lastName, gender };
}`,
);

replaceRegex(
  "participant draft key",
  /function getParticipantDraftKey\(\) \{[\s\S]*?\n\}/,
  `function getParticipantDraftKey() {
  const { firstName, lastName, gender } = syncParticipantDraftFromInputs();
  return firstName && lastName && gender
    ? \`${"${normalizeParticipantNameForMatch(firstName, lastName)}|${gender}"}\`
    : "";
}`,
);

replaceRegex(
  "activate participant",
  /function activateParticipantFromInputs\(\) \{[\s\S]*?\n\}\n\nfunction getLiveParticipantDisplayName/,
  `function activateParticipantFromInputs() {
  const { firstName, lastName, gender, participantName } = readLiveParticipantInputs();
  if (!firstName || !lastName) {
    setError("Bitte Vorname und Name vollständig eingeben.");
    render();
    return;
  }
  if (!gender) {
    setError("Bitte Mann oder Frau auswählen.");
    render();
    return;
  }

  const participantKey = \`${"${normalizeParticipantNameForMatch(firstName, lastName)}|${gender}"}\`;
  if (participantKey === state.liveEntry.participantKey) {
    updateParticipantActivationButton();
    return;
  }

  resetAttemptsForParticipantChange();
  state.liveEntry.firstName = firstName;
  state.liveEntry.lastName = lastName;
  state.liveEntry.gender = gender;
  state.liveEntry.draftFirstName = firstName;
  state.liveEntry.draftLastName = lastName;
  state.liveEntry.draftGender = gender;
  state.liveEntry.participantKey = participantKey;
  state.liveEntry.readyForAttempt = state.currentForce < ATTEMPT_END_THRESHOLD;
  clearError();
  setFlash(
    state.liveEntry.readyForAttempt
      ? \`${"${participantName} ist aktiv. Die Versuchserfassung ist gestartet."}\`
      : \`${"${participantName} ist aktiv. Bitte die Kraft vollständig lösen."}\`,
    "success",
  );
  if (USE_GUIDED_LIVE_UI) {
    state.guidedLiveStep = "attempts";
  }
  render();
}

function getLiveParticipantDisplayName`,
);

replaceRegex(
  "participant parts",
  /function getParticipantNameParts\(\) \{[\s\S]*?\n\}/,
  `function getParticipantNameParts() {
  return {
    firstName: state.liveEntry.firstName,
    lastName: state.liveEntry.lastName,
    gender: state.liveEntry.gender,
    participantName: [state.liveEntry.firstName, state.liveEntry.lastName].filter(Boolean).join(" ").trim(),
  };
}`,
);

replaceOnce(
  "result editor gender select",
  '                <div class="field"><label>Name</label><input data-result-last-name="${entry.id}" value="${escapeHtml(nameParts.lastName)}" /></div>\n                <div class="field"><label>Resultat in kg</label><input data-result-value="${entry.id}" type="number" min="0" step="0.1" value="${Number(entry.value || 0).toFixed(1)}" /></div>',
  '                <div class="field"><label>Name</label><input data-result-last-name="${entry.id}" value="${escapeHtml(nameParts.lastName)}" /></div>\n                <div class="field"><label>Kategorie</label><select data-result-gender="${entry.id}"><option value="" ${resultGenderKey(entry) === "unknown" ? "selected" : ""}>Nicht zugeordnet</option><option value="male" ${resultGenderKey(entry) === "male" ? "selected" : ""}>Mann</option><option value="female" ${resultGenderKey(entry) === "female" ? "selected" : ""}>Frau</option></select></div>\n                <div class="field"><label>Resultat in kg</label><input data-result-value="${entry.id}" type="number" min="0" step="0.1" value="${Number(entry.value || 0).toFixed(1)}" /></div>',
);

replaceOnce(
  "result editor summary gender",
  '<span>${escapeHtml(formatEntryDirection(entry))} · ${escapeHtml(formatDate(resultCreatedAtDate(entry)) || "ohne Datum")}</span>',
  '<span>${escapeHtml(formatEntryDirection(entry))} · ${escapeHtml(formatGenderLabel(entry.gender))} · ${escapeHtml(formatDate(resultCreatedAtDate(entry)) || "ohne Datum")}</span>',
);

replaceRegex(
  "existing result match",
  /function findExistingParticipantResult\(firstName, lastName, participantName, forceMode, results = state\.results\) \{[\s\S]*?\n\}/,
  `function findExistingParticipantResult(firstName, lastName, participantName, gender, forceMode, results = state.results) {
  const targetName = normalizeParticipantNameForMatch(firstName, lastName, participantName);
  if (!targetName) return null;
  return results.find((entry) => {
    const entryName = normalizeParticipantNameForMatch(entry.firstName, entry.lastName, entry.participantName || entry.name);
    return entryName === targetName
      && resultGenderKey(entry) === normalizeGender(gender)
      && resultDirectionKey(entry) === forceMode;
  }) || null;
}`,
);

replaceOnce(
  "live placement gender",
  '  return getResultPlacement(measuredValue, direction);',
  '  return getResultPlacement(measuredValue, direction, state.liveEntry.gender || state.liveEntry.draftGender);',
);

replaceRegex(
  "placement category",
  /function getResultPlacement\(value, direction\) \{[\s\S]*?\n\}/,
  `function getResultPlacement(value, direction, gender) {
  const normalizedDirection = direction || "neutral";
  const normalizedGender = normalizeGender(gender);
  const comparableResults = state.results.filter((entry) => {
    const directionMatches = normalizeForceMode(state.event.forceMode) === "Beide"
      ? resultDirectionKey(entry) === normalizedDirection
      : true;
    const genderMatches = normalizedGender === "unknown" || resultGenderKey(entry) === normalizedGender;
    return directionMatches && genderMatches;
  });
  const betterResults = comparableResults.filter((entry) => Number(entry.value || 0) > Number(value || 0)).length;
  return \`#${"${betterResults + 1}"}\`;
}`,
);

replaceOnce(
  "guided warmup state",
  '  if (state.guidedLiveStep === "name") return "name";',
  '  if (state.guidedLiveStep === "name") return "name";\n  if (state.guidedLiveStep === "warmup") return "warmup";',
);

replaceRegex(
  "guided leaderboard markup",
  /function guidedLeaderboardMarkup\(\) \{[\s\S]*?\n\}/,
  `function guidedLeaderboardMarkup() {
  return leaderboardSections(3).map((section) => \`
    <section class="guided-ranking-section">
      <h4><span aria-hidden="true">${"${guidedDirectionSymbol(section.direction)}"}</span> ${"${escapeHtml(section.title)}"}</h4>
      <ol class="guided-ranking-list">
        ${"${section.items.length ? section.items.map((entry, index) => `"}
          <li>
            <span class="guided-rank-number rank-${"${index + 1}"}">${"${index + 1}"}</span>
            <strong>${"${escapeHtml(entry.participantName || entry.name || \"Teilnehmer\")}"}</strong>
            <span>${"${Number(entry.value || 0).toFixed(1)}"} kg</span>
          </li>
        ${"${`}).join(\"\") : `<li class=\"is-empty\">Noch keine Resultate</li>`}"}
      </ol>
    </section>
  \`).join("");
}`,
);

replaceOnce(
  "insert warmup screen",
  '  if (step === "result") return guidedResultMarkup();\n  if (step === "name") {',
  `  if (step === "result") return guidedResultMarkup();
  if (step === "warmup") {
    return \`
      <div class="guided-screen guided-warmup-screen">
        <div class="eyebrow">Sicher testen</div>
        <h2>Bist du aufgewärmt?</h2>
        <p>Ein Maximalkrafttest belastet Finger, Hände und Unterarme stark. Bitte starte nur, wenn du dich bereits gut aufgewärmt hast.</p>
        <div class="guided-warmup-actions">
          <button class="button primary" id="guidedWarmupYes" type="button">Ja, ich bin aufgewärmt</button>
          <button class="button subtle" id="guidedWarmupNo" type="button">Nein, zurück zum Start</button>
        </div>
      </div>
    \`;
  }
  if (step === "name") {`,
);

replaceOnce(
  "gender selector in guided name screen",
  '          <div class="field"><label for="participantLastNameInput">Name</label><input id="participantLastNameInput" value="${escapeHtml(state.liveEntry.draftLastName || "")}" placeholder="Nachname" autocomplete="family-name" enterkeyhint="done" /></div>\n          <button class="button primary" id="activateParticipantButton" type="button" ${!online || !state.connected || !writable ? "disabled" : ""}>Bestätigen und starten</button>',
  `          <div class="field"><label for="participantLastNameInput">Name</label><input id="participantLastNameInput" value="${"${escapeHtml(state.liveEntry.draftLastName || \"\")}"}" placeholder="Nachname" autocomplete="family-name" enterkeyhint="done" /></div>
          <div class="guided-gender-field">
            <span>Kategorie</span>
            <div class="guided-gender-options" role="radiogroup" aria-label="Kategorie auswählen">
              <label class="guided-gender-option"><input type="radio" name="participantGender" value="male" ${"${state.liveEntry.draftGender === \"male\" ? \"checked\" : \"\"}"} /><span>Mann</span></label>
              <label class="guided-gender-option"><input type="radio" name="participantGender" value="female" ${"${state.liveEntry.draftGender === \"female\" ? \"checked\" : \"\"}"} /><span>Frau</span></label>
            </div>
          </div>
          <button class="button primary" id="activateParticipantButton" type="button" ${"${!online || !state.connected || !writable ? \"disabled\" : \"\"}"}>Bestätigen und starten</button>`,
);

replaceOnce(
  "guided leaderboard description",
  '<p>${normalizeForceMode(state.event.forceMode) === "Beide" ? "Die besten 5 · separate Wertung für Ziehen und Drücken" : "Die besten 5 der aktuellen Challenge"}</p>',
  '<p>Top 3 · getrennt nach Mann/Frau${normalizeForceMode(state.event.forceMode) === "Beide" ? " sowie Ziehen/Drücken" : ""}</p>',
);

replaceOnce(
  "reset live gender",
  '  state.liveEntry.draftLastName = "";\n  state.liveEntry.attempts = [];',
  '  state.liveEntry.draftLastName = "";\n  state.liveEntry.gender = "";\n  state.liveEntry.draftGender = "";\n  state.liveEntry.attempts = [];',
);

replaceOnce(
  "finalize participant parts",
  '  const { firstName, lastName, participantName } = getParticipantNameParts();\n  if (!firstName || !lastName) {',
  '  const { firstName, lastName, gender, participantName } = getParticipantNameParts();\n  if (!firstName || !lastName) {',
);

replaceOnce(
  "finalize gender validation",
  '    return false;\n  }\n\n  const attempts = [...(state.liveEntry.attempts || [])];',
  '    return false;\n  }\n  if (!gender || normalizeGender(gender) === "unknown") {\n    setError("Bitte Mann oder Frau auswählen.");\n    render();\n    return false;\n  }\n\n  const attempts = [...(state.liveEntry.attempts || [])];',
);

replaceOnce(
  "existing result call gender",
  '        participantName,\n        group.direction,',
  '        participantName,\n        gender,\n        group.direction,',
);

replaceOnce(
  "result payload gender",
  '        participantName,\n        value: group.finalValue,',
  '        participantName,\n        gender,\n        value: group.finalValue,',
);

replaceOnce(
  "result placement gender",
  '        placement: getResultPlacement(leaderboardValue, group.direction),',
  '        placement: getResultPlacement(leaderboardValue, group.direction, gender),',
);

replaceOnce(
  "last completed gender",
  '      participantName: savedName,\n      directionResults,',
  '      participantName: savedName,\n      gender,\n      directionResults,',
);

replaceRegex(
  "result update function",
  /async function updateResultEntry\(resultId, firstName, lastName, value\) \{[\s\S]*?\n\}/,
  `async function updateResultEntry(resultId, firstName, lastName, gender, value) {
  const cleanFirstName = firstName.trim();
  const cleanLastName = lastName.trim();
  const cleanGender = normalizeGender(gender);
  if (!cleanFirstName || !cleanLastName) {
    setError("Vorname und Name müssen beide ausgefüllt sein.");
    render();
    return;
  }
  if (cleanGender === "unknown") {
    setError("Bitte die Kategorie Mann oder Frau auswählen.");
    render();
    return;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    setError("Der Resultatwert muss eine gültige positive Zahl sein.");
    render();
    return;
  }

  const participantName = \`${"${cleanFirstName} ${cleanLastName}"}\`.trim();
  try {
    await updateDoc(doc(db, "results", resultId), {
      ownerUid: state.user?.uid || state.event.ownerUid || "",
      eventId: state.event.id,
      firstName: cleanFirstName,
      lastName: cleanLastName,
      participantName,
      gender: cleanGender,
      value: Number(numericValue.toFixed(1)),
      updatedAt: serverTimestamp(),
    });
    setResults(
      state.results.map((entry) => (entry.id === resultId
        ? {
            ...entry,
            ownerUid: state.user?.uid || state.event.ownerUid || "",
            eventId: state.event.id,
            firstName: cleanFirstName,
            lastName: cleanLastName,
            participantName,
            gender: cleanGender,
            value: Number(numericValue.toFixed(1)),
            updatedAt: new Date(),
          }
        : entry)),
    );
    clearError();
    setFlash(\`Resultat aktualisiert: ${"${participantName}"} · ${"${formatGenderLabel(cleanGender)}"} · ${"${numericValue.toFixed(1)}"} kg\`);
    render();
  } catch (error) {
    setError(\`Resultat konnte nicht gespeichert werden: ${"${error instanceof Error ? error.message : String(error)}"}\`);
    render();
  }
}`,
);

replaceOnce(
  "guided start goes to warmup",
  '    state.guidedLiveStep = "name";',
  '    state.guidedLiveStep = "warmup";',
);

replaceOnce(
  "warmup action bindings",
  '  root.querySelector("#guidedConnectPanel")?.addEventListener("click", async () => {',
  `  root.querySelector("#guidedWarmupYes")?.addEventListener("click", () => {
    state.guidedLiveStep = "name";
    clearError();
    render();
  });
  root.querySelector("#guidedWarmupNo")?.addEventListener("click", returnGuidedLiveToStart);
  root.querySelectorAll('input[name="participantGender"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.liveEntry.draftGender = input.checked ? input.value : state.liveEntry.draftGender;
      updateParticipantActivationButton();
    });
  });
  root.querySelector("#guidedConnectPanel")?.addEventListener("click", async () => {`,
);

replaceOnce(
  "result editor binding gender",
  '      const lastName = root.querySelector(`[data-result-last-name="${resultId}"]`)?.value || "";\n      const value = root.querySelector(`[data-result-value="${resultId}"]`)?.value || "";\n      await updateResultEntry(resultId, firstName, lastName, value);',
  '      const lastName = root.querySelector(`[data-result-last-name="${resultId}"]`)?.value || "";\n      const gender = root.querySelector(`[data-result-gender="${resultId}"]`)?.value || "";\n      const value = root.querySelector(`[data-result-value="${resultId}"]`)?.value || "";\n      await updateResultEntry(resultId, firstName, lastName, gender, value);',
);

replaceOnce(
  "display top3 copy",
  'Top 10 · ${state.event.challengeType} · Letztes Resultat live',
  'Top 3 pro Kategorie · ${state.event.challengeType} · Letztes Resultat live',
);
replaceOnce(
  "display top3 data",
  '${leaderboardSections(10).map((section) =>',
  '${leaderboardSections(3).map((section) =>',
);

// Add gender selection to the legacy live-entry fallback as well.
replaceOnce(
  "legacy gender selector",
  '                      <div class="field"><label>Name</label><input id="participantLastNameInput" value="${state.liveEntry.draftLastName || ""}" placeholder="Nachname eingeben" autocomplete="off" /></div>\n                      <div class="field participant-activate-field"><label>Freigabe</label><button class="button primary participant-activate-button" id="activateParticipantButton" type="button">Teilnehmer aktivieren</button></div>',
  '                      <div class="field"><label>Name</label><input id="participantLastNameInput" value="${state.liveEntry.draftLastName || ""}" placeholder="Nachname eingeben" autocomplete="off" /></div>\n                      <div class="field"><label>Kategorie</label><select id="participantGenderSelect"><option value="">Auswählen</option><option value="male" ${state.liveEntry.draftGender === "male" ? "selected" : ""}>Mann</option><option value="female" ${state.liveEntry.draftGender === "female" ? "selected" : ""}>Frau</option></select></div>\n                      <div class="field participant-activate-field"><label>Freigabe</label><button class="button primary participant-activate-button" id="activateParticipantButton" type="button">Teilnehmer aktivieren</button></div>',
);

// Support legacy select in the participant reader.
replaceOnce(
  "legacy gender reader",
  '  const selectedGenderInput = document.querySelector(\'input[name="participantGender"]:checked\');',
  '  const selectedGenderInput = document.querySelector(\'input[name="participantGender"]:checked\');\n  const legacyGenderSelect = document.getElementById("participantGenderSelect");',
);
replaceOnce(
  "legacy gender selected value",
  '  const selectedGender = selectedGenderInput?.value ?? state.liveEntry.draftGender ?? "";',
  '  const selectedGender = selectedGenderInput?.value ?? legacyGenderSelect?.value ?? state.liveEntry.draftGender ?? "";',
);
replaceOnce(
  "legacy gender binding",
  '  root.querySelector("#participantLastNameInput")?.addEventListener("change", syncParticipantInputs);',
  '  root.querySelector("#participantLastNameInput")?.addEventListener("change", syncParticipantInputs);\n  root.querySelector("#participantGenderSelect")?.addEventListener("change", syncParticipantInputs);',
);

fs.writeFileSync(mainPath, source);

styles += `

/* Warm-up gate and gender categories */
.guided-warmup-actions {
  width: min(100%, 470px);
  margin-top: 28px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.guided-warmup-actions .button {
  min-height: 56px;
  font-weight: 800;
}

.guided-gender-field {
  display: grid;
  gap: 8px;
}

.guided-gender-field > span {
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
}

.guided-gender-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.guided-gender-option {
  position: relative;
  cursor: pointer;
}

.guided-gender-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.guided-gender-option span {
  min-height: 48px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--surface);
  font-weight: 800;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
}

.guided-gender-option input:checked + span {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-soft);
}

.guided-gender-option input:focus-visible + span {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.guided-leaderboard-column {
  overflow-y: auto !important;
}

.guided-leaderboard-column .guided-ranking-section + .guided-ranking-section {
  margin-top: 8px;
}

.guided-leaderboard-column .guided-ranking-list li {
  min-height: 34px;
}

@media (max-width: 620px) {
  .guided-warmup-actions,
  .guided-gender-options {
    grid-template-columns: 1fr;
  }
}
`;

fs.writeFileSync(stylesPath, styles);
console.log("Warm-up and gender feature applied successfully.");
