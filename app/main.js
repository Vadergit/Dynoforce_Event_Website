import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getBlob, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "./firebase.js";

const BLE = {
  serviceUuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  stateCharacteristicUuid: "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
  commandCharacteristicUuid: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
  infoCharacteristicUuid: "6e400004-b5a3-f393-e0a9-e50e24dcca9e",
  cmdTare: 0x01,
  cmdResetPeak: 0x09,
};

const BLE_STORAGE_KEYS = {
  preferredDeviceId: "dynoforce.event.preferredBleDeviceId",
};

const EVENT_STORAGE_KEYS = {
  activeEventId: "dynoforce.event.activeEventId",
};

const FORCE_DIRECTION_THRESHOLD = 0.5;
const MODE_LOCK_THRESHOLD = 1.0;
const PEAK_MINIMUM_THRESHOLD = 2.0;
const ATTEMPT_START_THRESHOLD = 2.0;
const ATTEMPT_END_THRESHOLD = 2.0;

const emptyBranding = {
  eventLogo: "",
  venueLogo: "",
  headerBanner: "",
  sponsorBanner: "",
  showVenueLogo: true,
  eventLogoScale: 100,
  venueLogoScale: 100,
  headerBannerScale: 100,
  headerBannerThumbScale: 100,
  sponsorBannerScale: 100,
  eventLogoAspect: "1 / 1",
  venueLogoAspect: "1 / 1",
  headerBannerAspect: "4 / 1",
  sponsorBannerAspect: "5 / 1",
  eventLogoPdfData: "",
  venueLogoPdfData: "",
  headerBannerPdfData: "",
  sponsorBannerPdfData: "",
};

const state = {
  user: null,
  authLoading: true,
  connected: false,
  connecting: false,
  battery: 0,
  signal: "Nicht verbunden",
  currentAttempt: 1,
  currentForce: 0,
  signedForce: 0,
  peak: 0,
  rawPeak: 0,
  forceDirection: "neutral",
  peakDirection: "neutral",
  lockedMode: null,
  isInAttempt: false,
  previousForce: 0,
  wentBelowThreshold: false,
  elapsedSeconds: 0,
  flashMessage: "",
  flashType: "info",
  lastError: "",
  deviceInfo: null,
  saving: false,
  uploading: "",
  liveEntry: {
    firstName: "",
    lastName: "",
    attempts: [],
  },
  dashboardLoaded: false,
  publicEventsLoaded: false,
  eventLoaded: false,
  resultsLoaded: false,
  loadingEventId: "",
  currentPage: "dashboard",
  escapeListenerBound: false,
  resultRefreshInFlight: {},
  resultRefreshCompleted: {},
  unsubscribers: {
    auth: null,
    dashboard: null,
    publicEvents: null,
    event: null,
    results: null,
  },
  ble: {
    device: null,
    server: null,
    stateCharacteristic: null,
    commandCharacteristic: null,
    infoCharacteristic: null,
    reconnectTimer: null,
    autoReconnectEnabled: true,
    reconnectAttempted: false,
  },
  event: {
    id: "",
    name: "DynoForce Event",
    description: "",
    organiser: "Veranstalter",
    organiserEmail: "",
    location: "",
    date: "",
    challengeType: "Maximalkraft",
    forceMode: "Beide",
    gripType: "Standard",
    attempts: 3,
    scoringMode: "Bester Versuch",
    status: "Inaktiv",
    primaryColor: "#1f4f46",
    ownerUid: "",
    participantCount: 0,
    createdAt: null,
    closedAt: null,
    ...emptyBranding,
  },
  events: [],
  publicEvents: [],
  resultCache: {},
  results: [],
};

const root = document.getElementById("app");

const pageMeta = {
  dashboard: ["Dashboard", "Alle eigenen Events auf einen Blick mit Status, Teilnehmerzahl und Schnellzugriff."],
  setup: ["Event Setup", "Eventname, Challenge, Wertung und Ablauf in wenigen Schritten konfigurieren."],
  branding: ["Branding", "Hallenlogo, Sponsor Banner und Primärfarbe professionell integrieren."],
  live: ["Live-Messseite", "Zentrale Arbeitsseite für den Organisator mit Gerät, Teilnehmer, Messwert und Top 10."],
  public: ["Öffentliche Eventseite", "Live Leaderboard, Statistik, QR-Code und Druckansicht für Teilnehmer und Zuschauer."],
  display: ["Display-Modus", "Optimiert für Beamer, TV und Grossbildschirm mit permanent sichtbarem QR-Code."],
};

const APP_BASE = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
let attemptDetectionTimer = null;
let brandingScaleSaveTimer = null;

function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "event";
}

function formatDate(dateValue) {
  if (!dateValue) return "—";
  if (typeof dateValue?.toDate === "function") {
    return formatDate(dateValue.toDate());
  }
  if (dateValue instanceof Date) {
    if (Number.isNaN(dateValue.getTime())) return "—";
    const day = String(dateValue.getDate()).padStart(2, "0");
    const month = String(dateValue.getMonth() + 1).padStart(2, "0");
    const year = dateValue.getFullYear();
    return `${day}.${month}.${year}`;
  }
  const dateString = String(dateValue);
  const [year, month, day] = dateString.split("-");
  if (!year || !month || !day) return dateString;
  return `${day}.${month}.${year}`;
}

function formatLongDate(dateString) {
  return formatDate(dateString);
}

function averageValue() {
  if (!state.results.length) return 0;
  return state.results.reduce((sum, item) => sum + item.value, 0) / state.results.length;
}

function sortResults(results) {
  return [...results].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
}

function setResults(results, { loaded = true, eventId = state.event.id, cache = true } = {}) {
  const sortedResults = sortResults(results);
  state.results = sortedResults;
  state.resultsLoaded = loaded;
  if (cache && eventId) {
    state.resultCache[eventId] = sortedResults;
  }
}

function hydrateResultsFromCache(eventId = state.event.id) {
  const cachedResults = eventId ? state.resultCache[eventId] : null;
  if (!state.results.length && cachedResults?.length) {
    state.results = [...cachedResults];
    state.resultsLoaded = true;
    return true;
  }
  return false;
}

async function refreshResultsForEvent(eventId, { force = false } = {}) {
  if (!eventId) return;
  if (!force && state.resultRefreshInFlight[eventId]) return;
  if (!force && state.resultRefreshCompleted[eventId] && state.results.length) return;

  state.resultRefreshInFlight[eventId] = true;
  try {
    const resultsSnapshot = await getDocs(query(collection(db, "results"), where("eventId", "==", eventId)));
    const results = resultsSnapshot.docs.map((resultDoc) => ({
      id: resultDoc.id,
      ...resultDoc.data(),
    }));
    state.resultRefreshCompleted[eventId] = true;
    if (state.event.id === eventId || state.loadingEventId === eventId) {
      setResults(results, { eventId });
      if (Number(state.event.participantCount || 0) !== results.length) {
        state.event.participantCount = results.length;
      }
      render();
    }
  } catch (error) {
    if (state.event.id === eventId || state.loadingEventId === eventId) {
      setError(`Resultate konnten nicht direkt geladen werden: ${error instanceof Error ? error.message : String(error)}`);
      render();
    }
  } finally {
    state.resultRefreshInFlight[eventId] = false;
  }
}

function ensureOrganizerResults() {
  const isOrganizerPage = state.user && (state.currentPage === "live" || state.currentPage === "setup");
  if (!isOrganizerPage || !state.event.id || state.results.length) return;
  if (hydrateResultsFromCache(state.event.id)) return;
  void refreshResultsForEvent(state.event.id);
}

function getParticipantCountLabel() {
  if (state.results.length > 0) return String(state.results.length);
  if (Number.isFinite(Number(state.event.participantCount))) return String(Number(state.event.participantCount || 0));
  return "0";
}

function getBestResultLabel() {
  return `${Number(state.results[0]?.value || 0).toFixed(1)} kg`;
}

function getAverageLabel() {
  return `${averageValue().toFixed(1)} kg`;
}

function isDailyChallengeType(value = state.event.challengeType) {
  return value === "Tageschallenge" || value === "Freie Challenge";
}

function normalizeEventStatus(status) {
  if (status === "Live") return "Aktiv";
  if (status === "Geplant" || status === "Archiviert") return "Inaktiv";
  return status || "Inaktiv";
}

function isActiveEventStatus(status) {
  return normalizeEventStatus(status) === "Aktiv";
}

function resultCreatedAtDate(result) {
  const value = result?.createdAt;
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toLocalDayKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resultDirectionKey(result) {
  const direction = result?.forceMode || result?.direction || "neutral";
  if (direction === "pull" || direction === "push") return direction;
  return "neutral";
}

function getResultsForDirection(direction = "all") {
  if (direction === "all") return [...state.results];
  return state.results.filter((entry) => resultDirectionKey(entry) === direction);
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

function normalizeForceMode(value) {
  if (value === "Ziehen" || value === "pull") return "Ziehen";
  if (value === "Drücken" || value === "push") return "Drücken";
  return "Beide";
}

function directionFromSignedForce(force) {
  if (force > FORCE_DIRECTION_THRESHOLD) return "pull";
  if (force < -FORCE_DIRECTION_THRESHOLD) return "push";
  return "neutral";
}

function isDirectionAllowed(direction) {
  const mode = normalizeForceMode(state.event.forceMode);
  if (mode === "Beide") return direction === "pull" || direction === "push";
  if (mode === "Ziehen") return direction === "pull";
  if (mode === "Drücken") return direction === "push";
  return false;
}

function readLiveParticipantInputs() {
  const firstNameInput = document.getElementById("participantFirstNameInput");
  const lastNameInput = document.getElementById("participantLastNameInput");
  const firstName = String(firstNameInput?.value ?? state.liveEntry.firstName ?? "").trim();
  const lastName = String(lastNameInput?.value ?? state.liveEntry.lastName ?? "").trim();
  return { firstName, lastName, participantName: [firstName, lastName].filter(Boolean).join(" ").trim() };
}

function syncLiveEntryFromInputs() {
  const { firstName, lastName } = readLiveParticipantInputs();
  state.liveEntry.firstName = firstName;
  state.liveEntry.lastName = lastName;
}

function getLiveParticipantDisplayName() {
  syncLiveEntryFromInputs();
  return [state.liveEntry.firstName, state.liveEntry.lastName].filter(Boolean).join(" ");
}

function getParticipantNameParts() {
  syncLiveEntryFromInputs();
  return {
    firstName: state.liveEntry.firstName,
    lastName: state.liveEntry.lastName,
    participantName: [state.liveEntry.firstName, state.liveEntry.lastName].filter(Boolean).join(" ").trim(),
  };
}

function getCompletedAttemptsCount() {
  return Math.min(state.liveEntry.attempts?.length || 0, state.event.attempts || 0);
}

function getDisplayForceValue() {
  return state.currentForce < 0.2 ? 0 : state.currentForce;
}

function getMeasuredValue() {
  const peakValue = Number(state.peak.toFixed(1));
  const currentValue = Number(getDisplayForceValue().toFixed(1));

  if (state.event.challengeType === "Maximalkraft") {
    return peakValue >= PEAK_MINIMUM_THRESHOLD ? peakValue : 0;
  }

  return Math.max(0, currentValue || peakValue || 0);
}

function getSelectedForceModeKey() {
  const mode = normalizeForceMode(state.event.forceMode);
  if (mode === "Ziehen") return "pull";
  if (mode === "Drücken") return "push";
  return "both";
}

function medalForRank(index) {
  if (index === 0) return "🏆";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return String(index + 1);
}

function formatDirectionLabel(direction) {
  if (direction === "pull") return "Ziehen";
  if (direction === "push") return "Drücken";
  return "Neutral";
}

function getEventDisplayName() {
  return (state.event.name || "").trim() || "DynoForce Event";
}

function getEventSummaryLine() {
  return [formatDate(state.event.date), state.event.location, state.event.challengeType]
    .filter(Boolean)
    .join(" · ");
}

function getDashboardMeta() {
  if (state.user) return pageMeta.dashboard;
  return [
    "DynoForce Event",
    "Aktuelle Events entdecken und als Organisator nach dem Login eigene Veranstaltungen verwalten.",
  ];
}

function resultEditorMarkup() {
  return `
    <div class="card" style="margin-top:18px;">
      <div class="card-header"><div><h3>Resultate bearbeiten</h3><p>${state.results.length ? "Namen, Resultatwerte und einzelne Einträge direkt korrigieren." : state.resultsLoaded ? "Sobald Resultate vorhanden sind, können sie hier korrigiert oder entfernt werden." : "Resultate werden mit Firestore synchronisiert."}</p></div></div>
      <div class="event-list moderation-list">
        ${state.results.map((entry) => {
          const nameParts = getEditableResultNameParts(entry);
          return `
            <div class="event-item moderation-item">
              <div class="moderation-fields">
                <div class="field"><label>Vorname</label><input data-result-first-name="${entry.id}" value="${escapeHtml(nameParts.firstName)}" /></div>
                <div class="field"><label>Name</label><input data-result-last-name="${entry.id}" value="${escapeHtml(nameParts.lastName)}" /></div>
                <div class="field"><label>Resultat in kg</label><input data-result-value="${entry.id}" type="number" min="0" step="0.1" value="${Number(entry.value || 0).toFixed(1)}" /></div>
              </div>
              <div class="event-item-actions">
                <div class="metric-stack">
                  <strong>${Number(entry.value || 0).toFixed(1)} kg</strong>
                  <span>${escapeHtml(formatEntryDirection(entry))} · ${escapeHtml(formatDate(resultCreatedAtDate(entry)) || "ohne Datum")}</span>
                </div>
                <div class="action-row compact">
                  <button class="button" data-update-result="${entry.id}">Änderungen speichern</button>
                  <button class="button danger" data-delete-result="${entry.id}">Resultat entfernen</button>
                </div>
              </div>
            </div>
          `;
        }).join("") || `<div class="event-item"><div><h4>Noch keine Resultate</h4><p>Sobald Teilnehmer gespeichert werden, können sie hier korrigiert oder entfernt werden.</p></div></div>`}
      </div>
    </div>
  `;
}

function organizerEventPickerMarkup(page) {
  return "";
}

function formatEntryDirection(entry) {
  return formatDirectionLabel(entry.forceMode || entry.direction || "neutral");
}

function getLivePlacement() {
  const measuredValue = getMeasuredValue();
  if (measuredValue < PEAK_MINIMUM_THRESHOLD) return "—";
  const betterResults = state.results.filter((entry) => Number(entry.value || 0) > measuredValue).length;
  return `#${betterResults + 1}`;
}

function getFinalAttemptValue(attempts) {
  if (!attempts.length) return 0;
  if (state.event.scoringMode === "Durchschnitt") {
    return attempts.reduce((sum, attempt) => sum + attempt.value, 0) / attempts.length;
  }
  if (state.event.scoringMode === "Letzter Versuch") {
    return attempts[attempts.length - 1].value;
  }
  return Math.max(...attempts.map((attempt) => attempt.value));
}

function resetLiveEntryState() {
  state.liveEntry.firstName = "";
  state.liveEntry.lastName = "";
  state.liveEntry.attempts = [];
  state.currentAttempt = 1;
  state.currentForce = 0;
  state.signedForce = 0;
  state.peak = 0;
  state.rawPeak = 0;
  state.peakDirection = "neutral";
  state.forceDirection = "neutral";
  state.lockedMode = null;
  state.isInAttempt = false;
  state.previousForce = 0;
  state.wentBelowThreshold = false;
  state.elapsedSeconds = 0;

  const firstNameInput = document.getElementById("participantFirstNameInput");
  const lastNameInput = document.getElementById("participantLastNameInput");
  if (firstNameInput) firstNameInput.value = "";
  if (lastNameInput) lastNameInput.value = "";
}

async function ensureEventWritable() {
  await setDoc(
    doc(db, "events", state.event.id),
    {
      ownerUid: state.user.uid,
      updatedAt: serverTimestamp(),
      participantCount: state.results.length,
    },
    { merge: true },
  );
}

async function syncEventParticipantCount(participantCount = state.results.length) {
  await setDoc(
    doc(db, "events", state.event.id),
    {
      ownerUid: state.user?.uid || state.event.ownerUid,
      participantCount,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

function getEditableResultNameParts(entry) {
  const firstName = (entry.firstName || "").trim();
  const lastName = (entry.lastName || "").trim();
  if (firstName || lastName) {
    return { firstName, lastName };
  }
  const combined = String(entry.participantName || "").trim();
  if (!combined) return { firstName: "", lastName: "" };
  const parts = combined.split(/\s+/);
  return {
    firstName: parts.shift() || "",
    lastName: parts.join(" "),
  };
}

async function updateResultEntry(resultId, firstName, lastName, value) {
  const cleanFirstName = firstName.trim();
  const cleanLastName = lastName.trim();
  if (!cleanFirstName || !cleanLastName) {
    setError("Vorname und Name müssen beide ausgefüllt sein.");
    render();
    return;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    setError("Der Resultatwert muss eine gültige positive Zahl sein.");
    render();
    return;
  }

  const participantName = `${cleanFirstName} ${cleanLastName}`.trim();
  try {
    await updateDoc(doc(db, "results", resultId), {
      ownerUid: state.user?.uid || state.event.ownerUid || "",
      eventId: state.event.id,
      firstName: cleanFirstName,
      lastName: cleanLastName,
      participantName,
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
            value: Number(numericValue.toFixed(1)),
            updatedAt: new Date(),
          }
        : entry)),
    );
    clearError();
    setFlash(`Resultat aktualisiert: ${participantName} · ${numericValue.toFixed(1)} kg`);
    render();
  } catch (error) {
    setError(`Resultat konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`);
    render();
  }
}

async function deleteResultEntry(resultId) {
  const previousResults = [...state.results];
  const previousParticipantCount = Number(state.event.participantCount || state.results.length);
  try {
    setResults(state.results.filter((entry) => entry.id !== resultId));
    state.event.participantCount = state.results.length;
    await deleteDoc(doc(db, "results", resultId));
    await syncEventParticipantCount(state.results.length);
    clearError();
    setFlash("Resultat wurde aus der Rangliste entfernt.");
    render();
  } catch (error) {
    setResults(previousResults);
    state.event.participantCount = previousParticipantCount;
    setError(`Resultat konnte nicht gelöscht werden: ${error instanceof Error ? error.message : String(error)}`);
    render();
  }
}

async function deleteEventWithResults(eventId) {
  try {
    const resultsSnapshot = await getDocs(query(collection(db, "results"), where("eventId", "==", eventId)));
    await Promise.all(resultsSnapshot.docs.map((resultDoc) => deleteDoc(resultDoc.ref)));
    await deleteDoc(doc(db, "events", eventId));

    if (state.event.id === eventId) {
      setResults([]);
      resetLiveEntryState();
    }

    clearError();
    setFlash("Event und zugehörige Resultate wurden gelöscht.");
    syncUrl("dashboard");
    await routeAndLoad();
  } catch (error) {
    setError(`Event konnte nicht gelöscht werden: ${error instanceof Error ? error.message : String(error)}`);
    render();
  }
}

async function updateEventStatus(eventId, status) {
  try {
    const nextStatus = normalizeEventStatus(status);
    const payload = {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    };

    if (nextStatus === "Abgeschlossen") {
      payload.closedAt = serverTimestamp();
    } else {
      payload.closedAt = null;
    }

    await setDoc(doc(db, "events", eventId), payload, { merge: true });

    if (state.event.id === eventId) {
      state.event.status = nextStatus;
      state.event.closedAt = nextStatus === "Abgeschlossen" ? new Date().toISOString() : null;
    }

    clearError();
    setFlash(`Eventstatus aktualisiert: ${nextStatus}`);
    render();
  } catch (error) {
    setError(`Eventstatus konnte nicht geändert werden: ${error instanceof Error ? error.message : String(error)}`);
    render();
  }
}

async function primeEventState(eventId) {
  if (!eventId) return;
  try {
    const [eventSnapshot, resultsSnapshot] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(query(collection(db, "results"), where("eventId", "==", eventId))),
    ]);

    if (state.loadingEventId !== eventId) return;

    if (eventSnapshot.exists()) {
      state.event = eventDocToState(eventSnapshot.id, eventSnapshot.data());
      setResults(resultsSnapshot.docs.map((resultDoc) => ({
        id: resultDoc.id,
        ...resultDoc.data(),
      })), { eventId });
      state.eventLoaded = true;
      state.loadingEventId = eventId;
      rememberActiveEventId(eventId);
      if (state.user && Number(state.event.participantCount || 0) !== state.results.length) {
        state.event.participantCount = state.results.length;
        void syncEventParticipantCount(state.results.length);
      }
      render();
    }
  } catch (error) {
    setError(`Event konnte nicht vorbereitet werden: ${error instanceof Error ? error.message : String(error)}`);
    render();
  }
}

async function loadEventState(eventId) {
  if (!eventId) return false;
  const [eventSnapshot, resultsSnapshot] = await Promise.all([
    getDoc(doc(db, "events", eventId)),
    getDocs(query(collection(db, "results"), where("eventId", "==", eventId))),
  ]);

  if (state.loadingEventId !== eventId) return false;

  if (!eventSnapshot.exists()) {
    setError(`Event ${eventId} wurde nicht gefunden.`);
    state.eventLoaded = true;
    setResults([], { loaded: true, eventId, cache: false });
    return false;
  }

  state.event = eventDocToState(eventSnapshot.id, eventSnapshot.data());
  setResults(resultsSnapshot.docs.map((resultDoc) => ({
    id: resultDoc.id,
    ...resultDoc.data(),
  })), { eventId });
  state.eventLoaded = true;
  state.loadingEventId = eventId;
  rememberActiveEventId(eventId);

  if (state.user && Number(state.event.participantCount || 0) !== state.results.length) {
    state.event.participantCount = state.results.length;
    void syncEventParticipantCount(state.results.length);
  }

  return true;
}

async function finalizeParticipantResult(forceManualSave = false) {
  if (!state.user) {
    setError("Bitte als Organisator anmelden, bevor Resultate gespeichert werden.");
    render();
    return false;
  }

  const { firstName, lastName, participantName } = getParticipantNameParts();
  if (!firstName || !lastName) {
    setError("Bitte Vorname und Name eingeben.");
    render();
    return false;
  }

  const attempts = [...(state.liveEntry.attempts || [])];
  if (forceManualSave && state.isInAttempt && state.peak >= PEAK_MINIMUM_THRESHOLD) {
    attempts.push({
      value: Number(state.peak.toFixed(1)),
      direction: state.peakDirection,
    });
  }

  if (!attempts.length) {
    setError("Noch kein gültiger Versuch vorhanden.");
    render();
    return false;
  }

  const directions = attempts.map((attempt) => attempt.direction).filter(Boolean);
  const finalDirection = directions[directions.length - 1] || state.lockedMode || getSelectedForceModeKey();
  if (!isDirectionAllowed(finalDirection)) {
    setError("Die erfassten Versuche passen nicht zur gewählten Richtung.");
    render();
    return false;
  }

  try {
    await ensureEventWritable();

    const finalValue = Number(getFinalAttemptValue(attempts).toFixed(1));
    const resultPayload = {
      eventId: state.event.id,
      ownerUid: state.user.uid,
      firstName,
      lastName,
      participantName,
      value: finalValue,
      unit: "kg",
      forceMode: finalDirection,
      attemptNumber: attempts.length,
      attemptsCompleted: attempts.length,
      attemptsValues: attempts.map((attempt) => Number(attempt.value.toFixed(1))),
      scoringMode: state.event.scoringMode,
      createdAt: serverTimestamp(),
    };
    const resultRef = await addDoc(collection(db, "results"), resultPayload);
    setResults([
      ...state.results,
      {
        id: resultRef.id,
        ...resultPayload,
        createdAt: new Date(),
      },
    ]);
    state.event.participantCount = state.results.length;
    await syncEventParticipantCount(state.results.length);

    const savedName = participantName;
    resetLiveEntryState();
    setFlash(`Resultat gespeichert: ${savedName} · ${finalValue.toFixed(1)} kg`);
    render();
    return true;
  } catch (error) {
    setError(`Resultat speichern fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    render();
    return false;
  }
}

function setFlash(message, type = "info") {
  state.flashMessage = message;
  state.flashType = type;
}

function setError(message) {
  state.lastError = message;
  if (message) {
    setFlash(message, "error");
    console.error(message);
  }
}

function clearError() {
  state.lastError = "";
  if (state.flashType === "error") {
    state.flashMessage = "";
    state.flashType = "info";
  }
}

function isSafariLikeBrowser() {
  const ua = navigator.userAgent || "";
  return (/Safari/i.test(ua) && !/Chrome|Chromium|Edg|Firefox/i.test(ua)) || /iPhone|iPad|iPod/i.test(ua);
}

function getAuthErrorMessage(error) {
  const code = error?.code || "";

  if (code === "auth/popup-closed-by-user") return "Google Login wurde vor Abschluss geschlossen.";
  if (code === "auth/popup-blocked") return "Der Browser hat das Google-Login-Popup blockiert.";
  if (code === "auth/cancelled-popup-request") return "Die Google-Anmeldung wurde durch eine neue Anfrage ersetzt.";
  if (code === "auth/unauthorized-domain") return "Die Domain ist in Firebase Authentication noch nicht als autorisierte Domain eingetragen.";
  if (code === "auth/operation-not-allowed") return "Google Login ist im Firebase-Projekt noch nicht aktiviert.";
  if (code === "auth/invalid-credential") return "Die erhaltenen Anmeldedaten sind ungültig.";

  return error?.message || "Unbekannter Firebase-Auth-Fehler.";
}

function safeUnsub(key) {
  if (state.unsubscribers[key]) {
    state.unsubscribers[key]();
    state.unsubscribers[key] = null;
  }
}

function getRouteInfo() {
  const hash = window.location.hash.replace(/^#/, "");
  const segments = hash.split("/").filter(Boolean);
  const fallbackEventId = getActiveEventId() || state.event.id;

  if (segments[0] === "display") {
    return { page: "display", eventId: segments[1] || fallbackEventId };
  }

  if (segments[0] === "e") {
    return { page: "public", eventId: segments[1] || fallbackEventId };
  }

  const page = pageMeta[segments[0]] ? segments[0] : "dashboard";
  const routedEventPage = ["setup", "branding", "live"].includes(page);
  return { page, eventId: routedEventPage ? (segments[1] || fallbackEventId) : fallbackEventId };
}

function getPublicUrl() {
  return `${window.location.origin}${APP_BASE}/#/e/${state.event.id}`;
}

function getDisplayUrl() {
  return `${window.location.origin}${APP_BASE}/#/display/${state.event.id}`;
}

function syncUrl(page, eventId = state.event.id) {
  if (page === "public") {
    history.replaceState(null, "", `${APP_BASE}/#/e/${eventId}`);
    return;
  }
  if (page === "display") {
    history.replaceState(null, "", `${APP_BASE}/#/display/${eventId}`);
    return;
  }
  if (["setup", "branding", "live"].includes(page)) {
    history.replaceState(null, "", `${APP_BASE}/#/${page}/${eventId}`);
    return;
  }
  history.replaceState(null, "", page === "dashboard" ? `${APP_BASE}/` : `${APP_BASE}/#/${page}`);
}

function getOrganizerPageUrl(page, eventId = state.event.id) {
  if (page === "dashboard") return `${APP_BASE}/`;
  if (page === "public") return `${APP_BASE}/#/e/${eventId}`;
  if (page === "display") return `${APP_BASE}/#/display/${eventId}`;
  if (["setup", "branding", "live"].includes(page)) return `${APP_BASE}/#/${page}/${eventId}`;
  return `${APP_BASE}/#/${page}`;
}

function parseDeviceInfo(dataView) {
  if (!dataView || dataView.byteLength === 0) return null;
  try {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    const firstByte = dataView.getUint8(0);
    if ((firstByte >= 0x30 && firstByte <= 0x39) || firstByte === 0x2e) {
      return {
        productLine: "DynoGrip",
        fwVersion: String.fromCharCode(...bytes).trim(),
        serialNumber: "UNKNOWN",
      };
    }
    if (dataView.byteLength >= 14) {
      const serialBytes = new Uint8Array(dataView.buffer, dataView.byteOffset + 6, 8);
      return {
        productLine: `Code ${dataView.getUint8(0)}`,
        fwVersion: `${dataView.getUint8(3)}.${dataView.getUint8(4)}.${dataView.getUint8(5)}`,
        serialNumber: Array.from(serialBytes).map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase(),
      };
    }
  } catch (error) {
    setError(`Device info konnte nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`);
  }
  return null;
}

function parseStatePacket(dataView) {
  if (!dataView || dataView.byteLength < 20) return null;
  try {
    let offset = 0;
    const packet = {
      tMs: dataView.getUint32(offset, true),
      force: dataView.getFloat32((offset += 4), true),
      slope: dataView.getFloat32((offset += 4), true),
      peak: dataView.getFloat32((offset += 4), true),
      attemptCount: dataView.getUint16((offset += 4), true),
      batteryPercent: dataView.getUint8((offset += 2)),
      charging: dataView.getUint8((offset += 1)) === 1,
    };
    if (!Number.isFinite(packet.force) || packet.force < -1000 || packet.force > 1000) return null;
    return packet;
  } catch (error) {
    setError(`Messpaket konnte nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function disconnectCleanup() {
  state.connected = false;
  state.connecting = false;
  state.signal = "Nicht verbunden";
  state.ble.server = null;
  state.ble.stateCharacteristic = null;
  state.ble.commandCharacteristic = null;
  state.ble.infoCharacteristic = null;
}

function getPreferredBleDeviceId() {
  try {
    return window.localStorage.getItem(BLE_STORAGE_KEYS.preferredDeviceId) || "";
  } catch {
    return "";
  }
}

function getActiveEventId() {
  try {
    return window.localStorage.getItem(EVENT_STORAGE_KEYS.activeEventId) || "";
  } catch {
    return "";
  }
}

function rememberActiveEventId(eventId) {
  if (!eventId) return;
  try {
    window.localStorage.setItem(EVENT_STORAGE_KEYS.activeEventId, eventId);
  } catch {}
}

function rememberPreferredBleDevice(device) {
  if (!device?.id) return;
  try {
    window.localStorage.setItem(BLE_STORAGE_KEYS.preferredDeviceId, device.id);
  } catch {}
}

function clearReconnectTimer() {
  if (state.ble.reconnectTimer) {
    window.clearTimeout(state.ble.reconnectTimer);
    state.ble.reconnectTimer = null;
  }
}

function scheduleAutoReconnect(delay = 1500) {
  if (!state.ble.autoReconnectEnabled || state.connecting || state.connected) return;
  clearReconnectTimer();
  state.ble.reconnectTimer = window.setTimeout(async () => {
    state.ble.reconnectTimer = null;
    await attemptAutoReconnect();
  }, delay);
}

function onBluetoothDisconnected() {
  disconnectCleanup();
  setFlash("DynoGrip Verbindung getrennt.");
  scheduleAutoReconnect();
  render();
}

function onStateCharacteristicChanged(event) {
  const packet = parseStatePacket(event.target.value);
  if (!packet) return;
  const signedForce = -packet.force;
  const absForce = Math.abs(signedForce);
  const direction = directionFromSignedForce(signedForce);

  state.connected = true;
  state.connecting = false;
  state.signedForce = signedForce;
  state.currentForce = absForce;
  state.forceDirection = direction;
  state.rawPeak = Math.abs(signedForce) > Math.abs(state.rawPeak) && absForce >= PEAK_MINIMUM_THRESHOLD ? signedForce : state.rawPeak;

  if (state.lockedMode === null && absForce >= MODE_LOCK_THRESHOLD && direction !== "neutral") {
    state.lockedMode = direction;
  }

  if (absForce >= PEAK_MINIMUM_THRESHOLD && isDirectionAllowed(direction) && absForce >= state.peak) {
    state.peak = absForce;
    state.peakDirection = direction;
  }

  state.elapsedSeconds = Math.floor(packet.tMs / 1000) % 60;
  state.battery = packet.batteryPercent;
  state.signal = packet.charging ? "Stabil · lädt" : "Stabil";
  updateLiveMeasurementDom();
}

async function openBleConnection(device, { silent = false } = {}) {
  device.addEventListener("gattserverdisconnected", onBluetoothDisconnected);
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(BLE.serviceUuid);
  const stateCharacteristic = await service.getCharacteristic(BLE.stateCharacteristicUuid);
  const commandCharacteristic = await service.getCharacteristic(BLE.commandCharacteristicUuid);
  const infoCharacteristic = await service.getCharacteristic(BLE.infoCharacteristicUuid);
  state.ble.device = device;
  state.ble.server = server;
  state.ble.stateCharacteristic = stateCharacteristic;
  state.ble.commandCharacteristic = commandCharacteristic;
  state.ble.infoCharacteristic = infoCharacteristic;
  await stateCharacteristic.startNotifications();
  stateCharacteristic.addEventListener("characteristicvaluechanged", onStateCharacteristicChanged);
  try {
    state.deviceInfo = parseDeviceInfo(await infoCharacteristic.readValue());
  } catch {}
  state.connected = true;
  state.connecting = false;
  state.signal = "Stabil";
  state.ble.autoReconnectEnabled = true;
  state.ble.reconnectAttempted = true;
  clearReconnectTimer();
  rememberPreferredBleDevice(device);
  if (!silent) {
    setFlash(`DynoGrip verbunden${device.name ? `: ${device.name}` : ""}.`);
  }
}

async function connectToDevice(deviceOverride = null, options = {}) {
  if (!navigator.bluetooth) {
    setError("Web Bluetooth ist in diesem Browser nicht verfügbar. Bitte Chrome oder Edge verwenden.");
    render();
    return;
  }
  try {
    clearReconnectTimer();
    const device = deviceOverride || await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE.serviceUuid] }] });
    state.connecting = true;
    state.ble.autoReconnectEnabled = true;
    state.signal = "Verbinde...";
    clearError();
    render();
    await openBleConnection(device, options);
    render();
  } catch (error) {
    disconnectCleanup();
    if (!options.silent) {
      setError(error instanceof Error ? error.message : String(error));
    }
    render();
  }
}

async function attemptAutoReconnect() {
  if (!state.ble.autoReconnectEnabled || !navigator.bluetooth?.getDevices || state.connected || state.connecting) return;
  try {
    const devices = await navigator.bluetooth.getDevices();
    const preferredDeviceId = getPreferredBleDeviceId();
    const candidate =
      devices.find((device) => device.id && device.id === preferredDeviceId) ||
      devices.find((device) => (device.name || "").toLowerCase().includes("dyno"));
    if (!candidate) {
      scheduleAutoReconnect(5000);
      return;
    }
    await connectToDevice(candidate, { silent: true });
    if (state.connected) {
      setFlash(`DynoGrip automatisch verbunden${candidate.name ? `: ${candidate.name}` : ""}.`);
      render();
    }
  } catch {
    scheduleAutoReconnect(5000);
  }
}

function disconnectDevice() {
  try {
    state.ble.autoReconnectEnabled = false;
    clearReconnectTimer();
    if (state.ble.stateCharacteristic) {
      state.ble.stateCharacteristic.removeEventListener("characteristicvaluechanged", onStateCharacteristicChanged);
    }
    if (state.ble.device?.gatt?.connected) {
      state.ble.device.gatt.disconnect();
    }
  } catch (error) {
    setError(`Trennen fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
  }
  disconnectCleanup();
  setFlash("DynoGrip Verbindung getrennt.");
  render();
}

async function sendCommand(bytes) {
  if (!state.ble.commandCharacteristic) {
    setError("Kein DynoGrip verbunden.");
    render();
    return;
  }
  try {
    await state.ble.commandCharacteristic.writeValueWithoutResponse(bytes);
    clearError();
  } catch (error) {
    setError(`Befehl fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
  }
  render();
}

function eventDocToState(id, data) {
  return {
    id,
    name: data.name || "Event",
    description: data.description || "",
    organiser: data.organiser || "",
    organiserEmail: data.organiserEmail || "",
    location: data.location || "",
    date: data.date || new Date().toISOString().slice(0, 10),
    challengeType: data.challengeType || "Maximalkraft",
    forceMode: normalizeForceMode(data.forceMode),
    gripType: data.gripType || "Standard",
    attempts: Number(data.attempts || 3),
    scoringMode: data.scoringMode || "Bester Versuch",
    status: normalizeEventStatus(data.status),
    primaryColor: data.primaryColor || "#1f4f46",
    ownerUid: data.ownerUid || "",
    participantCount: Number(data.participantCount || 0),
    createdAt: data.createdAt || null,
    closedAt: data.closedAt || null,
    eventLogo: data.eventLogo || "",
    venueLogo: data.venueLogo || "",
    headerBanner: data.headerBanner || "",
    sponsorBanner: data.sponsorBanner || "",
    showVenueLogo: data.showVenueLogo !== false,
    eventLogoScale: Number(data.eventLogoScale || 100),
    venueLogoScale: Number(data.venueLogoScale || 100),
    headerBannerScale: Number(data.headerBannerScale || 100),
    headerBannerThumbScale: Number(data.headerBannerThumbScale || 100),
    sponsorBannerScale: Number(data.sponsorBannerScale || 100),
    eventLogoAspect: normalizeBrandingAspect(data.eventLogoAspect, "1 / 1"),
    venueLogoAspect: normalizeBrandingAspect(data.venueLogoAspect, "1 / 1"),
    headerBannerAspect: normalizeBrandingAspect(data.headerBannerAspect, "4 / 1"),
    sponsorBannerAspect: normalizeBrandingAspect(data.sponsorBannerAspect, "5 / 1"),
    eventLogoPdfData: data.eventLogoPdfData || "",
    venueLogoPdfData: data.venueLogoPdfData || "",
    headerBannerPdfData: data.headerBannerPdfData || "",
    sponsorBannerPdfData: data.sponsorBannerPdfData || "",
  };
}

async function subscribeToEvent(eventId) {
  safeUnsub("event");
  safeUnsub("results");
  state.eventLoaded = false;
  state.loadingEventId = eventId;
  if (!hydrateResultsFromCache(eventId)) {
    setResults([], { loaded: false, eventId, cache: false });
  }
  rememberActiveEventId(eventId);
  state.event = {
    ...state.event,
    id: eventId,
    name: "DynoForce Event",
    description: "",
    organiser: "Veranstalter",
    organiserEmail: "",
    location: "",
    date: "",
    challengeType: "Maximalkraft",
    forceMode: "Beide",
    gripType: "Standard",
    attempts: 3,
    scoringMode: "Bester Versuch",
    status: "Inaktiv",
    participantCount: 0,
    createdAt: null,
    closedAt: null,
  };
  render();

  try {
    await loadEventState(eventId);
    render();
  } catch (error) {
    if (state.loadingEventId === eventId) {
      setError(`Event und Resultate konnten nicht geladen werden: ${error instanceof Error ? error.message : String(error)}`);
      state.eventLoaded = true;
      render();
    }
  }

  state.unsubscribers.event = onSnapshot(doc(db, "events", eventId), (snapshot) => {
    if (state.loadingEventId !== eventId) return;
    if (snapshot.exists()) {
      state.event = eventDocToState(snapshot.id, snapshot.data());
      state.eventLoaded = true;
      state.loadingEventId = snapshot.id;
      if (state.currentPage === "live" && !isActiveEventStatus(state.event.status)) {
        setError("Die Aktive Ansicht ist nur für aktive Events verfügbar.");
        state.currentPage = "setup";
        syncUrl("setup", snapshot.id);
      } else {
        clearError();
      }
      if (!state.results.length && Number(state.event.participantCount || 0) > 0) {
        void primeEventState(eventId);
      }
      render();
    } else {
      setError(`Event ${eventId} wurde nicht gefunden.`);
      state.eventLoaded = true;
      render();
    }
  }, (error) => {
    if (state.loadingEventId !== eventId) return;
    setError(`Event konnte nicht geladen werden: ${error.message}`);
    state.eventLoaded = true;
    render();
  });

  state.unsubscribers.results = onSnapshot(
    query(collection(db, "results"), where("eventId", "==", eventId)),
    (snapshot) => {
      if (state.loadingEventId !== eventId) return;
      if (snapshot.empty) {
        const shouldVerifyEmptyResults = !state.eventLoaded || state.results.length > 0 || Number(state.event.participantCount || 0) > 0;
        state.resultsLoaded = true;
        if (hydrateResultsFromCache(eventId)) {
          render();
          return;
        }
        if (shouldVerifyEmptyResults) {
          void primeEventState(eventId);
          render();
          return;
        }
        setResults([]);
        render();
        return;
      }
      setResults(snapshot.docs.map((resultDoc) => ({
        id: resultDoc.id,
        ...resultDoc.data(),
      })), { eventId });
      if (state.user && state.event.id === eventId && Number(state.event.participantCount || 0) !== state.results.length) {
        state.event.participantCount = state.results.length;
        void syncEventParticipantCount(state.results.length);
      }
      render();
    },
    (error) => {
      if (state.loadingEventId !== eventId) return;
      state.resultsLoaded = true;
      setError(`Resultate konnten nicht geladen werden: ${error.message}`);
      render();
    },
  );
}

function subscribeToDashboard() {
  if (!state.user) {
    state.events = [];
    state.dashboardLoaded = true;
    render();
    return;
  }

  safeUnsub("dashboard");
  state.dashboardLoaded = false;
  state.unsubscribers.dashboard = onSnapshot(
    query(collection(db, "events"), where("ownerUid", "==", state.user.uid)),
    (snapshot) => {
      state.events = snapshot.docs.map((eventDoc) => {
        const data = eventDoc.data();
        return {
          id: eventDoc.id,
          name: data.name,
          date: formatDate(data.date),
          sortDate: data.date || "",
          status: normalizeEventStatus(data.status),
          participants: Number(data.participantCount || 0),
        };
      }).sort((a, b) => String(b.sortDate).localeCompare(String(a.sortDate)));
      state.dashboardLoaded = true;
      render();
    },
    (error) => {
      setError(`Dashboard konnte nicht geladen werden: ${error.message}`);
      state.dashboardLoaded = true;
      render();
    },
  );
}

function subscribeToPublicEvents() {
  safeUnsub("publicEvents");
  state.publicEventsLoaded = false;
  state.unsubscribers.publicEvents = onSnapshot(
    query(collection(db, "events"), where("status", "in", ["Live", "Aktiv"])),
    (snapshot) => {
      state.publicEvents = snapshot.docs.map((eventDoc) => {
        const data = eventDoc.data();
        return {
          id: eventDoc.id,
          name: data.name || "Event",
          date: formatLongDate(data.date),
          sortDate: data.date || "",
          location: data.location || "",
          challengeType: data.challengeType || "Challenge",
        };
      }).sort((a, b) => String(b.sortDate).localeCompare(String(a.sortDate)));
      state.publicEventsLoaded = true;
      render();
    },
    (error) => {
      setError(`Live Events konnten nicht geladen werden: ${error.message}`);
      state.publicEventsLoaded = true;
      render();
    },
  );
}

async function saveEvent(overrides = {}) {
  if (!state.user) {
    setError("Bitte zuerst als Organisator anmelden.");
    render();
    return;
  }

  state.saving = true;
  clearError();
  render();

  try {
    const payload = {
      name: state.event.name,
      description: state.event.description,
      organiser: state.event.organiser,
      organiserEmail: state.event.organiserEmail || "",
      location: state.event.location,
      date: state.event.date,
      challengeType: state.event.challengeType,
      forceMode: normalizeForceMode(state.event.forceMode),
      gripType: state.event.gripType,
      attempts: state.event.attempts,
      scoringMode: state.event.scoringMode,
      status: state.event.status,
      ownerUid: state.user.uid,
      primaryColor: state.event.primaryColor,
      eventLogo: state.event.eventLogo,
      venueLogo: state.event.venueLogo,
      headerBanner: state.event.headerBanner,
      sponsorBanner: state.event.sponsorBanner,
      showVenueLogo: state.event.showVenueLogo !== false,
      eventLogoScale: Number(state.event.eventLogoScale || 100),
      venueLogoScale: Number(state.event.venueLogoScale || 100),
      headerBannerScale: Number(state.event.headerBannerScale || 100),
      headerBannerThumbScale: Number(state.event.headerBannerThumbScale || 100),
      sponsorBannerScale: Number(state.event.sponsorBannerScale || 100),
      eventLogoAspect: normalizeBrandingAspect(state.event.eventLogoAspect, "1 / 1"),
      venueLogoAspect: normalizeBrandingAspect(state.event.venueLogoAspect, "1 / 1"),
      headerBannerAspect: normalizeBrandingAspect(state.event.headerBannerAspect, "4 / 1"),
      sponsorBannerAspect: normalizeBrandingAspect(state.event.sponsorBannerAspect, "5 / 1"),
      eventLogoPdfData: state.event.eventLogoPdfData || "",
      venueLogoPdfData: state.event.venueLogoPdfData || "",
      headerBannerPdfData: state.event.headerBannerPdfData || "",
      sponsorBannerPdfData: state.event.sponsorBannerPdfData || "",
      participantCount: state.results.length,
      updatedAt: serverTimestamp(),
      ...overrides,
    };

    await setDoc(
      doc(db, "events", state.event.id),
      {
        ...payload,
        createdAt: state.event.createdAt || serverTimestamp(),
      },
      { merge: true },
    );

    setFlash("Event in Firestore gespeichert.");
  } catch (error) {
    setError(`Event speichern fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    state.saving = false;
    render();
  }
}

async function uploadBrandingFile(fieldName, file) {
  if (!state.user) {
    setError("Bitte zuerst anmelden, bevor Branding hochgeladen wird.");
    render();
    return;
  }
  if (!file) return;

  try {
    state.uploading = fieldName;
    clearError();
    render();
    const extension = file.name.split(".").pop() || "bin";
    const path = `event-branding/${state.user.uid}/${state.event.id}/${fieldName}.${extension}`;
    const storageRef = ref(storage, path);
    const embeddedDataUrl = await createEmbeddedBrandingDataUrl(file, fieldName);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    state.event[fieldName] = url;
    state.event[getPdfBrandingFieldName(fieldName)] = embeddedDataUrl;
    await saveEvent();
    setFlash(`${fieldName} hochgeladen.`);
  } catch (error) {
    setError(`Upload fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    state.uploading = "";
    render();
  }
}

async function saveLiveResult() {
  await finalizeParticipantResult(true);
}

async function signInEmail(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}

async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  if (isSafariLikeBrowser()) {
    await signInWithRedirect(auth, provider);
    return;
  }

  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error?.code === "auth/popup-blocked" || error?.code === "auth/popup-closed-by-user") {
      throw error;
    }

    await signInWithRedirect(auth, provider);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function downloadPdf() {
  const previewWindow = window.open("", "_blank");

  if (!previewWindow) {
    setError("Die PDF-Ansicht konnte nicht geöffnet werden. Bitte Popups für diese Seite erlauben.");
    render();
    return;
  }

  previewWindow.document.write("<!doctype html><title>PDF wird erstellt</title><body style=\"font-family:Arial,sans-serif;padding:24px;color:#171717;\">PDF wird erstellt...</body>");
  previewWindow.document.close();

  try {
    const { default: QRCode } = await import("qrcode");
    const qrCodeDataUrl = await QRCode.toDataURL(getPublicUrl(), { margin: 0, width: 220 });
    const headerBanner = state.event.headerBannerPdfData || state.event.headerBanner || "";
    const eventLogo = state.event.eventLogoPdfData || state.event.eventLogo || "";
    const venueLogo = state.event.showVenueLogo === false ? "" : state.event.venueLogoPdfData || state.event.venueLogo || "";
    const sponsorBanner = state.event.sponsorBannerPdfData || state.event.sponsorBanner || "";
    const primary = state.event.primaryColor || "#1f4f46";
    const summaryRows = [
      ["Veranstalter", state.event.organiser || "DynoForce"],
      ...(state.event.organiserEmail ? [["Kontakt E-Mail", state.event.organiserEmail]] : []),
      ["Beschreibung", state.event.description || "Professionelles Event mit Live-Rangliste und DynoForce Messung."],
      ["Griff", state.event.gripType || "Standard"],
      ["Richtung", normalizeForceMode(state.event.forceMode)],
      ["Wertung", state.event.scoringMode],
      ["Teilnehmer", String(state.results.length)],
      ["Bestwert", `${Number(state.results[0]?.value || 0).toFixed(1)} kg`],
      ["Durchschnitt", `${averageValue().toFixed(1)} kg`],
    ];
    const overall = getOverallWinnersByDirection();
    const winners = getTodayWinnersByDirection();
    const mode = normalizeForceMode(state.event.forceMode);
    const printWinnerCards = (
      mode === "Beide"
        ? [
            { title: "Gesamtsieger Ziehen", winner: overall.pull },
            { title: "Gesamtsieger Drücken", winner: overall.push },
            { title: "Tagessieger Ziehen", winner: winners.pull },
            { title: "Tagessieger Drücken", winner: winners.push },
          ]
        : mode === "Ziehen"
          ? [{ title: "Gesamtsieger Ziehen", winner: overall.pull }, { title: "Tagessieger Ziehen", winner: winners.pull }]
          : mode === "Drücken"
            ? [{ title: "Gesamtsieger Drücken", winner: overall.push }, { title: "Tagessieger Drücken", winner: winners.push }]
            : [{ title: "Gesamtsieger", winner: overall.all }, { title: "Tagessieger", winner: winners.all }]
    ).map(({ title, winner }) => `
      <div class="winner-card">
        <small>${escapeHtml(title)}</small>
        <strong>${winner ? `${escapeHtml(winner.participantName || winner.name || "—")} · ${Number(winner.value || 0).toFixed(1)} kg` : "Heute noch kein Resultat"}</strong>
      </div>
    `).join("");
    const printLeaderboardSections = leaderboardSections(state.results.length || 1).map((section) => `
      <div class="leaderboard-section">
        <h3>${escapeHtml(section.title)}</h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Richtung</th>
              <th>Resultat</th>
            </tr>
          </thead>
          <tbody>
            ${(section.items || []).map((entry, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(entry.participantName || entry.name || "—")}</td>
                <td>${escapeHtml(formatEntryDirection(entry))}</td>
                <td>${Number(entry.value || 0).toFixed(1)} kg</td>
              </tr>
            `).join("") || `<tr><td colspan="4">Noch keine Resultate vorhanden.</td></tr>`}
          </tbody>
        </table>
      </div>
    `).join("");

    const summaryMarkup = summaryRows.map(([label, value]) => `
      <div class="summary-row">
        <div class="summary-label">${escapeHtml(label)}</div>
        <div class="summary-value">${escapeHtml(value)}</div>
      </div>
    `).join("");

    const html = `
      <!doctype html>
      <html lang="de">
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(getEventDisplayName())} PDF</title>
          <style>
            @page {
              size: A4;
              margin: 14mm;
            }
            :root {
              --primary: ${primary};
              --line: #ddd8cf;
              --muted: #666055;
              --surface-muted: #f5f3ed;
              --text: #171717;
            }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: Arial, sans-serif;
              color: var(--text);
              background: #ffffff;
            }
            .page {
              width: 210mm;
              min-height: 297mm;
              margin: 0 auto;
              padding: 16mm;
              background: #ffffff;
            }
            .hero {
              border: 1px solid var(--line);
              border-radius: 20px;
              overflow: hidden;
              margin-bottom: 18px;
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .hero-banner {
              width: 100%;
              height: 56mm;
              object-fit: contain;
              display: block;
              background: var(--surface-muted);
            }
            .hero-content {
              padding: 14px 16px 16px;
              display: grid;
              gap: 12px;
            }
            .logo-row {
              display: flex;
              gap: 12px;
              align-items: center;
            }
            .logo-box {
              width: 22mm;
              height: 22mm;
              border: 1px solid var(--line);
              border-radius: 10px;
              background: #fff;
              display: grid;
              place-items: center;
              overflow: hidden;
            }
            .logo-box img {
              width: 100%;
              height: 100%;
              object-fit: contain;
            }
            .hero-copy small {
              display: block;
              color: var(--muted);
              text-transform: uppercase;
              letter-spacing: 0.12em;
              font-size: 10px;
              margin-bottom: 6px;
            }
            .hero-copy h1 {
              margin: 0;
              font-size: 28px;
            }
            .hero-copy p {
              margin: 8px 0 0;
              color: var(--muted);
              line-height: 1.4;
            }
            .sponsor-banner {
              width: 100%;
              max-height: 28mm;
              object-fit: contain;
              display: block;
              margin-top: 10px;
              border-radius: 12px;
              background: var(--surface-muted);
            }
            .top-grid {
              display: grid;
              grid-template-columns: 1.2fr 0.8fr;
              gap: 18px;
              align-items: start;
              margin-bottom: 18px;
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .card {
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .card h2 {
              margin: 0 0 12px;
              font-size: 20px;
            }
            .summary-row {
              display: grid;
              grid-template-columns: 110px 1fr;
              gap: 12px;
              padding: 7px 0;
              border-bottom: 1px solid var(--line);
            }
            .summary-row:last-child {
              border-bottom: 0;
            }
            .summary-label {
              font-weight: 700;
            }
            .summary-value {
              line-height: 1.4;
            }
            .qr-card {
              border: 1px solid var(--line);
              border-radius: 18px;
              padding: 16px;
            }
            .qr-card img {
              width: 44mm;
              height: 44mm;
              display: block;
              margin-bottom: 12px;
            }
            .qr-card strong {
              display: block;
              margin-bottom: 6px;
            }
            .qr-card p {
              margin: 0;
              color: var(--muted);
              line-height: 1.4;
            }
            .winner-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
              gap: 12px;
              margin-bottom: 18px;
            }
            .winner-card {
              border: 1px solid var(--line);
              border-radius: 16px;
              padding: 14px;
              background: var(--surface-muted);
            }
            .winner-card small {
              display: block;
              color: var(--muted);
              margin-bottom: 8px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              font-size: 10px;
            }
            .winner-card strong {
              display: block;
              line-height: 1.35;
            }
            .leaderboard-section + .leaderboard-section {
              margin-top: 16px;
            }
            .leaderboard-section h3 {
              margin: 0 0 10px;
              font-size: 16px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
            thead {
              display: table-header-group;
            }
            tbody, tr {
              break-inside: avoid;
              page-break-inside: avoid;
            }
            th, td {
              text-align: left;
              padding: 9px 6px;
              border-bottom: 1px solid var(--line);
            }
            th {
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              color: var(--muted);
            }
            .actions {
              margin-top: 16px;
              display: flex;
              justify-content: flex-end;
              gap: 10px;
            }
            .print-button {
              border: 0;
              border-radius: 999px;
              background: var(--primary);
              color: #fff;
              padding: 10px 16px;
              font-weight: 700;
              cursor: pointer;
            }
            @media print {
              .actions { display: none; }
              .page {
                width: auto;
                min-height: auto;
                padding: 0;
              }
              body { margin: 0; }
              .top-grid {
                grid-template-columns: 1fr 72mm;
                align-items: start;
              }
              .qr-card {
                break-inside: avoid;
                page-break-inside: avoid;
              }
            }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="hero">
              ${headerBanner ? `<img class="hero-banner" src="${headerBanner}" alt="Header Banner" />` : ""}
              <div class="hero-content">
                <div class="logo-row">
                  ${eventLogo ? `<div class="logo-box"><img src="${eventLogo}" alt="Eventlogo" /></div>` : ""}
                  ${venueLogo ? `<div class="logo-box"><img src="${venueLogo}" alt="Hallenlogo" /></div>` : ""}
                </div>
                <div class="hero-copy">
                  <small>DynoForce Event</small>
                  <h1>${escapeHtml(getEventDisplayName())}</h1>
                  <p>${escapeHtml(getEventSummaryLine() || "Live Event")}</p>
                  <p>${escapeHtml(state.event.description || `${state.event.organiser || "Veranstalter"} präsentiert dieses Event.`)}</p>
                </div>
                ${sponsorBanner ? `<img class="sponsor-banner" src="${sponsorBanner}" alt="Sponsor Banner" />` : ""}
              </div>
            </div>

            <div class="top-grid">
              <div class="card">
                <h2>Eventübersicht</h2>
                ${summaryMarkup}
              </div>
              <div class="qr-card">
                <img src="${qrCodeDataUrl}" alt="QR-Code" />
                <strong>Live verfolgen</strong>
                <p>${escapeHtml(getPublicUrl())}</p>
                <p>QR-Code mit Smartphone scannen</p>
              </div>
            </div>

            <div class="card">
              <h2>${mode === "Beide" ? "Ranglisten" : "Rangliste"}</h2>
              ${isDailyChallengeType() ? `<div class="winner-grid">${printWinnerCards}</div>` : ""}
              ${printLeaderboardSections}
            </div>

            <div class="actions">
              <button class="print-button" onclick="window.print()">Als PDF sichern</button>
            </div>
          </div>
          <script>
            window.setTimeout(() => {
              try { window.print(); } catch (error) {}
            }, 300);
          </script>
        </body>
      </html>
    `;

    previewWindow.document.open();
    previewWindow.document.write(html);
    previewWindow.document.close();
  } catch (error) {
    if (!previewWindow.closed) {
      previewWindow.close();
    }
    setError(`PDF konnte nicht erstellt werden: ${error instanceof Error ? error.message : String(error)}`);
    render();
  }
}

function leaderboardTable(items, limit) {
  return `
    <tr><th>#</th><th>Name</th><th>Richtung</th><th>Resultat</th></tr>
    ${items.slice(0, limit).map((item, index) => `
      <tr>
        <td><span class="rank-pill">${medalForRank(index)}</span></td>
        <td>${item.participantName || item.name}</td>
        <td>${formatEntryDirection(item)}</td>
        <td>${Number(item.value).toFixed(1)} kg</td>
      </tr>
    `).join("")}
  `;
}

function dailyWinnerCardsMarkup() {
  const overall = getOverallWinnersByDirection();
  const winners = getTodayWinnersByDirection();
  const mode = normalizeForceMode(state.event.forceMode);
  const cards = [];

  if (mode === "Beide") {
    cards.push({ title: "Gesamtsieger Ziehen", winner: overall.pull });
    cards.push({ title: "Gesamtsieger Drücken", winner: overall.push });
    cards.push({ title: "Tagessieger Ziehen", winner: winners.pull });
    cards.push({ title: "Tagessieger Drücken", winner: winners.push });
  } else if (mode === "Ziehen") {
    cards.push({ title: "Gesamtsieger Ziehen", winner: overall.pull });
    cards.push({ title: "Tagessieger Ziehen", winner: winners.pull });
  } else if (mode === "Drücken") {
    cards.push({ title: "Gesamtsieger Drücken", winner: overall.push });
    cards.push({ title: "Tagessieger Drücken", winner: winners.push });
  } else {
    cards.push({ title: "Gesamtsieger", winner: overall.all });
    cards.push({ title: "Tagessieger", winner: winners.all });
  }

  return cards.map(({ title, winner }) => `
    <div class="mini-card">
      <small>${title}</small>
      <strong>${winner ? `${winner.participantName || winner.name || "—"} · ${Number(winner.value || 0).toFixed(1)} kg` : "Heute noch kein Resultat"}</strong>
    </div>
  `).join("");
}

function qrImage(url) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=264x264&margin=0&data=${encodeURIComponent(url)}`;
}

function updateLiveMeasurementDom() {
  if (state.currentPage !== "live") return;

  const setText = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };

  setText("liveForceValue", getDisplayForceValue().toFixed(1));
  setText("liveRecordValue", `${Number(state.results[0]?.value || 0).toFixed(1)} kg`);
  setText("livePlacementValue", getLivePlacement());
  setText("liveDirectionValue", formatDirectionLabel(state.forceDirection));
  setText("liveMeasuredValue", `${getMeasuredValue().toFixed(1)} kg`);
  setText("livePeakValue", `${state.peak.toFixed(1)} kg`);
  setText("liveConnectionValue", state.connecting ? "Verbinde..." : state.connected ? "Verbunden" : "Nicht verbunden");
  setText("liveBatteryValue", state.connected ? `${state.battery}%` : "—");
  setText("liveSignalValue", state.deviceInfo ? `${state.signal} · FW ${state.deviceInfo.fwVersion}` : state.signal);
  setText("sidebarConnectionLabel", state.connecting ? "Verbinde..." : state.connected ? "Verbunden" : "Nicht verbunden");
  setText("sidebarBatteryLabel", state.connected ? `${state.battery}%` : "—");
  setText("sidebarSignalLabel", state.deviceInfo ? `${state.signal} · FW ${state.deviceInfo.fwVersion}` : state.signal);
  setText("sidebarDeviceLabel", state.ble.device?.name || "Kein Gerät");
  setText("topChipLabel", state.connecting ? "DynoGrip verbindet..." : state.connected ? `DynoGrip verbunden${state.ble.device?.name ? ` · ${state.ble.device.name}` : ""}` : "DynoGrip nicht verbunden");
  const completedAttempts = getCompletedAttemptsCount();
  setText("liveAttemptDisplay", `Versuche ${completedAttempts} / ${state.event.attempts}`);
  setText("liveCapturedAttempts", `${completedAttempts} / ${state.event.attempts}`);
  setText("liveCurrentParticipant", getLiveParticipantDisplayName() || "Noch kein Teilnehmer erfasst");
  setText("liveSaveHint", state.liveEntry.attempts.length ? "Jetzt speichern oder weitere Versuche durchführen." : "Messung startet automatisch über 2 kg und zählt beim Rückfall unter 2 kg.");

  const progressBar = document.getElementById("liveProgressBar");
  if (progressBar) {
    progressBar.style.width = `${Math.max(8, Math.min(100, state.currentForce))}%`;
  }
}

function processAttemptDetectionTick() {
  if (!state.connected || state.currentPage !== "live") {
    return;
  }

  const absForce = state.currentForce;
  const direction = state.lockedMode || state.forceDirection;
  const { firstName, lastName } = getParticipantNameParts();
  const hasParticipant = Boolean(firstName && lastName);
  const canTrackAttempt = hasParticipant && (direction === "neutral" ? normalizeForceMode(state.event.forceMode) === "Beide" : isDirectionAllowed(direction));

  if (!state.isInAttempt && absForce >= ATTEMPT_START_THRESHOLD && canTrackAttempt) {
    state.isInAttempt = true;
    state.peak = absForce;
    state.peakDirection = direction === "neutral" ? state.peakDirection : direction;
    if (absForce > state.peak) {
      state.peak = absForce;
      state.peakDirection = direction;
    }
    updateLiveMeasurementDom();
  }

  if (state.isInAttempt && absForce < ATTEMPT_END_THRESHOLD) {
    if (state.peak >= PEAK_MINIMUM_THRESHOLD) {
      state.liveEntry.attempts = [
        ...(state.liveEntry.attempts || []),
        {
          value: Number(state.peak.toFixed(1)),
          direction: state.peakDirection || direction,
        },
      ];
      state.currentAttempt = Math.min((state.liveEntry.attempts?.length || 0) + 1, state.event.attempts);
    }

    state.isInAttempt = false;
    state.lockedMode = null;
    state.peak = 0;
    state.rawPeak = 0;
    state.peakDirection = "neutral";
    updateLiveMeasurementDom();

    if ((state.liveEntry.attempts?.length || 0) >= state.event.attempts) {
      void finalizeParticipantResult(false);
    }
  }
}

function loginCard() {
  return `
    <div class="login-modal-backdrop" id="loginModalBackdrop">
      <div class="login-modal">
        <div class="card-header">
          <div>
            <div class="eyebrow">Organisator Login</div>
            <h3>Anmelden</h3>
            <p>Mit bestehendem DynoForce Account anmelden und alle Funktionen freischalten.</p>
          </div>
          <button class="icon-button" id="closeLoginModal" aria-label="Login schliessen">×</button>
        </div>
        <div class="field-grid">
          <div class="field"><label>E-Mail</label><input id="loginEmail" type="email" placeholder="name@domain.ch" /></div>
          <div class="field"><label>Passwort</label><input id="loginPassword" type="password" placeholder="Passwort" /></div>
        </div>
        <div class="action-row">
          <button class="button primary" id="loginButton">Mit E-Mail anmelden</button>
          <button class="button" id="googleLoginButton">Mit Google anmelden</button>
        </div>
      </div>
    </div>
  `;
}

function publicHomeCard() {
  return `
    <div class="card public-home-card">
      <div class="card-header">
        <div>
          <div class="eyebrow">DynoForce Event</div>
          <h3>Aktuelle Events live verfolgen</h3>
          <p>Hier sehen Besucher laufende Veranstaltungen, Ranglisten und die öffentliche Eventseite. Die Verwaltungsfunktionen bleiben bewusst nur für Organisatoren sichtbar.</p>
        </div>
      </div>
    </div>
  `;
}

function publicEventsSection() {
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="eyebrow">Live Events</div>
          <h3>Aktuelle Veranstaltungen</h3>
          <p>${state.publicEventsLoaded ? "Alle aktuell laufenden Events auf einen Blick." : "Lade laufende Events..."}</p>
        </div>
      </div>
      <div class="event-list">
        ${state.publicEvents.map((event) => `
          <div class="event-item public-event-item">
            <div>
              <h4>${event.name}</h4>
              <p>${event.date} · ${event.location || "Ort offen"} · ${event.challengeType}</p>
            </div>
            <div class="action-row" style="margin-top:0;">
              <a class="button" href="${APP_BASE}/#/e/${event.id}">Eventseite öffnen</a>
              <a class="button" href="${APP_BASE}/#/display/${event.id}">Display</a>
            </div>
          </div>
        `).join("") || `<div class="event-item"><div><h4>Zurzeit keine Live Events</h4><p>Sobald ein Event läuft, erscheint es hier automatisch.</p></div></div>`}
      </div>
    </div>
  `;
}

function getBrandingScale(fieldName) {
  return Math.max(50, Math.min(180, Number(state.event[`${fieldName}Scale`] || 100)));
}

function getHeaderBannerThumbScale() {
  return Math.max(60, Math.min(220, Number(state.event.headerBannerThumbScale || 100)));
}

function normalizeBrandingAspect(value, fallback = "1 / 1") {
  const allowed = ["1 / 1", "4 / 3", "3 / 2", "16 / 9", "2 / 1", "3 / 1", "4 / 1", "5 / 1"];
  return allowed.includes(value) ? value : fallback;
}

function brandingScaleStyle(fieldName) {
  const fallbackAspect = fieldName === "headerBanner" ? "4 / 1" : fieldName === "sponsorBanner" ? "5 / 1" : "1 / 1";
  const aspect = normalizeBrandingAspect(state.event[`${fieldName}Aspect`], fallbackAspect);
  return `--asset-scale:${getBrandingScale(fieldName) / 100};--asset-ratio:${aspect};`;
}

function brandingAssetControls(fieldName, label, formatHint) {
  const scaleField = `${fieldName}Scale`;
  const aspectField = `${fieldName}Aspect`;
  const scale = getBrandingScale(fieldName);
  const fallbackAspect = fieldName === "headerBanner" ? "4 / 1" : fieldName === "sponsorBanner" ? "5 / 1" : "1 / 1";
  const aspect = normalizeBrandingAspect(state.event[aspectField], fallbackAspect);
  const aspectOptions = [
    ["1 / 1", "Quadratisch"],
    ["4 / 3", "Kompakt"],
    ["3 / 2", "Foto"],
    ["16 / 9", "Breit"],
    ["2 / 1", "Logo breit"],
    ["3 / 1", "Banner"],
    ["4 / 1", "Header"],
    ["5 / 1", "Sponsor"],
  ];
  return `
    <div class="branding-tools">
      <label class="button subtle" for="${fieldName}Input">${state.event[fieldName] ? "Bild ersetzen" : "Bild hinzufügen"}</label>
      <input class="branding-file-input" type="file" id="${fieldName}Input" accept="image/*" />
      <label class="branding-aspect-control">
        <span>Format</span>
        <select data-branding-aspect="${aspectField}" data-branding-target="${fieldName}">
          ${aspectOptions.map(([value, name]) => `<option value="${value}" ${value === aspect ? "selected" : ""}>${name}</option>`).join("")}
        </select>
      </label>
      <label class="branding-scale-control">
        <span>${label} <strong data-scale-value="${scaleField}">${scale}%</strong></span>
        <input type="range" min="50" max="180" step="5" value="${scale}" data-branding-scale="${scaleField}" data-branding-target="${fieldName}" />
      </label>
      ${fieldName === "venueLogo" ? `
        <label class="branding-toggle">
          <input type="checkbox" id="showVenueLogoInput" ${state.event.showVenueLogo === false ? "" : "checked"} />
          <span>Hallenlogo anzeigen</span>
        </label>
      ` : ""}
      ${fieldName === "headerBanner" ? `
        <label class="branding-scale-control compact">
          <span>Kleine Vorschau <strong data-scale-value="headerBannerThumbScale">${getHeaderBannerThumbScale()}%</strong></span>
          <input type="range" min="60" max="220" step="5" value="${getHeaderBannerThumbScale()}" data-header-thumb-scale />
        </label>
      ` : ""}
      <small>${formatHint}</small>
    </div>
  `;
}

function brandingLivePreview() {
  return `
    <div class="branding-live-preview branding-editor">
      <div class="branding-live-hero" style="border-color:${state.event.primaryColor || "#1f4f46"};">
        <div class="branding-editor-slot branding-editor-banner">
          ${state.event.headerBanner ? `<img class="branding-live-banner branding-scale-target" data-branding-preview="headerBanner" src="${state.event.headerBanner}" alt="Header Banner Vorschau" style="${brandingScaleStyle("headerBanner")}" />` : `<div class="branding-live-banner placeholder" data-branding-preview="headerBanner" style="${brandingScaleStyle("headerBanner")}">Header Banner</div>`}
          ${brandingAssetControls("headerBanner", "Header Grösse", "Querformat, ideal 2400 x 900 px")}
        </div>
        <div class="branding-live-content">
          <div class="branding-live-logos">
            <div class="branding-editor-slot branding-editor-logo">
              <div class="branding-live-logo-box" data-branding-preview="eventLogo" style="${brandingScaleStyle("eventLogo")}">${state.event.eventLogo ? `<img class="branding-scale-target" src="${state.event.eventLogo}" alt="Eventlogo Vorschau" style="${brandingScaleStyle("eventLogo")}" />` : `<span>Eventlogo</span>`}</div>
              ${brandingAssetControls("eventLogo", "Eventlogo", "PNG/SVG, quadratisch")}
            </div>
            <div class="branding-editor-slot branding-editor-logo">
              <div class="branding-live-logo-box" data-branding-preview="venueLogo" style="${brandingScaleStyle("venueLogo")}">${state.event.venueLogo ? `<img class="branding-scale-target" src="${state.event.venueLogo}" alt="Hallenlogo Vorschau" style="${brandingScaleStyle("venueLogo")}" />` : `<span>Hallenlogo</span>`}</div>
              ${brandingAssetControls("venueLogo", "Hallenlogo", "PNG/SVG, gerne horizontal")}
            </div>
          </div>
          <div class="branding-live-copy">
            <div class="eyebrow">Vorschau öffentliche Eventseite</div>
            <h3>${getEventDisplayName()}</h3>
            <p>${getEventSummaryLine() || "Datum · Ort · Challenge"}</p>
          </div>
        </div>
      </div>
      <div class="branding-live-footer">
        <div class="branding-editor-slot">
          <div class="branding-live-sponsor" data-branding-preview="sponsorBanner" style="${brandingScaleStyle("sponsorBanner")}">
            ${state.event.sponsorBanner ? `<img class="branding-scale-target" src="${state.event.sponsorBanner}" alt="Sponsor Banner Vorschau" style="${brandingScaleStyle("sponsorBanner")}" />` : `<span>Sponsor Banner erscheint hier</span>`}
          </div>
          ${brandingAssetControls("sponsorBanner", "Sponsor Grösse", "Querformat, ideal 2400 x 500 px")}
        </div>
        <div class="branding-live-meta">
          <div>
            <div class="panel-label">Primärfarbe</div>
            <div class="swatches compact">
              ${["#1f4f46", "#345d7e", "#8c5a21", "#4f4f4f"].map((color) => `<button class="swatch" data-color="${color}" style="background:${color}" aria-label="Primärfarbe ${color}"></button>`).join("")}
            </div>
          </div>
          <div class="metric-line"><span>Aktuelle Farbe</span><strong>${state.event.primaryColor || "#1f4f46"}</strong></div>
        </div>
      </div>
    </div>
  `;
}

function publicBrandingSection() {
  const visibleLogoCount = [state.event.eventLogo, state.event.venueLogo && state.event.showVenueLogo !== false].filter(Boolean).length;
  return `
    <div class="card brand-hero" id="publicBrandHero">
      ${state.event.headerBanner ? `<img class="brand-hero-banner" src="${state.event.headerBanner}" alt="Event Banner" style="${brandingScaleStyle("headerBanner")}" />` : ""}
      <div class="brand-hero-content ${visibleLogoCount <= 1 ? "single-logo" : ""}">
        <div class="brand-hero-logos">
          ${state.event.eventLogo ? `<img src="${state.event.eventLogo}" alt="Event Logo" style="${brandingScaleStyle("eventLogo")}" />` : ""}
          ${state.event.venueLogo && state.event.showVenueLogo !== false ? `<img src="${state.event.venueLogo}" alt="Hallenlogo" style="${brandingScaleStyle("venueLogo")}" />` : ""}
        </div>
        <div class="brand-hero-copy">
          <div class="eyebrow">DynoForce Event</div>
          <h1 class="hero-title">${getEventDisplayName()}</h1>
          <div class="brand-hero-meta">${getEventSummaryLine() || "Live Event"}</div>
          <p>${state.event.description || `${state.event.organiser || "Veranstalter"} präsentiert dieses Event.`}</p>
        </div>
      </div>
      ${state.event.sponsorBanner ? `<img class="brand-hero-sponsor" src="${state.event.sponsorBanner}" alt="Sponsor Banner" style="${brandingScaleStyle("sponsorBanner")}" />` : ""}
    </div>
  `;
}

function eventCardMediaMarkup() {
  return `
    <div class="event-card-side">
      <div class="status-badge">${state.event.status}</div>
      ${state.event.headerBanner ? `<img class="event-card-banner" src="${state.event.headerBanner}" alt="Event Banner" style="${brandingScaleStyle("headerBanner")};--thumb-scale:${getHeaderBannerThumbScale() / 100};" />` : ""}
    </div>
  `;
}

async function assetToDataUrl(url, embeddedDataUrl = "") {
  if (embeddedDataUrl) return embeddedDataUrl;
  if (!url) return null;
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    try {
      const storageRef = ref(storage, url);
      const blob = await getBlob(storageRef);
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (storageError) {
      console.warn("Branding-Asset konnte nicht für PDF geladen werden", url, error, storageError);
      return null;
    }
  }
}

function imageFormatFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return "PNG";
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) return "JPEG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "PNG";
}

function getPdfBrandingFieldName(fieldName) {
  return `${fieldName}PdfData`;
}

function getPdfImagePreset(fieldName) {
  const presets = {
    eventLogo: { maxWidth: 320, maxHeight: 320, mimeType: "image/png", quality: 0.92, fill: false },
    venueLogo: { maxWidth: 520, maxHeight: 240, mimeType: "image/png", quality: 0.92, fill: false },
    headerBanner: { maxWidth: 1200, maxHeight: 420, mimeType: "image/jpeg", quality: 0.8, fill: true },
    sponsorBanner: { maxWidth: 1200, maxHeight: 260, mimeType: "image/jpeg", quality: 0.8, fill: true },
  };
  return presets[fieldName] || presets.eventLogo;
}

async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function loadImage(src) {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function withTimeout(promise, timeoutMs = 8000) {
  return await Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Zeitüberschreitung beim PDF-Export.")), timeoutMs);
    }),
  ]);
}

async function normalizePdfImageDataUrl(sourceDataUrl, fieldName) {
  const image = await loadImage(sourceDataUrl);
  const preset = getPdfImagePreset(fieldName);
  const scale = Math.min(1, preset.maxWidth / image.width, preset.maxHeight / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return sourceDataUrl;

  if (preset.fill) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL(preset.mimeType, preset.quality);
}

async function createEmbeddedBrandingDataUrl(file, fieldName) {
  const sourceDataUrl = await readFileAsDataUrl(file);
  return await normalizePdfImageDataUrl(sourceDataUrl, fieldName);
}

async function getPdfAssetData(fieldName, url, embeddedDataUrl = "") {
  const rawDataUrl = await assetToDataUrl(url, embeddedDataUrl);
  if (!rawDataUrl) return null;
  try {
    return await normalizePdfImageDataUrl(rawDataUrl, fieldName);
  } catch (error) {
    console.warn("PDF-Bild konnte nicht normalisiert werden", fieldName, error);
    return rawDataUrl;
  }
}

function template(page) {
  const publicUrl = getPublicUrl();
  const displayUrl = getDisplayUrl();
  const record = state.results[0]?.value || 0;
  const average = averageValue();
  const last = state.results[state.results.length - 1];
  const lockedPage = !state.user && ["dashboard", "setup", "branding", "live"].includes(page);
  const navItems = state.user
    ? Object.keys(pageMeta).map((key) => `<button data-page="${key}" class="${page === key ? "active" : ""}">${pageMeta[key][0]}</button>`).join("")
    : `<button data-page="dashboard" class="${page === "dashboard" ? "active" : ""}">Startseite</button>`;
  const [dashboardTitle, dashboardText] = getDashboardMeta();

  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">DF</div>
          <div><h1>DynoForce Event</h1><p>Powered by DynoForce</p></div>
        </div>
        <nav class="nav">
          ${navItems}
        </nav>
        ${state.user ? `
          <div class="panel device-panel">
            <div class="panel-label">Geräte Status</div>
            <div class="device-panel-top">
              <div class="status-indicator"><span class="dot ${state.connected ? "" : "off"}"></span><span id="sidebarConnectionLabel">${state.connecting ? "Verbinde..." : state.connected ? "Bereit" : "Nicht verbunden"}</span></div>
              <strong class="device-battery" id="sidebarBatteryLabel">${state.connected ? `${state.battery}%` : "—"}</strong>
            </div>
            <div class="device-subline"><span>Gerät</span><strong id="sidebarDeviceLabel">${state.ble.device?.name || "DynoGrip"}</strong></div>
            <div class="action-row"><button class="button ${state.connected ? "" : "primary"}" id="connectToggle">${state.connected ? "Verbindung trennen" : state.connecting ? "Verbinde..." : "DynoGrip verbinden"}</button></div>
          </div>
        ` : ""}
        <div class="sidebar-footer">
          <strong>DynoForce Event</strong>
          Professioneller Live-Betrieb für Wettkampf, Boulderhalle und Eventfläche.
        </div>
      </aside>
      <main class="content">
        <div class="content-inner">
          <div class="topbar">
            <div><div class="eyebrow">DynoForce Event System</div><h2>${page === "dashboard" ? dashboardTitle : pageMeta[page][0]}</h2><p>${page === "dashboard" ? dashboardText : pageMeta[page][1]}</p></div>
            ${state.user
              ? `<div class="topbar-actions"><div class="top-chip"><span class="dot ${state.connected ? "" : "off"}"></span><span id="topChipLabel">${state.connecting ? "DynoGrip verbindet..." : state.connected ? "Messung bereit" : "DynoGrip nicht verbunden"}</span></div><button class="button" id="logoutButton">Abmelden</button></div>`
              : `<button class="button" id="openLoginModal">Anmelden</button>`}
          </div>
          ${state.lastError ? `<div class="notice error">${state.lastError}</div>` : ""}
          ${organizerEventPickerMarkup(page)}
          ${page === "dashboard" && !state.user ? `
            ${publicHomeCard()}
            <div style="margin-top:18px;">
              ${publicEventsSection()}
            </div>
            ${loginCard()}
          ` : ""}
          ${!lockedPage && state.user && page === "dashboard" ? `
            <div class="grid two">
              <div class="card">
                <div class="card-header"><div><h3>Meine Events</h3><p>${state.dashboardLoaded ? "Übersicht aller eigenen Veranstaltungen mit Status und Teilnehmerzahl." : "Lade Events aus Firestore..."}</p></div><button class="button primary" id="createEvent">Neues Event</button></div>
                <div class="event-list">
                  ${state.events.map((event) => `<div class="event-item"><div><h4>${escapeHtml(event.name || "Event")}</h4><p>${escapeHtml(event.date)} · ${event.participants} Teilnehmer · ${escapeHtml(event.status)}</p></div><div class="event-item-actions"><div class="status-menu"><button class="button subtle status-menu-trigger" data-toggle-status-menu="${event.id}">${escapeHtml(event.status)}</button><div class="status-menu-panel" data-status-menu="${event.id}" hidden><button class="button subtle" data-set-status="${event.id}" data-status-value="Aktiv">Aktiv</button><button class="button subtle" data-set-status="${event.id}" data-status-value="Inaktiv">Inaktiv</button><button class="button subtle" data-set-status="${event.id}" data-status-value="Abgeschlossen">Abgeschlossen</button></div></div><div class="action-row compact">${isActiveEventStatus(event.status) ? `<button class="button" data-open-event="${event.id}">Aktive Ansicht</button>` : ""}<button class="button" data-edit-event="${event.id}">Bearbeiten</button><button class="button danger" data-delete-event="${event.id}">Löschen</button></div></div></div>`).join("") || `<div class="event-item"><div><h4>Noch keine Events</h4><p>Lege dein erstes Event an und speichere es in Firestore.</p></div></div>`}
                </div>
              </div>
              <div class="grid">
                <div class="card"><div class="card-header"><div><h3>Schnellübersicht</h3><p>Live mit Firestore synchronisiert.</p></div></div><div class="metric-list"><div class="metric-line"><span>Aktives Event</span><strong>${state.event.name}</strong></div><div class="metric-line"><span>Challenge</span><strong>${state.event.challengeType}</strong></div><div class="metric-line"><span>Teilnehmer</span><strong>${getParticipantCountLabel()}</strong></div><div class="metric-line"><span>Status</span><strong>${state.event.status}</strong></div></div></div>
                <div class="card"><div class="card-header"><div><h3>Direktlinks</h3><p>Öffentliche Ansichten für Tests.</p></div></div><div class="metric-list"><div class="metric-line"><span>Public URL</span><strong><a href="${publicUrl}" target="_blank" rel="noopener noreferrer">${publicUrl}</a></strong></div><div class="metric-line"><span>Display URL</span><strong><a href="${displayUrl}" target="_blank" rel="noopener noreferrer">${displayUrl}</a></strong></div></div></div>
              </div>
            </div>
          ` : ""}
          ${!lockedPage && page === "setup" ? `
            <div class="grid two">
              <div class="card">
                <div class="card-header"><div><h3>Event Setup</h3><p>Konfiguration der Grunddaten und der Challenge.</p></div></div>
                <div class="field-grid two">
                  <div class="field"><label>Eventname</label><input id="eventNameInput" value="${state.event.name}" /></div>
                  <div class="field"><label>Datum</label><input id="eventDateInput" type="date" value="${state.event.date}" /></div>
                  <div class="field"><label>Veranstalter</label><input id="organiserInput" value="${state.event.organiser}" /></div>
                  <div class="field"><label>Kontakt E-Mail</label><input id="organiserEmailInput" type="email" value="${state.event.organiserEmail || ""}" placeholder="kontakt@veranstalter.ch" /></div>
                  <div class="field"><label>Ort</label><input id="locationInput" value="${state.event.location}" /></div>
                </div>
                <div class="field-grid" style="margin-top:14px;"><div class="field"><label>Beschreibung</label><textarea id="descriptionInput">${state.event.description}</textarea></div></div>
              </div>
              <div class="card">
                <div class="card-header"><div><h3>Challenge & Wertung</h3><p>Optimiert für schnelles Aufsetzen vor Ort.</p></div></div>
                <div class="field-grid two">
                  <div class="field"><label>Challenge</label><select id="challengeTypeInput"><option ${state.event.challengeType === "Maximalkraft" ? "selected" : ""}>Maximalkraft</option><option ${isDailyChallengeType(state.event.challengeType) ? "selected" : ""}>Tageschallenge</option></select></div>
                  <div class="field"><label>Richtung</label><select id="forceModeInput"><option ${normalizeForceMode(state.event.forceMode) === "Beide" ? "selected" : ""}>Beide</option><option ${normalizeForceMode(state.event.forceMode) === "Ziehen" ? "selected" : ""}>Ziehen</option><option ${normalizeForceMode(state.event.forceMode) === "Drücken" ? "selected" : ""}>Drücken</option></select></div>
                  <div class="field"><label>Griff</label><input id="gripTypeInput" value="${state.event.gripType}" /></div>
                  <div class="field"><label>Versuche</label><select id="attemptsInput"><option ${state.event.attempts === 1 ? "selected" : ""}>1 Versuch</option><option ${state.event.attempts === 3 ? "selected" : ""}>3 Versuche</option><option ${state.event.attempts === 5 ? "selected" : ""}>5 Versuche</option></select></div>
                  <div class="field"><label>Wertung</label><select id="scoringModeInput"><option ${state.event.scoringMode === "Bester Versuch" ? "selected" : ""}>Bester Versuch</option><option ${state.event.scoringMode === "Durchschnitt" ? "selected" : ""}>Durchschnitt</option><option ${state.event.scoringMode === "Letzter Versuch" ? "selected" : ""}>Letzter Versuch</option></select></div>
                </div>
                <div class="action-row"><button class="button primary" id="saveSetup">${state.saving ? "Speichert..." : "Event speichern"}</button><button class="button" id="startEvent">Event starten</button><button class="button" id="archiveEvent">Event archivieren</button></div>
              </div>
            </div>
            ${resultEditorMarkup()}
          ` : ""}
          ${!lockedPage && page === "branding" ? `
            <div class="card">
              <div class="card-header">
                <div>
                  <h3>Branding Vorschau</h3>
                  <p>${state.uploading ? `Upload läuft: ${state.uploading}` : "Bilder direkt an der gewünschten Stelle hinzufügen und passend skalieren."}</p>
                </div>
              </div>
              ${brandingLivePreview()}
            </div>
          ` : ""}
          ${!lockedPage && page === "live" ? `
            <div class="grid live">
              <div class="grid">
                <div class="card"><div class="card-header event-card-header"><div><h3>${state.event.name}</h3><p>${state.event.organiser} · ${state.event.challengeType} · ${state.event.scoringMode}</p></div>${eventCardMediaMarkup()}</div></div>
                <div class="card"><div class="card-header"><div><h3>Teilnehmer</h3><p>Zuerst Vorname und Name eingeben. Danach startet die Messung automatisch.</p></div></div><div class="field-grid two"><div class="field"><label>Vorname</label><input id="participantFirstNameInput" value="${state.liveEntry.firstName || ""}" placeholder="Vorname" /></div><div class="field"><label>Name</label><input id="participantLastNameInput" value="${state.liveEntry.lastName || ""}" placeholder="Nachname" /></div></div><div class="metric-list" style="margin-top:14px;"><div class="metric-line"><span>Aktueller Teilnehmer</span><strong id="liveCurrentParticipant">${getLiveParticipantDisplayName() || "Noch kein Teilnehmer erfasst"}</strong></div></div></div>
                <div class="card">
                  <div class="card-header"><div><h3>Live-Messung</h3><p>Die Erkennung folgt derselben Logik wie in der App und zählt gültige Versuche automatisch.</p></div><span id="liveAttemptDisplay">Versuche ${getCompletedAttemptsCount()} / ${state.event.attempts}</span></div>
                  <div class="measure-wrap"><div><div class="force-value"><span id="liveForceValue">${getDisplayForceValue().toFixed(1)}</span><span class="force-unit"> kg</span></div><div class="progress"><div class="progress-bar" id="liveProgressBar" style="width:${Math.max(8, Math.min(100, getDisplayForceValue()))}%"></div></div></div><div class="metric-list"><div class="metric-line"><span>Bester Versuch</span><strong id="liveRecordValue">${Number(record).toFixed(1)} kg</strong></div><div class="metric-line"><span>Aktuelle Platzierung</span><strong id="livePlacementValue">${getLivePlacement()}</strong></div><div class="metric-line"><span>Richtung</span><strong id="liveDirectionValue">${formatDirectionLabel(state.forceDirection)}</strong></div><div class="metric-line"><span>Aktueller Messwert</span><strong id="liveMeasuredValue">${getMeasuredValue().toFixed(1)} kg</strong></div></div></div>
                  <div class="action-row"><button class="button success" id="saveResult">Resultat speichern</button><button class="button" id="closeEvent">Event abschliessen</button></div>
                  <div class="mini-stats"><div class="mini-card"><small>Aktueller Peak</small><strong id="livePeakValue">${state.peak.toFixed(1)} kg</strong></div><div class="mini-card"><small>Erfasste Versuche</small><strong id="liveCapturedAttempts">${state.liveEntry.attempts.length} / ${state.event.attempts}</strong></div><div class="mini-card"><small>Wertung</small><strong>${state.event.scoringMode}</strong></div></div>
                  ${isDailyChallengeType() ? `<div class="mini-stats">${dailyWinnerCardsMarkup()}</div>` : ""}
                  <p class="muted" id="liveSaveHint" style="margin:18px 0 0;">${state.liveEntry.attempts.length ? "Jetzt speichern oder weitere Versuche durchführen." : "Messung startet automatisch, sobald ein gültiger Versuch erkannt wird."}</p>
                </div>
              </div>
              <div class="grid">
                <div class="card"><div class="card-header"><div><h3>Leaderboard</h3><p>${normalizeForceMode(state.event.forceMode) === "Beide" ? "Getrennte Ranglisten für Ziehen und Drücken." : "Top 10 permanent sichtbar und automatisch aktualisiert."}</p></div></div><div class="grid">${leaderboardSections(10).map((section) => `<div><h4 style="margin:0 0 10px;">${section.title}</h4><table>${leaderboardTable(section.items, section.items.length)}</table></div>`).join("")}</div></div>
                <div class="card"><div class="card-header"><div><h3>Zuschauer QR-Code</h3><p>Verfolge das Event live auf deinem eigenen Gerät.</p></div></div><div class="qr-block"><a class="qr" href="${publicUrl}" target="_blank" rel="noopener noreferrer"><img src="${qrImage(publicUrl)}" alt="QR-Code zur Eventseite" /></a><div><strong><a href="${publicUrl}" target="_blank" rel="noopener noreferrer">${publicUrl}</a></strong><p class="muted">Leaderboard, Resultate und PDF-Export jederzeit direkt auf dem Smartphone oder Tablet öffnen.</p></div></div></div>
              </div>
            </div>
          ` : ""}
          ${page === "public" ? `
            ${publicBrandingSection()}
            <div class="grid two">
              <div class="card"><div class="card-header"><div><h3>${getEventDisplayName()}</h3><p>${getEventSummaryLine()}</p></div><div class="status-badge">${state.event.status}</div></div><div class="metric-list"><div class="metric-line"><span>Veranstalter</span><strong>${state.event.organiser || "DynoForce"}</strong></div>${state.event.organiserEmail ? `<div class="metric-line"><span>Kontakt</span><strong>${state.event.organiserEmail}</strong></div>` : ""}<div class="metric-line"><span>Beschreibung</span><strong>${state.event.description || "Live Event mit öffentlicher Rangliste."}</strong></div></div></div>
              <div class="card"><div class="card-header"><div><h3>Event Statistik</h3><p>Live aus Firestore.</p></div></div><div class="metric-list"><div class="metric-line"><span>Teilnehmerzahl</span><strong>${getParticipantCountLabel()}</strong></div><div class="metric-line"><span>Bestwert</span><strong>${getBestResultLabel()}</strong></div><div class="metric-line"><span>Durchschnitt</span><strong>${getAverageLabel()}</strong></div></div><div class="action-row"><button class="button primary" id="downloadPdf">Seite drucken</button></div></div>
            </div>
            ${isDailyChallengeType() ? `<div class="mini-stats" style="margin-top:18px;">${dailyWinnerCardsMarkup()}</div>` : ""}
            <div class="grid" style="margin-top:18px;">
              <div class="card"><div class="card-header"><div><h3>${normalizeForceMode(state.event.forceMode) === "Beide" ? "Komplette Ranglisten" : "Komplette Rangliste"}</h3><p>${normalizeForceMode(state.event.forceMode) === "Beide" ? "Ziehen und Drücken werden separat gewertet." : "Automatische Aktualisierung während des Events."}</p></div></div><div class="grid">${leaderboardSections(state.results.length || 1).map((section) => `<div><h4 style="margin:0 0 10px;">${section.title}</h4><table>${leaderboardTable(section.items, section.items.length)}</table></div>`).join("")}</div></div>
            </div>
          ` : ""}
          ${page === "display" ? `
            <div class="grid two">
              <div class="card"><div class="eyebrow">Display-Modus</div><h1 class="display-title">${state.event.name}</h1><p class="muted" style="font-size:20px;">Top 10 · ${state.event.challengeType} · Letztes Resultat live</p>${isDailyChallengeType() ? `<div class="mini-stats" style="margin-bottom:18px;">${dailyWinnerCardsMarkup()}</div>` : ""}<div class="grid">${leaderboardSections(10).map((section) => `<div><h4 style="margin:0 0 10px;">${section.title}</h4><table class="display-board">${leaderboardTable(section.items, section.items.length)}</table></div>`).join("")}</div></div>
              <div class="grid"><div class="card"><div class="card-header"><div><h3>Letztes Resultat</h3><p>Optimiert für TV, Beamer und Grossbildschirm.</p></div></div><div style="font-size:44px; font-weight:800; letter-spacing:-0.04em;">${last ? `${last.participantName || last.name} · ${Number(last.value).toFixed(1)} kg` : "Noch kein Resultat"}</div></div><div class="card"><div class="card-header"><div><h3>Teilnehmer live</h3><p>QR-Code permanent sichtbar.</p></div></div><div class="metric-list"><div class="metric-line"><span>Teilnehmerzahl</span><strong>${getParticipantCountLabel()}</strong></div><div class="metric-line"><span>Öffentliche URL</span><strong><a href="${publicUrl}" target="_blank" rel="noopener noreferrer">${publicUrl}</a></strong></div></div><div class="qr-block" style="margin-top:18px;"><a class="qr" href="${publicUrl}" target="_blank" rel="noopener noreferrer"><img src="${qrImage(publicUrl)}" alt="QR-Code zur Eventseite" /></a><div><strong>Live verfolgen</strong><p class="muted">Leaderboard, Statistiken und PDF-Export ohne Login.</p></div></div></div></div>
            </div>
          ` : ""}
        </div>
      </main>
    </div>
  `;
}

function bindGeneralUi() {
  root.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", async () => {
      const page = button.dataset.page;
      const targetEventId = ["setup", "branding", "live", "public", "display"].includes(page)
        ? (state.event.id || getActiveEventId())
        : state.event.id;
      syncUrl(page, targetEventId);
      await routeAndLoad();
    });
  });

  root.querySelector("#connectToggle")?.addEventListener("click", async () => {
    if (state.connected) disconnectDevice();
    else if (!state.connecting) await connectToDevice();
  });

  root.querySelector("#logoutButton")?.addEventListener("click", async () => {
    await signOut(auth);
    setFlash("Abgemeldet.");
  });

  root.querySelector("#loginButton")?.addEventListener("click", async () => {
    try {
      await signInEmail(
        root.querySelector("#loginEmail").value.trim(),
        root.querySelector("#loginPassword").value,
      );
      clearError();
      setFlash("Erfolgreich angemeldet.");
    } catch (error) {
      setError(`Login fehlgeschlagen: ${getAuthErrorMessage(error)}`);
      render();
    }
  });

  root.querySelector("#googleLoginButton")?.addEventListener("click", async () => {
    try {
      await signInGoogle();
      clearError();
      setFlash("Google Login gestartet...");
    } catch (error) {
      setError(`Google Login fehlgeschlagen: ${getAuthErrorMessage(error)}`);
      render();
    }
  });

  const openLoginModal = () => {
    root.querySelector("#loginModalBackdrop")?.classList.add("open");
    window.setTimeout(() => {
      root.querySelector("#loginEmail")?.focus();
    }, 20);
  };

  const closeLoginModal = () => {
    root.querySelector("#loginModalBackdrop")?.classList.remove("open");
  };

  root.querySelector("#openLoginModal")?.addEventListener("click", openLoginModal);
  root.querySelector("#closeLoginModal")?.addEventListener("click", closeLoginModal);
  root.querySelector("#loginModalBackdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "loginModalBackdrop") closeLoginModal();
  });

  if (!state.escapeListenerBound) {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        root.querySelector("#loginModalBackdrop")?.classList.remove("open");
      }
    });
    state.escapeListenerBound = true;
  }

  if (state.user) {
    closeLoginModal();
  }

  root.querySelector("#organizerEventPicker")?.addEventListener("change", async (event) => {
    const eventId = event.target.value;
    if (!eventId) return;
    rememberActiveEventId(eventId);
    const targetPage = ["setup", "branding", "live"].includes(state.currentPage) ? state.currentPage : "setup";
    window.location.assign(getOrganizerPageUrl(targetPage, eventId));
  });

  root.querySelector("#loginPassword")?.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      root.querySelector("#loginButton")?.click();
    }
  });
}

function bindDashboardActions() {
  root.querySelector("#createEvent")?.addEventListener("click", async () => {
    if (!state.user) {
      setError("Bitte zuerst anmelden.");
      render();
      return;
    }
    state.event = {
      ...state.event,
      id: `event-${Date.now()}`,
      name: "Neues DynoForce Event",
      description: "Neue Challenge ohne App und ohne Login.",
      organiser: "Veranstalter",
      organiserEmail: "",
      location: "Ort",
      date: new Date().toISOString().slice(0, 10),
      challengeType: "Maximalkraft",
      forceMode: "Beide",
      gripType: "Standard",
      attempts: 3,
      scoringMode: "Bester Versuch",
      status: "Inaktiv",
      ownerUid: state.user.uid,
      participantCount: 0,
      ...emptyBranding,
    };
    setResults([]);
    state.liveEntry = {
      firstName: "",
      lastName: "",
      attempts: [],
    };
    await saveEvent();
    syncUrl("setup", state.event.id);
    await routeAndLoad();
  });

  root.querySelectorAll("[data-open-event]").forEach((item) => {
    item.addEventListener("click", async () => {
      const eventId = item.dataset.openEvent;
      rememberActiveEventId(eventId);
      window.location.assign(getOrganizerPageUrl("live", eventId));
    });
  });

  root.querySelectorAll("[data-edit-event]").forEach((item) => {
    item.addEventListener("click", async () => {
      const eventId = item.dataset.editEvent;
      rememberActiveEventId(eventId);
      window.location.assign(getOrganizerPageUrl("setup", eventId));
    });
  });

  root.querySelectorAll("[data-delete-event]").forEach((item) => {
    item.addEventListener("click", async () => {
      const eventId = item.dataset.deleteEvent;
      if (!window.confirm("Event wirklich löschen?\n\nAlle Resultate dieses Events werden ebenfalls entfernt.")) {
        return;
      }
      await deleteEventWithResults(eventId);
    });
  });

  root.querySelectorAll("[data-set-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const eventId = button.dataset.setStatus;
      const status = button.dataset.statusValue;
      await updateEventStatus(eventId, status);
    });
  });

  root.querySelectorAll("[data-toggle-status-menu]").forEach((button) => {
    button.addEventListener("click", () => {
      const eventId = button.dataset.toggleStatusMenu;
      root.querySelectorAll("[data-status-menu]").forEach((panel) => {
        if (panel.dataset.statusMenu === eventId) {
          panel.hidden = !panel.hidden;
        } else {
          panel.hidden = true;
        }
      });
    });
  });
}

function bindSetupActions() {
  root.querySelector("#saveSetup")?.addEventListener("click", async () => {
    state.event.name = root.querySelector("#eventNameInput").value.trim() || state.event.name;
    state.event.date = root.querySelector("#eventDateInput").value || state.event.date;
    state.event.organiser = root.querySelector("#organiserInput").value.trim() || state.event.organiser;
    state.event.organiserEmail = root.querySelector("#organiserEmailInput").value.trim();
    state.event.location = root.querySelector("#locationInput").value.trim() || state.event.location;
    state.event.description = root.querySelector("#descriptionInput").value.trim() || state.event.description;
    state.event.challengeType = root.querySelector("#challengeTypeInput").value;
    state.event.forceMode = normalizeForceMode(root.querySelector("#forceModeInput").value);
    state.event.gripType = root.querySelector("#gripTypeInput").value.trim() || state.event.gripType;
    state.event.attempts = Number(root.querySelector("#attemptsInput").value.split(" ")[0]);
    state.event.scoringMode = root.querySelector("#scoringModeInput").value;
    state.event.ownerUid = state.user?.uid || state.event.ownerUid;
    await saveEvent();
  });

  root.querySelector("#startEvent")?.addEventListener("click", async () => {
    state.event.status = "Aktiv";
    await saveEvent();
  });

  root.querySelector("#archiveEvent")?.addEventListener("click", async () => {
    state.event.status = "Inaktiv";
    await saveEvent();
  });

  bindResultEditorActions();
}

function bindBrandingActions() {
  root.querySelectorAll("[data-color]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.event.primaryColor = button.dataset.color;
      await saveEvent();
      document.documentElement.style.setProperty("--primary", state.event.primaryColor);
    });
  });

  root.querySelectorAll("[data-branding-scale]").forEach((input) => {
    const updateScale = () => {
      const scaleField = input.dataset.brandingScale;
      const target = input.dataset.brandingTarget;
      const value = Math.max(50, Math.min(180, Number(input.value || 100)));
      state.event[scaleField] = value;
      root.querySelector(`[data-scale-value="${scaleField}"]`)?.replaceChildren(`${value}%`);
      root.querySelectorAll(`[data-branding-preview="${target}"]`).forEach((element) => {
        element.style.setProperty("--asset-scale", String(value / 100));
      });
    };

    input.addEventListener("input", updateScale);
    input.addEventListener("change", async () => {
      updateScale();
      if (brandingScaleSaveTimer) window.clearTimeout(brandingScaleSaveTimer);
      brandingScaleSaveTimer = window.setTimeout(() => {
        void saveEvent();
      }, 250);
    });
  });

  root.querySelectorAll("[data-header-thumb-scale]").forEach((input) => {
    const updateThumbScale = () => {
      const value = Math.max(60, Math.min(220, Number(input.value || 100)));
      state.event.headerBannerThumbScale = value;
      root.querySelector(`[data-scale-value="headerBannerThumbScale"]`)?.replaceChildren(`${value}%`);
    };

    input.addEventListener("input", updateThumbScale);
    input.addEventListener("change", async () => {
      updateThumbScale();
      await saveEvent();
    });
  });

  root.querySelector("#showVenueLogoInput")?.addEventListener("change", async (event) => {
    state.event.showVenueLogo = event.target.checked;
    await saveEvent();
  });

  root.querySelectorAll("[data-branding-aspect]").forEach((select) => {
    select.addEventListener("change", async () => {
      const aspectField = select.dataset.brandingAspect;
      const target = select.dataset.brandingTarget;
      const value = normalizeBrandingAspect(select.value, state.event[aspectField] || "1 / 1");
      state.event[aspectField] = value;
      root.querySelectorAll(`[data-branding-preview="${target}"]`).forEach((element) => {
        element.style.setProperty("--asset-ratio", value);
      });
      await saveEvent();
    });
  });

  ["eventLogo", "venueLogo", "headerBanner", "sponsorBanner"].forEach((field) => {
    root.querySelector(`#${field}Input`)?.addEventListener("change", async (event) => {
      await uploadBrandingFile(field, event.target.files?.[0]);
    });
  });
}

function bindLiveActions() {
  const syncParticipantInputs = () => {
    syncLiveEntryFromInputs();
    updateLiveMeasurementDom();
  };

  root.querySelector("#participantFirstNameInput")?.addEventListener("input", syncParticipantInputs);
  root.querySelector("#participantFirstNameInput")?.addEventListener("change", syncParticipantInputs);
  root.querySelector("#participantLastNameInput")?.addEventListener("input", syncParticipantInputs);
  root.querySelector("#participantLastNameInput")?.addEventListener("change", syncParticipantInputs);
  syncParticipantInputs();
  root.querySelector("#saveResult")?.addEventListener("click", saveLiveResult);
  root.querySelector("#closeEvent")?.addEventListener("click", async () => {
    state.event.status = "Abgeschlossen";
    state.event.closedAt = new Date().toISOString();
    await saveEvent({ closedAt: serverTimestamp() });
  });
  bindResultEditorActions();
}

function bindResultEditorActions() {
  root.querySelectorAll("[data-update-result]").forEach((button) => {
    button.addEventListener("click", async () => {
      const resultId = button.dataset.updateResult;
      const firstName = root.querySelector(`[data-result-first-name="${resultId}"]`)?.value || "";
      const lastName = root.querySelector(`[data-result-last-name="${resultId}"]`)?.value || "";
      const value = root.querySelector(`[data-result-value="${resultId}"]`)?.value || "";
      await updateResultEntry(resultId, firstName, lastName, value);
    });
  });

  root.querySelectorAll("[data-delete-result]").forEach((button) => {
    button.addEventListener("click", async () => {
      const resultId = button.dataset.deleteResult;
      if (!window.confirm("Resultat wirklich aus der Rangliste entfernen?")) {
        return;
      }
      await deleteResultEntry(resultId);
    });
  });
}

function bindPublicActions() {
  root.querySelector("#downloadPdf")?.addEventListener("click", downloadPdf);
}

function render() {
  hydrateResultsFromCache();
  document.documentElement.style.setProperty("--primary", state.event.primaryColor || "#1f4f46");
  root.innerHTML = template(state.currentPage);
  bindGeneralUi();

  if (state.currentPage === "dashboard") bindDashboardActions();
  if (state.user && state.currentPage === "setup") bindSetupActions();
  if (state.user && state.currentPage === "branding") bindBrandingActions();
  if (state.user && state.currentPage === "live") bindLiveActions();
  if (state.currentPage === "public") bindPublicActions();
}

if (!attemptDetectionTimer) {
  attemptDetectionTimer = window.setInterval(processAttemptDetectionTick, 50);
}

async function routeAndLoad() {
  const route = getRouteInfo();
  state.currentPage = route.page;

  if (route.page === "public" || route.page === "display") {
    safeUnsub("publicEvents");
    await subscribeToEvent(route.eventId);
    render();
    return;
  }

  if (route.page === "dashboard") {
    if (state.user) {
      safeUnsub("publicEvents");
      subscribeToDashboard();
    } else {
      safeUnsub("dashboard");
      subscribeToPublicEvents();
    }
  }

  if (route.page === "setup" || route.page === "branding" || route.page === "live") {
    safeUnsub("publicEvents");
    const organizerEventId = route.eventId || getActiveEventId() || state.event.id;
    if (organizerEventId) {
      state.event.id = organizerEventId;
      if (!route.eventId) {
        syncUrl(route.page, organizerEventId);
      }
      await subscribeToEvent(organizerEventId);
      if (route.page === "setup" || route.page === "live") {
        void refreshResultsForEvent(organizerEventId, { force: true });
      }
    } else {
      state.currentPage = "dashboard";
      syncUrl("dashboard");
      if (state.user) subscribeToDashboard();
      else subscribeToPublicEvents();
    }
  }

  render();

  if (state.user && (route.page === "dashboard" || route.page === "setup" || route.page === "branding" || route.page === "live")) {
    await attemptAutoReconnect();
  }
}

safeUnsub("auth");
state.unsubscribers.auth = onAuthStateChanged(auth, async (user) => {
  state.user = user;
  state.authLoading = false;
  clearError();
  if (user) {
    safeUnsub("publicEvents");
    subscribeToDashboard();
  } else {
    safeUnsub("dashboard");
    subscribeToPublicEvents();
  }
  await routeAndLoad();
});

try {
  await getRedirectResult(auth);
} catch (error) {
  setError(`Google Login fehlgeschlagen: ${getAuthErrorMessage(error)}`);
}

window.addEventListener("popstate", routeAndLoad);
await routeAndLoad();

setInterval(() => {
  if (!state.connected || !isActiveEventStatus(state.event.status)) return;
  state.elapsedSeconds = (state.elapsedSeconds + 1) % 60;
  updateLiveMeasurementDom();
}, 1000);
