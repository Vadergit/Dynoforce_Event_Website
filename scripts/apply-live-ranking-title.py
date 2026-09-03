from pathlib import Path

# Applies the compact heading requested for the guided live leaderboard.
path = Path("app/main.js")
source = path.read_text(encoding="utf-8")
old = '''      <aside class="card guided-leaderboard-column">\n        <h3>Rangliste der Teilnehmer</h3>\n        <p>Top 3 · getrennt nach Mann/Frau${normalizeForceMode(state.event.forceMode) === "Beide" ? " sowie Ziehen/Drücken" : ""}</p>\n        ${guidedLeaderboardMarkup()}\n      </aside>'''
new = '''      <aside class="card guided-leaderboard-column">\n        <h3>Rangliste der 3 besten Teilnehmer</h3>\n        ${guidedLeaderboardMarkup()}\n      </aside>'''
if old not in source:
    raise RuntimeError("Guided leaderboard heading target not found")
source = source.replace(old, new, 1)
path.write_text(source, encoding="utf-8")
print("Updated guided leaderboard title and removed subtitle.")
