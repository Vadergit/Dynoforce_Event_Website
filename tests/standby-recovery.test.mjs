import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app/main.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} exists`);
  const remaining = source.slice(start);
  const next = remaining.slice(1).search(/\n(?:async )?function /);
  return next < 0 ? remaining : remaining.slice(0, next + 1);
}

function harness({ page = "live", hidden = false, fail = false } = {}) {
  const calls = [];
  let now = 10000;
  let timeout;
  let heartbeat;
  const characteristic = {
    async stopNotifications() {
      calls.push("stop");
      if (fail) throw new Error("GATT suspended");
    },
    async startNotifications() { calls.push("start"); },
    removeEventListener() { calls.push("unbind"); },
    addEventListener() { calls.push("bind"); },
  };
  const state = {
    user: {}, connected: true, currentPage: page, event: { status: "Aktiv" },
    elapsedSeconds: 0,
    ble: {
      stateCharacteristic: characteristic, lastPacketAt: 10001,
      autoReconnectEnabled: true, resumeInFlight: false, lastResumeAt: 0,
      device: { gatt: { connected: true, disconnect() { calls.push("disconnect"); } } },
    },
  };
  const context = vm.createContext({
    state,
    Date: { now: () => now },
    document: { visibilityState: hidden ? "hidden" : "visible" },
    window: { setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() { timeout = null; } },
    setInterval(fn) { heartbeat = fn; },
    console: { warn() {} },
    onStateCharacteristicChanged() {},
    syncParticipantDraftFromInputs() { calls.push("save-draft"); },
    render() { calls.push("render"); },
    updateLiveMeasurementDom() { calls.push("paint"); },
    resumeEventGames() { calls.push("resume-game"); },
    isActiveEventStatus: () => true,
    async attemptAutoReconnect() { calls.push("reconnect"); },
    disconnectCleanup() { calls.push("cleanup"); state.connected = false; },
  });
  vm.runInContext(functionSource("resumeAutoReconnect") + "\n" + functionSource("recoverBleNotifications"), context);
  vm.runInContext(source.slice(source.indexOf("let lastMeasurementHeartbeatAt =")), context);
  return {
    state, context, calls,
    resume() { vm.runInContext("resumeAutoReconnect()", context); },
    async settle() { timeout?.(); timeout = null; await new Promise(resolve => setImmediate(resolve)); },
    advance(ms) { now += ms; },
    heartbeat() { heartbeat(); },
  };
}

test("wake restarts notifications even when battery/status packets still arrive", async () => {
  const h = harness();
  h.resume();
  await h.settle();
  assert.deepEqual(h.calls, ["save-draft", "render", "paint", "stop", "unbind", "bind", "start", "save-draft", "render", "paint"]);
});

test("automatic suspension is detected even without a visibility or focus event", async () => {
  const h = harness();
  h.advance(60000);
  h.heartbeat();
  await h.settle();
  assert.ok(h.calls.includes("start"));
});

test("normal heartbeats do not restart Bluetooth", async () => {
  const h = harness();
  h.advance(1000);
  h.heartbeat();
  await h.settle();
  assert.deepEqual(h.calls, ["paint"]);
});

test("hidden documents defer recovery until visible", async () => {
  const h = harness({ hidden: true });
  h.advance(60000);
  h.heartbeat();
  h.resume();
  await h.settle();
  assert.deepEqual(h.calls, []);
});

test("games resume their loop without recreating their state", async () => {
  const h = harness({ page: "games" });
  h.resume();
  await h.settle();
  assert.ok(h.calls.includes("resume-game"));
  assert.equal(h.calls.includes("render"), false);
});

test("manual disconnect cancels pending notification recovery", async () => {
  const h = harness();
  h.resume();
  h.state.ble.autoReconnectEnabled = false;
  await h.settle();
  assert.equal(h.calls.includes("start"), false);
});

test("failed notification restart reconnects and clears the recovery guard", async () => {
  const h = harness({ fail: true });
  h.resume();
  await h.settle();
  assert.ok(h.calls.includes("reconnect"));
  assert.equal(h.state.ble.resumeInFlight, false);
});

test("successive wake events do not repeatedly restart the stream", async () => {
  const h = harness();
  h.resume();
  await h.settle();
  h.resume();
  await h.settle();
  assert.equal(h.calls.filter(call => call === "start").length, 1);
});
