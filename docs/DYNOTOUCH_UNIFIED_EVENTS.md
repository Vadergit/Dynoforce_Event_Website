# DynoTouch – gemeinsame Events und Branding

## Frontend (dieser Branch)

- Zurück zum Haupt-Dashboard, zur DynoTouch-Übersicht und zur Verwaltung von jeder Seite aus.
- Single Target und Multi Target in einer gemeinsamen Eventübersicht und Eventdetailseite, sobald sie dieselbe explizite \`eventGroupId\` besitzen oder Name und Start-/Enddatum (Kalendertag, Zürich) übereinstimmen.
- Separates Leaderboard für jede Disziplin und die Kategorien \`male\`, \`female\` und \`youth\` (unter 16). Bisherige Einträge ohne Kategorie erscheinen transparent als «Nicht zugeordnet».
- Gleiche öffentliche Eventstruktur mit Header, Beschreibung, Veranstalter, Statistik, drei Ranglistenkategorien, Sponsoren-Banner.
- Die sechs statischen Vorlagen BOUBA, BoulderLounge, GrindelBoulder, Kraftreaktor, Minimum und MITO sind wählbar. Zusätzlich werden die vorhandenen, zugriffsberechtigten Firebase-\`brandingPresets\` angezeigt.
- Bilder werden über denselben Storage-Pfad wie das bestehende DynoForce-Branding hochgeladen. Die Oberfläche überprüft nach Speichern die tatsächliche Speicherung im Backend und meldet fehlende Backend-Unterstützung ausdrücklich.

## Noch erforderliche Änderungen am separaten Backend

Der **DynoTouch-Event-Server** liegt gemäss bestehender Architektur *nicht* in diesem GitHub-Repository, sondern im separaten \`event-leaderboard\`-Workspace. Ohne folgende Serveränderungen ist das Feature **nicht produktionsreif**. Bitte Frontend und Backend koordiniert ausrollen.

### 1. Datenschema und Validierung

- In der persistierten Run-/Claim-Tabelle eine nicht-nullbare Kategorie für neue Einträge speichern: \`male | female | youth\`.
- Vorhandene Claims ohne Wert erhalten \`unknown\` / NULL; nicht automatisch anhand des Vornamens zuordnen.
- Ein einmal gewählter Wert gehört zum unveränderlichen Ergebnis. Moderation darf die Kategorie nur in einer auditierbaren Aktion bearbeiten, wenn eine Korrektur nötig ist.
- Claim-Duplikatsprüfung und Rangbildung berücksichtigen **Event-ID und Kategorie**, damit Namensgleichheiten nicht falsch zusammengefasst werden.

### 2. Öffentliche Claim-Schnittstelle

\`POST /api/claim/:token\` nimmt neben \`name\` und \`consent\` neu das Pflichtfeld \`category\` mit genau den drei oben genannten Werten an. Unbekannte oder fehlende Werte werden mit 400 abgelehnt. Kategorie serverseitig validieren und atomar mit dem Claim speichern. Die bestehenden Regeln für Token-Verbrauch, Ablauf und Score-Unveränderlichkeit dürfen nicht verändert werden.

\`GET /api/events/:id?offset=...\` liefert für jeden Ranglisteneintrag \`category\` (optional \`gender\` nur für alte Daten). Bestehende \`score\` und \`duration\` bleiben unverändert. Die API bietet weiterhin vollständig paginierbare Ergebnisse.

### 3. Event-Metadaten und Branding

Die Eventdaten in \`GET /api/events\`, \`GET /api/events/:id\` und \`GET /api/owner/events\` enthalten neu optional:

\`\`\`json
{
  "eventGroupId": "kraftreaktor-2026",
  "description": "Eventbeschreibung",
  "organiser": "Kraftreaktor",
  "location": "Aarau",
  "brandingTemplate": "kraftreaktor-lenzburg-aarau",
  "branding": {
    "headerBanner": "/branding/kraftreaktor-lenzburg-aarau/header-banner-2400x600.jpg",
    "eventLogo": "/branding/kraftreaktor-lenzburg-aarau/eventlogo-df-1000x1000.png",
    "venueLogo": "",
    "sponsorBanner": "/branding/kraftreaktor-lenzburg-aarau/sponsor-footer-2500x500.jpg",
    "showVenueLogo": false,
    "primaryColor": "#1f4f46"
  }
}
\`\`\`

\`PATCH /api/owner/events\` mit \`{id,...metadata}\` akzeptiert diese Felder nur bei verifizierter Firebase-Identität und **nur für Events dieses Veranstalters**. Die vorhandene \`enabled\`-Aktion bleibt erhalten. Gültige Bild-URLs sollen auf eigene Storage- und statische Branding-Pfade beschränkt oder anderweitig sicher validiert werden. Die vom Backend gelieferten Werte müssen nach \`GET /api/events/:id\` sichtbar sein.

Eine \`eventGroupId\` erlaubt es, Single und Multi unter einem Event zusammenzufassen, selbst wenn ihre technischen Zeitfenster leicht abweichen. **Keine Ergebnisse von unterschiedlichen Regeln (mode/mask/targetMs) zu einer einzigen Punktwertung mischen.** Der Browser führt identische Disziplinen zusammen und berechnet innerhalb jeder Kategorie Platzierungen.

### 4. Veröffentlichung

1. D1/Backend-Migration inkl. Validierung, Kategorien und Event-Metadaten implementieren und testen.
2. Backend zuerst veröffentlichen, mit Test-Claims und Test-Events ausserhalb der produktiven Rangliste testen.
3. GitHub-PR prüfen (Build und Tests) und erst danach das Frontend mergen/veröffentlichen.
4. Den Navigationspfad Dashboard → DynoTouch → Event → Dashboard sowie QR-Claim, Live-Refresh und das Speichern von Vorlagen end-to-end prüfen.

**Sicherheit:** Backend-Resultate werden niemals durch den Browser erzeugt, Scores bleiben serverseitig unveränderlich; das Frontend darf kein unberechtigtes Event-Branding schreiben. Die bestehende DynoGrip-/DynoForce-Eventlogik und Firebase-Regeln bleiben unverändert.
