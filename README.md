# DynoGrip Event Website

Diese Website ist für `GitHub Pages` als statisches Frontend vorbereitet.

## Hosting

- Frontend: GitHub Pages
- Backend: Firebase Auth, Firestore, Storage

## Wichtige URLs auf GitHub Pages

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

## Firebase

Genutzt werden:

- Firebase Auth
- Firestore
- Firebase Storage

Die Web-App nutzt standardmässig das bestehende DynoForce Firebase-Projekt.
