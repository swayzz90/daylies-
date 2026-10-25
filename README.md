# Daily Brain

Nachrichten, Lesestoff und Allgemeinwissen statt Scrollen. Eine Web-App (PWA) fürs iPhone, gehostet auf GitHub Pages.

- **Nachrichten:** Filter Alle, Deutschland, Welt plus Themen (Politik, Wirtschaft, Börse, Technik, Wissenschaft, Sport, Kultur). Suche, Gelesen-Markierung, stündliche Aktualisierung.
- **Lesen:** Wissenschaft, Psychologie, Geschichte, Philosophie, Gesellschaft und Gesundheit zum Weiterbilden. Artikel bis 30 Tage alt.
- **Sprache:** Deutsche und englische Quellen. Der Knopf neben der Suche wechselt zwischen Alle, DE und EN.
- **Lernen:** Alle Spiele sind jederzeit spielbar, ohne Tageslimit, und lassen sich mitten in der Runde wechseln.
  - Welt-Quiz: Hauptstädte, Welches Land?, Flaggen, Flagge finden, Karte (Land antippen)
  - Wissen und Geschichte: Wahr oder falsch, Früher oder später?, Jahr schätzen, Zeitstrahl, Wer war das?
  - Personen-Atlas mit Profilen (Epoche oder Thema), Rabbit Hole über „Weiter entdecken“
  - Tagesstapel: 10 Wissenskarten pro Tag mit Frage, falsche Antworten kommen später wieder (bewusst begrenzt)
  - Wissenskarte: Die Weltkarte färbt sich, je sicherer du Länder kennst
  - Lernkasten-System (Wiederholung nach 1, 3, 7, 21 Tagen) und Tagesserie
- **Bezahlartikel:** Werden erkannt und ausgeblendet (siehe unten).

## Einrichtung

1. Öffentliches Repo anlegen, alle Dateien hochladen (Ordner `.github/workflows/deploy.yml` über „Create new file“ anlegen).
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → „Nachrichten holen & veröffentlichen“ → Run workflow.
4. Seite in Safari öffnen → Teilen → Zum Home-Bildschirm.

## Quellen anpassen: `feeds.json`

Jeder Feed hat:
- `section`: `news` oder `lesen`
- `region` (nur news): `deutschland`, `welt` oder `beide`. „beide“ erscheint unter beiden Filtern.
- `lang` (optional): `en` für englische Quellen, sonst Deutsch
- `topic`: politik, wirtschaft, boerse, technik, wissenschaft, sport, kultur, psychologie, geschichte, philosophie, gesellschaft, gesundheit
- `rules` (optional): `wissen` (deutsch) oder `wissen_en` (englisch) sortiert Artikel eines Mischfeeds per Stichwort in Psychologie, Geschichte oder Philosophie um
- `paywall` (optional): `check` prüft jede Artikelseite, `title` nur den Titel
- `enabled: false` schaltet einen Feed ab

Kein Verlag soll dominieren: Pro Quelle werden höchstens 70 (Nachrichten) bzw. 50 (Lesen) Artikel gezeigt, die neuesten zuerst.
Reihenfolge zählt: Bei doppelten Artikeln gewinnt der Feed weiter oben. Spezielle Themen stehen deshalb vor allgemeinen.
Ein Thema erscheint in der App nur, wenn es Einträge hat. Fällt ein Feed aus, laufen die anderen weiter.

## Bezahlartikel

Zwei Stufen, beide ohne Umgehen von Bezahlschranken:
1. Markierungen im Feed (z. B. „heise+“, „(S+)“ im Titel).
2. Bei Quellen mit `"paywall": "check"` wird die Artikelseite auf die Angaben geprüft, die Verlage für Google setzen (`isAccessibleForFree: false`, `article:content_tier`). Ergebnisse werden zwischengespeichert, damit nicht jede Stunde alles neu geprüft wird.

Im Log der Action steht die Zeile **BEZAHLARTIKEL ENTFERNT**. Dort siehst du, wie viele Artikel gefiltert und wie viele Seiten nicht prüfbar waren. In der App steht die Zahl unter „Nachrichten“.

## Inhalte der Spiele

- `content.json`: 90 Ereignisse, 61 Aussagen, 49 Wissenskarten, 46 Personen. Die Texte sind von Hand geschrieben, nur verstorbene Personen. Neue Inhalte kannst du dort ergänzen, die Struktur ist selbsterklärend.
- `map.json`: Weltkarte (Natural Earth, öffentlich nutzbar), 194 von 195 Staaten außer Tuvalu.
- Profile verlinken auf eine Wikipedia-Suche, damit kein Link ins Leere läuft.

## Gut zu wissen

- Fortschritt, Serie, Filter und gelesene Meldungen liegen lokal auf dem Gerät.
- GitHub pausiert geplante Läufe nach 60 Tagen ohne Aktivität. Ein Commit oder manueller Start reicht.
- Lokal testen: `python3 -m http.server`, Nachrichten holen mit `node fetch-news.mjs` (Node 20+).
