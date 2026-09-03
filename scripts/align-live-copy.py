from pathlib import Path

path = Path("app/main.js")
source = path.read_text(encoding="utf-8")
old = '<h3>Rangliste der 3 besten Teilnehmer</h3>'
new = '<h3>Rangliste · Top 3 je Kategorie</h3>'

if source.count(old) != 1:
    raise RuntimeError(f"Expected exactly one live leaderboard title, found {source.count(old)}")

path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("Live leaderboard title updated.")
