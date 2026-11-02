# DynoTouch event leaderboards

The existing DynoGrip events and Firebase collections are unchanged. DynoTouch is
an additional section at `https://event.dynoforce.ch/#/dynotouch`.

## Organizer setup

1. Sign in using the existing event website login (Firebase project `dynoforce`).
2. Open DynoTouch → Veranstalter and create a board key. It is shown only once.
3. In the board's local web portal open Settings → Events, paste that key, save.
4. Create an event there: name, active dates, moderation password, QR duration
   (default 20 seconds), and return window (default 120 seconds).
5. Select the event, apply its fixed game rules and enable event mode.

The MPR121 must be enabled for public competition. LED-only testing remains
available locally, but is not accepted as a verified public competition run.

## Player flow

A completed run is first recorded locally and sent over verified HTTPS. Once
accepted, the display shows a QR code. Scanning opens the existing domain and
lets the player enter a public nickname with consent. A token can be claimed
only once, atomically on the server, even with simultaneous requests. Expiration
is enforced by the server. The first person to submit a photographed QR wins;
this is not identity verification of the athlete.

Ranking is score descending, then duration ascending. Equal score and duration
share a rank. Public pages show claimed, visible entries only.

## Moderation and security

The event owner uses the existing Firebase login. Alternatively an event-specific
password opens moderation for that event. Rename/hide changes are audited;
neither action releases a used QR. Scores cannot be edited in the public form.
Device keys are hashed server-side; event passwords are salted PBKDF2 hashes.
Only the exact website origin is allowed to use authenticated cross-origin APIs.
Moderator sessions are held in memory, not browser local storage.

## Backend and deployment

GitHub Pages remains the frontend. The stateful API and D1 database run at
`https://dynoforce-events.dario-neuenschwander.chatgpt.site` (Sites project
`appgprj_6ae8c03db9748191937c46fccb58eacf`). No DNS changes are required.
The backend source is in the DynoTouch firmware workspace's `event-leaderboard`
checkout. Deploy that backend before releasing API-dependent frontend changes.
Firebase ID tokens are verified against Google's signing keys with the expected
issuer and audience. No additional ChatGPT login is used.

`VITE_DYNOTOUCH_API_URL` can override the public API URL for local testing; it is
not a secret. Never place device keys or moderator passwords in build variables.

Frontend checks: `npm run build` and `node --test tests/*.test.mjs`.
The existing main-branch GitHub Pages workflow publishes the frontend.
Backend tests cover concurrent claims, immutable results, authorization,
moderation, expired tokens, fixed rules and disabled events. They create fixtures
only in the local database, never on the public site.

If the board has no trustworthy network time or cannot upload, the local game log
remains the record. Public QR entry is not available until a run is accepted.
