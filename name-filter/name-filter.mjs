/**
 * DynoForce nickname filter, reusable in browsers and Node.js.
 * Does not make any network requests when checking names.
 */
export function normalizeNickname(value) {
  return String(value ?? "").normalize("NFC").toLowerCase()
    .trim().replace(/\s+/g, " ");
}

export function createNicknameValidator(config) {
  if (!config || !Array.isArray(config.exact) || !Array.isArray(config.contains)) {
    throw new TypeError("Invalid nickname blacklist");
  }

  const exact = new Set(config.exact.map(normalizeNickname));
  const contains = config.contains.map(normalizeNickname).filter(Boolean);
  const allowed = new Set((config.allowExact ?? []).map(normalizeNickname));

  function isBlocked(name) {
    const normalized = normalizeNickname(name);
    if (!normalized || allowed.has(normalized)) return false;
    return exact.has(normalized) || contains.some(term => normalized.includes(term));
  }

  return {
    isBlocked,
    check(name, alreadyTaken = false) {
      const blocked = isBlocked(name);
      const rejected = blocked || alreadyTaken;
      return {
        accepted: !rejected,
        message: rejected ? config.message : null
      };
    },
    message: config.message
  };
}

// Client-side: call once on page load and cache the returned validator.
// Server-side: read the JSON from disk and call createNicknameValidator().
export async function loadNicknameValidator(
  url = new URL("./dynoforce-name-blacklist.json", import.meta.url)
) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Nickname blacklist could not be loaded");
  return createNicknameValidator(await response.json());
}
