#!/usr/bin/env python3
"""Daylies Lauf 1. Run from the root of swayzz90/daylies- on gpt-update.
Safe: only edits 5 text files, refuses to apply if source differs.
Does not create branches, push or deploy.
"""
from pathlib import Path
import json
import subprocess

ROOT = Path.cwd()
branch = subprocess.run(["git", "branch", "--show-current"], capture_output=True, text=True)
if branch.returncode != 0 or branch.stdout.strip() != "gpt-update":
    raise SystemExit("Abbruch: Bitte zuerst den Git-Branch gpt-update auschecken.")


def swap(source: str, old: str, new: str, context: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{context}: expected 1 occurrence, found {count}. Aborted without writing.")
    return source.replace(old, new, 1)


def change(path: str, fn):
    p = ROOT / path
    if not p.exists():
        raise RuntimeError(f"Datei fehlt: {p}")
    originals[path] = p.read_text(encoding="utf-8")
    results[path] = fn(originals[path])


def theme(css):
    for a, b in [
        ("--bg: #151A23;", "--bg: #000000;"),
        ("--surface: #1D2430;", "--surface: #080808;"),
        ("--ink: #E7ECF3;", "--ink: #F5F7FA;"),
        ("--muted: #93A0B3;", "--muted: #A3ADBB;"),
        ("--line: #2A3342;", "--line: #252525;"),
        ("--accent-soft: #223347;", "--accent-soft: #102235;"),
        ("border-color: #35506b;", "border-color: #35506b;"),
    ]:
        if a != b:
            css = swap(css, a, b, "CSS " + a)
    css += '''\n\n/* Lauf 1: Listen schrittweise laden, tastaturfreundlich und OLED-schwarz. */
.feed-more {
  width: 100%; margin: 16px 0 6px; padding: 13px 16px;
  border-radius: 12px; border: 1px solid var(--line);
  background: var(--surface); color: var(--accent); font-weight: 700;
}
.feed-more:active { background: var(--accent-soft); }
.cw-cell:focus-visible, .cw-key:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
'''
    return css


def html(s):
    s = swap(s, 'content="#151A23"', 'content="#000000"', "HTML theme-color")
    s = swap(s, 'html,body{background:#151A23;color-scheme:dark}', 'html,body{background:#000000;color-scheme:dark}', "HTML inline color")
    return s


def manifest(s):
    obj = json.loads(s)
    obj["background_color"] = "#000000"
    obj["theme_color"] = "#000000"
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def service_worker(s):
    s = swap(s,
'''          .then((res) => {
            clearTimeout(timer);
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put("news.json", copy));
            resolve(res);
          })''',
'''          .then((res) => {
            clearTimeout(timer);
            // Fehlerantworten niemals als gültige Nachrichten speichern.
            if (!res.ok) { fromCache().then(resolve); return; }
            const copy = res.clone();
            caches.open(VERSION)
              .then((c) => c.put("news.json", copy))
              .catch(() => { /* Cache-Fehler dürfen Online-Daten nicht blockieren */ });
            resolve(res);
          })''', "Service Worker cache guard")
    return s


def app(s):
    # Nachrichten: sichtbare Nachrichten bleiben innerhalb ihres aktiven Filters.
    s = swap(s,
'''function pickHeadlines(ui) {
  const pool = (news.groups || []).filter((g) =>
    (langFilter === "alle" || g.lang === langFilter) &&''',
'''function pickHeadlines(ui, visibleIds) {
  const pool = (news.groups || []).filter((g) =>
    visibleIds.has(g.lead) &&
    (langFilter === "alle" || g.lang === langFilter) &&''', "headline lead filter")
    s = swap(s, "function renderHeadlines(heads) {", "function renderHeadlines(heads, visibleIds) {", "headline signature")
    s = swap(s,
'''      if (!it || seen.has(it.source)) return false;''',
'''      if (!it || !visibleIds.has(it.id) || seen.has(it.source)) return false;''', "headline other sources")
    s = swap(s,
'''  const heads = section === "news" && !q ? pickHeadlines(ui) : [];
  if (section === "news") renderHeadlines(heads);
  const shown = new Set(heads.flatMap((g) => g.members));''',
'''  const visibleIds = new Set(matches.map((it) => it.id));
  const heads = section === "news" && !q ? pickHeadlines(ui, visibleIds) : [];
  if (section === "news") renderHeadlines(heads, visibleIds);
  const shown = new Set(heads.flatMap((g) => g.members.filter((id) => visibleIds.has(id))));''', "headline group filtering")

    # Max. 60 Einträge pro Liste rendern; Klick auf "Mehr" lädt weitere 60.
    s = swap(s,
'''  news: { list: "#news-list", topics: "#news-topics", region: savedFilters.region || "alle", topic: savedFilters.newsTopic || "alle", query: "" },
  lesen: { list: "#lesen-list", topics: "#lesen-topics", topic: savedFilters.lesenTopic || "alle", query: "" },''',
'''  news: { list: "#news-list", topics: "#news-topics", region: savedFilters.region || "alle", topic: savedFilters.newsTopic || "alle", query: "", limit: 60 },
  lesen: { list: "#lesen-list", topics: "#lesen-topics", topic: savedFilters.lesenTopic || "alle", query: "", limit: 60 },''', "feed limits")
    s = swap(s, '  for (const it of items) {\n    const label = dayLabel(it.date);', '  for (const it of items.slice(0, ui.limit)) {\n    const label = dayLabel(it.date);', "feed pagination")
    s = swap(s, '''  list.innerHTML = html;
  if (pendingScroll''', '''  const remaining = items.length - ui.limit;
  if (remaining > 0) html += `<button type="button" class="feed-more" aria-label="${remaining} weitere Beiträge laden">Weitere Beiträge anzeigen (${remaining} übrig)</button>`;
  list.innerHTML = html;
  if (pendingScroll''', "feed more button")
    s = swap(s,
'''    const a = e.target.closest(".news-item");
    if (!a) return;''',
'''    if (e.target.closest(".feed-more")) {
      const section = list.id === "news-list" ? "news" : "lesen";
      const y = scroller.scrollTop;
      feedUI[section].limit += 60;
      renderFeed(section);
      requestAnimationFrame(() => scroller.scrollTo(0, y));
      return;
    }
    const a = e.target.closest(".news-item");
    if (!a) return;''', "feed more click")
    s = swap(s,
'''    feedUI[box.dataset.section].topic = b.dataset.topic;
    saveFilters();''',
'''    feedUI[box.dataset.section].topic = b.dataset.topic;
    feedUI[box.dataset.section].limit = 60;
    saveFilters();''', "topic reset")
    s = swap(s,
'''    feedUI.news.region = b.dataset.cat;
    saveFilters();''',
'''    feedUI.news.region = b.dataset.cat;
    feedUI.news.limit = 60;
    saveFilters();''', "region reset")
    s = swap(s,
'''    langFilter = LANGS[(LANGS.indexOf(langFilter) + 1) % LANGS.length];
    saveFilters();''',
'''    langFilter = LANGS[(LANGS.indexOf(langFilter) + 1) % LANGS.length];
    feedUI.news.limit = feedUI.lesen.limit = 60;
    saveFilters();''', "language reset")
    s = swap(s,
'''    searchTimer = setTimeout(() => { feedUI[section].query = e.target.value; renderFeed(section); }, 120);''',
'''    searchTimer = setTimeout(() => { feedUI[section].query = e.target.value; feedUI[section].limit = 60; renderFeed(section); }, 120);''', "search reset")

    # Quiz-Dialog: Fokus wiederherstellen; Escape zum Schließen.
    s = swap(s,
'''let quiz = null;
let nextTimer;

function showQuiz() {
  $("#quiz").hidden = false;
  document.body.style.overflow = "hidden";
}''',
'''let quiz = null;
let nextTimer;
let quizReturnFocus = null;
let cwKeyHandler = null;

function removeCrossKeyboard() {
  if (cwKeyHandler) document.removeEventListener("keydown", cwKeyHandler);
  cwKeyHandler = null;
}
function showQuiz() {
  if ($("#quiz").hidden) quizReturnFocus = document.activeElement;
  $("#quiz").hidden = false;
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => $("#quiz-close").focus({ preventScroll: true }));
}''', "quiz focus")
    s = swap(s,
'''function startQuiz(game) {
  clearTimeout(nextTimer);
  const questions = game.pick();
  if (!questions.length) return;
  quiz = { mode: game, questions, i: 0, results: [], points: 0 };''',
'''function startQuiz(game) {
  clearTimeout(nextTimer);
  removeCrossKeyboard();
  const saved = game.kind === "cross" ? loadCrossSession(game) : null;
  const questions = saved ? [saved.puzzle] : game.pick();
  if (!questions.length) return;
  quiz = { mode: game, questions, i: 0, results: [], points: 0, crossSaved: saved?.state || null };''', "quiz restore")
    s = swap(s,
'''function closeQuiz() {
  clearTimeout(nextTimer);
  $("#quiz").hidden = true;
  document.body.style.overflow = "";
  quiz = null;
  renderLearn();
}''',
'''function closeQuiz() {
  clearTimeout(nextTimer);
  removeCrossKeyboard();
  $("#quiz").hidden = true;
  document.body.style.overflow = "";
  quiz = null;
  renderLearn();
  quizReturnFocus?.focus?.({ preventScroll: true });
  quizReturnFocus = null;
}''', "quiz close focus")

    # Kreuzwort: persistiert Gitter, Buchstaben, Hinweise und Punktestand.
    s = swap(s,
'''function renderCross(pz) {
  const E = pz.entries, N = E.length;
  quiz.questions = E; quiz.results = []; quiz.i = 0; quiz.points = 0;

  const at = {};''',
'''function loadCrossSession(game) {
  const saved = store.get("cw-session:" + game.id, null);
  if (!saved || !saved.puzzle || !Array.isArray(saved.puzzle.entries) || !saved.state) return null;
  if (game.id === "cw-d" && saved.day !== dayKey()) return null;
  // Normale Kreuzworträtsel dürfen nach Abschluss neu gestartet werden.
  if (game.id !== "cw-d" && saved.state.finished) return null;
  return saved;
}

function renderCross(pz) {
  const E = pz.entries, N = E.length;
  const saved = quiz.crossSaved;
  quiz.questions = E;
  quiz.results = saved?.results || [];
  quiz.i = 0;
  quiz.points = saved?.points || 0;

  const at = {};''', "cross restore setup")
    s = swap(s,
'''  const st = { vals: {}, locked: new Set(), wrong: new Set(), help: E.map(() => 0), hints: E.map(() => 0), done: new Set(), sel: E[0].cells[0], dir: E[0].dir, finished: false };''',
'''  const st = {
    vals: saved?.vals || {}, locked: new Set(saved?.locked || []), wrong: new Set(saved?.wrong || []),
    help: saved?.help?.length === N ? saved.help : E.map(() => 0),
    hints: saved?.hints?.length === N ? saved.hints : E.map(() => 0),
    done: new Set(saved?.done || []),
    sel: saved?.sel && pz.sol[saved.sel] ? saved.sel : E[0].cells[0],
    dir: ["a", "d"].includes(saved?.dir) ? saved.dir : E[0].dir,
    finished: !!saved?.finished,
  };
  const persist = () => store.set("cw-session:" + quiz.mode.id, {
    day: dayKey(), puzzle: pz,
    state: {
      vals: st.vals, locked: [...st.locked], wrong: [...st.wrong], help: st.help,
      hints: st.hints, done: [...st.done], sel: st.sel, dir: st.dir,
      finished: st.finished, results: quiz.results, points: quiz.points,
    },
  });''', "cross persisted state")
    s = swap(s,
'''    paint();
  });
  $("#cw-all").addEventListener("click", (ev) => {''',
'''    paint();
    persist();
  });
  $("#cw-all").addEventListener("click", (ev) => {''', "cross cell selection persistence")
    s = swap(s,
'''    st.sel = e.cells.find((c) => !st.locked.has(c)) || e.cells[0];
    paint();
  });''',
'''    st.sel = e.cells.find((c) => !st.locked.has(c)) || e.cells[0];
    paint();
    persist();
  });''', "cross clue selection persistence")
    s = swap(s,
'''    }
    paint();
  });
  paint();
}

/* ---------- Zurück wischen:''',
'''    }
    paint();
    persist();
  });
  // Externe Tastatur: normale Buchstaben, Zurück/Löschen und Prüfen.
  cwKeyHandler = (ev) => {
    if ($("#quiz").hidden || quiz?.mode.kind !== "cross" || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.target instanceof HTMLElement && ev.target.matches("input, textarea, [contenteditable]")) return;
    const ch = ev.key.toUpperCase();
    if (/^[A-Z]$/.test(ch)) {
      const key = $(".cw-key[data-ch='" + ch + "']");
      if (key) { ev.preventDefault(); key.click(); }
    } else if (ev.key === "Backspace" || ev.key === "Delete") {
      ev.preventDefault(); $("#cw-back")?.click();
    } else if (ev.key === "Enter" && !ev.target.closest?.("button")) {
      ev.preventDefault(); $("#cw-check")?.click();
    }
  };
  document.addEventListener("keydown", cwKeyHandler);
  if (st.finished) {
    $("#feedback").innerHTML = `<button class="btn wide" id="cw-end">Ergebnis ansehen</button>`;
    $("#cw-end").addEventListener("click", renderResult);
  }
  paint();
  persist();
}

/* ---------- Zurück wischen:''', "cross keyboard and persistence")
    s = swap(s,
'''/* ---------- Zurück wischen: vom linken Rand nach rechts ---------- */
const TAB_ORDER''',
'''/* ---------- Zurück wischen: vom linken Rand nach rechts ---------- */
window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && goBack()) ev.preventDefault();
});
const TAB_ORDER''', "escape handling")
    s = swap(s,
"""  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }""",
"""  // Im Testproxy keine Offline-Caches oder PWA-Installationen anlegen.
  if ("serviceWorker" in navigator && location.protocol === "https:" && location.hostname !== "raw.githack.com") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }""", "preview cache guard")
    return s


originals = {}
results = {}
change("style.css", theme)
change("index.html", html)
change("manifest.webmanifest", manifest)
change("sw.js", service_worker)
change("app.js", app)

# Checks before anything is written.
assert results["style.css"].count("--bg: #000000;") == 1
assert "#151A23" not in results["style.css"]
assert "#151A23" not in results["index.html"]
assert "#151A23" not in results["manifest.webmanifest"]
assert "if (!res.ok) { fromCache().then(resolve); return; }" in results["sw.js"]
assert "loadCrossSession(game)" in results["app.js"]
assert "visibleIds.has(g.lead)" in results["app.js"]

# Run Node parser if installed; do not alter repo until checked.
import tempfile
with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
    f.write(results["app.js"])
    tmp = Path(f.name)
try:
    p = subprocess.run(["node", "--check", str(tmp)], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError("JavaScript syntax check failed:\n" + p.stderr)
except FileNotFoundError:
    print("Hinweis: Node.js nicht installiert; JS-Syntaxcheck übersprungen")
finally:
    tmp.unlink(missing_ok=True)

for name, value in results.items():
    (ROOT / name).write_text(value, encoding="utf-8")
print("Lauf 1 lokal aktualisiert: " + ", ".join(results))
print("Bitte im Branch gpt-update testen, committen und pushen. Main bleibt unverändert.")
