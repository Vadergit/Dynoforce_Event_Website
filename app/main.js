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
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "./firebase.js";

const BLE = {
  serviceUuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  stateCharacteristicUuid: "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
  commandCharacteristicUuid: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
  infoCharacteristicUuid: "6e400004-b5a3-f393-e0a9-e50e24dcca9e",
  cmdTare: 0x01,
  cmdResetPeak: 0x09,
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
  currentPage: "dashboard",
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
  },
  event: {
    id: "boulder-jam-2027",
    name: "Boulder Jam 2027",
    description: "Offene Publikumschallenge für maximale Fingerkraft mit DynoGrip.",
    organiser: "Boulderhalle Zürich",
    location: "Zürich",
    date: "2027-03-18",
    challengeType: "Maximalkraft",
    forceMode: "Beide",
    gripType: "Sloper 35°",
    attempts: 3,
    scoringMode: "Bester Versuch",
    status: "Live",
    primaryColor: "#1f4f46",
    ownerUid: "",
    createdAt: null,
    closedAt: null,
    ...emptyBranding,
  },
  events: [],
  publicEvents: [],
  results: [],
};

const root = document.getElementById("app");

const pageMeta = {
  dashboard: ["Dashboard", "Alle eigenen Events auf einen Blick mit Status, Teilnehmerzahl und Schnellzugriff."],
  setup: ["Event Setup", "Eventname, Challenge, Wertung und Ablauf in wenigen Schritten konfigurieren."],
  branding: ["Branding", "Hallenlogo, Sponsor Banner und Primärfarbe professionell integrieren."],
  live: ["Live-Messseite", "Zentrale Arbeitsseite für den Organisator mit Gerät, Teilnehmer, Messwert und Top 10."],
  public: ["Öffentliche Eventseite", "Live Leaderboard, Statistik, QR-Code und PDF Download für Teilnehmer und Zuschauer."],
  display: ["Display-Modus", "Optimiert für Beamer, TV und Grossbildschirm mit permanent sichtbarem QR-Code."],
};

const APP_BASE = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
let attemptDetectionTimer = null;

function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "event";
}

function formatDate(dateString) {
  if (!dateString) return "—";
  const [year, month, day] = dateString.split("-");
  return `${day}.${month}.${year}`;
}

function formatLongDate(dateString) {
  return formatDate(dateString);
}

function averageValue() {
  if (!state.results.length) return 0;
  return state.results.reduce((sum, item) => sum + item.value, 0) / state.results.length;
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

function getLiveParticipantDisplayName() {
  return [state.liveEntry.firstName, state.liveEntry.lastName].map((value) => value.trim()).filter(Boolean).join(" ");
}

function getParticipantNameParts() {
  const firstName = (state.liveEntry.firstName || "").trim();
  const lastName = (state.liveEntry.lastName || "").trim();
  return { firstName, lastName, participantName: [firstName, lastName].filter(Boolean).join(" ").trim() };
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
    await addDoc(collection(db, "results"), {
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
    });

    await setDoc(
      doc(db, "events", state.event.id),
      {
        ownerUid: state.user.uid,
        participantCount: state.results.length + 1,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

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

  if (segments[0] === "display") {
    return { page: "display", eventId: segments[1] || state.event.id };
  }

  if (segments[0] === "e") {
    return { page: "public", eventId: segments[1] || state.event.id };
  }

  const page = pageMeta[segments[0]] ? segments[0] : "dashboard";
  return { page, eventId: state.event.id };
}

function getPublicUrl() {
  return `${window.location.origin}${APP_BASE}/#/e/${state.event.id}`;
}

function getDisplayUrl() {
  return `${window.location.origin}${APP_BASE}/#/display/${state.event.id}`;
}

function syncUrl(page) {
  if (page === "public") {
    history.replaceState(null, "", `${APP_BASE}/#/e/${state.event.id}`);
    return;
  }
  if (page === "display") {
    history.replaceState(null, "", `${APP_BASE}/#/display/${state.event.id}`);
    return;
  }
  history.replaceState(null, "", page === "dashboard" ? `${APP_BASE}/` : `${APP_BASE}/#/${page}`);
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

function onBluetoothDisconnected() {
  disconnectCleanup();
  setFlash("DynoGrip Verbindung getrennt.");
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

async function connectToDevice() {
  if (!navigator.bluetooth) {
    setError("Web Bluetooth ist in diesem Browser nicht verfügbar. Bitte Chrome oder Edge verwenden.");
    render();
    return;
  }
  try {
    state.connecting = true;
    state.signal = "Verbinde...";
    clearError();
    render();
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE.serviceUuid] }] });
    device.addEventListener("gattserverdisconnected", onBluetoothDisconnected);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(BLE.serviceUuid);
    const stateCharacteristic = await service.getCharacteristic(BLE.stateCharacteristicUuid);
    const commandCharacteristic = await service.getCharacteristic(BLE.commandCharacteristicUuid);
    const infoCharacteristic = await service.getCharacteristic(BLE.infoCharacteristicUuid);
    state.ble = { device, server, stateCharacteristic, commandCharacteristic, infoCharacteristic };
    await stateCharacteristic.startNotifications();
    stateCharacteristic.addEventListener("characteristicvaluechanged", onStateCharacteristicChanged);
    try {
      state.deviceInfo = parseDeviceInfo(await infoCharacteristic.readValue());
    } catch {}
    state.connected = true;
    state.connecting = false;
    state.signal = "Stabil";
    setFlash(`DynoGrip verbunden${device.name ? `: ${device.name}` : ""}.`);
    render();
  } catch (error) {
    disconnectCleanup();
    setError(error instanceof Error ? error.message : String(error));
    render();
  }
}

function disconnectDevice() {
  try {
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
    location: data.location || "",
    date: data.date || new Date().toISOString().slice(0, 10),
    challengeType: data.challengeType || "Maximalkraft",
    forceMode: normalizeForceMode(data.forceMode),
    gripType: data.gripType || "Freie Challenge",
    attempts: Number(data.attempts || 3),
    scoringMode: data.scoringMode || "Bester Versuch",
    status: data.status || "Geplant",
    primaryColor: data.primaryColor || "#1f4f46",
    ownerUid: data.ownerUid || "",
    createdAt: data.createdAt || null,
    closedAt: data.closedAt || null,
    eventLogo: data.eventLogo || "",
    venueLogo: data.venueLogo || "",
    headerBanner: data.headerBanner || "",
    sponsorBanner: data.sponsorBanner || "",
  };
}

function subscribeToEvent(eventId) {
  safeUnsub("event");
  safeUnsub("results");
  state.eventLoaded = false;
  state.results = [];

  state.unsubscribers.event = onSnapshot(doc(db, "events", eventId), (snapshot) => {
    if (snapshot.exists()) {
      state.event = eventDocToState(snapshot.id, snapshot.data());
      state.eventLoaded = true;
      clearError();
      render();
    } else {
      setError(`Event ${eventId} wurde nicht gefunden.`);
      state.eventLoaded = true;
      render();
    }
  }, (error) => {
    setError(`Event konnte nicht geladen werden: ${error.message}`);
    state.eventLoaded = true;
    render();
  });

  state.unsubscribers.results = onSnapshot(
    query(collection(db, "results"), where("eventId", "==", eventId)),
    (snapshot) => {
      state.results = snapshot.docs.map((resultDoc) => ({
        id: resultDoc.id,
        ...resultDoc.data(),
      })).sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
      render();
    },
    (error) => {
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
          status: data.status,
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
    query(collection(db, "events"), where("status", "==", "Live")),
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
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    state.event[fieldName] = url;
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

async function downloadPdf() {
  try {
    const [{ jsPDF }, { default: QRCode }] = await Promise.all([
      import("jspdf"),
      import("qrcode"),
    ]);
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 40;
    let y = margin;
    const primary = state.event.primaryColor || "#1f4f46";

    const [headerBanner, eventLogo, venueLogo, sponsorBanner, qrCodeDataUrl] = await Promise.all([
      assetToDataUrl(state.event.headerBanner),
      assetToDataUrl(state.event.eventLogo),
      assetToDataUrl(state.event.venueLogo),
      assetToDataUrl(state.event.sponsorBanner),
      QRCode.toDataURL(getPublicUrl(), { margin: 0, width: 180 }),
    ]);

    if (headerBanner) {
      pdf.addImage(headerBanner, imageFormatFromDataUrl(headerBanner), margin, y, pageWidth - margin * 2, 120);
      y += 140;
    }

    pdf.setFillColor(primary);
    pdf.roundedRect(margin, y, pageWidth - margin * 2, 92, 18, 18, "F");
    pdf.setTextColor("#ffffff");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(28);
    pdf.text(getEventDisplayName(), margin + 24, y + 34);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(12);
    pdf.text(getEventSummaryLine() || "DynoForce Event", margin + 24, y + 58);
    pdf.text(state.event.organiser ? `Veranstalter: ${state.event.organiser}` : "Powered by DynoForce", margin + 24, y + 76);

    if (eventLogo) {
      pdf.addImage(eventLogo, imageFormatFromDataUrl(eventLogo), pageWidth - margin - 132, y + 14, 54, 54);
    }
    if (venueLogo) {
      pdf.addImage(venueLogo, imageFormatFromDataUrl(venueLogo), pageWidth - margin - 68, y + 14, 54, 54);
    }

    y += 120;
    pdf.setTextColor("#171717");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.text("Eventübersicht", margin, y);
    y += 18;

    const summaryRows = [
      ["Veranstalter", state.event.organiser],
      ["Beschreibung", state.event.description || "Professionelles Event mit Live-Rangliste und DynoForce Messung."],
      ["Griff", state.event.gripType],
      ["Richtung", normalizeForceMode(state.event.forceMode)],
      ["Wertung", state.event.scoringMode],
      ["Teilnehmer", String(state.results.length)],
      ["Bestwert", `${Number(state.results[0]?.value || 0).toFixed(1)} kg`],
      ["Durchschnitt", `${averageValue().toFixed(1)} kg`],
    ];

    summaryRows.forEach(([label, value]) => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text(`${label}:`, margin, y);
      pdf.setFont("helvetica", "normal");
      const lines = pdf.splitTextToSize(String(value), 280);
      pdf.text(lines, margin + 90, y);
      y += Math.max(18, lines.length * 14);
    });

    if (qrCodeDataUrl) {
      pdf.addImage(qrCodeDataUrl, "PNG", pageWidth - margin - 120, 210, 120, 120);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text("Live verfolgen", pageWidth - margin - 120, 344);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text("event.dynoforce.ch", pageWidth - margin - 120, 360);
      pdf.text("QR-Code mit Smartphone scannen", pageWidth - margin - 120, 374);
    }

    if (sponsorBanner) {
      y += 8;
      pdf.addImage(sponsorBanner, imageFormatFromDataUrl(sponsorBanner), margin, y, pageWidth - margin * 2, 64);
      y += 84;
    } else {
      y += 26;
    }

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.text("Rangliste", margin, y);
    y += 20;

    const tableTop = y;
    const columns = [margin, margin + 34, margin + 250, margin + 360, pageWidth - margin];
    pdf.setDrawColor(221, 216, 207);
    pdf.line(margin, tableTop, pageWidth - margin, tableTop);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text("#", columns[0], tableTop + 14);
    pdf.text("Name", columns[1], tableTop + 14);
    pdf.text("Richtung", columns[2], tableTop + 14);
    pdf.text("Resultat", columns[3], tableTop + 14);
    y = tableTop + 28;

    state.results.forEach((entry, index) => {
      if (y > pageHeight - 60) {
        pdf.addPage();
        y = margin;
      }
      pdf.setDrawColor(221, 216, 207);
      pdf.line(margin, y + 8, pageWidth - margin, y + 8);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.text(String(index + 1), columns[0], y);
      pdf.text(entry.participantName || entry.name || "—", columns[1], y);
      pdf.text(formatEntryDirection(entry), columns[2], y);
      pdf.text(`${Number(entry.value || 0).toFixed(1)} kg`, columns[3], y);
      y += 24;
    });

    pdf.save(`${state.event.id}.pdf`);
  } catch (error) {
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
    <div class="card" style="max-width:420px;margin:60px auto;">
      <div class="card-header">
        <div>
          <h3>Organisator Login</h3>
          <p>Mit bestehendem DynoForce Firebase-Account anmelden.</p>
        </div>
      </div>
      <div class="field-grid">
        <div class="field"><label>E-Mail</label><input id="loginEmail" type="email" placeholder="name@domain.ch" /></div>
        <div class="field"><label>Passwort</label><input id="loginPassword" type="password" placeholder="Passwort" /></div>
      </div>
      <div class="action-row">
        <button class="button primary" id="loginButton">Anmelden</button>
        <button class="button" id="googleLoginButton">Google</button>
      </div>
    </div>
  `;
}

function publicHomeCard() {
  return `
    <div class="card public-home-card">
      <div class="card-header">
        <div>
          <div class="eyebrow">Organisator Login</div>
          <h3>Event verwalten</h3>
          <p>Nach dem Login werden Event Setup, Branding, Live-Messung, öffentliche Eventseite, Display-Modus und die DynoGrip Verbindung freigeschaltet.</p>
        </div>
      </div>
      <div class="action-row">
        <button class="button primary" id="publicLoginButton">Anmelden</button>
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

function brandingPreviewImage(url, label) {
  return url
    ? `<img src="${url}" alt="${label}" style="max-width:100%;border-radius:12px;border:1px solid var(--line);" />`
    : `${label}<br/>Noch kein Upload`;
}

function publicBrandingSection() {
  return `
    <div class="card brand-hero">
      ${state.event.headerBanner ? `<img class="brand-hero-banner" src="${state.event.headerBanner}" alt="Event Banner" />` : ""}
      <div class="brand-hero-content">
        <div class="brand-hero-logos">
          ${state.event.eventLogo ? `<img src="${state.event.eventLogo}" alt="Event Logo" />` : ""}
          ${state.event.venueLogo ? `<img src="${state.event.venueLogo}" alt="Hallenlogo" />` : ""}
        </div>
        <div class="brand-hero-copy">
          <div class="eyebrow">DynoForce Event</div>
          <h1 class="hero-title">${getEventDisplayName()}</h1>
          <div class="brand-hero-meta">${getEventSummaryLine() || "Live Event"}</div>
          <p>${state.event.description || `${state.event.organiser || "Veranstalter"} präsentiert dieses Event.`}</p>
        </div>
      </div>
      ${state.event.sponsorBanner ? `<img class="brand-hero-sponsor" src="${state.event.sponsorBanner}" alt="Sponsor Banner" />` : ""}
    </div>
  `;
}

async function assetToDataUrl(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn("Branding-Asset konnte nicht für PDF geladen werden", url, error);
    return null;
  }
}

function imageFormatFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return "PNG";
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) return "JPEG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "PNG";
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
          <div class="panel">
            <div class="panel-label">Event Status</div>
            <div class="status-row"><div class="status-indicator"><span class="dot ${state.connected ? "" : "off"}"></span><span id="sidebarConnectionLabel">${state.connecting ? "Verbinde..." : state.connected ? "Bereit" : "Nicht verbunden"}</span></div><strong id="sidebarBatteryLabel">${state.connected ? `${state.battery}%` : "—"}</strong></div>
            <div class="status-row"><span class="muted">Gerät</span><strong id="sidebarDeviceLabel">${state.ble.device?.name || "DynoGrip"}</strong></div>
            <div class="action-row"><button class="button ${state.connected ? "" : "primary"}" id="connectToggle">${state.connected ? "Verbindung trennen" : state.connecting ? "Verbinde..." : "DynoGrip verbinden"}</button></div>
            <div class="action-row" style="margin-top:10px;"><button class="button" id="logoutButton">Abmelden</button></div>
          </div>
        ` : `
          <div class="panel">
            <div class="panel-label">Für Organisatoren</div>
            <div class="metric-list">
              <div class="metric-line"><span>Event Setup</span><strong>nach Login</strong></div>
              <div class="metric-line"><span>Branding</span><strong>nach Login</strong></div>
              <div class="metric-line"><span>Live Messung</span><strong>nach Login</strong></div>
            </div>
          </div>
        `}
        <div class="sidebar-footer">
          <strong>DynoForce Event</strong>
          Professioneller Live-Betrieb für Wettkampf, Boulderhalle und Eventfläche.
        </div>
      </aside>
      <main class="content">
        <div class="content-inner">
          <div class="topbar">
            <div><div class="eyebrow">DynoForce Event System</div><h2>${page === "dashboard" ? dashboardTitle : pageMeta[page][0]}</h2><p>${page === "dashboard" ? dashboardText : pageMeta[page][1]}</p></div>
            <div class="top-chip"><span class="dot ${state.connected ? "" : "off"}"></span><span id="topChipLabel">${state.user ? (state.connecting ? "DynoGrip verbindet..." : state.connected ? "Messung bereit" : "DynoGrip nicht verbunden") : "Öffentlicher Modus"}</span></div>
          </div>
          ${(state.lastError || state.flashMessage) ? `<div class="notice ${state.lastError || state.flashType === "error" ? "error" : ""}">${state.lastError || state.flashMessage}</div>` : ""}
          ${page === "dashboard" && !state.user ? `
            <div class="grid two">
              ${publicHomeCard()}
              ${loginCard()}
            </div>
            <div style="margin-top:18px;">
              ${publicEventsSection()}
            </div>
          ` : ""}
          ${!lockedPage && state.user && page === "dashboard" ? `
            <div class="grid two">
              <div class="card">
                <div class="card-header"><div><h3>Meine Events</h3><p>${state.dashboardLoaded ? "Übersicht aller eigenen Veranstaltungen mit Status und Teilnehmerzahl." : "Lade Events aus Firestore..."}</p></div><button class="button primary" id="createEvent">Neues Event</button></div>
                <div class="event-list">
                  ${state.events.map((event) => `<div class="event-item" data-open-event="${event.id}"><div><h4>${event.name}</h4><p>${event.date} · ${event.participants} Teilnehmer · ${event.status}</p></div><div class="status-badge">${event.status}</div></div>`).join("") || `<div class="event-item"><div><h4>Noch keine Events</h4><p>Lege dein erstes Event an und speichere es in Firestore.</p></div></div>`}
                </div>
              </div>
              <div class="grid">
                <div class="card"><div class="card-header"><div><h3>Schnellübersicht</h3><p>Live mit Firestore synchronisiert.</p></div></div><div class="metric-list"><div class="metric-line"><span>Aktives Event</span><strong>${state.event.name}</strong></div><div class="metric-line"><span>Challenge</span><strong>${state.event.challengeType}</strong></div><div class="metric-line"><span>Teilnehmer</span><strong>${state.results.length}</strong></div><div class="metric-line"><span>Status</span><strong>${state.event.status}</strong></div></div></div>
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
                  <div class="field"><label>Ort</label><input id="locationInput" value="${state.event.location}" /></div>
                </div>
                <div class="field-grid" style="margin-top:14px;"><div class="field"><label>Beschreibung</label><textarea id="descriptionInput">${state.event.description}</textarea></div></div>
              </div>
              <div class="card">
                <div class="card-header"><div><h3>Challenge & Wertung</h3><p>Optimiert für schnelles Aufsetzen vor Ort.</p></div></div>
                <div class="field-grid two">
                  <div class="field"><label>Challenge</label><select id="challengeTypeInput"><option ${state.event.challengeType === "Maximalkraft" ? "selected" : ""}>Maximalkraft</option><option ${state.event.challengeType === "Dead Hang" ? "selected" : ""}>Dead Hang</option><option ${state.event.challengeType === "Endurance" ? "selected" : ""}>Endurance</option><option ${state.event.challengeType === "Freie Challenge" ? "selected" : ""}>Freie Challenge</option></select></div>
                  <div class="field"><label>Richtung</label><select id="forceModeInput"><option ${normalizeForceMode(state.event.forceMode) === "Beide" ? "selected" : ""}>Beide</option><option ${normalizeForceMode(state.event.forceMode) === "Ziehen" ? "selected" : ""}>Ziehen</option><option ${normalizeForceMode(state.event.forceMode) === "Drücken" ? "selected" : ""}>Drücken</option></select></div>
                  <div class="field"><label>Griff</label><input id="gripTypeInput" value="${state.event.gripType}" /></div>
                  <div class="field"><label>Versuche</label><select id="attemptsInput"><option ${state.event.attempts === 1 ? "selected" : ""}>1 Versuch</option><option ${state.event.attempts === 3 ? "selected" : ""}>3 Versuche</option><option ${state.event.attempts === 5 ? "selected" : ""}>5 Versuche</option></select></div>
                  <div class="field"><label>Wertung</label><select id="scoringModeInput"><option ${state.event.scoringMode === "Bester Versuch" ? "selected" : ""}>Bester Versuch</option><option ${state.event.scoringMode === "Durchschnitt" ? "selected" : ""}>Durchschnitt</option><option ${state.event.scoringMode === "Letzter Versuch" ? "selected" : ""}>Letzter Versuch</option></select></div>
                </div>
                <div class="action-row"><button class="button primary" id="saveSetup">${state.saving ? "Speichert..." : "Event speichern"}</button><button class="button" id="startEvent">Event starten</button><button class="button" id="archiveEvent">Event archivieren</button></div>
              </div>
            </div>
          ` : ""}
          ${!lockedPage && page === "branding" ? `
            <div class="grid two">
              <div class="card">
                <div class="card-header"><div><h3>Branding</h3><p>Uploads landen direkt in Firebase Storage.</p></div></div>
                <div class="field-grid">
                  <div class="field"><label>Eventlogo</label><input type="file" id="eventLogoInput" accept="image/*" /></div>
                  <div class="field"><label>Hallenlogo</label><input type="file" id="venueLogoInput" accept="image/*" /></div>
                  <div class="field"><label>Header Banner</label><input type="file" id="headerBannerInput" accept="image/*" /></div>
                  <div class="field"><label>Sponsor Banner</label><input type="file" id="sponsorBannerInput" accept="image/*" /></div>
                  <div class="color-box">
                    <div class="panel-label">Primärfarbe</div>
                    <div class="swatches">
                      ${["#1f4f46", "#345d7e", "#8c5a21", "#4f4f4f"].map((color) => `<button class="swatch" data-color="${color}" style="background:${color}"></button>`).join("")}
                    </div>
                  </div>
                </div>
              </div>
              <div class="card">
                <div class="card-header"><div><h3>Branding Vorschau</h3><p>${state.uploading ? `Upload läuft: ${state.uploading}` : "Minimalistisch, professionell, viel Weissraum."}</p></div></div>
                <div class="grid">
                  <div class="brand-preview">${brandingPreviewImage(state.event.eventLogo, "Event Logo")}</div>
                  <div class="brand-preview">${brandingPreviewImage(state.event.venueLogo, "Venue Logo")}</div>
                  <div class="brand-preview">${brandingPreviewImage(state.event.headerBanner, "Header Banner")}</div>
                  <div class="brand-preview">${brandingPreviewImage(state.event.sponsorBanner, "Sponsor Banner")}</div>
                </div>
              </div>
            </div>
          ` : ""}
          ${!lockedPage && page === "live" ? `
            <div class="grid live">
              <div class="grid">
                <div class="card"><div class="card-header"><div><h3>${state.event.name}</h3><p>${state.event.organiser} · ${state.event.challengeType} · ${state.event.scoringMode}</p></div><div class="status-badge">${state.event.status}</div></div></div>
                <div class="card"><div class="card-header"><div><h3>Teilnehmer</h3><p>Zuerst Vorname und Name eingeben. Danach startet die Messung automatisch.</p></div></div><div class="field-grid two"><div class="field"><label>Vorname</label><input id="participantFirstNameInput" value="${state.liveEntry.firstName || ""}" placeholder="Vorname" /></div><div class="field"><label>Name</label><input id="participantLastNameInput" value="${state.liveEntry.lastName || ""}" placeholder="Nachname" /></div></div><div class="metric-list" style="margin-top:14px;"><div class="metric-line"><span>Aktueller Teilnehmer</span><strong id="liveCurrentParticipant">${getLiveParticipantDisplayName() || "Noch kein Teilnehmer erfasst"}</strong></div></div></div>
                <div class="card">
                  <div class="card-header"><div><h3>Live-Messung</h3><p>Die Erkennung folgt derselben Logik wie in der App und zählt gültige Versuche automatisch.</p></div><span id="liveAttemptDisplay">Versuche ${getCompletedAttemptsCount()} / ${state.event.attempts}</span></div>
                  <div class="measure-wrap"><div><div class="force-value"><span id="liveForceValue">${getDisplayForceValue().toFixed(1)}</span><span class="force-unit"> kg</span></div><div class="progress"><div class="progress-bar" id="liveProgressBar" style="width:${Math.max(8, Math.min(100, getDisplayForceValue()))}%"></div></div></div><div class="metric-list"><div class="metric-line"><span>Bester Versuch</span><strong id="liveRecordValue">${Number(record).toFixed(1)} kg</strong></div><div class="metric-line"><span>Aktuelle Platzierung</span><strong id="livePlacementValue">${getLivePlacement()}</strong></div><div class="metric-line"><span>Richtung</span><strong id="liveDirectionValue">${formatDirectionLabel(state.forceDirection)}</strong></div><div class="metric-line"><span>Aktueller Messwert</span><strong id="liveMeasuredValue">${getMeasuredValue().toFixed(1)} kg</strong></div></div></div>
                  <div class="action-row"><button class="button success" id="saveResult">Resultat speichern</button><button class="button" id="closeEvent">Event abschliessen</button></div>
                  <div class="mini-stats"><div class="mini-card"><small>Aktueller Peak</small><strong id="livePeakValue">${state.peak.toFixed(1)} kg</strong></div><div class="mini-card"><small>Erfasste Versuche</small><strong id="liveCapturedAttempts">${state.liveEntry.attempts.length} / ${state.event.attempts}</strong></div><div class="mini-card"><small>Wertung</small><strong>${state.event.scoringMode}</strong></div></div>
                  <p class="muted" id="liveSaveHint" style="margin:18px 0 0;">${state.liveEntry.attempts.length ? "Jetzt speichern oder weitere Versuche durchführen." : "Messung startet automatisch, sobald ein gültiger Versuch erkannt wird."}</p>
                </div>
              </div>
              <div class="grid">
                <div class="card"><div class="card-header"><div><h3>Leaderboard</h3><p>Top 10 permanent sichtbar und automatisch aktualisiert.</p></div></div><table>${leaderboardTable(state.results, 10)}</table></div>
                <div class="card"><div class="card-header"><div><h3>Zuschauer QR-Code</h3><p>Verfolge das Event live auf deinem eigenen Gerät.</p></div></div><div class="qr-block"><a class="qr" href="${publicUrl}" target="_blank" rel="noopener noreferrer"><img src="${qrImage(publicUrl)}" alt="QR-Code zur Eventseite" /></a><div><strong><a href="${publicUrl}" target="_blank" rel="noopener noreferrer">${publicUrl}</a></strong><p class="muted">Leaderboard, Resultate und PDF-Export jederzeit direkt auf dem Smartphone oder Tablet öffnen.</p></div></div></div>
              </div>
            </div>
          ` : ""}
          ${page === "public" ? `
            ${publicBrandingSection()}
            <div class="grid two">
              <div class="card"><div class="card-header"><div><h3>${getEventDisplayName()}</h3><p>${getEventSummaryLine()}</p></div><div class="status-badge">${state.event.status}</div></div><div class="metric-list"><div class="metric-line"><span>Veranstalter</span><strong>${state.event.organiser || "DynoForce"}</strong></div><div class="metric-line"><span>Beschreibung</span><strong>${state.event.description || "Live Event mit öffentlicher Rangliste."}</strong></div></div></div>
              <div class="card"><div class="card-header"><div><h3>Event Statistik</h3><p>Live aus Firestore.</p></div></div><div class="metric-list"><div class="metric-line"><span>Teilnehmerzahl</span><strong>${state.results.length}</strong></div><div class="metric-line"><span>Bestwert</span><strong>${Number(record).toFixed(1)} kg</strong></div><div class="metric-line"><span>Durchschnitt</span><strong>${average.toFixed(1)} kg</strong></div></div><div class="action-row"><button class="button primary" id="downloadPdf">PDF herunterladen</button></div></div>
            </div>
            <div class="grid" style="margin-top:18px;">
              <div class="card"><div class="card-header"><div><h3>Komplette Rangliste</h3><p>Automatische Aktualisierung während des Events.</p></div></div><table>${leaderboardTable(state.results, state.results.length)}</table></div>
            </div>
          ` : ""}
          ${page === "display" ? `
            <div class="grid two">
              <div class="card"><div class="eyebrow">Display-Modus</div><h1 class="display-title">${state.event.name}</h1><p class="muted" style="font-size:20px;">Top 10 · ${state.event.challengeType} · Letztes Resultat live</p><table class="display-board">${leaderboardTable(state.results, 10)}</table></div>
              <div class="grid"><div class="card"><div class="card-header"><div><h3>Letztes Resultat</h3><p>Optimiert für TV, Beamer und Grossbildschirm.</p></div></div><div style="font-size:44px; font-weight:800; letter-spacing:-0.04em;">${last ? `${last.participantName || last.name} · ${Number(last.value).toFixed(1)} kg` : "Noch kein Resultat"}</div></div><div class="card"><div class="card-header"><div><h3>Teilnehmer live</h3><p>QR-Code permanent sichtbar.</p></div></div><div class="metric-list"><div class="metric-line"><span>Teilnehmerzahl</span><strong>${state.results.length}</strong></div><div class="metric-line"><span>Öffentliche URL</span><strong><a href="${publicUrl}" target="_blank" rel="noopener noreferrer">${publicUrl}</a></strong></div></div><div class="qr-block" style="margin-top:18px;"><a class="qr" href="${publicUrl}" target="_blank" rel="noopener noreferrer"><img src="${qrImage(publicUrl)}" alt="QR-Code zur Eventseite" /></a><div><strong>Live verfolgen</strong><p class="muted">Leaderboard, Statistiken und PDF-Export ohne Login.</p></div></div></div></div>
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
      syncUrl(page);
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

  root.querySelector("#publicLoginButton")?.addEventListener("click", async () => {
    root.querySelector("#loginEmail")?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      organiser: state.user.displayName || state.user.email || "Veranstalter",
      location: "Ort",
      date: new Date().toISOString().slice(0, 10),
      challengeType: "Maximalkraft",
      forceMode: "Beide",
      gripType: "Freie Challenge",
      attempts: 3,
      scoringMode: "Bester Versuch",
      status: "Geplant",
      ownerUid: state.user.uid,
      ...emptyBranding,
    };
    state.results = [];
    state.liveEntry = {
      firstName: "",
      lastName: "",
      attempts: [],
    };
    await saveEvent();
    syncUrl("setup");
    await routeAndLoad();
  });

  root.querySelectorAll("[data-open-event]").forEach((item) => {
    item.addEventListener("click", async () => {
      const eventId = item.dataset.openEvent;
      state.event.id = eventId;
      syncUrl("live");
      subscribeToEvent(eventId);
      render();
    });
  });
}

function bindSetupActions() {
  root.querySelector("#saveSetup")?.addEventListener("click", async () => {
    state.event.name = root.querySelector("#eventNameInput").value.trim() || state.event.name;
    state.event.date = root.querySelector("#eventDateInput").value || state.event.date;
    state.event.organiser = root.querySelector("#organiserInput").value.trim() || state.event.organiser;
    state.event.location = root.querySelector("#locationInput").value.trim() || state.event.location;
    state.event.description = root.querySelector("#descriptionInput").value.trim() || state.event.description;
    state.event.challengeType = root.querySelector("#challengeTypeInput").value;
    state.event.forceMode = normalizeForceMode(root.querySelector("#forceModeInput").value);
    state.event.gripType = root.querySelector("#gripTypeInput").value.trim() || state.event.gripType;
    state.event.attempts = Number(root.querySelector("#attemptsInput").value.split(" ")[0]);
    state.event.scoringMode = root.querySelector("#scoringModeInput").value;
    state.event.id = slugify(state.event.name);
    state.event.ownerUid = state.user?.uid || state.event.ownerUid;
    await saveEvent();
  });

  root.querySelector("#startEvent")?.addEventListener("click", async () => {
    state.event.status = "Live";
    await saveEvent();
  });

  root.querySelector("#archiveEvent")?.addEventListener("click", async () => {
    state.event.status = "Archiviert";
    await saveEvent();
  });
}

function bindBrandingActions() {
  root.querySelectorAll("[data-color]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.event.primaryColor = button.dataset.color;
      await saveEvent();
      document.documentElement.style.setProperty("--primary", state.event.primaryColor);
    });
  });

  ["eventLogo", "venueLogo", "headerBanner", "sponsorBanner"].forEach((field) => {
    root.querySelector(`#${field}Input`)?.addEventListener("change", async (event) => {
      await uploadBrandingFile(field, event.target.files?.[0]);
    });
  });
}

function bindLiveActions() {
  root.querySelector("#participantFirstNameInput")?.addEventListener("input", (event) => {
    state.liveEntry.firstName = event.target.value;
    updateLiveMeasurementDom();
  });
  root.querySelector("#participantLastNameInput")?.addEventListener("input", (event) => {
    state.liveEntry.lastName = event.target.value;
    updateLiveMeasurementDom();
  });
  root.querySelector("#saveResult")?.addEventListener("click", saveLiveResult);
  root.querySelector("#closeEvent")?.addEventListener("click", async () => {
    state.event.status = "Abgeschlossen";
    state.event.closedAt = new Date().toISOString();
    await saveEvent({ closedAt: serverTimestamp() });
  });
}

function bindPublicActions() {
  root.querySelector("#downloadPdf")?.addEventListener("click", downloadPdf);
}

function render() {
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
    subscribeToEvent(route.eventId);
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
    if (state.event.id) {
      subscribeToEvent(state.event.id);
    }
  }

  render();
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
  if (!state.connected || state.event.status !== "Live") return;
  state.elapsedSeconds = (state.elapsedSeconds + 1) % 60;
  updateLiveMeasurementDom();
}, 1000);
