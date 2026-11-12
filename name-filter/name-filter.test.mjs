import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createNicknameValidator } from "./name-filter.mjs";

const file = readFileSync(new URL("./dynoforce-name-blacklist.json", import.meta.url), "utf8");
const data = JSON.parse(file);
const validator = createNicknameValidator(data);
const blocked = ["Löli", "loeli", "Fudli", "Arschloch", "Arschloch123", "Hurensohn", "bitch", "shithead"];
const allowed = ["Dario", "BoulderKing", "Ninja", "zombie", "assassin", "NightRider", "SuperLöli"];
for (const name of blocked) assert.equal(validator.isBlocked(name), true, name);
for (const name of allowed) assert.equal(validator.isBlocked(name), false, name);
assert.equal(validator.check("Löli").message, data.message);
assert.equal(validator.check("Dario", true).message, data.message);
assert.ok(data.exact.length > 11000, "Expected an extended list");
console.log("Tests passed", { blocked: blocked.length, allowed: allowed.length, entries: data.exact.length });
