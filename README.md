# DynoGrip Event Website

Diese Website ist für `GitHub Pages` als statisches Frontend mit eigener Domain vorbereitet.

## Hosting

- Frontend: GitHub Pages
- Ziel-Domain: `event.dynoforce.ch`
- Backend: Firebase Auth, Firestore, Storage

## Wichtige URLs

Produktion mit Custom Domain:

- `https://event.dynoforce.ch/`
- `https://event.dynoforce.ch/#/e/{eventId}`
- `https://event.dynoforce.ch/#/display/{eventId}`

Fallback direkt auf GitHub Pages:

- Dashboard: `/Dynoforce_Event_Website/`
- Öffentliche Eventseite: `/Dynoforce_Event_Website/#/e/{eventId}`
- Display-Modus: `/Dynoforce_Event_Website/#/display/{eventId}`

Beispiel:

- `https://vadergit.github.io/Dynoforce_Event_Website/#/e/boulder-jam-2027`

## Lokale Entwicklung

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## GitHub Pages

Die automatische Veröffentlichung läuft über:

- `.github/workflows/deploy-github-pages.yml`

Damit es online funktioniert, muss im GitHub-Repository unter:

- `Settings > Pages`

`GitHub Actions` als Source aktiviert sein.

Zusätzlich:

- unter `Settings > Pages > Custom domain` muss `event.dynoforce.ch` stehen
- die Datei `public/CNAME` sorgt dafür, dass GitHub Pages die Domain mit ausliefert

## DNS

Im DNS von `dynoforce.ch` muss für GitHub Pages eine Subdomain gesetzt werden:

- Typ: `CNAME`
- Host/Name: `event`
- Ziel: `vadergit.github.io`

Nach dem Speichern braucht die DNS-Umstellung oft einige Minuten bis Stunden.

## Firebase Auth

Damit Google Login und E-Mail-Login über die Custom Domain funktionieren, muss in Firebase zusätzlich unter:

- `Authentication > Settings > Authorized domains`

die Domain `event.dynoforce.ch` eingetragen sein.

## Firebase

Genutzt werden:

- Firebase Auth
- Firestore
- Firebase Storage

Die Web-App nutzt standardmässig das bestehende DynoForce Firebase-Projekt `dynoforce`.
