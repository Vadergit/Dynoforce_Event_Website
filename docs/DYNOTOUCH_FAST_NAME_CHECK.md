# DynoTouch: sofortiger Namenscheck und Natel-Vorausfüllung

## Frontend-Umsetzung (dieses Repository)

- Falls der Server bereits bei **GET /api/claim/:token** ein vollständiges Array `nameIndex: [{name, category}, ...]` für genau diese Disziplin zurückgibt, wird es sofort ohne weitere Netzwerkanfrage verwendet. Andernfalls startet beim QR-Öffnen **eine** Hintergrundabfrage der öffentlichen Event-Ergebnisse. Falls die API bereits 100 Resultate liefert, werden weitere Seiten abgerufen. Die erste Seite des Events wird aus der Eventantwort wiederverwendet.
- Der Vergleich während des Tippens erfolgt **synchron im lokalen Speicher (Set)**: keine künstliche 300- oder 500-ms-Wartezeit und keine Anfrage pro Tastendruck. Eine Netzwerklatenz beim erstmaligen Laden der Ranglisten kann jedoch nicht garantiert werden. Währenddessen steht «Namen werden geladen».
- Gematcht wird nur gegen dieselbe Event-Gruppe, denselben Modus (Single/Multi), **identische Spielregeln** und dieselbe Kategorie Mann/Frau/Jugendliche unter 16.
- Gleicher Name: Hinweis «Bist du dieselbe Person?» mit «Ja» / «Nein, anderer Name». «Ja» bestätigt die Verwendung des Namens; der Claim bleibt ein neues unveränderliches Resultat. Die öffentliche Rangliste zeigt weiterhin nur den besten Versuch pro Name/Kategorie/Disziplin.
- Nach einem **erfolgreichen** Claim wird ausschliesslich der letzte Anzeigename und die Kategorie für exakt diese Event-ID lokal auf diesem Natel gespeichert. Beim nächsten Scan sind diese Felder vorausgefüllt; für denselben Namen + Kategorie kommt keine Wiederholungswarnung. Ein anderer Name oder eine andere Kategorie wird normal geprüft. Auf einem gemeinsam verwendeten Natel gibt es zusätzlich den Ein-Klick-Button **«Anderer Teilnehmer»**, der Name und Kategorie zurücksetzt und die lokale Vorausfüllung für dieses Event löscht.
- Einwilligung, QR-Tokens und Ergebnisse werden **nicht** lokal gespeichert. Die Einwilligung ist für jeden Claim erneut erforderlich.
- Scheitert die öffentliche Namensabfrage, behauptet das System nicht, der Name sei verfügbar; ein ausdrückliches «Trotzdem fortfahren» bleibt möglich, damit ein QR-Ergebnis bei einem kurzen API-Ausfall nicht verloren gehen muss.
- Der Eventeditor hat einen Schalter «Bestehende Namen … erneut verwenden». Die Speicherung wird wie bei anderen erweiterten Metadaten serverseitig per GET verifiziert. Ohne Backend-Unterstützung erscheint eine Fehlermeldung statt einer falschen Erfolgsmeldung.

## Backend-Vertrag (separater DynoTouch-Event-Server)

**Das Backend liegt im separaten `event-leaderboard`-Workspace, nicht in `Dynoforce_Event_Website`.** Es wird separat veröffentlicht. Der Abschluss vom 03.11.2026 implementiert folgende Anforderungen:

1. `allowExistingName` pro Event in der Datenbank persistieren und über `GET /api/events/:id` und `GET /api/owner/events` ausliefern. `PATCH /api/owner/events` akzeptiert die Einstellung nur für berechtigte Veranstalter.
2. Einen **schnellen, indexgestützten Namenscheck** anbieten, idealerweise direkt in `GET /api/claim/:token` mit `nameIndex: [{name, category}, ...]` als vollständige Liste der Namen je Kategorie und identischer Disziplin sowie `allowExistingName`. Die aktuelle Frontend-Version unterstützt dieses Antwortformat bereits und benötigt dann keine weiteren Ranglistenanfragen. Damit entfällt das zusätzliche Laden aller Ranglistenseiten. Alternativ `GET /api/events/:id/name-check?name=...&category=...` mit passendem Datenbankindex; dann darf eine neue Anfrage eine ältere Antwort niemals überschreiben.
3. Bei `POST /api/claim/:token` den aktuellen Namen **atomar** nochmals prüfen. Wenn `allowExistingName=false`, Duplikate ablehnen. Wenn aktiviert, die explizite Zusammenführungsbestätigung respektieren; nie ungeprüft ein fremdes Resultat löschen oder verändern. Die Zuordnung ist ohne Login keine Identitätsprüfung.
4. Die Prüfung darf **niemals Single/Multi** oder voneinander abweichende Spielregeln zusammenwerfen. Innerhalb einer identischen Wertungsdisziplin und Teilnehmerkategorie muss sie dagegen alle zur selben Event-Gruppe gehörenden Resultate erfassen.
5. Den einmaligen Verbrauch des QR-Tokens, die unveränderlichen Messwerte, die Event-Zugriffsgrenzen und Moderations-Protokolle unverändert beibehalten.
6. Tests für parallele Claims, Unicode-/Leerzeichen-Normalisierung, 100+ Teilnehmer, ausgeschaltete Wiederverwendung, gemischte Kategorien, Mode- und Regeltrennung, gemeinsam verwendete Natels und Sessions mit deaktiviertem Web Storage durchführen.

### Implementierte Schnittstelle

- `GET /api/claim/:token` liefert `nameIndex: [{name, category}, ...]` vollständig für die identische Disziplin, Event-Gruppe und Veranstalter-Zuständigkeit sowie `allowExistingName`. Kein zusätzliches Laden aller Ranglistenseiten nötig.
- `allowExistingName` ist eine echte Datenbankspalte, standardmässig `true`; nur der Eventbesitzer darf sie per `PATCH /api/owner/events` ändern. Änderungen werden protokolliert.
- `POST /api/claim/:token` übermittelt zusätzlich `confirmExistingName: true`, wenn «Ja» oder «Trotzdem fortfahren» gewählt wurde oder exakt Name/Kategorie des letzten erfolgreichen Versuchs auf diesem Natel verwendet werden. Ein String `"true"` reicht nicht.
- Bei zwischenzeitlich vergebenem Namen: HTTP 409, `code: "NAME_CONFIRMATION_REQUIRED"`, aktueller `nameIndex` und `allowExistingName`. Die Oberfläche aktualisiert die Prüfung, ohne den Token zu verbrauchen. Bei ausgeschalteter Wiederverwendung: `code: "NAME_TAKEN"`.
- Der Duplikat- und Policy-Check ist Teil desselben bedingten SQL-Updates wie der Tokenverbrauch. Keine Löschung/Überschreibung von Versuchen; Messwerte bleiben unverändert.
- Ein Index über Event/Sichtbarkeit/Kategorie/normalisierten Namen unterstützt die Abfrage. NFKC, Unicode-Kleinschreibung und zusammengefasste Leerzeichen gelten einheitlich für Namenscheck und Bestwertung. Bestehende Datensätze erhalten beim Zugriff verlustfrei den Suchschlüssel; ihre Kategorie wird nicht geraten.
- Kein Firmware-Update erforderlich. Die neue Funktion liegt auf der öffentlichen Eventseite und im Eventserver.

**Wichtig:** Ein lokal wiedererkannter Name ist nur eine Bequemlichkeitsfunktion und kein Nachweis, dass diese Person tatsächlich am Natel steht. Der Veranstalter muss bei offiziellen Wettbewerben die Wiederverwendung deaktivieren oder eine stärkere Bestätigung vorsehen.

## Verifikation

Frontend: `npm ci && npm run build && node --test tests/*.test.mjs`.

Zusätzlich im Backend geprüft: `tests/fast-name-check.mjs`, `tests/integration.mjs`, `tests/unified-pagination.mjs` (126 Namen einschliesslich Altbestand), Metadata-/Firebase-Tests, TypeScript und Produktionsbuild. Browserprüfung: bestehender Name → Bestätigung → Speichern → nächster QR mit Vorausfüllung, neuer Einwilligung und «Anderer Teilnehmer» zum Zurücksetzen. Web-Storage-Ausfälle sind durch Unit-Tests abgedeckt; sie blockieren keine Eintragung.

Produktionsleistung: Ziel ist ein unmittelbar reagierender Vergleich **nach** der ersten Datenübertragung. Eine feste Ende-zu-Ende-Latenz unter 500 ms ist bei Netzwerk-, Cloud- oder Mobilfunkverbindungen nicht seriös garantierbar. Für viele Hundert Teilnehmer ist die oben beschriebene Backend-Optimierung erforderlich.
