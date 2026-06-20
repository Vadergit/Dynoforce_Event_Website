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
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
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
const ATTEMPT_END_THRESHOLD = 1.0;

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
  elapsedSeconds: 0,
  goal: 90,
  flashMessage: "",
  flashType: "info",
  lastError: "",
  deviceInfo: null,
  saving: false,
  uploading: "",
  liveEntry: {
    participantName: "",
    attemptNumber: 1,
  },
  dashboardLoaded: false,
  eventLoaded: false,
  currentPage: "dashboard",
  unsubscribers: {
    auth: null,
    dashboard: null,
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

function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "event";
}

function formatDate(dateString) {
  if (!dateString) return "—";
  const [year, month, day] = dateString.split("-");
  return `${day}.${month}.${year}`;
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

function getLiveParticipantName() {
  return state.liveEntry.participantName || "";
}

function getLiveAttemptNumber() {
  return Number(state.liveEntry.attemptNumber) || Number(state.currentAttempt) || 1;
}

function getMeasuredValue() {
  const peakValue = Number(state.peak.toFixed(1));
  const currentValue = Number(state.currentForce.toFixed(1));

  if (state.event.challengeType === "Maximalkraft") {
    return Math.max(0, peakValue || currentValue || 0);
  }

  return Math.max(0, currentValue || peakValue || 0);
}

function getSelectedForceModeKey() {
  const mode = normalizeForceMode(state.event.forceMode);
  if (mode === "Ziehen") return "pull";
  if (mode === "Drücken") return "push";
  return "both";
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

  if (!state.isInAttempt && absForce >= ATTEMPT_START_THRESHOLD && isDirectionAllowed(direction)) {
    state.isInAttempt = true;
  } else if (state.isInAttempt && absForce < ATTEMPT_END_THRESHOLD) {
    state.isInAttempt = false;
    state.lockedMode = null;
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
    query(collection(db, "results"), where("eventId", "==", eventId), orderBy("value", "desc")),
    (snapshot) => {
      state.results = snapshot.docs.map((resultDoc) => ({
        id: resultDoc.id,
        ...resultDoc.data(),
      }));
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
    query(collection(db, "events"), where("ownerUid", "==", state.user.uid), orderBy("date", "desc")),
    (snapshot) => {
      state.events = snapshot.docs.map((eventDoc) => {
        const data = eventDoc.data();
        return {
          id: eventDoc.id,
          name: data.name,
          date: formatDate(data.date),
          status: data.status,
          participants: Number(data.participantCount || 0),
        };
      });
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
  if (!state.user) {
    setError("Bitte als Organisator anmelden, bevor Resultate gespeichert werden.");
    render();
    return;
  }
  const name = getLiveParticipantName().trim() || "Gast";
  const attemptNumber = getLiveAttemptNumber();
  const measured = getMeasuredValue();
  const forceMode = state.peakDirection === "push" ? "push" : state.peakDirection === "pull" ? "pull" : state.lockedMode;

  if (measured <= 0) {
    setError("Noch kein Messwert vorhanden. Bitte zuerst eine Messung durchführen.");
    render();
    return;
  }

  if (!forceMode || !isDirectionAllowed(forceMode)) {
    const selectedMode = normalizeForceMode(state.event.forceMode);
    setError(`Dieser Versuch passt nicht zur gewählten Richtung (${selectedMode}).`);
    render();
    return;
  }

  if (!state.event.id) {
    setError("Es ist noch kein Event ausgewählt.");
    render();
    return;
  }

  try {
    await addDoc(collection(db, "results"), {
      eventId: state.event.id,
      ownerUid: state.user.uid,
      participantName: name,
      value: measured,
      unit: "kg",
      forceMode,
      attemptNumber,
      createdAt: serverTimestamp(),
    });

    await updateDoc(doc(db, "events", state.event.id), {
      participantCount: state.results.length + 1,
      updatedAt: serverTimestamp(),
    });

    state.currentAttempt = Math.min(attemptNumber + 1, state.event.attempts);
    state.liveEntry.participantName = "";
    state.liveEntry.attemptNumber = state.currentAttempt;
    state.peak = 0;
    state.rawPeak = 0;
    state.peakDirection = "neutral";
    state.lockedMode = null;
    state.isInAttempt = false;
    setFlash(`Resultat gespeichert: ${name} · ${measured.toFixed(1)} kg`);
    render();
  } catch (error) {
    setError(`Resultat speichern fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    render();
  }
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

function escapePdfText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function downloadPdf() {
  const lines = [
    "DynoGrip Event Export",
    `Eventname: ${state.event.name}`,
    `Veranstalter: ${state.event.organiser}`,
    `Ort: ${state.event.location}`,
    `Datum: ${formatDate(state.event.date)}`,
    `Challenge: ${state.event.challengeType}`,
    `Grip Type: ${state.event.gripType}`,
    `Wertung: ${state.event.scoringMode}`,
    `Status: ${state.event.status}`,
    `Teilnehmerzahl: ${state.results.length}`,
    `Bestwert: ${(state.results[0]?.value || 0).toFixed(1)} kg`,
    `Durchschnitt: ${averageValue().toFixed(1)} kg`,
    `Public URL: ${getPublicUrl()}`,
    "Powered by DynoForce",
    ...state.results.map((entry, index) => `${index + 1}. ${entry.participantName || entry.name} - ${Number(entry.value).toFixed(1)} kg`),
  ];

  const content = ["BT", "/F1 12 Tf", "40 800 Td"];
  lines.forEach((line, index) => {
    if (index > 0) content.push("0 -18 Td");
    content.push(`(${escapePdfText(line)}) Tj`);
  });
  content.push("ET");

  const stream = content.join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object) => {
    offsets.push(pdf.length);
    pdf += `${object}\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const blob = new Blob([pdf], { type: "application/pdf" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.event.id}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function leaderboardTable(items, limit) {
  return `
    <tr><th>#</th><th>Name</th><th>Resultat</th></tr>
    ${items.slice(0, limit).map((item, index) => `
      <tr>
        <td><span class="rank-pill">${index + 1}</span></td>
        <td>${item.participantName || item.name}</td>
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

  setText("liveForceValue", state.currentForce.toFixed(1));
  setText("liveRecordValue", Number(state.results[0]?.value || 0).toFixed(1));
  setText("liveGoalValue", state.goal.toFixed(1));
  setText("liveDirectionValue", state.forceDirection === "pull" ? "Ziehen" : state.forceDirection === "push" ? "Drücken" : "Neutral");
  setText("liveMeasuredValue", `${getMeasuredValue().toFixed(1)} kg`);
  setText("livePeakValue", `${state.peak.toFixed(1)} kg`);
  setText("livePeakDirectionValue", state.peakDirection === "pull" ? "Ziehen" : state.peakDirection === "push" ? "Drücken" : "—");
  setText("liveElapsedValue", `00:${String(state.elapsedSeconds).padStart(2, "0")}`);
  setText("liveScoreValue", String(Math.round(state.peak * 10)));
  setText("liveConnectionValue", state.connecting ? "Verbinde..." : state.connected ? "Verbunden" : "Nicht verbunden");
  setText("liveBatteryValue", state.connected ? `${state.battery}%` : "—");
  setText("liveSignalValue", state.deviceInfo ? `${state.signal} · FW ${state.deviceInfo.fwVersion}` : state.signal);
  setText("sidebarConnectionLabel", state.connecting ? "Verbinde..." : state.connected ? "Verbunden" : "Nicht verbunden");
  setText("sidebarBatteryLabel", state.connected ? `${state.battery}%` : "—");
  setText("sidebarSignalLabel", state.deviceInfo ? `${state.signal} · FW ${state.deviceInfo.fwVersion}` : state.signal);
  setText("sidebarDeviceLabel", state.ble.device?.name || "Kein Gerät");
  setText("topChipLabel", state.connecting ? "DynoGrip verbindet..." : state.connected ? `DynoGrip verbunden${state.ble.device?.name ? ` · ${state.ble.device.name}` : ""}` : "DynoGrip nicht verbunden");
  setText("liveAttemptDisplay", `Versuch ${getLiveAttemptNumber()} / ${state.event.attempts}`);

  const progressBar = document.getElementById("liveProgressBar");
  if (progressBar) {
    progressBar.style.width = `${Math.max(8, Math.min(100, state.currentForce))}%`;
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

function brandingPreviewImage(url, label) {
  return url
    ? `<img src="${url}" alt="${label}" style="max-width:100%;border-radius:12px;border:1px solid var(--line);" />`
    : `${label}<br/>Noch kein Upload`;
}

function template(page) {
  const publicUrl = getPublicUrl();
  const displayUrl = getDisplayUrl();
  const record = state.results[0]?.value || 0;
  const average = averageValue();
  const last = state.results[state.results.length - 1];
  const placement = state.results.findIndex((entry) => (entry.participantName || entry.name) === getLiveParticipantName()) + 1;
  const lockedPage = !state.user && ["dashboard", "setup", "branding", "live"].includes(page);

  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">DF</div>
          <div><h1>DynoGrip Event</h1><p>Powered by DynoForce</p></div>
        </div>
        <nav class="nav">
          ${Object.keys(pageMeta).map((key) => `<button data-page="${key}" class="${page === key ? "active" : ""}">${pageMeta[key][0]}</button>`).join("")}
        </nav>
        <div class="panel">
          <div class="panel-label">Gerätestatus</div>
          <div class="status-row"><div class="status-indicator"><span class="dot ${state.connected ? "" : "off"}"></span><span id="sidebarConnectionLabel">${state.connecting ? "Verbinde..." : state.connected ? "Verbunden" : "Nicht verbunden"}</span></div><strong id="sidebarBatteryLabel">${state.connected ? `${state.battery}%` : "—"}</strong></div>
          <div class="status-row"><span class="muted">Signal</span><strong id="sidebarSignalLabel">${state.deviceInfo ? `${state.signal} · FW ${state.deviceInfo.fwVersion}` : state.signal}</strong></div>
          <div class="status-row"><span class="muted">Gerät</span><strong id="sidebarDeviceLabel">${state.ble.device?.name || "Kein Gerät"}</strong></div>
          <div class="action-row"><button class="button" id="connectToggle">${state.connected ? "Verbindung trennen" : state.connecting ? "Verbinde..." : "DynoGrip verbinden"}</button></div>
        </div>
        <div class="panel">
          <div class="panel-label">Organisator</div>
          <div class="status-row"><span class="muted">Status</span><strong>${state.authLoading ? "Prüfe..." : state.user ? "Angemeldet" : "Nicht angemeldet"}</strong></div>
          <div class="status-row"><span class="muted">Account</span><strong>${state.user?.email || "—"}</strong></div>
          ${state.user ? `<div class="action-row"><button class="button" id="logoutButton">Abmelden</button></div>` : ""}
        </div>
        <div class="sidebar-footer">
          <strong>Firebase aktiv</strong>
          Public und Display lesen live aus Firestore. Organizer-Seiten sind an Firebase Auth gekoppelt. Branding-Dateien werden in Firebase Storage abgelegt.
        </div>
      </aside>
      <main class="content">
        <div class="content-inner">
          <div class="topbar">
            <div><div class="eyebrow">DynoGrip Event System</div><h2>${pageMeta[page][0]}</h2><p>${pageMeta[page][1]}</p></div>
            <div class="top-chip"><span class="dot ${state.connected ? "" : "off"}"></span><span id="topChipLabel">${state.connecting ? "DynoGrip verbindet..." : state.connected ? `DynoGrip verbunden${state.ble.device?.name ? ` · ${state.ble.device.name}` : ""}` : "DynoGrip nicht verbunden"}</span></div>
          </div>
          ${(state.lastError || state.flashMessage) ? `<div class="notice ${state.lastError || state.flashType === "error" ? "error" : ""}">${state.lastError || state.flashMessage}</div>` : ""}
          ${lockedPage ? loginCard() : ""}
          ${!lockedPage && page === "dashboard" ? `
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
                  <div class="field"><label>Grip Type</label><input id="gripTypeInput" value="${state.event.gripType}" /></div>
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
                <div class="card">
                  <div class="card-header"><div><h3>Live-Messung</h3><p>Grosse zentrale Anzeige für aktuelle Kraft, Peak, Zeit und Zielwert.</p></div><span id="liveAttemptDisplay">Versuch ${getLiveAttemptNumber()} / ${state.event.attempts}</span></div>
                  <div class="measure-wrap"><div><div class="force-value"><span id="liveForceValue">${state.currentForce.toFixed(1)}</span><span class="force-unit"> kg</span></div><div class="progress"><div class="progress-bar" id="liveProgressBar" style="width:${Math.max(8, Math.min(100, state.currentForce))}%"></div></div></div><div class="metric-list"><div class="metric-line"><span>Aktueller Rekord</span><strong id="liveRecordValue">${Number(record).toFixed(1)}</strong></div><div class="metric-line"><span>Zielwert</span><strong id="liveGoalValue">${state.goal.toFixed(1)}</strong></div><div class="metric-line"><span>Platzierung</span><strong>${placement > 0 ? `#${placement}` : "Neu"}</strong></div><div class="metric-line"><span>Richtung</span><strong id="liveDirectionValue">${state.forceDirection === "pull" ? "Ziehen" : state.forceDirection === "push" ? "Drücken" : "Neutral"}</strong></div><div class="metric-line"><span>Speicherwert</span><strong id="liveMeasuredValue">${getMeasuredValue().toFixed(1)} kg</strong></div></div></div>
                  <div class="action-row"><button class="button primary" id="resetPeak" ${!state.connected ? "disabled" : ""}>Peak zurücksetzen</button><button class="button" id="tareButton" ${!state.connected ? "disabled" : ""}>Tare senden</button><button class="button success" id="saveResult">Resultat speichern</button><button class="button" id="closeEvent">Event abschliessen</button></div>
                  <div class="mini-stats"><div class="mini-card"><small>Peak</small><strong id="livePeakValue">${state.peak.toFixed(1)} kg</strong></div><div class="mini-card"><small>Peak Richtung</small><strong id="livePeakDirectionValue">${state.peakDirection === "pull" ? "Ziehen" : state.peakDirection === "push" ? "Drücken" : "—"}</strong></div><div class="mini-card"><small>Zeit</small><strong id="liveElapsedValue">00:${String(state.elapsedSeconds).padStart(2, "0")}</strong></div><div class="mini-card"><small>Punktzahl</small><strong id="liveScoreValue">${Math.round(state.peak * 10)}</strong></div></div>
                </div>
                <div class="grid two">
                  <div class="card"><div class="card-header"><div><h3>Gerätebereich</h3><p>Web Bluetooth Status, Akku und Signal.</p></div></div><div class="metric-list"><div class="metric-line"><span>Verbindung</span><strong id="liveConnectionValue">${state.connecting ? "Verbinde..." : state.connected ? "Verbunden" : "Nicht verbunden"}</strong></div><div class="metric-line"><span>Akkustand</span><strong id="liveBatteryValue">${state.connected ? `${state.battery}%` : "—"}</strong></div><div class="metric-line"><span>Signal</span><strong id="liveSignalValue">${state.deviceInfo ? `${state.signal} · FW ${state.deviceInfo.fwVersion}` : state.signal}</strong></div></div></div>
                  <div class="card"><div class="card-header"><div><h3>Teilnehmerbereich</h3><p>Kein Login erforderlich.</p></div></div><div class="field-grid"><div class="field"><label>Name</label><input id="participantNameInput" value="${getLiveParticipantName()}" placeholder="Teilnehmername" /></div><div class="field"><label>Versuch Nummer</label><input id="participantAttemptInput" type="number" min="1" max="${state.event.attempts}" value="${getLiveAttemptNumber()}" /></div></div></div>
                </div>
              </div>
              <div class="grid">
                <div class="card"><div class="card-header"><div><h3>Leaderboard</h3><p>Top 10 permanent sichtbar und automatisch aktualisiert.</p></div></div><table>${leaderboardTable(state.results, 10)}</table></div>
                <div class="card"><div class="card-header"><div><h3>Zuschauer QR-Code</h3><p>Öffnet die öffentliche Eventseite unter <code>/e/{eventId}</code>.</p></div></div><div class="qr-block"><a class="qr" href="${publicUrl}" target="_blank" rel="noopener noreferrer"><img src="${qrImage(publicUrl)}" alt="QR-Code zur Eventseite" /></a><div><strong><a href="${publicUrl}" target="_blank" rel="noopener noreferrer">${publicUrl}</a></strong><p class="muted">Zuschauer können die Rangliste live verfolgen, teilen und den PDF-Export öffnen.</p></div></div></div>
              </div>
            </div>
          ` : ""}
          ${page === "public" ? `
            <div class="grid two">
              <div class="card"><div class="card-header"><div><h3>${state.event.name}</h3><p>${state.event.location} · ${formatDate(state.event.date)} · ${state.event.challengeType}</p></div><div class="status-badge">${state.event.status}</div></div></div>
              <div class="card"><div class="card-header"><div><h3>Event Statistik</h3><p>Live aus Firestore.</p></div></div><div class="metric-list"><div class="metric-line"><span>Teilnehmerzahl</span><strong>${state.results.length}</strong></div><div class="metric-line"><span>Bestwert</span><strong>${Number(record).toFixed(1)} kg</strong></div><div class="metric-line"><span>Durchschnitt</span><strong>${average.toFixed(1)} kg</strong></div></div><div class="action-row"><button class="button primary" id="downloadPdf">PDF herunterladen</button></div></div>
            </div>
            <div class="grid two" style="margin-top:18px;">
              <div class="card"><div class="card-header"><div><h3>Komplette Rangliste</h3><p>Automatische Aktualisierung während des Events.</p></div></div><table>${leaderboardTable(state.results, state.results.length)}</table></div>
              <div class="grid"><div class="card"><div class="card-header"><div><h3>QR-Code</h3><p>Direktlink für Zuschauer.</p></div></div><div class="qr-block"><a class="qr" href="${publicUrl}" target="_blank" rel="noopener noreferrer"><img src="${qrImage(publicUrl)}" alt="QR-Code zur Eventseite" /></a><div><strong><a href="${publicUrl}" target="_blank" rel="noopener noreferrer">${publicUrl}</a></strong><p class="muted">Live Rangliste ansehen, Event teilen und Resultate verfolgen.</p></div></div></div></div>
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
      name: "Neues DynoGrip Event",
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
      participantName: "",
      attemptNumber: 1,
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
  root.querySelector("#participantNameInput")?.addEventListener("input", (event) => {
    state.liveEntry.participantName = event.target.value;
  });
  root.querySelector("#participantAttemptInput")?.addEventListener("input", (event) => {
    const nextAttempt = Number(event.target.value);
    state.liveEntry.attemptNumber = Number.isFinite(nextAttempt) && nextAttempt > 0 ? nextAttempt : 1;
  });
  root.querySelector("#tareButton")?.addEventListener("click", () => sendCommand(new Uint8Array([BLE.cmdTare])));
  root.querySelector("#resetPeak")?.addEventListener("click", () => {
    state.peak = 0;
    state.currentForce = 0;
    state.rawPeak = 0;
    state.peakDirection = "neutral";
    state.lockedMode = null;
    state.isInAttempt = false;
    sendCommand(new Uint8Array([BLE.cmdResetPeak]));
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
  if (!state.liveEntry.attemptNumber) {
    state.liveEntry.attemptNumber = state.currentAttempt || 1;
  }
  root.innerHTML = template(state.currentPage);
  bindGeneralUi();

  if (state.user || ["public", "display"].includes(state.currentPage)) {
    if (state.currentPage === "dashboard") bindDashboardActions();
    if (state.currentPage === "setup") bindSetupActions();
    if (state.currentPage === "branding") bindBrandingActions();
    if (state.currentPage === "live") bindLiveActions();
    if (state.currentPage === "public") bindPublicActions();
  }
}

async function routeAndLoad() {
  const route = getRouteInfo();
  state.currentPage = route.page;

  if (route.page === "public" || route.page === "display") {
    subscribeToEvent(route.eventId);
    render();
    return;
  }

  if (route.page === "dashboard") {
    subscribeToDashboard();
  }

  if (route.page === "setup" || route.page === "branding" || route.page === "live") {
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
    subscribeToDashboard();
  } else {
    safeUnsub("dashboard");
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
  render();
}, 1000);
