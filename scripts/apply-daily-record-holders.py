from pathlib import Path

main_path = Path("app/main.js")
index_path = Path("index.html")
css_path = Path("app/daily-leaders.css")
source = main_path.read_text(encoding="utf-8")


def replace_once(old, new, label):
    global source
    if old not in source:
        raise RuntimeError(f"Target not found: {label}")
    source = source.replace(old, new, 1)


def replace_count(old, new, expected, label):
    global source
    count = source.count(old)
    if count != expected:
        raise RuntimeError(f"Unexpected count for {label}: {count} != {expected}")
    source = source.replace(old, new)


replace_once(
    'const USE_GUIDED_LIVE_UI = true;\n',
    'const USE_GUIDED_LIVE_UI = true;\nconst EVENT_TIME_ZONE = "Europe/Zurich";\n',
    'event timezone constant',
)

replace_count(
    '    attempts: 3,\n    scoringMode: "Bester Versuch",\n    status: "Inaktiv",',
    '    attempts: 3,\n    scoringMode: "Bester Versuch",\n    showDailyLeaders: true,\n    status: "Inaktiv",',
    2,
    'default event states',
)

replace_once(
    '      attempts: 3,\n      scoringMode: "Bester Versuch",\n      status: "Inaktiv",',
    '      attempts: 3,\n      scoringMode: "Bester Versuch",\n      showDailyLeaders: true,\n      status: "Inaktiv",',
    'new event defaults',
)

old_timestamp = '''function resultCreatedAtDate(result) {\n  const value = result?.createdAt;\n  if (!value) return null;\n  if (typeof value?.toDate === "function") return value.toDate();\n  if (value instanceof Date) return value;\n  if (typeof value === "string" || typeof value === "number") {\n    const parsed = new Date(value);\n    return Number.isNaN(parsed.getTime()) ? null : parsed;\n  }\n  return null;\n}\n\nfunction toLocalDayKey(date) {\n  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";\n  const year = date.getFullYear();\n  const month = String(date.getMonth() + 1).padStart(2, "0");\n  const day = String(date.getDate()).padStart(2, "0");\n  return `${year}-${month}-${day}`;\n}\n'''
new_timestamp = '''function timestampValueToDate(value) {\n  if (!value) return null;\n  if (typeof value?.toDate === "function") return value.toDate();\n  if (value instanceof Date) return value;\n  if (typeof value === "string" || typeof value === "number") {\n    const parsed = new Date(value);\n    return Number.isNaN(parsed.getTime()) ? null : parsed;\n  }\n  return null;\n}\n\nfunction resultCreatedAtDate(result) {\n  return timestampValueToDate(result?.createdAt);\n}\n\nfunction resultDailyBestAtDate(result) {\n  return timestampValueToDate(result?.dailyBestAt);\n}\n\nfunction toEventDayKey(date) {\n  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";\n  const parts = new Intl.DateTimeFormat("en-CA", {\n    timeZone: EVENT_TIME_ZONE,\n    year: "numeric",\n    month: "2-digit",\n    day: "2-digit",\n  }).formatToParts(date);\n  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));\n  return `${values.year}-${values.month}-${values.day}`;\n}\n\nfunction formatEventDayLabel(date = new Date()) {\n  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";\n  return new Intl.DateTimeFormat("de-CH", {\n    timeZone: EVENT_TIME_ZONE,\n    day: "2-digit",\n    month: "2-digit",\n    year: "numeric",\n  }).format(date);\n}\n'''
replace_once(old_timestamp, new_timestamp, 'timezone-safe day helper')

old_today = '''function getTodayWinnersByDirection() {\n  const todayKey = toLocalDayKey(new Date());\n  const todaysResults = state.results.filter((entry) => toLocalDayKey(resultCreatedAtDate(entry)) === todayKey);\n  return {\n    all: todaysResults[0] || null,\n    pull: todaysResults.find((entry) => resultDirectionKey(entry) === "pull") || null,\n    push: todaysResults.find((entry) => resultDirectionKey(entry) === "push") || null,\n  };\n}\n'''
new_today = '''function getTodayResultValue(entry, todayKey = toEventDayKey(new Date())) {\n  const dailyBestAt = resultDailyBestAtDate(entry);\n  const dailyBestValue = Number(entry?.dailyBestValue);\n  if (dailyBestAt && toEventDayKey(dailyBestAt) === todayKey && Number.isFinite(dailyBestValue)) {\n    return dailyBestValue;\n  }\n  if (!dailyBestAt && entry?.dailyBestDay === todayKey && Number.isFinite(dailyBestValue)) {\n    return dailyBestValue;\n  }\n  const createdAt = resultCreatedAtDate(entry);\n  if (createdAt && toEventDayKey(createdAt) === todayKey) {\n    return Number(entry.value || 0);\n  }\n  return null;\n}\n\nfunction getTodayResults() {\n  const todayKey = toEventDayKey(new Date());\n  return state.results\n    .map((entry) => ({ entry, todayValue: getTodayResultValue(entry, todayKey) }))\n    .filter(({ todayValue }) => Number.isFinite(todayValue) && todayValue >= 0)\n    .sort((a, b) => b.todayValue - a.todayValue);\n}\n\nfunction getTodayWinnersByDirection() {\n  const todaysResults = getTodayResults();\n  const asTodayEntry = (item) => item ? { ...item.entry, value: item.todayValue } : null;\n  return {\n    all: asTodayEntry(todaysResults[0]),\n    pull: asTodayEntry(todaysResults.find(({ entry }) => resultDirectionKey(entry) === "pull")),\n    push: asTodayEntry(todaysResults.find(({ entry }) => resultDirectionKey(entry) === "push")),\n  };\n}\n\nfunction getTodayCategoryLeaders() {\n  const mode = normalizeForceMode(state.event.forceMode);\n  const directions = mode === "Beide"\n    ? [{ key: "pull", label: "Ziehen" }, { key: "push", label: "Drücken" }]\n    : mode === "Ziehen"\n      ? [{ key: "pull", label: "Ziehen" }]\n      : [{ key: "push", label: "Drücken" }];\n  const genders = [{ key: "male", label: "Mann" }, { key: "female", label: "Frau" }];\n  const todaysResults = getTodayResults();\n\n  return directions.flatMap((direction) => genders.map((gender) => {\n    const leader = todaysResults.find(({ entry }) =>\n      resultDirectionKey(entry) === direction.key && resultGenderKey(entry) === gender.key);\n    return {\n      key: `${direction.key}-${gender.key}`,\n      direction: direction.key,\n      gender: gender.key,\n      label: `${gender.label} · ${direction.label}`,\n      participantName: leader?.entry?.participantName || leader?.entry?.name || "",\n      value: leader?.todayValue ?? null,\n    };\n  }));\n}\n\nfunction guidedDailyLeadersMarkup() {\n  if (state.event.showDailyLeaders === false) return "";\n  const leaders = getTodayCategoryLeaders();\n  return `\n    <section class="guided-daily-leaders" aria-label="Heutige Rekordhalter">\n      <div class="guided-daily-leaders-heading">\n        <strong>Heutige Rekordhalter</strong>\n        <span>${escapeHtml(formatEventDayLabel())} · nur heute</span>\n      </div>\n      <div class="guided-daily-leaders-grid">\n        ${leaders.map((leader) => `\n          <div class="guided-daily-leader-card">\n            <small>${escapeHtml(leader.label)}</small>\n            <strong>${leader.participantName ? escapeHtml(leader.participantName) : "Noch offen"}</strong>\n            <span>${leader.value === null ? "Noch kein Resultat" : `${Number(leader.value).toFixed(1)} kg`}</span>\n          </div>\n        `).join("")}\n      </div>\n    </section>\n  `;\n}\n'''
replace_once(old_today, new_today, 'correct today leaderboard helpers')

replace_once(
    '      <div class="guided-safety-box"><strong>! &nbsp; Sicher testen</strong><span>Überschätze dich nicht und gib unaufgewärmt keine maximale Kraft. Bei Schmerzen sofort stoppen.</span></div>\n    </div>',
    '      <div class="guided-safety-box"><strong>! &nbsp; Sicher testen</strong><span>Überschätze dich nicht und gib unaufgewärmt keine maximale Kraft. Bei Schmerzen sofort stoppen.</span></div>\n      ${guidedDailyLeadersMarkup()}\n    </div>',
    'daily leaders on guided start screen',
)

replace_once(
    '    attempts: Number(data.attempts || 3),\n    scoringMode: data.scoringMode || "Bester Versuch",\n    status: normalizeEventStatus(data.status),',
    '    attempts: Number(data.attempts || 3),\n    scoringMode: data.scoringMode || "Bester Versuch",\n    showDailyLeaders: data.showDailyLeaders !== false,\n    status: normalizeEventStatus(data.status),',
    'event hydration setting',
)

replace_once(
    '      attempts: state.event.attempts,\n      scoringMode: state.event.scoringMode,\n      status: state.event.status,',
    '      attempts: state.event.attempts,\n      scoringMode: state.event.scoringMode,\n      showDailyLeaders: state.event.showDailyLeaders !== false,\n      status: state.event.status,',
    'event payload setting',
)

setup_old = '''                  <div class="field"><label>Wertung</label><select id="scoringModeInput"><option ${state.event.scoringMode === "Bester Versuch" ? "selected" : ""}>Bester Versuch</option><option ${state.event.scoringMode === "Durchschnitt" ? "selected" : ""}>Durchschnitt</option><option ${state.event.scoringMode === "Letzter Versuch" ? "selected" : ""}>Letzter Versuch</option></select></div>\n                </div>\n                <div class="action-row"><button class="button primary" id="saveSetup">'''
setup_new = '''                  <div class="field"><label>Wertung</label><select id="scoringModeInput"><option ${state.event.scoringMode === "Bester Versuch" ? "selected" : ""}>Bester Versuch</option><option ${state.event.scoringMode === "Durchschnitt" ? "selected" : ""}>Durchschnitt</option><option ${state.event.scoringMode === "Letzter Versuch" ? "selected" : ""}>Letzter Versuch</option></select></div>\n                </div>\n                <label class="setup-feature-toggle">\n                  <input type="checkbox" id="showDailyLeadersInput" ${state.event.showDailyLeaders === false ? "" : "checked"} />\n                  <span><strong>Heutige Rekordhalter anzeigen</strong><small>Zeigt in der Live-Mitte ausschliesslich die besten Resultate des heutigen Tages, getrennt nach Mann/Frau und Ziehen/Drücken.</small></span>\n                </label>\n                <div class="action-row"><button class="button primary" id="saveSetup">'''
replace_once(setup_old, setup_new, 'setup toggle')

replace_once(
    '    state.event.scoringMode = root.querySelector("#scoringModeInput").value;\n    state.event.ownerUid = state.user?.uid || state.event.ownerUid;',
    '    state.event.scoringMode = root.querySelector("#scoringModeInput").value;\n    state.event.showDailyLeaders = root.querySelector("#showDailyLeadersInput")?.checked !== false;\n    state.event.ownerUid = state.user?.uid || state.event.ownerUid;',
    'setup toggle binding',
)

payload_old = '''      const leaderboardValue = Math.max(group.finalValue, Number(existingResult?.value || 0));\n      const resultPayload = {\n        eventId: state.event.id,\n        ownerUid: state.user.uid,\n        firstName,\n        lastName,\n        participantName,\n        gender,\n        value: group.finalValue,\n        unit: "kg",\n        forceMode: group.direction,\n        attemptNumber: group.attempts.length,\n        attemptsCompleted: group.attempts.length,\n        attemptsValues: group.attempts.map((attempt) => Number(attempt.value.toFixed(1))),\n        scoringMode: "Bester Versuch",\n      };'''
payload_new = '''      const leaderboardValue = Math.max(group.finalValue, Number(existingResult?.value || 0));\n      const todayKey = toEventDayKey(new Date());\n      const previousDailyAt = resultDailyBestAtDate(existingResult);\n      const previousDailyDay = previousDailyAt ? toEventDayKey(previousDailyAt) : String(existingResult?.dailyBestDay || "");\n      const previousDailyValue = previousDailyDay === todayKey ? Number(existingResult?.dailyBestValue || 0) : 0;\n      const dailyBestValue = Math.max(group.finalValue, previousDailyValue);\n      const resultPayload = {\n        eventId: state.event.id,\n        ownerUid: state.user.uid,\n        firstName,\n        lastName,\n        participantName,\n        gender,\n        value: group.finalValue,\n        unit: "kg",\n        forceMode: group.direction,\n        attemptNumber: group.attempts.length,\n        attemptsCompleted: group.attempts.length,\n        attemptsValues: group.attempts.map((attempt) => Number(attempt.value.toFixed(1))),\n        scoringMode: "Bester Versuch",\n        dailyBestDay: todayKey,\n        dailyBestValue,\n        dailyBestAt: serverTimestamp(),\n      };'''
replace_once(payload_old, payload_new, 'daily result payload')

replace_once(
    '''        nextResults.push({\n          id: resultRef.id,\n          ...createdPayload,\n          createdAt: new Date(),\n        });''',
    '''        nextResults.push({\n          id: resultRef.id,\n          ...createdPayload,\n          createdAt: new Date(),\n          dailyBestAt: new Date(),\n        });''',
    'new result optimistic daily timestamp',
)

update_old = '''      } else if (group.finalValue > Number(existingResult.value || 0)) {\n        const updatedPayload = {\n          ...resultPayload,\n          createdAt: existingResult.createdAt || serverTimestamp(),\n          updatedAt: serverTimestamp(),\n          previousBestValue: Number(existingResult.value || 0),\n        };\n        batch.update(doc(db, "results", existingResult.id), updatedPayload);\n        pendingWrites += 1;\n        nextResults = nextResults.map((entry) => (entry.id === existingResult.id\n          ? {\n            ...entry,\n            ...resultPayload,\n            updatedAt: new Date(),\n            previousBestValue: Number(existingResult.value || 0),\n          }\n          : entry));\n      }'''
update_new = '''      } else {\n        const previousBestValue = Number(existingResult.value || 0);\n        const improvedOverallBest = group.finalValue > previousBestValue;\n        const updatedPayload = {\n          ...resultPayload,\n          value: leaderboardValue,\n          createdAt: existingResult.createdAt || serverTimestamp(),\n          updatedAt: serverTimestamp(),\n          ...(improvedOverallBest ? { previousBestValue } : {}),\n        };\n        batch.update(doc(db, "results", existingResult.id), updatedPayload);\n        pendingWrites += 1;\n        nextResults = nextResults.map((entry) => (entry.id === existingResult.id\n          ? {\n            ...entry,\n            ...resultPayload,\n            value: leaderboardValue,\n            dailyBestAt: new Date(),\n            updatedAt: new Date(),\n            ...(improvedOverallBest ? { previousBestValue } : {}),\n          }\n          : entry));\n      }'''
replace_once(update_old, update_new, 'always persist daily best for existing participants')

main_path.write_text(source, encoding="utf-8")

index = index_path.read_text(encoding="utf-8")
index_old = '  <link rel="stylesheet" href="/app/live-spacing.css" />\n'
index_new = '  <link rel="stylesheet" href="/app/live-spacing.css" />\n  <link rel="stylesheet" href="/app/daily-leaders.css" />\n'
if index_old not in index:
    raise RuntimeError("Index stylesheet target not found")
index_path.write_text(index.replace(index_old, index_new, 1), encoding="utf-8")

css_path.write_text('''/* Optionale Tages-Rekordhalter in der geführten Live-Ansicht. */\n.setup-feature-toggle {\n  margin-top: 14px;\n  display: flex;\n  align-items: flex-start;\n  gap: 12px;\n  padding: 13px 14px;\n  border: 1px solid rgba(31, 79, 70, 0.2);\n  border-radius: 14px;\n  background: var(--primary-soft);\n  cursor: pointer;\n}\n\n.setup-feature-toggle input {\n  width: 20px;\n  height: 20px;\n  margin: 2px 0 0;\n  flex: 0 0 auto;\n  accent-color: var(--primary);\n}\n\n.setup-feature-toggle span,\n.setup-feature-toggle strong,\n.setup-feature-toggle small {\n  display: block;\n}\n\n.setup-feature-toggle strong {\n  color: var(--text);\n  font-size: 14px;\n}\n\n.setup-feature-toggle small {\n  margin-top: 3px;\n  color: var(--muted);\n  font-size: 12px;\n  line-height: 1.35;\n}\n\n.guided-daily-leaders {\n  margin-top: 12px;\n  padding-top: 10px;\n  border-top: 1px solid rgba(31, 79, 70, 0.16);\n}\n\n.guided-daily-leaders-heading {\n  display: flex;\n  align-items: baseline;\n  justify-content: space-between;\n  gap: 10px;\n  margin-bottom: 7px;\n}\n\n.guided-daily-leaders-heading strong {\n  font-size: 13px;\n  letter-spacing: -0.01em;\n}\n\n.guided-daily-leaders-heading span {\n  color: var(--muted);\n  font-size: 10px;\n  font-weight: 700;\n  white-space: nowrap;\n}\n\n.guided-daily-leaders-grid {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 6px;\n}\n\n.guided-daily-leader-card {\n  min-width: 0;\n  padding: 8px 7px;\n  border: 1px solid var(--line);\n  border-radius: 11px;\n  background: #f8f8f5;\n}\n\n.guided-daily-leader-card small,\n.guided-daily-leader-card strong,\n.guided-daily-leader-card span {\n  display: block;\n  min-width: 0;\n}\n\n.guided-daily-leader-card small {\n  color: var(--muted);\n  font-size: 9px;\n  font-weight: 800;\n  text-transform: uppercase;\n  letter-spacing: 0.04em;\n  white-space: nowrap;\n}\n\n.guided-daily-leader-card strong {\n  margin-top: 3px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 12px;\n}\n\n.guided-daily-leader-card span {\n  margin-top: 2px;\n  color: var(--primary);\n  font-size: 12px;\n  font-weight: 900;\n}\n\n@media (max-width: 700px) {\n  .guided-daily-leaders-grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n\n  .guided-daily-leaders-heading {\n    align-items: flex-start;\n    flex-direction: column;\n    gap: 2px;\n  }\n}\n''', encoding="utf-8")

print("Daily record holder feature applied.")
