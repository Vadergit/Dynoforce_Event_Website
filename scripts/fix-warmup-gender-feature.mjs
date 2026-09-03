import fs from "node:fs";

const path = "app/main.js";
let source = fs.readFileSync(path, "utf8");

const replacement = [
  'function guidedLeaderboardMarkup() {',
  '  return leaderboardSections(3).map((section) => `',
  '    <section class="guided-ranking-section">',
  '      <h4><span aria-hidden="true">${guidedDirectionSymbol(section.direction)}</span> ${escapeHtml(section.title)}</h4>',
  '      <ol class="guided-ranking-list">',
  '        ${section.items.length ? section.items.map((entry, index) => `',
  '          <li>',
  '            <span class="guided-rank-number rank-${index + 1}">${index + 1}</span>',
  '            <strong>${escapeHtml(entry.participantName || entry.name || "Teilnehmer")}</strong>',
  '            <span>${Number(entry.value || 0).toFixed(1)} kg</span>',
  '          </li>',
  '        `).join("") : `<li class="is-empty">Noch keine Resultate</li>`}',
  '      </ol>',
  '    </section>',
  '  `).join("");',
  '}',
].join("\n");

const regex = /function guidedLeaderboardMarkup\(\) \{[\s\S]*?\n\}\n\nfunction guidedTopThreeMessage/;
if (!regex.test(source)) throw new Error("Could not find guidedLeaderboardMarkup block to repair");
source = source.replace(regex, `${replacement}\n\nfunction guidedTopThreeMessage`);

fs.writeFileSync(path, source);
console.log("Guided leaderboard template repaired.");
