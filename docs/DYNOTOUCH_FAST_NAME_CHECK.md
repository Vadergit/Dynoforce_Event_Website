# DynoTouch: sofortiger Namenscheck und Natel-Vorausfüllung

## Frontend-Umsetzung (dieses Repository)

- Sobald ein QR-Code geöffnet wird, startet **eine** Hintergrundabfrage der öffentlichen Event-Ergebnisse. Falls die API bereits 100 Resultate liefert, werden auch weitere Seiten abgerufen. Die erste Seite des Events wird aus der Eventantwort wiederverwendet.
- Der Vergleich während des Tippens erfolgt **synchron im lokalen Speicher (Set)**: keine künstliche 300- oder 500-ms-Wartezeit und keine Anfrage pro Tastendruck. Eine Netzwerklatenz beim erstmaligen Laden der Ranglisten kann jedoch nicht garantiert werden. Währenddessen steht «Namen werden geladen».
- Gematcht wird nur gegen dieselbe Event-Gruppe, denselben Modus (Single/Multi), **identische Spielregeln** und dieselbe Kategorie Mann/Frau/Jugendliche unter 16.
- Gleicher Name: Hinweis «Bist du dieselbe Person?» mit «Ja» / «Nein, anderer Name». «Ja» bestätigt die Verwendung des Namens; der Claim bleibt ein neues unveränderliches Resultat. Die öffentliche Rangliste zeigt weiterhin nur den besten Versuch pro Name/Kategorie/Disziplin.
- Nach einem **erfolgreichen** Claim wird ausschliesslich der letzte Anzeigename und die Kategorie für exakt diese Event-ID lokal auf diesem Natel gespeichert. Beim nächsten Scan sind diese Felder vorausgefüllt; für denselben Namen + Kategorie kommt keine Wiederholungswarnung. Ein anderer Name oder eine andere Kategorie wird normal geprüft. Das Gerät kann auch für andere Personen verwendet werden, indem die Eingabe geändert wird.
- Einwilligung, QR-Tokens und Ergebnisse werden **nicht** lokal gespeichert. Die Einwilligung ist für jeden Claim erneut erforderlich.
- Scheitert die öffentliche Namensabfrage, behauptet das System nicht, der Name sei verfügbar; ein ausdrückliches «Trotzdem fortfahren» bleibt möglich, damit ein QR-Ergebnis bei einem kurzen API-Ausfall nicht verloren gehen muss.
- Der Eventeditor hat einen Schalter «Bestehende Namen … erneut verwenden». Die Speicherung wird wie bei anderen erweiterten Metadaten serverseitig per GET verifiziert. Ohne Backend-Unterstützung erscheint eine Fehlermeldung statt einer falschen Erfolgsmeldung.

## Erforderlicher Backend-Abschluss (separater DynoTouch-Event-Server)

**Das Backend liegt im separaten `event-leaderboard`-Workspace, nicht in `Dynoforce_Event_Website`.** Dieser GitHub-PR kann dessen Datenbank und Deploy nicht verändern. Folgende Schritte sind notwendig, um die Funktion vollständig und gegen gleichzeitige Claims abzusichern:

1. `allowExistingName` pro Event in der Datenbank persistieren und über `GET /api/events/:id` und `GET /api/owner/events` ausliefern. `PATCH /api/owner/events` akzeptiert die Einstellung nur für berechtigte Veranstalter.
2. Einen **schnellen, indexgestützten Namenscheck** anbieten, idealerweise direkt in `GET /api/claim/:token` als kompakte Liste der normalisierten sichtbaren Namen je Kategorie und identischer Disziplin. Damit entfällt das zusätzliche Laden aller Ranglistenseiten. Alternativ `GET /api/events/:id/name-check?name=...&category=...` mit passendem Datenbankindex; dann darf eine neue Anfrage eine ältere Antwort niemals überschreiben.
3. Bei `POST /api/claim/:token` den aktuellen Namen **atomar** nochmals prüfen. Wenn `allowExistingName=false`, Duplikate ablehnen. Wenn aktiviert, die explizite Zusammenführungsbestätigung respektieren; nie ungeprüft ein fremdes Resultat löschen oder verändern. Die Zuordnung ist ohne Login keine Identitätsprüfung.
4. Die Prüfung darf **niemals Single/Multi** oder voneinander abweichende Spielregeln zusammenwerfen. Innerhalb einer identischen Wertungsdisziplin und Teilnehmerkategorie muss sie dagegen alle zur selben Event-Gruppe gehörenden Resultate erfassen.
5. Den einmaligen Verbrauch des QR-Tokens, die unveränderlichen Messwerte, die Event-Zugriffsgrenzen und Moderations-Protokolle unverändert beibehalten.
6. Tests für parallele Claims, Unicode-/Leerzeichen-Normalisierung, 100+ Teilnehmer, ausgeschaltete Wiederverwendung, gemischte Kategorien, Mode- und Regeltrennung, gemeinsam verwendete Natels und Sessions mit deaktiviertem Web Storage durchführen.

**Wichtig:** Ein lokal wiedererkannter Name ist nur eine Bequemlichkeitsfunktion und kein Nachweis, dass diese Person tatsächlich am Natel steht. Der Veranstalter muss bei offiziellen Wettbewerben die Wiederverwendung deaktivieren oder eine stärkere Bestätigung vorsehen.

## Verifikation

Frontend: `npm ci && npm run build && node --test tests/*.test.mjs`.

Produktionsleistung: Ziel ist ein unmittelbar reagierender Vergleich **nach** der ersten Datenübertragung. Eine feste Ende-zu-Ende-Latenz unter 500 ms ist bei Netzwerk-, Cloud- oder Mobilfunkverbindungen nicht seriös garantierbar. Für viele Hundert Teilnehmer ist die oben beschriebene Backend-Optimierung erforderlich.
