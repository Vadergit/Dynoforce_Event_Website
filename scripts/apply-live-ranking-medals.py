from pathlib import Path

path = Path("app/main.js")
source = path.read_text(encoding="utf-8")

replacements = [
    (
        '<span class="guided-rank-number rank-1">1</span>',
        '<span class="guided-rank-number rank-1">${medalForRank(0)}</span>',
    ),
    (
        '<span class="guided-rank-number rank-${index + 1}">${index + 1}</span>',
        '<span class="guided-rank-number rank-${index + 1}">${medalForRank(index)}</span>',
    ),
]

for old, new in replacements:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match for {old!r}, found {count}")
    source = source.replace(old, new, 1)

path.write_text(source, encoding="utf-8")
print("Live ranking medals applied.")
