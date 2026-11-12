# Erweiterter DynoForce-Namensfilter (Vorbereitung)

**Status:** Nur in einem separaten GitHub-Branch vorbereitet. Weder Event-Webseite noch normale App sind dadurch live geändert.

## Inhalt

- `dynoforce-name-blacklist.json`: 11'558 eindeutige gesperrte vollständige Namen/Ausdrücke und 19 starke Teilwortmuster
- `name-filter.mjs`: gemeinsame Prüflogik für Browser und Node.js
- `name-filter.test.mjs`: Beispiele und automatisierte Tests
- Sprachen: Englisch, Hochdeutsch, Schweizerdeutsch
- Normalisierung: Unicode-NFC, Kleinschreibung, überflüssige Leerzeichen zusammenfassen
- Keine rechenintensive KI, keine aggressive Leetspeak- oder Rechtschreib-Ähnlichkeitssuche
- Gleiche Fehlermeldung bei belegtem und gesperrtem Namen

**Wichtig:** Die grösste verwendete Quellliste ist eine nicht vollständig redaktionell geprüfte Sammlung. Darin können harmlose oder veraltete Begriffe vorkommen. Darum wird die grosse Liste nur mit dem vollständigen Nicknamen verglichen. Teilwortsperren greifen nur für die separat gepflegten 19 Muster. Die `allowExact`-Ausnahmen erlauben häufige harmlose Namen (zum Beispiel `zombie` oder `assassin`).

## Integration Event-Webseite

Beim Start der QR-Code-Webseite einmal die JSON-Datei mitladen und im Browser zwischenspeichern. Beim Tippen lokale Prüfung direkt ausführen:

```js
import { loadNicknameValidator } from "./name-filter/name-filter.mjs";

const validator = await loadNicknameValidator();
const name = document.querySelector("#nickname").value;
const result = validator.check(name, false);
if (!result.accepted) {
  // Zeige dieselbe Meldung wie bei bereits belegtem Namen.
  showError(result.message);
}
```

Die bestehende Live-Prüfung auf belegte Namen bleibt unverändert; die Blacklist muss nicht bei jedem Tastendruck übertragen werden.

**Verbindlich:** Dieselbe Prüfung muss zusätzlich in der Firebase-Cloud-Function beziehungsweise im API-Dienst vor der Vergabe eines Namens laufen. Die reine Browserprüfung lässt sich umgehen. Auch bestehende Wiederverwendungs- und Überschreibungsregeln dürfen eine gesperrte Namenswahl nicht umgehen.

## Integration normale DynoForce-App

Dieselbe JSON-Datei als App-Asset bündeln oder versioniert laden und cachen. Beim Erstellen oder Ändern des Benutzernamens prüfen. Bestehende serverseitige Sperren und Eindeutigkeitsprüfung nicht entfernen. Nicht bei jedem Login prüfen.

## Tests

Aus dem Repository-Stammverzeichnis:

```bash
node name-filter/name-filter.test.mjs
```

Die Liste vor der Live-Schaltung an echten, harmlosen Event-Namen testen und Fehlalarme über `allowExact` bzw. Löschung aus `exact` entfernen. Eine Liste kann nie alle kreativen Schreibweisen abdecken.

## Quellen und Lizenz

- [LDNOOBW V2 – Englisch](https://github.com/LDNOOBWV2/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words_V2/blob/main/data/en.txt), CC0 1.0
- [LDNOOBW V2 – Deutsch](https://github.com/LDNOOBWV2/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words_V2/blob/main/data/de.txt), CC0 1.0
- Eigenständige Schweizerdeutsch-Ergänzung aus dem bisherigen DynoForce-Vorbereitungspaket
- Das ursprüngliche Projekt [LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) wird als ursprüngliche Datenquelle genannt und verwendet CC BY 4.0.

Die Datenmenge liegt bei etwa 200 KB unkomprimiert und wird nur einmal beim Laden benötigt. Beim Tippen gibt es keine zusätzliche Netzwerkabfrage für die Blacklist.
