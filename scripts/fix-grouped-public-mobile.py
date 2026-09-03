from pathlib import Path

path = Path("app/main.js")
source = path.read_text(encoding="utf-8")
old = '''            <div class="grid" style="margin-top:18px;">\n              <div class="card public-leaderboard-card">'''
new = '''            <div class="public-leaderboard-area" style="margin-top:18px;">\n              <div class="card public-leaderboard-card">'''
if old not in source:
    raise RuntimeError("Public leaderboard wrapper target not found")
source = source.replace(old, new, 1)
path.write_text(source, encoding="utf-8")
print("Public grouped leaderboard mobile wrapper fixed.")
