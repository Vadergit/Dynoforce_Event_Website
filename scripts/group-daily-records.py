from pathlib import Path

path = Path("app/main.js")
source = path.read_text(encoding="utf-8")
start_marker = "function guidedDailyLeadersMarkup() {"
end_marker = "\nfunction getOverallWinnersByDirection()"
start = source.index(start_marker)
end = source.index(end_marker, start)

replacement = '''function guidedDailyLeadersMarkup() {
  if (state.event.showDailyLeaders === false) return "";
  const leaders = getTodayCategoryLeaders();
  const directions = [...new Set(leaders.map((leader) => leader.direction))];
  const groups = directions.map((direction) => ({
    direction,
    title: formatDirectionLabel(direction),
    leaders: leaders.filter((leader) => leader.direction === direction),
  }));

  return `
    <section class="guided-daily-leaders" aria-label="Tagesrekorde">
      <div class="guided-daily-leaders-heading">
        <strong>Tagesrekorde</strong>
        <span>Heute · ${escapeHtml(formatEventDayLabel())}</span>
      </div>
      <div class="guided-daily-direction-grid">
        ${groups.map((group) => `
          <section class="guided-direction-group guided-daily-direction-group">
            <div class="guided-direction-heading">
              <span aria-hidden="true">${guidedDirectionSymbol(group.direction)}</span>
              <strong>${escapeHtml(group.title)}</strong>
            </div>
            <div class="guided-direction-categories">
              ${group.leaders.map((leader) => `
                <section class="guided-ranking-section guided-daily-ranking-section">
                  <h4>${escapeHtml(formatGenderLabel(leader.gender))}</h4>
                  <ol class="guided-ranking-list">
                    ${leader.participantName ? `
                      <li>
                        <span class="guided-rank-number rank-1">1</span>
                        <strong>${escapeHtml(leader.participantName)}</strong>
                        <span>${Number(leader.value).toFixed(1)} kg</span>
                      </li>
                    ` : `<li class="is-empty">Noch kein Tagesrekord</li>`}
                  </ol>
                </section>
              `).join("")}
            </div>
          </section>
        `).join("")}
      </div>
    </section>
  `;
}
'''

path.write_text(source[:start] + replacement + source[end:], encoding="utf-8")
print("Grouped daily record markup applied.")
