# DynoTouch: gezielte Bedienungsverbesserungen

Bestehende Farben, Typografie und Seitenstruktur bleiben erhalten.

- Die öffentliche Einwilligung ist ein zusammenhängendes, vollständig anklickbares Label mit 28-px-Checkbox, dezentem Hintergrund und Rahmen. Die vorgegebene Formulierung bleibt eindeutig; Kategorie/Punkte/Spieldauer werden ergänzend erklärt.
- Standard bleibt `false`, auch bei lokal vorausgefüllten Teilnehmerdaten. «Anderer Teilnehmer» setzt die Zustimmung ebenfalls zurück. Sie wird nicht lokal gespeichert.
- Speichern ohne Zustimmung zeigt den Fehler direkt am Feld, scrollt dorthin und fokussiert die Checkbox. Es wird kein Claim gesendet. Der Button ist nur während eines laufenden Requests deaktiviert; Name, Kategorie und Wiederverwendung werden weiterhin geprüft.
- «Zurück» ist eine einheitliche Schaltfläche mit Pfeil, dezent farbiger Fläche und mindestens 46 px Höhe. Von der Namenseingabe führt sie zur zugehörigen Rangliste.

Im separaten Firmware-Workspace wurden beide CYD-Varianten angepasst:

- Gleicher sichtbarer und berührungsempfindlicher Zurück-Button oben links auf QR und Game Over.
- QR weiterhin Version 6, Skalierung 3 und vier Module ungestörte weisse Ruhezone. Unveränderte QR-Grösse; darunter Restsekunden und Fortschrittsbalken.
- Displaydauer startet beim Einblenden und verwendet die konfigurierte QR-Rückkehrdauer (derzeit `eventReopenSeconds`, standardmässig 120 s), maximal die verbleibende serverseitige Gültigkeit. Aktualisierung einmal pro sichtbarer Sekunde, ohne blockierendes Warten.
- Display-Abschluss/Zurück setzt nur den lokalen Bildschirm zurück; es gibt keinen Request, der einen bereits gescannten QR auf dem Server vorzeitig ungültig macht. Ein erfolgreich eingetragener Claim oder Offline-Erkennung kann wie bisher früher zum Start führen.

Prüfung: Frontend-Tests und Produktionsbuild; Browserablauf ohne Haken, Label-Klick und Fehlerdarstellung; native C++-Tests für Sekundenrundung, Ablauf, Millis-Überlauf und Touch-Geometrie; Firmware-Build für ILI9341 und ST7789-v3. Ein Hardware-Upload und die visuelle Prüfung am echten Display sind separat zu bestätigen.
