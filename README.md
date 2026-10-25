# Daily Brain

Nachrichten, Lesestoff und Allgemeinwissen statt Scrollen. Eine Web-App (PWA) fürs iPhone, gehostet auf GitHub Pages.

- **Nachrichten:** Filter Alle, Deutschland, Welt plus Themen (Politik, Wirtschaft, Börse, Technik, Wissenschaft, Sport, Kultur). Suche, Gelesen-Markierung, stündliche Aktualisierung.
- **Lesen:** Wissenschaft, Geschichte, Psychologie und Gesellschaft zum Weiterbilden. Neuere und ältere Artikel (bis 30 Tage).
- **Lernen:** Welt-Quiz mit vier Spielen, jederzeit wechselbar, ohne Tageslimit. Lernkasten-System und Tagesserie.
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
- `topic`: Politik, Wirtschaft, Börse, Technik, Wissenschaft, Sport, Kultur, Psychologie, Geschichte, Gesellschaft
- `rules` (optional): sortiert Artikel eines Mischfeeds per Stichwort in Psychologie oder Geschichte um
- `paywall` (optional): `check` prüft jede Artikelseite, `title` nur den Titel
- `enabled: false` schaltet einen Feed ab

Reihenfolge zählt: Bei doppelten Artikeln gewinnt der Feed weiter oben. Spezielle Themen stehen deshalb vor allgemeinen.
Ein Thema erscheint in der App nur, wenn es Einträge hat. Fällt ein Feed aus, laufen die anderen weiter.

## Bezahlartikel

Zwei Stufen, beide ohne Umgehen von Bezahlschranken:
1. Markierungen im Feed (z. B. „heise+“, „(S+)“ im Titel).
2. Bei Quellen mit `"paywall": "check"` wird die Artikelseite auf die Angaben geprüft, die Verlage für Google setzen (`isAccessibleForFree: false`, `article:content_tier`). Ergebnisse werden zwischengespeichert, damit nicht jede Stunde alles neu geprüft wird.

Im Log der Action steht die Zeile **BEZAHLARTIKEL ENTFERNT**. Dort siehst du, wie viele Artikel gefiltert und wie viele Seiten nicht prüfbar waren. In der App steht die Zahl unter „Nachrichten“.

## Gut zu wissen

- Fortschritt, Serie, Filter und gelesene Meldungen liegen lokal auf dem Gerät.
- GitHub pausiert geplante Läufe nach 60 Tagen ohne Aktivität. Ein Commit oder manueller Start reicht.
- Lokal testen: `python3 -m http.server`, Nachrichten holen mit `node fetch-news.mjs` (Node 20+).
