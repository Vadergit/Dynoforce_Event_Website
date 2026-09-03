from pathlib import Path

main_path = Path("app/main.js")
styles_path = Path("app/styles.css")
source = main_path.read_text(encoding="utf-8")
styles = styles_path.read_text(encoding="utf-8")


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f"Could not find replacement target: {label}")
    return text.replace(old, new, 1)


leaderboard_helpers = r'''
function leaderboardDirectionGroups(limit = 10) {
  const mode = normalizeForceMode(state.event.forceMode);
  const directions = mode === "Beide"
    ? ["pull", "push"]
    : mode === "Ziehen"
      ? ["pull"]
      : mode === "Drücken"
        ? ["push"]
        : ["all"];
  const sections = leaderboardSections(limit);

  return directions.map((direction) => ({
    key: direction,
    direction,
    title: direction === "all" ? "Rangliste" : formatDirectionLabel(direction),
    sections: sections.filter((section) => section.direction === direction),
  })).filter((group) => group.sections.length);
}

function groupedLeaderboardMarkup(limit = 3, { tableClass = "", surface = "public" } = {}) {
  return `
    <div class="leaderboard-direction-groups is-${surface}">
      ${leaderboardDirectionGroups(limit).map((group) => `
        <section class="leaderboard-direction-group">
          <header class="leaderboard-direction-header">
            <span class="leaderboard-direction-symbol" aria-hidden="true">${guidedDirectionSymbol(group.direction)}</span>
            <div class="leaderboard-direction-title">
              <small>Disziplin</small>
              <h3>${escapeHtml(group.title)}</h3>
            </div>
          </header>
          <div class="leaderboard-gender-grid">
            ${group.sections.map((section) => `
              <section class="leaderboard-gender-card">
                <div class="leaderboard-gender-heading">
                  <h4>${escapeHtml(formatGenderLabel(section.gender))}</h4>
                  <span>Kategorie</span>
                </div>
                <table class="leaderboard-table grouped-leaderboard-table ${tableClass}">
                  ${leaderboardTable(section.items, section.items.length, { showDirection: false })}
                </table>
              </section>
            `).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;
}
'''.strip()

source = replace_once(
    source,
    "\n\nfunction normalizeForceMode(value) {",
    "\n\n" + leaderboard_helpers + "\n\nfunction normalizeForceMode(value) {",
    "leaderboard helpers insertion",
)

old_guided = r'''function guidedLeaderboardMarkup() {
  return leaderboardSections(3).map((section) => `
    <section class="guided-ranking-section">
      <h4><span aria-hidden="true">${guidedDirectionSymbol(section.direction)}</span> ${escapeHtml(section.title)}</h4>
      <ol class="guided-ranking-list">
        ${section.items.length ? section.items.map((entry, index) => `
          <li>
            <span class="guided-rank-number rank-${index + 1}">${index + 1}</span>
            <strong>${escapeHtml(entry.participantName || entry.name || "Teilnehmer")}</strong>
            <span>${Number(entry.value || 0).toFixed(1)} kg</span>
          </li>
        `).join("") : `<li class="is-empty">Noch keine Resultate</li>`}
      </ol>
    </section>
  `).join("");
}'''

new_guided = r'''function guidedLeaderboardMarkup() {
  return leaderboardDirectionGroups(3).map((group) => `
    <section class="guided-direction-group">
      <div class="guided-direction-heading">
        <span aria-hidden="true">${guidedDirectionSymbol(group.direction)}</span>
        <strong>${escapeHtml(group.title)}</strong>
      </div>
      <div class="guided-direction-categories">
        ${group.sections.map((section) => `
          <section class="guided-ranking-section">
            <h4>${escapeHtml(formatGenderLabel(section.gender))}</h4>
            <ol class="guided-ranking-list">
              ${section.items.length ? section.items.map((entry, index) => `
                <li>
                  <span class="guided-rank-number rank-${index + 1}">${index + 1}</span>
                  <strong>${escapeHtml(entry.participantName || entry.name || "Teilnehmer")}</strong>
                  <span>${Number(entry.value || 0).toFixed(1)} kg</span>
                </li>
              `).join("") : `<li class="is-empty">Noch keine Resultate</li>`}
            </ol>
          </section>
        `).join("")}
      </div>
    </section>
  `).join("");
}'''
source = replace_once(source, old_guided, new_guided, "guided leaderboard")

old_table = r'''function leaderboardTable(items, limit) {
  return `
    <colgroup>
      <col class="rank-column" />
      <col class="name-column" />
      <col class="direction-column" />
      <col class="result-column" />
    </colgroup>
    <tr><th>#</th><th>Name</th><th class="direction-column">Richtung</th><th>Resultat</th></tr>
    ${items.slice(0, limit).map((item, index) => `
      <tr>
        <td><span class="rank-pill">${medalForRank(index)}</span></td>
        <td>${item.participantName || item.name}</td>
        <td class="direction-column">${formatEntryDirection(item)}</td>
        <td>${Number(item.value).toFixed(1)} kg</td>
      </tr>
    `).join("")}
  `;
}'''

new_table = r'''function leaderboardTable(items, limit, { showDirection = true } = {}) {
  const visibleItems = items.slice(0, limit);
  return `
    <colgroup>
      <col class="${showDirection ? "rank-column" : "grouped-rank-column"}" />
      <col class="${showDirection ? "name-column" : "grouped-name-column"}" />
      ${showDirection ? `<col class="direction-column" />` : ""}
      <col class="${showDirection ? "result-column" : "grouped-result-column"}" />
    </colgroup>
    <tr><th>#</th><th>Name</th>${showDirection ? `<th class="direction-column">Richtung</th>` : ""}<th>Resultat</th></tr>
    ${visibleItems.length ? visibleItems.map((item, index) => `
      <tr>
        <td><span class="rank-pill">${medalForRank(index)}</span></td>
        <td>${escapeHtml(item.participantName || item.name || "Teilnehmer")}</td>
        ${showDirection ? `<td class="direction-column">${formatEntryDirection(item)}</td>` : ""}
        <td>${Number(item.value).toFixed(1)} kg</td>
      </tr>
    `).join("") : `<tr class="leaderboard-empty-row"><td colspan="${showDirection ? 4 : 3}">Noch keine Resultate</td></tr>`}
  `;
}'''
source = replace_once(source, old_table, new_table, "leaderboard table")

old_legacy_live = r'''                <div class="card live-leaderboard-card"><div class="card-header"><div><h3>Leaderboard</h3><p>${normalizeForceMode(state.event.forceMode) === "Beide" ? "Top 3 für Ziehen und Drücken." : "Top 3 – automatisch aktualisiert."}</p></div></div><div class="grid live-leaderboard-sections">${leaderboardSections(3).map((section) => `<div><h4>${section.title}</h4><table class="leaderboard-table">${leaderboardTable(section.items, section.items.length)}</table></div>`).join("")}</div></div>'''
new_legacy_live = r'''                <div class="card live-leaderboard-card"><div class="card-header"><div><h3>Leaderboard</h3><p>${normalizeForceMode(state.event.forceMode) === "Beide" ? "Top 3 · zuerst nach Ziehen/Drücken, darin nach Mann/Frau." : "Top 3 · getrennt nach Mann und Frau."}</p></div></div>${groupedLeaderboardMarkup(3, { surface: "live" })}</div>'''
source = replace_once(source, old_legacy_live, new_legacy_live, "legacy live leaderboard")

old_public = r'''              <div class="card"><div class="card-header"><div><h3>${normalizeForceMode(state.event.forceMode) === "Beide" ? "Komplette Ranglisten" : "Komplette Rangliste"}</h3><p>${normalizeForceMode(state.event.forceMode) === "Beide" ? "Ziehen und Drücken werden separat gewertet." : "Automatische Aktualisierung während des Events."}</p></div></div><div class="grid">${leaderboardSections(state.results.length || 1).map((section) => `<div><h4 style="margin:0 0 10px;">${section.title}</h4><table class="leaderboard-table">${leaderboardTable(section.items, section.items.length)}</table></div>`).join("")}</div></div>'''
new_public = r'''              <div class="card public-leaderboard-card"><div class="card-header"><div><h3>${normalizeForceMode(state.event.forceMode) === "Beide" ? "Komplette Ranglisten" : "Komplette Rangliste"}</h3><p>${normalizeForceMode(state.event.forceMode) === "Beide" ? "Ziehen und Drücken sind als Hauptkategorien gebündelt. Mann und Frau werden darin separat gewertet." : "Mann und Frau werden innerhalb der Disziplin separat gewertet."}</p></div></div>${groupedLeaderboardMarkup(state.results.length || 1, { surface: "public" })}</div>'''
source = replace_once(source, old_public, new_public, "public leaderboard")

old_display = r'''              <div class="card"><div class="eyebrow">Display-Modus</div><h1 class="display-title">${state.event.name}</h1><p class="muted" style="font-size:20px;">Top 3 pro Kategorie · ${state.event.challengeType} · Letztes Resultat live</p>${isDailyChallengeType() ? `<div class="mini-stats" style="margin-bottom:18px;">${dailyWinnerCardsMarkup()}</div>` : ""}<div class="grid">${leaderboardSections(3).map((section) => `<div><h4 style="margin:0 0 10px;">${section.title}</h4><table class="leaderboard-table display-board">${leaderboardTable(section.items, section.items.length)}</table></div>`).join("")}</div></div>'''
new_display = r'''              <div class="card display-leaderboard-card"><div class="eyebrow">Display-Modus</div><h1 class="display-title">${state.event.name}</h1><p class="muted" style="font-size:20px;">Top 3 pro Kategorie · ${state.event.challengeType} · gruppiert nach Disziplin</p>${isDailyChallengeType() ? `<div class="mini-stats" style="margin-bottom:18px;">${dailyWinnerCardsMarkup()}</div>` : ""}${groupedLeaderboardMarkup(3, { surface: "display", tableClass: "display-board" })}</div>'''
source = replace_once(source, old_display, new_display, "display leaderboard")

styles_addition = r'''

/* Hierarchisch gruppierte Ranglisten: Disziplin -> Mann/Frau */
.leaderboard-direction-groups {
  display: grid;
  gap: 18px;
}

.leaderboard-direction-group {
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(31, 79, 70, 0.24);
  border-radius: 20px;
  background: #f7f8f5;
}

.leaderboard-direction-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 16px;
  border-bottom: 1px solid rgba(31, 79, 70, 0.18);
  background: linear-gradient(145deg, var(--primary-soft), #f5f8f6);
}

.leaderboard-direction-symbol {
  width: 42px;
  height: 34px;
  flex: 0 0 42px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(31, 79, 70, 0.18);
  border-radius: 11px;
  background: #fff;
  color: var(--primary);
  font-size: 13px;
  font-weight: 900;
  letter-spacing: -0.12em;
}

.leaderboard-direction-title {
  min-width: 0;
}

.leaderboard-direction-title small {
  display: block;
  margin-bottom: 1px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.leaderboard-direction-title h3 {
  margin: 0;
  font-size: 20px;
  letter-spacing: -0.025em;
}

.leaderboard-gender-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 12px;
}

.leaderboard-gender-card {
  min-width: 0;
  padding: 12px 14px 8px;
  border: 1px solid var(--line);
  border-radius: 15px;
  background: #fff;
}

.leaderboard-gender-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 5px;
}

.leaderboard-gender-heading h4 {
  margin: 0;
  color: var(--text);
  font-size: 16px;
}

.leaderboard-gender-heading span {
  color: var(--muted);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.grouped-leaderboard-table col.grouped-rank-column {
  width: 15%;
}

.grouped-leaderboard-table col.grouped-name-column {
  width: 55%;
}

.grouped-leaderboard-table col.grouped-result-column {
  width: 30%;
}

.grouped-leaderboard-table th,
.grouped-leaderboard-table td {
  padding-inline: 6px;
}

.leaderboard-empty-row td {
  color: var(--muted);
  font-style: italic;
  text-align: left !important;
}

.public-leaderboard-card .card-header {
  margin-bottom: 14px;
}

.live-leaderboard-card .leaderboard-direction-groups {
  gap: 10px;
}

.live-leaderboard-card .leaderboard-direction-group {
  border-radius: 15px;
}

.live-leaderboard-card .leaderboard-direction-header {
  padding: 10px 12px;
}

.live-leaderboard-card .leaderboard-direction-title h3 {
  font-size: 17px;
}

.live-leaderboard-card .leaderboard-gender-grid {
  grid-template-columns: 1fr;
  gap: 8px;
  padding: 8px;
}

.live-leaderboard-card .leaderboard-gender-card {
  padding: 9px 10px 6px;
}

.display-leaderboard-card .leaderboard-direction-groups {
  gap: 14px;
  margin-top: 16px;
}

.display-leaderboard-card .leaderboard-direction-header {
  padding-block: 11px;
}

.display-leaderboard-card .leaderboard-gender-grid {
  gap: 10px;
  padding: 10px;
}

.display-leaderboard-card .leaderboard-gender-card {
  padding: 10px 12px 6px;
}

.display-leaderboard-card .display-board td {
  font-size: 20px;
  padding: 12px 6px;
}

.guided-direction-group {
  overflow: hidden;
  border: 1px solid rgba(31, 79, 70, 0.25);
  border-radius: 16px;
  background: #f6f8f6;
}

.guided-direction-group + .guided-direction-group {
  margin-top: 10px;
}

.guided-direction-heading {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  border-bottom: 1px solid rgba(31, 79, 70, 0.16);
  background: var(--primary-soft);
  color: var(--primary);
}

.guided-direction-heading > span {
  width: 36px;
  min-width: 36px;
  height: 27px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: #fff;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: -0.12em;
}

.guided-direction-heading > strong {
  font-size: 15px;
}

.guided-direction-categories {
  display: grid;
  gap: 7px;
  padding: 8px;
}

.guided-direction-categories .guided-ranking-section {
  padding: 9px 10px 7px;
  border-radius: 11px;
  background: #fff;
}

.guided-direction-categories .guided-ranking-section + .guided-ranking-section {
  margin-top: 0 !important;
}

.guided-direction-categories .guided-ranking-section h4 {
  margin-bottom: 5px;
  color: var(--text);
  font-size: 13px;
}

@media (max-width: 760px) {
  .public-leaderboard-card .leaderboard-gender-grid,
  .display-leaderboard-card .leaderboard-gender-grid {
    grid-template-columns: 1fr;
  }

  .public-leaderboard-card {
    min-width: 0;
    padding: 16px;
    border-radius: 18px;
  }

  .leaderboard-direction-group {
    border-radius: 16px;
  }

  .leaderboard-direction-header {
    padding: 11px 12px;
  }

  .leaderboard-gender-grid {
    padding: 8px;
  }
}
'''

if "/* Hierarchisch gruppierte Ranglisten: Disziplin -> Mann/Frau */" not in styles:
    styles = styles.rstrip() + styles_addition + "\n"

main_path.write_text(source, encoding="utf-8")
styles_path.write_text(styles, encoding="utf-8")
print("Grouped leaderboard UI applied successfully.")
