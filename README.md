# Daily Brain

Nachrichten und Allgemeinwissen statt Scrollen. Eine Web-App (PWA) fürs iPhone, gehostet auf GitHub Pages.

- **Nachrichten:** Deutschland und Welt aus RSS-Feeds (tagesschau, SPIEGEL, ZEIT, DW), stündlich aktualisiert, mit Suche und Gelesen-Markierung.
- **Lernen:** Welt-Quiz mit vier Spielen (Hauptstädte, Welches Land?, Flaggen, Flagge finden), Regionenfilter, Lernkasten-System und Tagesserie.

## Einrichtung (ca. 10 Minuten)

1. **Repo anlegen:** Auf github.com ein neues Repository erstellen, z. B. `daily-brain`. Es muss **öffentlich** sein, weil GitHub Pages im kostenlosen Plan nur öffentliche Repos veröffentlicht.
2. **Dateien hochladen:** Den Inhalt dieses Ordners ins Repo hochladen (inklusive des versteckten Ordners `.github`). Am einfachsten per GitHub Desktop oder:
   ```bash
   git init && git add . && git commit -m "Daily Brain"
   git branch -M main
   git remote add origin https://github.com/DEIN-NAME/daily-brain.git
   git push -u origin main
   ```
   Hinweis: Beim Hochladen über die Weboberfläche wird der Ordner `.github` gern vergessen. Dann gibt es keine Nachrichten.
3. **Pages aktivieren:** Im Repo unter *Settings → Pages → Build and deployment → Source* die Option **GitHub Actions** wählen.
4. **Ersten Lauf starten:** Unter *Actions → „Nachrichten holen & veröffentlichen“ → Run workflow*. Nach 1–2 Minuten steht die App unter `https://DEIN-NAME.github.io/daily-brain/`.
5. **Aufs iPhone:** Die Adresse in Safari öffnen, *Teilen → Zum Home-Bildschirm*. Danach startet sie wie eine normale App.

## Wie es funktioniert

- Die GitHub Action läuft stündlich, holt die Feeds aus `feeds.json`, schreibt `data/news.json` und veröffentlicht die Seite neu.
- Fortschritt, Serie und gelesene Meldungen liegen lokal auf dem Gerät (localStorage). Wer Safari-Daten löscht, löscht auch den Fortschritt.
- Die App funktioniert offline. Nachrichten zeigen dann den letzten geladenen Stand.

## Anpassen

- **Quellen:** In `feeds.json` Feeds hinzufügen, entfernen oder mit `"enabled": false` abschalten. `category` ist `deutschland` oder `welt`.
- **Aktualisierung:** In `.github/workflows/deploy.yml` die Zeile `cron`. GitHub startet geplante Läufe teils mit Verzögerung.
- **Länder:** `countries.json` (194 Staaten, deutsche Namen und Hauptstädte). Israel ist aus den Hauptstadt-Spielen ausgenommen, weil die Hauptstadt international umstritten ist.

## Gut zu wissen

- GitHub pausiert geplante Läufe, wenn im Repo 60 Tage lang nichts passiert. Dann reicht ein beliebiger Commit oder ein manueller Start.
- Falls ein Feed ausfällt, laufen die anderen weiter. Welcher Feed gerade klemmt, steht im Log der Action.
- Lokal testen: `python3 -m http.server` im Ordner starten und `http://localhost:8000` öffnen. Nachrichten holen: `node fetch-news.mjs` (Node 20+).

## Nächste Ausbaustufen

1. Tagesstapel mit 10 Wissenskarten pro Tag
2. Personenspiel „Wer war das?“ mit Profilen und Atlas
3. Karte, Zeitstrahl, Früher oder später?
