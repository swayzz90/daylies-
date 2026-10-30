"use strict";

/* ---------- Speicher ---------- */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("db:" + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("db:" + key, JSON.stringify(value)); } catch { /* voll oder gesperrt */ }
  },
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const scroller = $("#scroller");
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ---------- Tabs ---------- */
const views = { news: $("#view-news"), lesen: $("#view-lesen"), learn: $("#view-learn") };
const scrollPos = { news: 0, lesen: 0, learn: 0 };
let currentTab = store.get("tab", "news");
if (!views[currentTab]) currentTab = "news";
let lastY = 0;

function showTab(tab) {
  scrollPos[currentTab] = scroller.scrollTop;
  currentTab = tab;
  store.set("tab", tab);
  for (const [name, el] of Object.entries(views)) el.hidden = name !== tab;
  document.querySelectorAll(".tabbar button").forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  scroller.scrollTo(0, scrollPos[tab] || 0);
  lastY = scrollPos[tab] || 0;
  document.querySelectorAll(".news-tools").forEach((t) => t.classList.remove("hide"));
  if (tab === "learn") renderLearn();
}
document.querySelectorAll(".tabbar button").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.tab === currentTab) scroller.scrollTo({ top: 0, behavior: "smooth" });
    else showTab(b.dataset.tab);
  })
);

/* =================================================================
   NACHRICHTEN und LESEN
   ================================================================= */
const news = { items: [], groups: [], updated: null, loadedAt: 0, paywall: 0 };
const readIds = new Set(store.get("read", []));

const TOPICS = {
  politik: "Politik", wirtschaft: "Wirtschaft", boerse: "Börse", technik: "Technik",
  wissenschaft: "Wissenschaft", sport: "Sport", kultur: "Kultur",
  psychologie: "Psychologie", geschichte: "Geschichte", philosophie: "Philosophie",
  gesellschaft: "Gesellschaft", gesundheit: "Gesundheit",
};
const LANGS = ["alle", "de", "en"];
const LANG_LABEL = { alle: "Alle", de: "DE", en: "EN" };
const savedFilters = store.get("filters", {});
let langFilter = LANGS.includes(savedFilters.lang) ? savedFilters.lang : "alle";
const feedUI = {
  news: { list: "#news-list", topics: "#news-topics", region: savedFilters.region || "alle", topic: savedFilters.newsTopic || "alle", query: "" },
  lesen: { list: "#lesen-list", topics: "#lesen-topics", topic: savedFilters.lesenTopic || "alle", query: "" },
};
const saveFilters = () => store.set("filters", { region: feedUI.news.region, newsTopic: feedUI.news.topic, lesenTopic: feedUI.lesen.topic, lang: langFilter });

function markRead(id) {
  readIds.add(id);
  store.set("read", [...readIds].slice(-3000));
}

async function loadNews() {
  try {
    const res = await fetch("news.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    news.loadedAt = Date.now();
    if (data.updated && data.updated === news.updated && news.items.length) return; // nichts Neues: kein Neuaufbau
    // ältere news.json ohne Bereich/Thema bleibt lesbar
    news.items = (data.items || []).map((it) => ({
      ...it,
      section: it.section || "news",
      region: it.region ?? it.category ?? "beide",
      topic: it.topic || "politik",
      lang: it.lang || "de",
    }));
    news.updated = data.updated;
    news.paywall = data.stats?.paywallRemoved || 0;
    news.groups = data.groups || [];
  } catch {
    if (!news.items.length) $("#news-sub").textContent = "Offline. Keine gespeicherten Meldungen.";
  }
  renderFeed("news");
  renderFeed("lesen");
}

function relTime(iso) {
  if (!iso) return "";
  const diff = (Date.now() - Date.parse(iso)) / 60000;
  if (diff < 1) return "gerade eben";
  if (diff < 60) return `vor ${Math.round(diff)} Min.`;
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
}

function dayLabel(iso) {
  if (!iso) return "Ohne Datum";
  const d = new Date(iso);
  const today = dayKey();
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (dayKey(d) === today) return "Heute";
  if (dayKey(d) === dayKey(y)) return "Gestern";
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}

/* ---------- Schlagzeilen (Gruppen aus news.json) ---------- */
let hlBox = null;

// Je Ansicht: die stärksten Gruppen zuerst. Bei „Alle“ 1 große + 3 kleine, höchstens 2 pro Thema.
// Bei einem Thema 1 große + 2 kleine. Ab zwei passenden Gruppen gibt es einen Block.
function pickHeadlines(ui) {
  const pool = (news.groups || []).filter((g) =>
    (langFilter === "alle" || g.lang === langFilter) &&
    (ui.region === "alle" || g.regions.includes(ui.region) || g.regions.includes("beide")) &&
    (ui.topic === "alle" || g.topics.includes(ui.topic)));
  if (pool.length < 2) return [];
  const all = ui.topic === "alle";
  const want = all ? 4 : 3;
  const perTopic = {};
  const picked = [];
  for (const g of pool) {                       // news.json ist bereits nach Punkten sortiert
    if (picked.length === want) break;
    if (all && (perTopic[g.topic] || 0) >= 2) continue;
    perTopic[g.topic] = (perTopic[g.topic] || 0) + 1;
    picked.push(g);
  }
  return picked;
}

function renderHeadlines(heads) {
  if (!hlBox) {
    hlBox = document.createElement("section");
    hlBox.className = "headlines";
    hlBox.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-id]");
      if (!a) return;
      saveScroll();
      markRead(a.dataset.id);
      a.classList.add("read");
    });
    $("#news-list").before(hlBox);
  }
  if (!heads.length) { hlBox.innerHTML = ""; return; }

  const byId = new Map(news.items.map((it) => [it.id, it]));
  const lead = (g) => byId.get(g.lead);
  const badge = (g) => `<span class="hl-badge">Schlagzeile</span><span class="hl-count">Gemeldet von ${g.count} Quellen</span>`;
  // Weitere Quellen der Gruppe: je Quelle eine Meldung, ohne die Führungsmeldung
  const also = (g) => {
    const seen = new Set([lead(g).source]);
    return g.members.map((id) => byId.get(id)).filter((it) => {
      if (!it || seen.has(it.source)) return false;
      seen.add(it.source);
      return true;
    });
  };
  const alsoHtml = (g) => {
    const list = also(g);
    if (!list.length) return "";
    const names = list.map((it) => it.source);
    const label = names.length > 3 ? `${names.slice(0, 3).join(", ")} und ${names.length - 3} weitere` : names.join(", ");
    return `<details class="hl-also"><summary>Auch bei: ${esc(label)}</summary>
      <div class="hl-also-list">${list.map((it) => `<a href="${esc(it.link)}" target="_blank" rel="noopener" data-id="${esc(it.id)}" class="${readIds.has(it.id) ? "read" : ""}">${esc(it.source)}: ${esc(it.title)}</a>`).join("")}</div>
    </details>`;
  };
  const bigHtml = (g) => {
    const it = lead(g);
    return `
    <article class="hl-big">
      <a class="hl-link${readIds.has(it.id) ? " read" : ""}" href="${esc(it.link)}" target="_blank" rel="noopener" data-id="${esc(it.id)}">
        ${it.image ? `<img class="hl-img" src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
        <div class="hl-tags">${badge(g)}</div>
        <h3 class="hl-title">${esc(it.title)}</h3>
        ${it.summary ? `<p class="hl-summary">${esc(it.summary)}</p>` : ""}
        <div class="news-meta"><span class="src">${esc(it.source)}</span><span>${esc(relTime(it.date))}</span></div>
      </a>
      ${alsoHtml(g)}
    </article>`;
  };
  const rowHtml = (g) => {
    const it = lead(g);
    const topic = TOPICS[g.topic] ? `<span class="cat">${esc(TOPICS[g.topic])}</span>` : "";
    return `
    <article class="hl-row">
      <a class="hl-row-link${readIds.has(it.id) ? " read" : ""}" href="${esc(it.link)}" target="_blank" rel="noopener" data-id="${esc(it.id)}">
        <div class="hl-tags">${badge(g)}${topic}</div>
        <h3 class="hl-row-title">${esc(it.title)}</h3>
      </a>
      ${alsoHtml(g)}
    </article>`;
  };
  const [big, ...small] = heads;
  hlBox.innerHTML = `<h2 class="section-title hl-head">Schlagzeilen</h2>${bigHtml(big)}${small.map(rowHtml).join("")}`;
}

function renderFeed(section) {
  const ui = feedUI[section];
  const list = $(ui.list);
  const box = $(ui.topics);

  if (section === "news") {
    const dateText = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
    const stand = news.updated
      ? ` · Stand ${new Date(news.updated).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`
      : "";
    const paid = news.paywall ? ` · ${news.paywall} Bezahlartikel ausgeblendet` : "";
    $("#news-sub").textContent = dateText + stand + paid;
  }

  const all = news.items.filter((it) => it.section === section);
  if (!all.length) {
    box.innerHTML = "";
    list.innerHTML = `<div class="empty"><strong>Noch keine Einträge</strong>
      Die Daten kommen nach dem nächsten Lauf der GitHub Action. Starte sie unter Actions mit „Run workflow“.</div>`;
    return;
  }

  // Region (nur Nachrichten) und Themen-Chips; Themen ohne Einträge werden ausgeblendet
  const inRegion = all.filter((it) =>
    (langFilter === "alle" || it.lang === langFilter) &&
    (section !== "news" || ui.region === "alle" || it.region === ui.region || it.region === "beide"));
  const counts = {};
  inRegion.forEach((it) => { counts[it.topic] = (counts[it.topic] || 0) + 1; });
  if (ui.topic !== "alle" && !counts[ui.topic]) ui.topic = "alle";
  const keep = box.scrollLeft;
  box.innerHTML = [["alle", "Alle"], ...Object.keys(TOPICS).filter((k) => counts[k]).map((k) => [k, TOPICS[k]])]
    .map(([k, label]) => `<button role="radio" aria-checked="${k === ui.topic}" data-topic="${k}">${label}</button>`).join("");
  box.scrollLeft = keep;

  const q = ui.query.trim().toLowerCase();
  const matches = inRegion.filter((it) =>
    (ui.topic === "alle" || it.topic === ui.topic) &&
    (!q || (it.title + " " + it.summary + " " + it.source).toLowerCase().includes(q))
  );

  // Schlagzeilen oben (nur Nachrichten, nur ohne Suchbegriff). Ihre Meldungen fehlen dann in der Zeitliste.
  const heads = section === "news" && !q ? pickHeadlines(ui) : [];
  if (section === "news") renderHeadlines(heads);
  const shown = new Set(heads.flatMap((g) => g.members));
  const items = matches.filter((it) => !shown.has(it.id));

  if (!matches.length && !heads.length) {
    list.innerHTML = `<div class="empty"><strong>Keine Treffer</strong>
      ${q ? `Für „${esc(ui.query)}“ gibt es gerade nichts.` : "In dieser Auswahl gibt es gerade nichts."} Versuch einen anderen Begriff, ein anderes Thema oder die Sprache „Alle“.</div>`;
    return;
  }

  let html = "";
  let lastDay = "";
  for (const it of items) {
    const label = dayLabel(it.date);
    if (label !== lastDay) { html += `<h2 class="day-label">${esc(label)}</h2>`; lastDay = label; }
    const chip = ui.topic === "alle" && TOPICS[it.topic] ? `<span class="cat">${TOPICS[it.topic]}</span>` : "";
    const en = it.lang === "en" ? `<span class="cat">EN</span>` : "";
    const time = section === "news" ? `<span>${esc(relTime(it.date))}</span>` : "";
    html += `
      <a class="news-item${readIds.has(it.id) ? " read" : ""}" href="${esc(it.link)}" target="_blank" rel="noopener" data-id="${esc(it.id)}">
        <div>
          <div class="news-meta"><span class="src">${esc(it.source)}</span>${time}${chip}${en}</div>
          <h3 class="news-title">${esc(it.title)}</h3>
          ${it.summary ? `<p class="news-summary">${esc(it.summary)}</p>` : ""}
        </div>
        ${it.image ? `<img class="news-thumb" src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      </a>`;
  }
  list.innerHTML = html;
  if (pendingScroll && pendingScroll.tab === section && currentTab === section) {
    const y = pendingScroll.y; pendingScroll = null;
    requestAnimationFrame(() => { lastY = y; scroller.scrollTo(0, y); });
  }
}

/* Scroll-Position merken, damit die Liste nach dem Zurückkehren nicht oben neu startet */
let pendingScroll = null;
const savedScroll = store.get("scroll", null);
if (savedScroll && savedScroll.tab === currentTab && Date.now() - savedScroll.t < 30 * 60 * 1000) {
  pendingScroll = { tab: savedScroll.tab, y: savedScroll.y };
}
const saveScroll = () => {
  if ((currentTab === "news" || currentTab === "lesen") && $("#quiz").hidden) {
    store.set("scroll", { y: scroller.scrollTop, t: Date.now(), tab: currentTab });
  }
};
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveScroll(); });
window.addEventListener("pagehide", saveScroll);

document.querySelectorAll(".feed-list").forEach((list) =>
  list.addEventListener("click", (e) => {
    const a = e.target.closest(".news-item");
    if (!a) return;
    saveScroll();
    markRead(a.dataset.id);
    a.classList.add("read");
  })
);

// Themen-Chips (Nachrichten und Lesen)
document.querySelectorAll(".topics").forEach((box) =>
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    feedUI[box.dataset.section].topic = b.dataset.topic;
    saveFilters();
    renderFeed(box.dataset.section);
  })
);

// Region (nur Nachrichten)
const markRegion = () => document.querySelectorAll(".segmented button")
  .forEach((x) => x.setAttribute("aria-selected", String(x.dataset.cat === feedUI.news.region)));
markRegion();
document.querySelectorAll(".segmented button").forEach((b) =>
  b.addEventListener("click", () => {
    feedUI.news.region = b.dataset.cat;
    saveFilters();
    markRegion();
    renderFeed("news");
  })
);

// Sprache (gilt für Nachrichten und Lesen)
const markLang = () => document.querySelectorAll(".lang-btn").forEach((b) => {
  b.textContent = LANG_LABEL[langFilter];
  b.dataset.lang = langFilter;
  b.title = { alle: "Alle Sprachen", de: "Nur Deutsch", en: "Nur Englisch" }[langFilter];
});
markLang();
document.querySelectorAll(".lang-btn").forEach((b) =>
  b.addEventListener("click", () => {
    langFilter = LANGS[(LANGS.indexOf(langFilter) + 1) % LANGS.length];
    saveFilters();
    markLang();
    renderFeed("news");
    renderFeed("lesen");
  })
);

let searchTimer;
[["news", "#news-search"], ["lesen", "#lesen-search"]].forEach(([section, sel]) =>
  $(sel).addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { feedUI[section].query = e.target.value; renderFeed(section); }, 120);
  })
);

/* Filterleiste: beim Runterscrollen ausblenden, beim Hochscrollen wieder zeigen */
scroller.addEventListener("scroll", () => {
  const y = scroller.scrollTop;
  const hide = y > 160 && y > lastY + 4;
  const show = y < lastY - 4 || y <= 160;
  if (hide || show) document.querySelectorAll(".news-tools").forEach((t) => t.classList.toggle("hide", hide));
  lastY = y;
}, { passive: true });

/* Zum Aktualisieren ziehen */
(() => {
  const pull = $("#pull");
  let startY = null, dist = 0;
  window.addEventListener("touchstart", (e) => {
    if ((currentTab !== "news" && currentTab !== "lesen") || scroller.scrollTop > 0 || !$("#quiz").hidden) return;
    startY = e.touches[0].clientY; dist = 0; pull.classList.add("dragging");
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    dist = Math.max(0, e.touches[0].clientY - startY);
    pull.style.height = Math.min(dist * 0.5, 60) + "px";
    pull.firstElementChild.textContent = dist > 120 ? "Loslassen zum Aktualisieren" : "Zum Aktualisieren ziehen";
  }, { passive: true });
  window.addEventListener("touchend", async () => {
    if (startY === null) return;
    pull.classList.remove("dragging");
    const go = dist > 120;
    startY = null;
    if (go) {
      pull.firstElementChild.textContent = "Wird aktualisiert";
      await loadNews();
    }
    pull.style.height = "0px";
  });
})();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - news.loadedAt > 10 * 60 * 1000) loadNews();
});

/* =================================================================
   LERNEN
   ================================================================= */
let countries = [];
let CONTENT = null;        // Ereignisse, Aussagen, Karten, Personen (content.json)
let MAPD = null;           // Weltkarte (map.json)
let CHEM = null;           // Chemielabor-Aufgaben (aus chemie.json gebaut)
let MAP_MARKUP = "";
const PEOPLE = {};         // id -> Person
let PORTRAITS = {};        // id -> { file, artist, license, page, v } (portraits/portraits.json)
const CARD = {};           // id -> Karte
const MAPIDX = {};         // Länderkürzel -> { s: größte Kantenlänge }
const REGIONS = ["Alle", "Europa", "Asien", "Afrika", "Amerika", "Ozeanien"];
let region = store.get("region", "Alle");

const THIS_YEAR = new Date().getFullYear();
const fmtYear = (y) => (y < 0 ? `${-y} v. Chr.` : String(y));
const lifeSpan = (p) => `${p.approx ? "um " : ""}${fmtYear(p.b)} bis ${fmtYear(p.d)}`;
const initials = (name) => {
  const w = name.replace(/ (Jr\.|der Große|II\.|VII\.)/g, "").split(" ").filter((x) => /^[A-ZÄÖÜ]/.test(x));
  return w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] || "?")[0];
};
const nameOf = (id) => countries.find((c) => c.id === id)?.name || "";
const ERA_LABEL = { antike: "Antike", mittelalter: "Mittelalter und Renaissance", neuzeit: "Frühe Neuzeit", j19: "19. Jahrhundert", j20: "20. Jahrhundert" };
const PTOPIC_LABEL = { politik: "Politik und Geschichte", wissen: "Wissenschaft und Technik", wirtschaft: "Wirtschaft", kultur: "Kultur und Philosophie" };
const CTOPIC_LABEL = { wirtschaft: "Wirtschaft", geschichte: "Geschichte", wissenschaft: "Wissenschaft", politik: "Politik" };

/* ---------- Spiele ---------- */
const COUNTRY_MODES = [
  {
    id: "capital", title: "Hauptstädte", sub: "Land sehen, Hauptstadt wählen", icon: "🏛️",
    usable: (c) => !c.noCapitalQuiz,
    prompt: (c) => `<p class="prompt-label">Hauptstadt von</p><h2 class="prompt-big">${esc(c.name)}</h2><div class="prompt-small-flag">${c.flag}</div>`,
    answerLabel: (c) => esc(c.capital), answerText: (c) => c.capital,
    distinct: (c) => c.capital,
  },
  {
    id: "capital-rev", title: "Welches Land?", sub: "Hauptstadt sehen, Land wählen", icon: "Rom", iconText: true,
    usable: (c) => !c.noCapitalQuiz,
    prompt: (c) => `<p class="prompt-label">Wessen Hauptstadt ist</p><h2 class="prompt-big">${esc(c.capital)}</h2>`,
    answerLabel: (c) => esc(c.name), answerText: (c) => c.name,
    distinct: (c) => c.name,
  },
  {
    id: "flag", title: "Flaggen", sub: "Flagge sehen, Land wählen", icon: "🇨🇿",
    usable: () => true,
    prompt: (c) => `<p class="prompt-label">Zu welchem Land gehört diese Flagge?</p><p class="prompt-flag" aria-label="Flagge">${c.flag}</p>`,
    answerLabel: (c) => esc(c.name), answerText: (c) => c.name,
    distinct: (c) => c.name,
  },
  {
    id: "flag-rev", title: "Flagge finden", sub: "Land sehen, Flagge wählen", icon: "🏳️",
    usable: () => true, flagAnswers: true,
    prompt: (c) => `<p class="prompt-label">Welche Flagge gehört zu</p><h2 class="prompt-big">${esc(c.name)}</h2>`,
    answerLabel: (c) => `<span aria-label="Flagge von ${esc(c.name)}">${c.flag}</span>`, answerText: (c) => c.name,
    distinct: (c) => c.flag,
  },
];
COUNTRY_MODES.forEach((m) => { m.kind = "country"; m.sr = true; m.short = m.title; m.pick = () => pickFrom(m.id, pool(m)); });

// Karte: nur Länder, die auf dem Handy groß genug zum Antippen sind
function mapUsable(c) {
  const m = MAPIDX[c.id];
  if (!m || !MAPD) return false;
  const v = MAPD.views[region === "Alle" ? c.region : region] || MAPD.views.Alle;
  const px = Math.min(window.innerWidth || 390, 640) - 40;
  return m.s * (px / v[2]) >= 14;
}
const MAP_MODE = {
  id: "map", kind: "map", title: "Karte", sub: "Land auf der Karte antippen", icon: "🗺️", sr: true, short: "Karte",
  usable: mapUsable, pick: () => pickFrom("map", pool(MAP_MODE)),
};

const GAMES = [
  ...COUNTRY_MODES, MAP_MODE,
  { id: "tf", kind: "tf", title: "Wahr oder falsch", sub: "Stimmt die Aussage?", icon: "W/F", iconText: true, sr: true, short: "Wahr/Falsch", know: true,
    pick: () => pickFrom("tf", CONTENT.facts) },
  { id: "before", kind: "before", title: "Früher oder später?", sub: "Welches Ereignis kam zuerst?", icon: "⏳", short: "Früher/Später", know: true,
    pick: () => pickPairs() },
  { id: "year", kind: "year", title: "Jahr schätzen", sub: "Je näher, desto mehr Punkte", icon: "📅", scored: true, short: "Jahr schätzen", know: true,
    pick: () => shuffle(CONTENT.events).slice(0, 10) },
  { id: "timeline", kind: "timeline", title: "Zeitstrahl", sub: "Fünf Ereignisse ordnen", icon: "📜", short: "Zeitstrahl", know: true,
    pick: () => pickSets(5) },
  { id: "who", kind: "who", title: "Die Akte", sub: "Foto enthüllen, Person erraten", icon: "🕵️", sr: true, scored: true, short: "Die Akte", know: true,
    pick: () => pickWho() },
  { id: "duel", kind: "duel", title: "Zeitgenossen-Duell", sub: "Wer lebte früher, wer passt nicht dazu?", icon: "⚔️", short: "Duell", know: true,
    pick: () => pickDuels() },
  { id: "quote", kind: "quote", title: "Zitat-Rätsel", sub: "Von wem stammt das Zitat?", icon: "💬", sr: true, short: "Zitate", know: true,
    pick: () => pickFrom("quote", CONTENT.quotes) },
  { id: "links", kind: "links", title: "Verbindungen", sub: "Finde den Weg von Person zu Person", icon: "🕸️", scored: true, short: "Verbindungen", know: true,
    pick: () => pickRoutes() },
  { id: "face", kind: "face", title: "Gesichter", sub: "Porträt sehen, Person wählen", icon: "🖼️", sr: true, short: "Gesichter", know: true,
    avail: () => hasPhotos(), pick: () => pickFrom("face", CONTENT.people.filter((p) => photoUrl(p.id))) },
  { id: "c-salt", kind: "chem", group: "chem", title: "Salzbaukasten", sub: "Ionen zu Formel und Name", icon: "NaCl", iconText: true, sr: true, short: "Salze",
    avail: () => !!CHEM, pool: () => CHEM.salt, pick: () => pickFrom("c-salt", CHEM.salt) },
  { id: "c-redox", kind: "chem", group: "chem", title: "Redox", sub: "Oxidationszahlen, Elektronen, Spannungsreihe", icon: "e⁻", iconText: true, sr: true, short: "Redox",
    avail: () => !!CHEM, pool: () => CHEM.redox, pick: () => pickFrom("c-redox", CHEM.redox) },
  { id: "c-sb", kind: "chem", group: "chem", title: "Säuren und Basen", sub: "Formeln, Abkürzungen, Paare, pH", icon: "pH", iconText: true, sr: true, short: "Säure/Base",
    avail: () => !!CHEM, pool: () => CHEM.sb, pick: () => pickFrom("c-sb", CHEM.sb) },
  { id: "c-titr", kind: "chem", group: "chem", title: "Titrationskurve", sub: "Kurve lesen, Indikator wählen", icon: "📈", sr: true, short: "Titration",
    avail: () => !!CHEM, pool: () => CHEM.titr, pick: () => pickFrom("c-titr", CHEM.titr) },
  { id: "c-analytik", kind: "chem", group: "chem", title: "Analytik-Detektiv", sub: "Methode wählen, IR und NMR deuten", icon: "IR", iconText: true, sr: true, short: "Analytik",
    avail: () => !!CHEM, pool: () => CHEM.analytik, pick: () => pickFrom("c-analytik", CHEM.analytik) },
];
const DECK = { id: "cards", kind: "deck", title: "Tagesstapel", sr: true, noAgain: true, short: "Tagesstapel" };
const gameById = (id) => GAMES.find((g) => g.id === id);

/* ---------- Fortschritt: Lernkasten-System ----------
   Kasten 0 = falsch beantwortet, 1..5 = immer sicherer. Ab Kasten 3 gilt etwas als „sicher“. */
const INTERVAL_DAYS = [0, 0, 1, 3, 7, 21];
const MASTERED = 3;
let progress = store.get("progress", {});
let activity = store.get("activity", []);

function rec(modeId, id) { return progress[modeId]?.[id]; }
function saveRec(modeId, id, correct) {
  progress[modeId] ??= {};
  const r = progress[modeId][id] ?? { box: 0, due: 0, seen: 0, wrong: 0 };
  r.seen++;
  if (correct) r.box = Math.min(5, r.box + 1);
  else { r.box = 0; r.wrong++; }
  r.due = Date.now() + INTERVAL_DAYS[r.box] * 86400000;
  progress[modeId][id] = r;
  store.set("progress", progress);
}

function pool(mode) {
  return countries.filter((c) => mode.usable(c) && (region === "Alle" || c.region === region));
}

// Auswahl: erst fällige Wiederholungen, dann Neues, dann das am längsten Ungeübte
function pickFrom(modeId, all, n = 10) {
  const now = Date.now();
  const due = shuffle(all.filter((c) => { const r = rec(modeId, c.id); return r && r.box < 5 && r.due <= now; }))
    .sort((a, b) => rec(modeId, a.id).box - rec(modeId, b.id).box);
  const fresh = shuffle(all.filter((c) => !rec(modeId, c.id)));
  const rest = shuffle(all.filter((c) => !due.includes(c) && !fresh.includes(c)))
    .sort((a, b) => rec(modeId, a.id).due - rec(modeId, b.id).due);
  const out = [...due.slice(0, 5)];
  for (const list of [fresh, due.slice(5), rest]) for (const c of list) if (out.length < n && !out.includes(c)) out.push(c);
  return shuffle(out.slice(0, n));
}

function options(mode, target) {
  const all = countries.filter((c) => mode.usable(c) && c.id !== target.id && mode.distinct(c) !== mode.distinct(target));
  const near = shuffle(all.filter((c) => c.region === target.region));
  const far = shuffle(all.filter((c) => c.region !== target.region));
  return shuffle([target, ...[...near, ...far].slice(0, 3)]);
}

// Paare für „Früher oder später?“
function pickPairs(n = 10) {
  const ev = shuffle(CONTENT.events), used = new Set(), out = [];
  for (const a of ev) {
    if (used.has(a.id)) continue;
    const cand = ev.filter((x) => !used.has(x.id) && x.id !== a.id && Math.abs(x.y - a.y) >= 8);
    const near = cand.filter((x) => Math.abs(x.y - a.y) <= 200);
    const list = near.length && Math.random() < 0.7 ? near : cand;
    if (!list.length) continue;
    const b = list[Math.floor(Math.random() * list.length)];
    used.add(a.id); used.add(b.id); out.push([a, b]);
    if (out.length >= n) break;
  }
  return out;
}

// Fünfer-Gruppen für den Zeitstrahl (Abstand mindestens 6 Jahre)
function pickSets(n = 5, size = 5) {
  const used = new Set(), sets = [];
  for (let tries = 0; tries < 200 && sets.length < n; tries++) {
    const set = [];
    for (const e of shuffle(CONTENT.events)) {
      if (used.has(e.id)) continue;
      if (set.every((x) => Math.abs(x.y - e.y) >= 6)) set.push(e);
      if (set.length === size) break;
    }
    if (set.length === size) { set.forEach((e) => used.add(e.id)); sets.push(set); }
  }
  return sets;
}

/* ---------- Lernen-Übersicht ---------- */
function streakInfo() {
  const set = new Set(activity);
  let n = 0;
  const d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (set.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return { n, today: set.has(dayKey()), set };
}

const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
function row({ attr, icon, iconText, title, sub, pct }) {
  return `
    <button class="mode" ${attr}>
      <span class="mode-icon${iconText ? " text" : ""}" aria-hidden="true">${icon}</span>
      <span>
        <span class="mode-title">${title}</span>
        <span class="mode-sub" style="display:block">${sub}</span>
        ${pct == null ? "" : `<span class="bar" aria-hidden="true"><b style="width:${pct}%"></b></span>`}
      </span>
      ${CHEVRON}
    </button>`;
}

function gameStats(g) {
  const now = Date.now();
  let list = null;
  if (g.kind === "country" || g.kind === "map") list = pool(g);
  else if (g.id === "tf") list = CONTENT?.facts;
  else if (g.id === "who") list = CONTENT?.people;
  else if (g.id === "face") list = CONTENT?.people.filter((p) => photoUrl(p.id));
  else if (g.id === "quote") list = CONTENT?.quotes;
  else if (g.pool) list = g.pool();
  if (list) {
    const mastered = list.filter((x) => (rec(g.id, x.id)?.box ?? 0) >= MASTERED).length;
    const due = list.filter((x) => { const r = rec(g.id, x.id); return r && r.box < 5 && r.due <= now; }).length;
    return { sub: `${mastered} von ${list.length} sicher${due ? `, ${due} zum Wiederholen` : ""}`, pct: list.length ? Math.round((mastered / list.length) * 100) : 0 };
  }
  const best = store.get("best", {})[g.id];
  return { sub: best != null ? `Beste Runde: ${best} richtig` : g.sub, pct: null };
}
const gameRow = (g) => { const s = gameStats(g); return row({ attr: `data-game="${g.id}"`, icon: g.icon, iconText: g.iconText, title: g.title, sub: s.sub, pct: s.pct }); };

const masteredTotal = () => Object.values(progress).reduce((s, m) => s + Object.values(m).filter((r) => r.box >= MASTERED).length, 0);

function mastery(id) {
  let seen = false, sure = 0;
  for (const m of ["capital", "capital-rev", "flag", "flag-rev", "map"]) {
    const r = rec(m, id);
    if (r) { seen = true; if (r.box >= MASTERED) sure++; }
  }
  return !seen ? 0 : sure >= 3 ? 3 : sure >= 1 ? 2 : 1;
}

function renderLearn() {
  if (!countries.length) return;
  const { n, today, set } = streakInfo();
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    week.push(`<i class="${set.has(dayKey(d)) ? "on" : ""}" title="${d.toLocaleDateString("de-DE")}">${d.toLocaleDateString("de-DE", { weekday: "narrow" })}</i>`);
  }
  $("#streak").innerHTML = `
    <div class="streak-num">${n}</div>
    <div class="streak-text">
      <strong>${n === 1 ? "Tag in Folge" : "Tage in Folge"}</strong>
      <span>${today ? "Heute erledigt. Stark." : "Spiel heute eine Runde, um die Serie zu halten."}</span>
      <div class="week" aria-label="Letzte 7 Tage">${week.join("")}</div>
    </div>`;
  $("#learn-sub").textContent = `${masteredTotal()} Antworten sitzen sicher`;

  // Tagesstapel, Wissen und Personen
  const know = $("#modes-know");
  if (CONTENT) {
    const d = deckState();
    const done = d.pos >= d.ids.length;
    $("#deck-row").innerHTML = row({
      attr: 'data-open="deck"', icon: done ? "✓" : "🗂️", iconText: done,
      title: "Tagesstapel",
      sub: done ? "Heute geschafft. Morgen kommen 10 neue Karten." : `${d.pos} von ${d.ids.length} Karten heute${d.reviews ? `, ${d.reviews} Wiederholungen dabei` : ""}`,
      pct: Math.round((d.pos / d.ids.length) * 100),
    });
    know.innerHTML = GAMES.filter((g) => g.know && (!g.avail || g.avail())).map(gameRow).join("");
    const found = discovered().length;
    $("#atlas-row").innerHTML = row({
      attr: 'data-open="atlas"', icon: "🧭", title: "Personen-Album",
      sub: `${found} von ${CONTENT.people.length} Personen entdeckt`, pct: Math.round((found / CONTENT.people.length) * 100),
    });
  } else {
    $("#deck-row").innerHTML = ""; $("#atlas-row").innerHTML = "";
    know.innerHTML = `<div class="empty"><strong>Inhalte fehlen</strong>Die Datei content.json konnte nicht geladen werden.</div>`;
  }

  if (CHEM) {
    let cb = $("#chem-block");
    if (!cb) { cb = document.createElement("div"); cb.id = "chem-block"; $("#atlas-row").insertAdjacentElement("afterend", cb); }
    cb.innerHTML = `<h2 class="section-title chem-title">Chemie</h2><div class="modes">${GAMES.filter((g) => g.group === "chem").map(gameRow).join("")}</div>`;
  }

  // Welt-Quiz
  $("#regions").innerHTML = REGIONS.map((r) =>
    `<button role="radio" aria-checked="${r === region}" data-region="${r}">${r}</button>`).join("");
  $("#modes").innerHTML = [...COUNTRY_MODES, ...(MAPD ? [MAP_MODE] : [])].map(gameRow).join("");

  // Wissenskarte
  if (MAPD) {
    const v = MAPD.views.Alle;
    const quiz = new Set(countries.map((c) => c.id));
    let sure = 0;
    const paths = MAPD.countries.map((m) => {
      const lvl = m.i && quiz.has(m.i) ? mastery(m.i) : -1;
      return `<path class="land ${lvl < 0 ? "bg" : "k" + lvl}" d="${m.d}"/>`;
    }).join("");
    countries.forEach((c) => { if (mastery(c.id) === 3) sure++; });
    $("#know-sub").textContent = `${sure} von ${countries.length} Ländern sicher. Die Karte füllt sich, je mehr du übst.`;
    $("#know-map").innerHTML = `<svg viewBox="${v.join(" ")}" role="img" aria-label="Weltkarte mit deinem Lernstand">${paths}</svg>
      <div class="legend"><span><i class="k0"></i>offen</span><span><i class="k1"></i>in Übung</span><span><i class="k2"></i>teils sicher</span><span><i class="k3"></i>sicher</span></div>`;
  }
}

$("#regions").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  region = b.dataset.region; store.set("region", region); renderLearn();
});
$("#view-learn").addEventListener("click", (e) => {
  const b = e.target.closest(".mode"); if (!b) return;
  if (b.dataset.game) startQuiz(gameById(b.dataset.game));
  else if (b.dataset.open === "deck") startDeck();
  else if (b.dataset.open === "atlas") openSheet(atlasView);
});

/* ---------- Quiz-Rahmen ---------- */
let quiz = null;
let nextTimer;

function showQuiz() {
  $("#quiz").hidden = false;
  document.body.style.overflow = "hidden";
}

function startQuiz(game) {
  clearTimeout(nextTimer);
  const questions = game.pick();
  if (!questions.length) return;
  quiz = { mode: game, questions, i: 0, results: [], points: 0 };
  if (game.kind === "who") preloadPhotos(questions.map((q) => q.p));
  else if (game.kind === "face") preloadPhotos(questions);
  else if (game.kind === "duel") preloadPhotos(questions.flatMap((q) => q.people));
  showQuiz();
  renderModeSwitcher();
  renderQuestion();
}

function renderModeSwitcher() {
  const avail = GAMES.filter((g) => (g.know ? !!CONTENT : g.kind === "map" ? !!MAPD : true) && (!g.avail || g.avail()));
  $("#quiz-modes").innerHTML = avail.map((g) =>
    `<button role="radio" aria-checked="${g.id === quiz.mode.id}" data-mode="${g.id}">${g.short}</button>`).join("");
  const box = $("#quiz-modes"), act = box.querySelector('[aria-checked="true"]');
  if (act) box.scrollLeft = act.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft - (box.clientWidth - act.offsetWidth) / 2;
  else box.scrollLeft = 0;
}
$("#quiz-modes").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || !quiz || b.dataset.mode === quiz.mode.id) return;
  startQuiz(gameById(b.dataset.mode));
});

function closeQuiz() {
  clearTimeout(nextTimer);
  $("#quiz").hidden = true;
  document.body.style.overflow = "";
  quiz = null;
  renderLearn();
}
$("#quiz-close").addEventListener("click", closeQuiz);

function renderDots() {
  $("#quiz-dots").innerHTML = quiz.questions.map((_, i) => {
    const r = quiz.results[i];
    const cls = r === undefined ? (i === quiz.i ? "now" : "") : r.correct ? "ok" : "no";
    return `<li class="${cls}"></li>`;
  }).join("");
  $("#quiz-count").textContent = `${Math.min(quiz.i + 1, quiz.questions.length)}/${quiz.questions.length}`;
}

const RENDER = {
  country: (t) => renderCountry(t), map: (t) => renderMap(t), tf: (t) => renderTF(t), before: (t) => renderBefore(t),
  year: (t) => renderYear(t), timeline: (t) => renderTimeline(t), deck: (t) => renderDeck(t), face: (t) => renderFace(t), duel: (t) => renderDuel(t), quote: (t) => renderQuote(t), links: (t) => renderLinks(t), chem: (t) => renderChem(t),
  who: (t) => (t.mode === "learn" ? renderLearnCard(t) : renderAkte(t)),
};
function renderQuestion() {
  renderDots();
  RENDER[quiz.mode.kind](quiz.questions[quiz.i]);
}

// Ergebnis einer Frage festhalten und weiterschalten
function settle({ correct, show, feedback = "", auto = correct, delay = 650, pts = 0, after }) {
  quiz.results[quiz.i] = { correct, show, pts };
  quiz.points += pts;
  renderDots();
  const fb = $("#feedback");
  if (auto) {
    fb.innerHTML = feedback;
    nextTimer = setTimeout(next, delay);
  } else {
    fb.innerHTML = `${feedback}<button class="btn" id="next">Weiter</button>`;
    $("#next").addEventListener("click", next);
  }
  after?.();
}

function next() {
  if (!quiz) return;
  quiz.i++;
  if (quiz.i < quiz.questions.length) renderQuestion();
  else renderResult();
}

const FEEDBACK = '<div class="feedback" id="feedback"></div>';

/* ---------- Länder-Spiele ---------- */
function renderCountry(target) {
  const { mode } = quiz;
  const opts = options(mode, target);
  $("#quiz-body").innerHTML = `
    <div class="prompt">${mode.prompt(target)}</div>
    <div class="answers${mode.flagAnswers ? " flags" : ""}">
      ${opts.map((o) => `<button class="answer" data-id="${o.id}">${mode.answerLabel(o)}</button>`).join("")}
    </div>${FEEDBACK}`;
  $("#quiz-body").querySelectorAll(".answer").forEach((btn) =>
    btn.addEventListener("click", () => answerCountry(btn, target, opts), { once: true }));
}

function answerCountry(btn, target, opts) {
  const { mode } = quiz;
  const correct = btn.dataset.id === target.id;
  const buttons = $("#quiz-body").querySelectorAll(".answer");
  buttons.forEach((b) => { b.disabled = true; if (b.dataset.id === target.id) b.classList.add("correct"); });
  if (!correct) {
    btn.classList.add("wrong");
    if (mode.flagAnswers) {
      buttons.forEach((b) => {
        const c = opts.find((o) => o.id === b.dataset.id);
        b.insertAdjacentHTML("beforeend", `<span class="hint">${esc(c.name)}</span>`);
      });
    }
  }
  saveRec(mode.id, target.id, correct);
  const chosen = opts.find((o) => o.id === btn.dataset.id);
  settle({
    correct,
    show: { icon: target.flag, title: target.name, sub: mode.id.startsWith("capital") ? "Hauptstadt " + target.capital : "Deine Wahl: " + chosen.name },
    feedback: correct ? "" : `<p>Richtig wäre <strong>${esc(mode.answerText(target))}</strong></p>`,
  });
}

/* ---------- Karte ---------- */
function renderMap(target) {
  const view = region === "Alle" ? target.region : region;
  const v = MAPD.views[view] || MAPD.views.Alle;
  $("#quiz-body").innerHTML = `
    <div class="prompt tight"><p class="prompt-label">Tippe auf</p><h2 class="prompt-big small">${esc(target.name)}</h2></div>
    <div class="mapbox"><svg id="quiz-map" viewBox="${v.join(" ")}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Karte">${MAP_MARKUP}</svg></div>
    <p class="map-tip">Ausschnitt: ${view}</p>
    ${FEEDBACK}`;
  const svg = $("#quiz-map");
  let locked = false;
  svg.addEventListener("click", (e) => {
    const p = e.target.closest("path.land:not(.bg)");
    if (!p || locked) return;
    locked = true;
    const id = p.dataset.id;
    const correct = id === target.id;
    p.classList.add(correct ? "ok" : "no");
    const right = svg.querySelector(`path[data-id="${target.id}"]`);
    if (!correct && right) { right.classList.add("ok"); svg.appendChild(right); }
    svg.appendChild(p);
    saveRec("map", target.id, correct);
    settle({
      correct,
      show: { icon: target.flag, title: target.name, sub: correct ? "" : `Du hast ${nameOf(id)} gewählt` },
      feedback: correct ? "" : `<p>Das ist <strong>${esc(nameOf(id))}</strong>. Gesucht war <strong>${esc(target.name)}</strong>.</p>`,
    });
  });
}

/* ---------- Wahr oder falsch ---------- */
function renderTF(f) {
  $("#quiz-body").innerHTML = `
    <div class="prompt"><p class="prompt-label">Wahr oder falsch?</p><h2 class="prompt-statement">${esc(f.s)}</h2></div>
    <div class="answers two"><button class="answer" data-v="1">Wahr</button><button class="answer" data-v="0">Falsch</button></div>
    ${FEEDBACK}`;
  $("#quiz-body").querySelectorAll(".answer").forEach((btn) => btn.addEventListener("click", () => {
    const correct = (btn.dataset.v === "1") === f.a;
    $("#quiz-body").querySelectorAll(".answer").forEach((b) => {
      b.disabled = true;
      if ((b.dataset.v === "1") === f.a) b.classList.add("correct");
    });
    if (!correct) btn.classList.add("wrong");
    saveRec("tf", f.id, correct);
    settle({
      correct, auto: false,
      show: { icon: f.a ? "✓" : "✗", title: f.s, sub: f.e },
      feedback: `<p><strong>${f.a ? "Wahr" : "Falsch"}.</strong> ${esc(f.e)}</p>`,
    });
  }, { once: true }));
}

/* ---------- Früher oder später? ---------- */
function renderBefore([a, b]) {
  $("#quiz-body").innerHTML = `
    <div class="prompt short"><p class="prompt-label">Was geschah früher?</p></div>
    <div class="answers">
      <button class="answer" data-i="0">${esc(a.t)}<span class="hint"></span></button>
      <button class="answer" data-i="1">${esc(b.t)}<span class="hint"></span></button>
    </div>${FEEDBACK}`;
  $("#quiz-body").querySelectorAll(".answer").forEach((btn) => btn.addEventListener("click", () => {
    const first = a.y < b.y ? 0 : 1;
    const correct = Number(btn.dataset.i) === first;
    const btns = [...$("#quiz-body").querySelectorAll(".answer")];
    btns.forEach((x, i) => { x.disabled = true; x.querySelector(".hint").textContent = fmtYear((i ? b : a).y); if (i === first) x.classList.add("correct"); });
    if (!correct) btn.classList.add("wrong");
    const early = first ? b : a;
    settle({
      correct, delay: 1500,
      show: { icon: "✗", title: `${a.t} oder ${b.t}`, sub: `${fmtYear(a.y)} und ${fmtYear(b.y)}` },
      feedback: correct ? "" : `<p>Früher war: <strong>${esc(early.t)}</strong> (${fmtYear(early.y)})</p>`,
    });
  }, { once: true }));
}

/* ---------- Jahr schätzen ---------- */
function renderYear(e) {
  $("#quiz-body").innerHTML = `
    <div class="prompt"><p class="prompt-label">In welchem Jahr geschah das?</p><h2 class="prompt-statement">${esc(e.t)}</h2></div>
    <div class="year-row">
      <input id="yr" type="number" inputmode="numeric" placeholder="Jahr" aria-label="Jahr">
      <button class="lang-btn" id="era" type="button" data-bc="0">n. Chr.</button>
    </div>
    <button class="btn wide" id="check">Prüfen</button>
    ${FEEDBACK}`;
  const input = $("#yr"), era = $("#era"), check = $("#check");
  era.addEventListener("click", () => {
    const bc = era.dataset.bc === "1" ? "0" : "1";
    era.dataset.bc = bc;
    era.textContent = bc === "1" ? "v. Chr." : "n. Chr.";
  });
  const submit = () => {
    const raw = parseInt(input.value, 10);
    if (Number.isNaN(raw) || check.disabled) return;
    const guess = era.dataset.bc === "1" ? -Math.abs(raw) : Math.abs(raw);
    const err = Math.abs(guess - e.y);
    const tol = Math.max(3, Math.round(Math.abs(THIS_YEAR - e.y) * 0.04));
    const correct = err <= tol;
    const pts = Math.max(0, Math.round(100 * (1 - err / (tol * 4))));
    input.disabled = true; era.disabled = true; check.disabled = true; check.hidden = true;
    settle({
      correct, auto: false, pts,
      show: { icon: correct ? "✓" : "✗", title: e.t, sub: `Richtig: ${fmtYear(e.y)}, dein Tipp: ${fmtYear(guess)}` },
      feedback: `<p><strong>${fmtYear(e.y)}</strong><br>${err === 0 ? "Auf das Jahr genau!" : `${err} ${err === 1 ? "Jahr" : "Jahre"} daneben`} · ${pts} Punkte</p>`,
    });
  };
  check.addEventListener("click", submit);
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submit(); });
}

/* ---------- Zeitstrahl ---------- */
function renderTimeline(set) {
  const order = [];
  const shuffled = shuffle(set);
  let finished = false;
  $("#quiz-body").innerHTML = `
    <div class="prompt short"><p class="prompt-label">Tippe die Ereignisse der Reihe nach an: das älteste zuerst.</p></div>
    <div class="tl" id="tl"></div>
    <div class="tl-actions"><button class="btn ghost" id="undo" type="button">Letzte Auswahl zurücknehmen</button></div>
    ${FEEDBACK}`;
  const draw = () => {
    $("#tl").innerHTML = shuffled.map((ev) => {
      const k = order.indexOf(ev.id);
      return `<button class="tl-item${k >= 0 ? " picked" : ""}" data-id="${ev.id}" ${k >= 0 || finished ? "disabled" : ""}>
        ${k >= 0 ? `<b class="tl-badge">${k + 1}</b>` : `<b class="tl-badge empty"></b>`}<span>${esc(ev.t)}</span></button>`;
    }).join("");
    $("#undo").disabled = finished || order.length === 0;
  };
  draw();
  $("#tl").addEventListener("click", (e) => {
    const b = e.target.closest(".tl-item");
    if (!b || finished) return;
    order.push(b.dataset.id);
    if (order.length < set.length) { draw(); return; }
    finished = true;
    draw();
    $("#undo").hidden = true;
    const sorted = [...set].sort((x, y) => x.y - y.y);
    const right = order.filter((id, i) => id === sorted[i].id).length;
    const correct = right === set.length;
    settle({
      correct, auto: false,
      show: { icon: correct ? "✓" : "✗", title: "Zeitstrahl", sub: `${right} von ${set.length} an der richtigen Stelle` },
      feedback: `<div class="fb-text"><p><strong>${right} von ${set.length}</strong> an der richtigen Stelle.</p>
        <ol class="tl-result">${sorted.map((ev, i) => `<li class="${order[i] === ev.id ? "ok" : "no"}"><b>${fmtYear(ev.y)}</b> ${esc(ev.t)}</li>`).join("")}</ol></div>`,
      after: () => { const qb = $("#quiz-body"); qb.scrollTop = qb.scrollHeight; },
    });
  });
  $("#undo").addEventListener("click", () => { if (!finished) { order.pop(); draw(); } });
}

/* ---------- Die Akte (früher „Wer war das?“) ---------- */
const discovered = () => store.get("people", []);
function discover(id) {
  const list = discovered();
  if (!list.includes(id)) { list.push(id); store.set("people", list); }
}

const PHOTO_MIN = 8; // erst ab so vielen Porträts werden Foto-Spiele angeboten
const hasPhotos = () => Object.keys(PORTRAITS).length >= PHOTO_MIN;
const photoUrl = (id) => { const r = PORTRAITS[id]; return r ? `${r.file}?v=${r.v}` : null; };
function preloadPhotos(people) { people.forEach((p) => { const u = photoUrl(p.id); if (u) new Image().src = u; }); }

const SILHOUETTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/></svg>';

// Runder oder quadratischer Ausschnitt (Initialen, solange kein Foto da ist)
function avatar(p, cls = "") {
  const u = photoUrl(p.id);
  return `<span class="avatar ${cls}" aria-hidden="true">${u ? `<img src="${esc(u)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<span class="ini">${esc(initials(p.name))}</span></span>`;
}

// Großes Porträt; bei blur > 0 ist es verschwommen (Akte), Silhouette wenn kein Foto vorhanden ist
function portraitHTML(p, { blur = 0, stamp = "", id = "", big = false } = {}) {
  const u = photoUrl(p.id);
  return `<div class="portrait${u ? "" : " nophoto"}${big ? " big" : ""}"${id ? ` id="${id}"` : ""}>
    ${u ? `<img src="${esc(u)}" alt="" style="--blur:${blur}px" onerror="this.parentNode.classList.add('nophoto');this.remove()">` : ""}
    <span class="silhouette">${SILHOUETTE}</span>${stamp ? `<span class="stamp">${esc(stamp)}</span>` : ""}</div>`;
}

function lifeBar(p) {
  const min = -800, max = THIS_YEAR, span = max - min;
  const pct = (y) => ((Math.max(min, Math.min(max, y)) - min) / span) * 100;
  const left = pct(p.b), width = Math.max(1.5, pct(p.d) - pct(p.b));
  const tick = (y, label) => `<span style="left:${pct(y)}%">${label}</span>`;
  return `<div class="lifebar" role="img" aria-label="Lebenszeit ${esc(lifeSpan(p))}">
    <div class="track"><i style="left:${left}%;width:${width}%"></i></div>
    <div class="ticks">${tick(-800, "800 v. Chr.")}${tick(0, "0")}${tick(1000, "1000")}${tick(max, "heute")}</div></div>`;
}

function steckbriefHTML(p) {
  return `<h2 class="profile-name">${esc(p.name)}</h2>
    <p class="profile-meta">${esc(p.role)}<br>${lifeSpan(p)}</p>
    ${lifeBar(p)}
    <p class="profile-tags"><span class="cat">${ERA_LABEL[p.era]}</span><span class="cat">${PTOPIC_LABEL[p.topic]}</span></p>
    <h3>Kurz erklärt</h3><p>${esc(p.short)}</p>
    <h3>Hintergrund</h3><p>${esc(p.bg)}</p>`;
}

/* Schwierigkeit passt sich automatisch an den Lernstand (Kasten) an */
const AKTE_FIELDS = [
  { key: "era", label: "Epoche", val: (p) => ERA_LABEL[p.era] },
  { key: "country", label: "Land", val: (p) => p.country },
  { key: "life", label: "Lebensdaten", val: (p) => lifeSpan(p) },
  { key: "role", label: "Beruf", val: (p) => p.role },
  { key: "known", label: "Bekannt für", val: (p) => p.known },
  { key: "hint", label: "Persönlicher Hinweis", val: (p) => p.hints[2] },
];
const AKTE_LEVELS = {
  1: { label: "Einfach", blur: 10, open: ["era", "country"], dist: "far" },
  2: { label: "Mittel", blur: 16, open: ["era"], dist: "topic" },
  3: { label: "Schwer", blur: 22, open: [], dist: "near" },
};
function whoLevel(p) {
  const r = rec("who", p.id);
  if (!r) return 1;
  return r.box <= 1 ? 1 : r.box <= 3 ? 2 : 3;
}

// Neue Personen lernt man zuerst kennen (Steckbrief, dann Mini-Check), höchstens drei pro Runde. Der Rest kommt als Akte.
function pickWho(n = 10) {
  const picked = pickFrom("who", CONTENT.people, n);
  let learn = 0;
  return picked.map((p) => {
    if (!rec("who", p.id) && learn < 3) { learn++; return { p, mode: "learn" }; }
    return { p, mode: "akte", level: whoLevel(p) };
  });
}

function whoOptions(p, dist = "topic") {
  const others = CONTENT.people.filter((x) => x.id !== p.id);
  let pool;
  if (dist === "far") pool = others.filter((x) => x.topic !== p.topic && x.era !== p.era);
  else if (dist === "near") pool = others.filter((x) => x.topic === p.topic).sort((a, b) => Math.abs(a.b - p.b) - Math.abs(b.b - p.b)).slice(0, 8);
  else pool = others.filter((x) => x.topic === p.topic);
  const rest = others.filter((x) => !pool.includes(x));
  return shuffle([p, ...[...shuffle(pool), ...shuffle(rest)].slice(0, 3)]);
}

// Ergebnis festhalten, ohne automatisch weiterzuschalten
function record({ correct, show, pts = 0 }) {
  quiz.results[quiz.i] = { correct, show, pts };
  quiz.points += pts;
  renderDots();
}

// Mini-Check: eine Frage zur Leistung der Person
function renderMiniCheck(p, onAnswer) {
  const opts = shuffle(p.qa.o.map((t, i) => ({ t, ok: i === 0 })));
  $("#quiz-body").innerHTML = `
    <div class="mini-head">${avatar(p, "sm")}<span><strong>${esc(p.name)}</strong><span class="muted">Mini-Check</span></span></div>
    <div class="prompt tight"><h2 class="prompt-statement">${esc(p.qa.q)}</h2></div>
    <div class="answers">${opts.map((o, i) => `<button class="answer" data-i="${i}">${esc(o.t)}</button>`).join("")}</div>
    ${FEEDBACK}`;
  $("#quiz-body").querySelectorAll(".answer").forEach((btn) => btn.addEventListener("click", () => {
    const correct = opts[Number(btn.dataset.i)].ok;
    $("#quiz-body").querySelectorAll(".answer").forEach((b, i) => { b.disabled = true; if (opts[i].ok) b.classList.add("correct"); });
    if (!correct) btn.classList.add("wrong");
    onAnswer(correct);
    $("#feedback").innerHTML = `<p>${correct ? "Richtig." : `Richtig wäre <strong>${esc(p.qa.o[0])}</strong>`}</p><button class="btn" id="next">Weiter</button>`;
    $("#next").addEventListener("click", next);
  }, { once: true }));
}

// Neue Person: erst kennenlernen, dann Mini-Check
function renderLearnCard({ p }) {
  discover(p.id);
  $("#quiz-body").innerHTML = `
    <div class="profile learn">
      ${portraitHTML(p, { stamp: "Neu", big: true })}
      ${steckbriefHTML(p)}
    </div>
    <div class="card-actions"><button class="btn wide" id="to-check" type="button">Weiter zum Mini-Check</button></div>`;
  $("#to-check").addEventListener("click", () => renderMiniCheck(p, (correct) => {
    saveRec("who", p.id, correct);
    record({ correct, pts: correct ? 3 : 0, show: { icon: initials(p.name), title: p.name, sub: "neu kennengelernt" } });
  }));
}

// Bekannte Person: Akte mit geschwärzten Feldern, das Foto wird mit jedem aufgedeckten Feld schärfer
function renderAkte({ p, level }) {
  const L = AKTE_LEVELS[level];
  const opts = whoOptions(p, L.dist);
  const open = new Set(L.open);
  const wasUnseen = !rec("who", p.id);
  let paid = 0, wrong = 0, done = false;
  $("#quiz-body").innerHTML = `
    <div class="akte">
      ${portraitHTML(p, { blur: L.blur, stamp: L.label, id: "akte-portrait" })}
      <div class="akte-side">
        <p class="akte-name" id="akte-name">Unbekannte Person</p>
        <p class="muted akte-rule">Jedes aufgedeckte Feld kostet einen Punkt. Ein falscher Tipp deckt ein Feld auf, beim zweiten ist der Fall verloren.</p>
      </div>
    </div>
    <div class="fields" id="fields"></div>
    <div class="answers" id="who-opts">${opts.map((o) => `<button class="answer" data-id="${o.id}">${esc(o.name)}</button>`).join("")}</div>
    ${FEEDBACK}`;
  const portrait = $("#akte-portrait");
  portrait.classList.add("hidden");
  const img = portrait.querySelector("img");
  const paintBlur = () => img?.style.setProperty("--blur", `${Math.max(0, L.blur * (1 - paid / 4))}px`);
  const draw = () => {
    $("#fields").innerHTML = AKTE_FIELDS.map((f) => open.has(f.key)
      ? `<div class="field open"><span class="f-label">${f.label}</span><span class="f-val">${esc(f.val(p))}</span></div>`
      : `<button class="field locked" data-key="${f.key}" type="button"><span class="f-label">${f.label}</span><span class="f-val redact">▮▮▮▮▮▮▮▮▮▮</span><span class="f-cost">−1</span></button>`).join("");
  };
  const reveal = (key) => { if (done || open.has(key)) return; open.add(key); paid++; draw(); paintBlur(); };
  draw();
  $("#fields").addEventListener("click", (e) => { const b = e.target.closest(".field.locked"); if (b) reveal(b.dataset.key); });

  const finish = (correct) => {
    done = true;
    $("#who-opts").querySelectorAll(".answer").forEach((x) => { x.disabled = true; if (x.dataset.id === p.id) x.classList.add("correct"); });
    portrait.classList.remove("hidden");
    img?.style.setProperty("--blur", "0px");
    const pts = correct ? Math.max(1, 5 - paid) + (level - 1) : 0;
    saveRec("who", p.id, correct && paid <= 3);
    discover(p.id);
    record({ correct, pts, show: { icon: initials(p.name), title: p.name, sub: correct ? `${paid} Feld${paid === 1 ? "" : "er"} aufgedeckt` : "nicht erkannt" } });
    const needsCheck = !correct || wasUnseen;
    $("#akte-name").textContent = p.name;
    $(".akte-rule").textContent = `${p.role} · ${lifeSpan(p)}`;
    $("#fields").innerHTML = `${lifeBar(p)}<p class="sol-short">${esc(p.short)}</p>`;
    $("#who-opts").hidden = true;
    $("#feedback").innerHTML = `<p><strong>${correct ? `${pts} Punkte` : "Fall verloren"}</strong><br><span class="muted">${correct ? "Gelöst" : "Die Person war"} ${esc(p.name)}</span></p>
      <button class="btn ghost" id="open-profile" type="button">Profil</button>
      <button class="btn" id="to-check" type="button">${needsCheck ? "Mini-Check" : "Weiter"}</button>`;
    $("#open-profile").addEventListener("click", () => openProfile(p.id));
    $("#to-check").addEventListener("click", () => (needsCheck ? renderMiniCheck(p, () => {}) : next()));
  };
  $("#who-opts").addEventListener("click", (e) => {
    const b = e.target.closest(".answer");
    if (!b || done || b.disabled) return;
    if (b.dataset.id === p.id) return finish(true);
    b.classList.add("wrong"); b.disabled = true;
    wrong++;
    if (wrong >= 2) return finish(false);
    const nextField = AKTE_FIELDS.find((f) => !open.has(f.key));
    if (nextField) reveal(nextField.key);
  });
}

/* ---------- Gesichter: Porträt sehen, Person wählen ---------- */
function renderFace(p) {
  const opts = whoOptions(p, "topic");
  $("#quiz-body").innerHTML = `
    <div class="prompt tight"><p class="prompt-label">Wer ist das?</p></div>
    ${portraitHTML(p, { big: true })}
    <div class="answers">${opts.map((o) => `<button class="answer" data-id="${o.id}">${esc(o.name)}</button>`).join("")}</div>
    ${FEEDBACK}`;
  $("#quiz-body").querySelectorAll(".answer").forEach((btn) => btn.addEventListener("click", () => {
    const correct = btn.dataset.id === p.id;
    $("#quiz-body").querySelectorAll(".answer").forEach((b) => { b.disabled = true; if (b.dataset.id === p.id) b.classList.add("correct"); });
    if (!correct) btn.classList.add("wrong");
    saveRec("face", p.id, correct);
    discover(p.id);
    settle({
      correct,
      show: { icon: initials(p.name), title: p.name, sub: lifeSpan(p) },
      feedback: correct ? "" : `<p>Das war <strong>${esc(p.name)}</strong><br><span class="muted">${esc(p.role)}</span></p>`,
    });
  }, { once: true }));
}

/* ---------- Verbindungsnetz ---------- */
const NEIGH = {}; // id -> [{ to, w }]
function buildGraph() {
  for (const k of Object.keys(NEIGH)) delete NEIGH[k];
  CONTENT.edges.forEach(({ a, b, w }) => {
    (NEIGH[a] ??= []).push({ to: b, w });
    (NEIGH[b] ??= []).push({ to: a, w });
  });
}
function distFrom(src) {
  const d = { [src]: 0 }, q = [src];
  for (let i = 0; i < q.length; i++) {
    for (const { to } of NEIGH[q[i]] || []) if (!(to in d)) { d[to] = d[q[i]] + 1; q.push(to); }
  }
  return d;
}
const edgeWhy = (a, b) => (NEIGH[a] || []).find((n) => n.to === b)?.w || "";
function shortestPath(a, b) {
  const prev = { [a]: null }, q = [a];
  for (let i = 0; i < q.length && !(b in prev); i++) {
    for (const { to } of NEIGH[q[i]] || []) if (!(to in prev)) { prev[to] = q[i]; q.push(to); }
  }
  const path = [];
  for (let c = b; c != null; c = prev[c]) path.unshift(c);
  return path;
}

/* ---------- Zeitgenossen-Duell ---------- */
const DUEL_BORN_GAP = 25, DUEL_ODD_GAP = 40;
function pickDuels(n = 10) {
  const P = CONTENT.people, out = [];
  for (let guard = 0; out.length < n && guard < 600; guard++) {
    if (Math.random() < 0.5) {
      const [a, b] = shuffle(P).slice(0, 2);
      if (Math.abs(a.b - b.b) < DUEL_BORN_GAP) continue;
      out.push({ type: "born", people: [a, b], answer: (a.b < b.b ? a : b).id });
    } else {
      const y = P[Math.floor(Math.random() * P.length)].b + 20;
      const alive = shuffle(P.filter((p) => p.b <= y && y <= p.d));
      if (alive.length < 3) continue;
      const three = alive.slice(0, 3);
      const lo = Math.min(...three.map((p) => p.b)), hi = Math.max(...three.map((p) => p.d));
      const far = P.filter((p) => p.d < lo - DUEL_ODD_GAP || p.b > hi + DUEL_ODD_GAP);
      if (!far.length) continue;
      const odd = far[Math.floor(Math.random() * far.length)];
      out.push({ type: "odd", people: shuffle([...three, odd]), answer: odd.id });
    }
  }
  return out;
}

// Lebenszeiten als Balken auf gemeinsamer Zeitachse
function rangeChart(list, markId) {
  const lo = Math.min(...list.map((p) => p.b)) - 10, hi = Math.max(...list.map((p) => p.d)) + 10, span = hi - lo;
  return `<div class="range">${list.slice().sort((a, b) => a.b - b.b).map((p) => `
    <div class="r-row${p.id === markId ? " mark" : ""}">
      <span class="r-name">${esc(p.name)}</span>
      <div class="r-track"><i style="left:${((p.b - lo) / span) * 100}%;width:${Math.max(1.5, ((p.d - p.b) / span) * 100)}%"></i></div>
      <span class="r-years">${lifeSpan(p)}</span>
    </div>`).join("")}</div>`;
}

function renderDuel(q) {
  const born = q.type === "born";
  $("#quiz-body").innerHTML = `
    <div class="prompt short"><p class="prompt-label">${born ? "Wer wurde früher geboren?" : "Drei von ihnen lebten zur selben Zeit. Wer passt nicht dazu?"}</p></div>
    <div class="duel${born ? " two" : ""}">
      ${q.people.map((p) => `<button class="duel-card" data-id="${p.id}" type="button">${avatar(p, "sq")}<span class="t-name">${esc(p.name)}</span></button>`).join("")}
    </div>${FEEDBACK}`;
  $("#quiz-body").querySelectorAll(".duel-card").forEach((btn) => btn.addEventListener("click", () => {
    const correct = btn.dataset.id === q.answer;
    const ans = PEOPLE[q.answer];
    $("#quiz-body").querySelectorAll(".duel-card").forEach((b) => {
      b.disabled = true;
      if (b.dataset.id === q.answer) b.classList.add("correct");
    });
    if (!correct) btn.classList.add("wrong");
    const text = born
      ? `<strong>${esc(ans.name)}</strong> wurde früher geboren.`
      : `<strong>${esc(ans.name)}</strong> lebte zu einer ganz anderen Zeit als die drei anderen.`;
    settle({
      correct, auto: false,
      show: { icon: born ? "↔" : "≠", title: q.people.map((p) => p.name).join(", "), sub: born ? `Früher geboren: ${ans.name}` : `Passt nicht dazu: ${ans.name}` },
      feedback: `<div class="fb-text"><p>${text}</p>${rangeChart(q.people, q.answer)}</div>`,
    });
  }, { once: true }));
}

/* ---------- Zitat-Rätsel ---------- */
function renderQuote(item) {
  const p = PEOPLE[item.p];
  const opts = whoOptions(p, "topic");
  $("#quiz-body").innerHTML = `
    <div class="prompt"><p class="prompt-label">Von wem stammt dieses Zitat?</p>
      <blockquote class="quote">„${esc(item.q)}“</blockquote></div>
    <div class="answers">${opts.map((o) => `<button class="answer" data-id="${o.id}">${esc(o.name)}</button>`).join("")}</div>
    ${FEEDBACK}`;
  $("#quiz-body").querySelectorAll(".answer").forEach((btn) => btn.addEventListener("click", () => {
    const correct = btn.dataset.id === p.id;
    $("#quiz-body").querySelectorAll(".answer").forEach((b) => { b.disabled = true; if (b.dataset.id === p.id) b.classList.add("correct"); });
    if (!correct) btn.classList.add("wrong");
    saveRec("quote", item.id, correct);
    discover(p.id);
    settle({
      correct, auto: false,
      show: { icon: initials(p.name), title: `„${item.q}“`, sub: p.name },
      feedback: `<div class="fb-text"><p><strong>${esc(p.name)}</strong><br><span class="muted">${esc(item.s)}</span></p>
        ${item.t ? '<p class="muted small">Überliefert: Der genaue Wortlaut ist nicht gesichert.</p>' : ""}</div>
        <button class="btn ghost" id="open-profile" type="button">Profil</button>`,
      after: () => $("#open-profile").addEventListener("click", () => openProfile(p.id)),
    });
  }, { once: true }));
}

/* ---------- Verbindungen: Weg von Person A zu Person B ---------- */
function pickRoutes(n = 5) {
  const ids = CONTENT.people.map((p) => p.id), out = [], used = new Set();
  for (let guard = 0; out.length < n && guard < 400; guard++) {
    const a = ids[Math.floor(Math.random() * ids.length)];
    if (used.has(a)) continue;
    const d = distFrom(a);
    const cands = ids.filter((b) => d[b] >= 2 && d[b] <= 4 && !used.has(b));
    if (!cands.length) continue;
    const b = cands[Math.floor(Math.random() * cands.length)];
    used.add(a); used.add(b);
    out.push({ a, b, opt: d[b] });
  }
  return out;
}

function renderLinks({ a, b, opt }) {
  const A = PEOPLE[a], B = PEOPLE[b];
  const toGoal = distFrom(b);               // Abstand jeder Person zum Ziel
  const path = [a];
  const limit = opt + 3;
  const chain = () => path.map((id) => `<span class="stop">${esc(PEOPLE[id].name)}</span>`).join('<span class="arrow">→</span>');
  const summary = (ids) => `<ol class="tl-result">${ids.slice(1).map((id, i) => `<li><b>${esc(PEOPLE[ids[i]].name)} → ${esc(PEOPLE[id].name)}</b><br>${esc(edgeWhy(ids[i], id))}</li>`).join("")}</ol>`;

  const draw = () => {
    const cur = path[path.length - 1];
    const seen = new Set(path);
    let options = (NEIGH[cur] || []).map((n) => n.to).filter((id) => !seen.has(id));
    if (options.length < 2) options = (NEIGH[cur] || []).map((n) => n.to);
    const good = shuffle(options.filter((id) => toGoal[id] < toGoal[cur]));
    const rest = shuffle(options.filter((id) => !(toGoal[id] < toGoal[cur])));
    const shown = shuffle([...good.slice(0, 2), ...rest.slice(0, 5 - Math.min(2, good.length)), ...good.slice(2, 3)].slice(0, 5));
    if (toGoal[cur] === 1 && !shown.includes(b)) shown[0] = b;
    const steps = path.length - 1;
    $("#quiz-body").innerHTML = `
      <div class="prompt short"><p class="prompt-label">Finde den Weg über verbundene Personen. Schritte: ${steps} · Ziel erreichbar in ${opt}</p></div>
      <div class="route"><div class="route-goal"><span class="muted">Start</span><strong>${esc(A.name)}</strong></div><span class="arrow">→</span><div class="route-goal"><span class="muted">Ziel</span><strong>${esc(B.name)}</strong></div></div>
      <div class="chain">${chain()}</div>
      <p class="prompt-label hop">Mit wem ist <strong>${esc(PEOPLE[cur].name)}</strong> verbunden?</p>
      <div class="answers" id="hop-opts">${shown.map((id) => `<button class="answer" data-id="${id}">${esc(PEOPLE[id].name)}<span class="hint">${esc(PEOPLE[id].role)}</span></button>`).join("")}</div>
      ${FEEDBACK}`;
    $("#hop-opts").addEventListener("click", (e) => {
      const btn = e.target.closest(".answer");
      if (!btn || btn.disabled) return;
      step(btn.dataset.id, cur, btn);
    });
  };

  const step = (id, cur, btn) => {
    const before = toGoal[cur], after = toGoal[id];
    $("#hop-opts").querySelectorAll(".answer").forEach((x) => { x.disabled = true; });
    btn.classList.add(after < before ? "correct" : after > before ? "wrong" : "neutral");
    path.push(id);
    const mood = after < before ? "Näher dran" : after > before ? "Umweg" : "Gleich weit entfernt";
    const why = esc(edgeWhy(cur, id));
    const steps = path.length - 1;
    if (id === b || steps >= limit) $("#hop-opts").hidden = true;
    if (id === b) {
      const pts = Math.max(1, 6 - 2 * (steps - opt));
      record({ correct: steps <= opt + 1, pts, show: { icon: "🕸", title: `${A.name} → ${B.name}`, sub: `${steps} Schritte, kürzester Weg: ${opt}` } });
      $("#feedback").innerHTML = `<div class="fb-text"><p><strong>Ziel erreicht in ${steps} ${steps === 1 ? "Schritt" : "Schritten"}</strong> (kürzester Weg: ${opt}) · ${pts} Punkte</p>${summary(path)}</div><button class="btn" id="next" type="button">Weiter</button>`;
      $("#next").addEventListener("click", next);
      return;
    }
    if (steps >= limit) {
      const best = shortestPath(a, b);
      record({ correct: false, pts: 0, show: { icon: "🕸", title: `${A.name} → ${B.name}`, sub: `zu viele Umwege, kürzester Weg: ${opt}` } });
      $("#feedback").innerHTML = `<div class="fb-text"><p><strong>Zu viele Umwege.</strong> Ein kürzester Weg:</p>${summary(best)}</div><button class="btn" id="next" type="button">Weiter</button>`;
      $("#next").addEventListener("click", next);
      return;
    }
    $("#feedback").innerHTML = `<div class="fb-text"><p><strong>${mood}.</strong><br>${why}</p></div><button class="btn" id="step-on" type="button">Weiter</button>`;
    $("#step-on").addEventListener("click", draw);
  };
  draw();
}

/* ---------- Profile und Atlas (Overlay) ---------- */
const sheetStack = [];
function openSheet(render) {
  sheetStack.push(render);
  $("#sheet").hidden = false;
  document.body.style.overflow = "hidden";
  render();
  $("#sheet-body").scrollTop = 0;
}
function sheetBack() {
  sheetStack.pop();
  if (sheetStack.length) { sheetStack[sheetStack.length - 1](); return; }
  $("#sheet").hidden = true;
  document.body.style.overflow = $("#quiz").hidden ? "" : "hidden";
  renderLearn();
}
$("#sheet-back").addEventListener("click", sheetBack);
const openProfile = (id) => openSheet(() => profileView(id));

function profileView(id) {
  const p = PEOPLE[id];
  discover(id);
  $("#sheet-title").textContent = "Profil";
  const rel = (NEIGH[id] || []).map((n) => ({ p: PEOPLE[n.to], w: n.w })).filter((r) => r.p);
  const ph = PORTRAITS[id];
  $("#sheet-body").innerHTML = `
    <div class="profile">
      ${portraitHTML(p, { big: true })}
      ${steckbriefHTML(p)}
      ${ph ? `<p class="credit">Foto: ${esc(ph.artist)}, ${esc(ph.license)}, <a href="${esc(ph.page)}" target="_blank" rel="noopener">Wikimedia Commons</a></p>` : ""}
      <h3>Weiter entdecken</h3>
      <div class="rabbit">${rel.map((r) => `<button class="atlas-row" data-id="${r.p.id}">${avatar(r.p, "sm")}<span><strong>${esc(r.p.name)}</strong><span class="muted why">${esc(r.w)}</span></span></button>`).join("")}</div>
      <a class="btn ghost wide wiki" href="https://de.wikipedia.org/w/index.php?search=${encodeURIComponent(p.name)}" target="_blank" rel="noopener">Bei Wikipedia lesen</a>
    </div>`;
  $("#sheet-body").querySelectorAll(".rabbit .atlas-row").forEach((b) => b.addEventListener("click", () => openProfile(b.dataset.id)));
}

// Personen-Album: Porträts pro Epoche oder Thema, unbekannte Personen bleiben ein Fragezeichen
let atlasBy = "era";
function atlasView() {
  $("#sheet-title").textContent = "Personen-Album";
  const seen = new Set(discovered());
  const all = CONTENT.people;
  const groups = atlasBy === "era"
    ? Object.entries(ERA_LABEL).map(([k, label]) => [label, all.filter((p) => p.era === k)])
    : Object.entries(PTOPIC_LABEL).map(([k, label]) => [label, all.filter((p) => p.topic === k)]);
  $("#sheet-body").innerHTML = `
    <p class="page-sub">${seen.size} von ${all.length} Personen entdeckt. Neue Personen findest du in „Die Akte“ und bei den Gesichtern.</p>
    <div class="segmented two" role="tablist" aria-label="Sortierung">
      <button role="tab" data-by="era" aria-selected="${atlasBy === "era"}">Nach Epoche</button>
      <button role="tab" data-by="topic" aria-selected="${atlasBy === "topic"}">Nach Thema</button>
    </div>
    ${groups.map(([label, list]) => {
      const sorted = list.slice().sort((a, b) => a.b - b.b);
      const mine = sorted.filter((p) => seen.has(p.id)).length;
      return `<h3 class="atlas-group">${label} <span class="muted">${mine}/${list.length}</span></h3>
        <div class="grid">${sorted.map((p) => seen.has(p.id)
          ? `<button class="tile" data-id="${p.id}">${avatar(p, "sq")}<span class="t-name">${esc(p.name)}</span></button>`
          : `<div class="tile locked" aria-label="noch unbekannt"><span class="avatar sq"><span class="ini">?</span></span><span class="t-name">???</span></div>`).join("")}</div>`;
    }).join("")}`;
  $("#sheet-body").querySelectorAll(".tile[data-id]").forEach((b) => b.addEventListener("click", () => openProfile(b.dataset.id)));
  $("#sheet-body").querySelectorAll("[data-by]").forEach((b) => b.addEventListener("click", () => { atlasBy = b.dataset.by; atlasView(); }));
}

/* ---------- Tagesstapel ---------- */
const DECK_SIZE = 10;
function buildDeck() {
  const now = Date.now();
  const cards = CONTENT.cards;
  const due = shuffle(cards.filter((c) => { const r = rec("cards", c.id); return r && r.box < 5 && r.due <= now; }))
    .sort((a, b) => rec("cards", a.id).box - rec("cards", b.id).box).slice(0, 4);
  const fresh = shuffle(cards.filter((c) => !rec("cards", c.id)));
  const rest = shuffle(cards.filter((c) => !due.includes(c) && !fresh.includes(c)))
    .sort((a, b) => rec("cards", a.id).due - rec("cards", b.id).due);
  const out = [...due];
  for (const list of [fresh, rest]) for (const c of list) if (out.length < DECK_SIZE && !out.includes(c)) out.push(c);
  return { ids: shuffle(out).map((c) => c.id), reviews: due.length };
}
function deckState() {
  let d = store.get("deck", null);
  const valid = d && d.day === dayKey() && Array.isArray(d.ids) && d.ids.length && d.ids.every((id) => CARD[id]);
  if (!valid) {
    const built = buildDeck();
    d = { day: dayKey(), ids: built.ids, reviews: built.reviews, results: [], pos: 0 };
    store.set("deck", d);
  }
  return d;
}

function startDeck() {
  clearTimeout(nextTimer);
  const d = deckState();
  const cards = d.ids.map((id) => CARD[id]);
  const results = d.results.map((ok, i) => ({ correct: ok, show: { icon: ok ? "✓" : "✗", title: cards[i].t, sub: cards[i].x }, pts: 0 }));
  quiz = { mode: DECK, questions: cards, i: Math.min(d.pos, cards.length), results, points: 0 };
  showQuiz();
  renderModeSwitcher();
  if (d.pos >= cards.length) renderResult();
  else renderQuestion();
}

function renderDeck(card) {
  $("#quiz-body").innerHTML = `
    <div class="card-face">
      <p class="card-topic"><span class="cat">${CTOPIC_LABEL[card.topic]}</span></p>
      <h2 class="card-title">${esc(card.t)}</h2>
      <p class="card-text">${esc(card.x)}</p>
      <p class="card-why"><b>Warum wichtig:</b> ${esc(card.w)}</p>
    </div>
    <div class="card-actions"><button class="btn wide" id="to-q" type="button">Zur Frage</button></div>`;
  $("#to-q").addEventListener("click", () => {
    const opts = shuffle(card.o.map((text, i) => ({ text, ok: i === 0 })));
    $("#quiz-body").innerHTML = `
      <div class="prompt"><p class="prompt-label">${esc(card.t)}</p><h2 class="prompt-statement">${esc(card.q)}</h2></div>
      <div class="answers">${opts.map((o, i) => `<button class="answer" data-i="${i}">${esc(o.text)}</button>`).join("")}</div>
      ${FEEDBACK}`;
    $("#quiz-body").querySelectorAll(".answer").forEach((btn) => btn.addEventListener("click", () => {
      const correct = opts[Number(btn.dataset.i)].ok;
      $("#quiz-body").querySelectorAll(".answer").forEach((b, i) => { b.disabled = true; if (opts[i].ok) b.classList.add("correct"); });
      if (!correct) btn.classList.add("wrong");
      saveRec("cards", card.id, correct);
      const d = deckState();
      d.results[quiz.i] = correct;
      d.pos = Math.max(d.pos, quiz.i + 1);
      store.set("deck", d);
      settle({
        correct,
        show: { icon: "✗", title: card.t, sub: card.o[0] },
        feedback: correct ? "" : `<p>Richtig wäre <strong>${esc(card.o[0])}</strong></p>`,
      });
    }, { once: true }));
  });
}

/* ---------- Ergebnis ---------- */
function renderResult() {
  const { mode, results } = quiz;
  const score = results.filter((r) => r.correct).length;
  const total = results.length;
  if (!activity.includes(dayKey())) { activity.push(dayKey()); activity = activity.slice(-400); store.set("activity", activity); }
  if (mode.id !== "cards") {
    const best = store.get("best", {});
    if ((best[mode.id] ?? -1) < score) { best[mode.id] = score; store.set("best", best); }
  }

  const msg =
    mode.noAgain ? "Für heute reicht es. Morgen warten 10 neue Karten, falsche Antworten kommen dazwischen wieder." :
    mode.sr
      ? (score === total ? "Fehlerfrei. Die Fragen kommen erst in ein paar Tagen wieder."
        : score >= total * 0.7 ? "Gute Runde. Die Fehler kommen in der nächsten Runde wieder dran."
        : "Die falschen Antworten kommen gleich in der nächsten Runde wieder. So bleibt es hängen.")
      : (score === total ? "Fehlerfrei. Noch eine Runde?" : score >= total * 0.7 ? "Gute Runde." : "Noch Luft nach oben. Ein neuer Durchgang bringt neue Aufgaben.");

  const wrong = results.filter((r) => !r.correct);
  renderDots();
  $("#quiz-count").textContent = "";
  $("#quiz-body").innerHTML = `
    <div class="result">
      <p class="result-score">${score}<small> von ${total}</small></p>
      ${mode.scored && quiz.points ? `<p class="result-points">${quiz.points} Punkte</p>` : ""}
      <p class="result-msg">${msg}</p>
      ${wrong.length ? `<ul class="mistakes">${wrong.map((r) => `
        <li><span class="f">${esc(r.show.icon)}</span>
          <div><strong>${esc(r.show.title)}</strong>${r.show.sub ? `<span>${esc(r.show.sub)}</span>` : ""}</div>
        </li>`).join("")}</ul>` : ""}
    </div>
    <div class="result-actions${mode.noAgain ? " single" : ""}">
      <button class="btn ghost" id="done">Fertig</button>
      ${mode.noAgain ? "" : `<button class="btn" id="again">Nächste Runde</button>`}
    </div>`;
  $("#done").addEventListener("click", closeQuiz);
  $("#again")?.addEventListener("click", () => startQuiz(mode));
}

/* =================================================================
   CHEMIELABOR (Daten: chemie.json)
   Alle Aufgaben sind Auswahlfragen: o[0] ist die richtige Antwort, die Reihenfolge wird beim Anzeigen gemischt.
   ================================================================= */
/*CHEM-PURE-START*/
const SUBD = "₀₁₂₃₄₅₆₇₈₉", SUPD = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sub = (s) => String(s).replace(/\d/g, (d) => SUBD[d]);
const supCharge = (z, plus) => (z > 1 ? String(z).replace(/\d/g, (d) => SUPD[d]) : "") + (plus ? "⁺" : "⁻");
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const pickN = (arr, n) => shuffle(arr).slice(0, n);

// Formel eines Salzes: Klammern nur bei Mehratom-Ionen mit Index
const saltPart = (form, n, poly) => (n === 1 ? sub(form) : (poly ? `(${sub(form)})` : sub(form)) + sub(n));
const saltFormula = (c, a, nC, nA) => saltPart(c.form, nC, c.poly) + saltPart(a.form, nA, a.poly);
const ionLabel = (x, plus) => sub(x.form) + supCharge(x.z, plus);
const saltName = (c, a) => { const an = a.name.toLowerCase(); return c.name.includes("(") ? `${c.name}-${an}` : c.name + an; };
const saltAllowed = (c, a) => (!a.only || a.only.includes(c.id)) && !(a.deny || []).includes(c.id);

function buildSaltPool(D) {
  const pool = [];
  for (const c of D.cations) for (const a of D.anions) {
    if (!saltAllowed(c, a)) continue;
    const g = gcd(c.z, a.z), nC = a.z / g, nA = c.z / g;
    pool.push({
      id: `${c.id}|${a.id}`, c, a, nC, nA,
      formula: saltFormula(c, a, nC, nA), name: saltName(c, a),
    });
  }
  pool.forEach((it) => {
    it.build = () => (Math.random() < 0.5 ? saltToFormula(it) : saltToName(it, pool));
  });
  return pool;
}
function saltToFormula(it) {
  const { c, a, nC, nA, formula } = it;
  const cand = [[nA, nC], [1, 1], [nC * 2, nA * 2], [nC, 1], [1, nA], [nC + 1, nA], [nC, nA + 1]]
    .map(([x, y]) => saltFormula(c, a, x, y));
  const wrong = [...new Set(cand.filter((f) => f !== formula))];
  return {
    label: "Welche Formel hat das Salz?", q: `${ionLabel(c, true)}  +  ${ionLabel(a, false)}`,
    t: `${ionLabel(c, true)} + ${ionLabel(a, false)}`, o: [formula, ...pickN(wrong, 3)],
    e: `${ionLabel(c, true)} und ${ionLabel(a, false)} müssen sich in der Ladung ausgleichen: ${nC} × ${c.z}+ = ${nA} × ${a.z}−. Das Salz heißt ${it.name}.`,
  };
}
function saltToName(it, pool) {
  const near = pool.filter((p) => p !== it && p.name !== it.name && (p.c === it.c || p.a === it.a));
  const names = [...new Set(near.map((p) => p.name))];
  return {
    label: "Wie heißt das Salz?", q: it.formula, t: it.formula, o: [it.name, ...pickN(names, 3)],
    e: `${it.formula} besteht aus ${ionLabel(it.c, true)} und ${ionLabel(it.a, false)}.`,
  };
}

// Säuren, Basen, Abkürzungen, konjugierte Paare
function buildSbPool(D) {
  const pool = [];
  const groups = {
    saeure: "Säure", base: "Base", trivial: "Trivialname",
  };
  for (const s of D.stoffe) {
    const same = D.stoffe.filter((x) => x.g === s.g && x.f !== s.f && x.n !== s.n);
    const sameDistinct = (key) => [...new Set(same.map((x) => x[key]))];
    pool.push({
      id: `n:${s.id}`,
      build: () => ({
        label: groups[s.g] === "Trivialname" ? "Trivialname: welche Formel?" : "Welche Formel?", q: s.n, t: s.n,
        o: [s.f, ...pickN(sameDistinct("f"), 3)], e: `${s.n} hat die Formel ${s.f}.`,
      }),
    });
    pool.push({
      id: `f:${s.id}`,
      build: () => ({
        label: groups[s.g] === "Trivialname" ? "Trivialname: welcher Stoff?" : "Wie heißt der Stoff?", q: s.f, t: s.f,
        o: [s.n, ...pickN(sameDistinct("n"), 3)], e: `${s.f} ist ${s.n}.`,
      }),
    });
  }
  for (const x of D.abk) {
    pool.push({
      id: x.id,
      build: () => ({
        label: "Was bedeutet die Abkürzung?", q: x.ab, t: x.ab,
        o: [x.m, ...pickN(D.abk.filter((y) => y.m !== x.m).map((y) => y.m), 3)], e: `${x.ab} steht für ${x.m}.`,
      }),
    });
  }
  const all = [...new Set(D.pairs.flat())];
  D.pairs.forEach(([acid, base], i) => {
    pool.push({
      id: `ks:${i}`,
      build: () => ({
        label: "Konjugiertes Paar", q: `Was ist die konjugierte Base von ${acid}?`, t: `Konjugierte Base von ${acid}`,
        o: [base, ...pickN(all.filter((x) => x !== base && x !== acid), 3)],
        e: `${acid} gibt ein Proton ab und wird zu ${base}.`,
      }),
    });
    pool.push({
      id: `ka:${i}`,
      build: () => ({
        label: "Konjugiertes Paar", q: `Was ist die konjugierte Säure von ${base}?`, t: `Konjugierte Säure von ${base}`,
        o: [acid, ...pickN(all.filter((x) => x !== acid && x !== base), 3)],
        e: `${base} nimmt ein Proton auf und wird zu ${acid}.`,
      }),
    });
  });
  for (const x of D.sb) pool.push(x);
  return pool;
}

// Titrationskurve: Säure (pKs oder null = stark) mit starker Base, x = n(Base) / n(Säure), c = 0,1 mol/L
function titrationPH(pks, x, c = 0.1) {
  const Ka = pks == null ? 1e8 : Math.pow(10, -pks), Kw = 1e-14;
  const cNa = (c * x) / (1 + x), cA = c / (1 + x);
  const f = (lh) => { const h = Math.pow(10, lh); return cNa + h - (cA * Ka) / (Ka + h) - Kw / h; };
  let lo = -14, hi = 1;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
  return -(lo + hi) / 2;
}

function titrationSvg(pks) {
  const W = 320, H = 210, L = 34, R = 10, T = 10, B = 40;
  const X = (x) => L + (x / 2) * (W - L - R), Y = (ph) => T + (1 - ph / 14) * (H - T - B);
  const xs = [];
  for (let x = 0; x < 0.9; x += 0.02) xs.push(x);
  for (let x = 0.9; x < 1.1; x += 0.002) xs.push(x);
  for (let x = 1.1; x <= 2.0001; x += 0.02) xs.push(x);
  const path = xs.map((x, i) => `${i ? "L" : "M"}${X(x).toFixed(1)} ${Y(titrationPH(pks, x)).toFixed(1)}`).join("");
  let grid = "";
  for (let ph = 0; ph <= 14; ph += 2) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${Y(ph)}" y2="${Y(ph)}" stroke="var(--line)" stroke-width="1"/>` +
      `<text x="${L - 6}" y="${Y(ph) + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)">${ph}</text>`;
  }
  for (const x of [0, 0.5, 1, 1.5, 2]) {
    grid += `<line x1="${X(x)}" x2="${X(x)}" y1="${T}" y2="${H - B}" stroke="var(--line)" stroke-width="1"/>` +
      `<text x="${X(x)}" y="${H - B + 14}" text-anchor="middle" font-size="10" fill="var(--muted)">${x}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Titrationskurve: pH gegen zugegebene Basenmenge">
    ${grid}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linejoin="round"/>
    <text x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">x = n(Base) / n(Säure)</text>
    <text x="${L + 6}" y="${T + 12}" font-size="10" fill="var(--muted)">pH</text></svg>`;
}

// IR-Spektrum aus Banden [Wellenzahl, Breite, Tiefe]
const IR_ALKYL = [[2930, 40, 0.55], [2860, 20, 0.4], [1460, 25, 0.35], [1375, 10, 0.25]];
function irSvg(item) {
  const bands = [...(item.base ? IR_ALKYL : []), ...item.bands];
  const W = 320, H = 190, L = 12, R = 10, T = 10, B = 36;
  const X = (wn) => L + ((4000 - wn) / 3500) * (W - L - R), Y = (t) => T + (1 - t) * (H - T - B);
  const pts = [];
  for (let wn = 4000; wn >= 500; wn -= 5) {
    let t = 0.97;
    for (const [c, w, d] of bands) t *= 1 - d * Math.exp(-Math.pow((wn - c) / w, 2));
    pts.push(`${pts.length ? "L" : "M"}${X(wn).toFixed(1)} ${Y(Math.max(0.03, t)).toFixed(1)}`);
  }
  let grid = "";
  for (const wn of [4000, 3000, 2000, 1500, 1000, 500]) {
    grid += `<line x1="${X(wn)}" x2="${X(wn)}" y1="${T}" y2="${H - B}" stroke="var(--line)" stroke-width="1"/>` +
      `<text x="${X(wn)}" y="${H - B + 14}" text-anchor="${wn === 4000 ? "start" : wn === 500 ? "end" : "middle"}" font-size="10" fill="var(--muted)">${wn}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="IR-Spektrum">
    ${grid}<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="var(--muted)" stroke-width="1"/>
    <path d="${pts.join("")}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/>
    <text x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">Wellenzahl in cm⁻¹ (Durchlässigkeit nach oben)</text></svg>`;
}

// ¹H-NMR-Strichspektrum aus Signalen [δ, Muster, Zahl der H]
const NMR_PAT = { s: [1], d: [1, 1], t: [1, 2, 1], q: [1, 3, 3, 1], sept: [1, 6, 15, 20, 15, 6, 1], m: [2, 3, 4, 3, 2] };
function nmrSvg(signals) {
  const W = 320, H = 170, L = 12, R = 12, T = 22, B = 34;
  const X = (ppm) => L + ((12 - ppm) / 12) * (W - L - R), base = H - B;
  const J = 0.1;
  let raw = 0;
  const sigs = signals.map(([d, m, h]) => {
    const p = NMR_PAT[m], sum = p.reduce((a, b) => a + b, 0);
    const lines = p.map((v, i) => ({ x: d + (i - (p.length - 1) / 2) * J, a: (h * v) / sum }));
    raw = Math.max(raw, ...lines.map((l) => l.a));
    return { d, h, lines };
  });
  const k = (base - T - 14) / raw;
  let g = "", txt = "";
  for (const s of sigs) {
    let top = base;
    for (const l of s.lines) {
      const y = base - Math.max(2, l.a * k);
      top = Math.min(top, y);
      g += `<line x1="${X(l.x).toFixed(1)}" x2="${X(l.x).toFixed(1)}" y1="${base}" y2="${y.toFixed(1)}" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/>`;
    }
    txt += `<text x="${X(s.d).toFixed(1)}" y="${(top - 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--ink)">${s.h} H</text>`;
  }
  let grid = "";
  for (const ppm of [12, 10, 8, 6, 4, 2, 0]) {
    grid += `<line x1="${X(ppm)}" x2="${X(ppm)}" y1="${base}" y2="${base + 4}" stroke="var(--muted)"/>` +
      `<text x="${X(ppm)}" y="${base + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">${ppm}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="¹H-NMR-Spektrum">
    <line x1="${L}" x2="${W - R}" y1="${base}" y2="${base}" stroke="var(--muted)" stroke-width="1"/>${g}${txt}${grid}
    <text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">δ in ppm (Zahl über dem Signal: relative H-Zahl)</text></svg>`;
}

function buildChem(D) {
  const irPool = D.ir.map((x) => ({
    id: x.id,
    build: () => ({ label: "IR-Spektrum", fig: irSvg(x), q: "Welche funktionelle Gruppe oder Verbindungsklasse passt zum Spektrum?", t: "IR-Spektrum deuten", o: x.o, e: x.e }),
  }));
  const nmrPool = D.nmr.map((x) => ({
    id: x.id,
    build: () => ({
      label: "¹H-NMR-Spektrum", fig: nmrSvg(x.s), q: "Welche Verbindung gehört zu diesem Spektrum?", t: "¹H-NMR-Spektrum deuten",
      o: [x.name, ...pickN(D.nmr.filter((y) => y.name !== x.name).map((y) => y.name), 3)], e: x.e,
    }),
  }));
  const titr = D.titration.map((x) => ({
    id: x.id,
    build: () => ({ label: x.label, fig: titrationSvg(x.pks), q: x.q, t: `Titrationskurve: ${x.q}`, o: x.o, e: x.e }),
  }));
  return {
    salt: buildSaltPool(D),
    redox: D.redox,
    sb: buildSbPool(D),
    titr,
    analytik: [...D.analytik, ...irPool, ...nmrPool],
  };
}
/*CHEM-PURE-END*/

function renderChem(item) {
  const q = item.build ? item.build() : item;
  const opts = shuffle(q.o.map((t, i) => ({ t, ok: i === 0 })));
  $("#quiz-body").innerHTML = `
    <div class="prompt chem-prompt">
      ${q.label ? `<p class="prompt-label">${esc(q.label)}</p>` : ""}
      ${q.fig ? `<div class="chem-fig">${q.fig}</div>` : ""}
      ${q.ctx ? `<p class="chem-ctx">${esc(q.ctx)}</p>` : ""}
      <h2 class="prompt-statement chem-q">${esc(q.q)}</h2>
    </div>
    <div class="answers">${opts.map((o, i) => `<button class="answer chem-a" data-i="${i}">${esc(o.t)}</button>`).join("")}</div>
    ${FEEDBACK}`;
  $("#quiz-body").querySelectorAll(".answer").forEach((btn) => btn.addEventListener("click", () => {
    const correct = opts[Number(btn.dataset.i)].ok;
    $("#quiz-body").querySelectorAll(".answer").forEach((b, i) => { b.disabled = true; if (opts[i].ok) b.classList.add("correct"); });
    if (!correct) btn.classList.add("wrong");
    saveRec(quiz.mode.id, item.id, correct);
    settle({
      correct, auto: false,
      show: { icon: quiz.mode.iconText ? quiz.mode.icon : "⚗️", title: q.t || q.q, sub: `Richtig: ${q.o[0]}` },
      feedback: `<div class="fb-text"><p><strong>${esc(q.o[0])}</strong><br><span class="muted">${esc(q.e || "")}</span></p></div>`,
    });
  }, { once: true }));
}

/* ---------- Zurück wischen: vom linken Rand nach rechts ---------- */
const TAB_ORDER = ["news", "lesen", "learn"];
function goBack() {
  if (!$("#sheet").hidden) { sheetBack(); return true; }      // Profil oder Album
  if (!$("#quiz").hidden) { closeQuiz(); return true; }        // Spiel
  const i = TAB_ORDER.indexOf(currentTab);
  if (i > 0) { showTab(TAB_ORDER[i - 1]); return true; }       // ein Reiter zurück
  return false;
}
(() => {
  const EDGE = 24, TRIGGER = 90;
  let sx = 0, sy = 0, dx = 0, t0 = 0, tracking = false, active = false, el = null;
  const topOverlay = () => (!$("#sheet").hidden ? $("#sheet") : !$("#quiz").hidden ? $("#quiz") : null);
  window.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || e.touches[0].clientX > EDGE) return;
    const t = e.touches[0];
    tracking = true; active = false; sx = t.clientX; sy = t.clientY; dx = 0; t0 = Date.now(); el = topOverlay();
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (!active) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) { tracking = false; return; } // senkrecht: normales Scrollen
      if (dx > 8) active = true; else return;
    }
    e.preventDefault();
    if (el) { el.style.transition = "none"; el.style.transform = `translateX(${Math.max(0, dx)}px)`; }
  }, { passive: false });
  const end = () => {
    if (!tracking) return;
    tracking = false;
    const fast = dx / Math.max(1, Date.now() - t0) > 0.6;
    const go = active && (dx > TRIGGER || (fast && dx > 40));
    const node = el;
    el = null; active = false;
    if (node) {
      node.style.transition = "transform 0.2s ease";
      node.style.transform = go ? "translateX(100%)" : "translateX(0)";
      setTimeout(() => {
        node.style.transition = "none"; node.style.transform = "";
        if (go) goBack();
        requestAnimationFrame(() => { node.style.transition = ""; });
      }, 210);
    } else if (go) goBack();
  };
  window.addEventListener("touchend", end);
  window.addEventListener("touchcancel", end);
})();

/* ---------- Start ---------- */
async function init() {
  showTab(currentTab);
  loadNews();
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
  try {
    countries = await get("countries.json");
  } catch {
    $("#modes").innerHTML = `<div class="empty"><strong>Länderdaten fehlen</strong>Die Datei countries.json konnte nicht geladen werden.</div>`;
  }
  try {
    CONTENT = await get("content.json");
    CONTENT.people.forEach((p) => { PEOPLE[p.id] = p; });
    CONTENT.cards.forEach((c) => { CARD[c.id] = c; });
    buildGraph();
  } catch { CONTENT = null; }
  try { CHEM = buildChem(await get("chemie.json")); } catch { CHEM = null; }
  try {
    PORTRAITS = (await get("portraits/portraits.json")).items || {};
  } catch { PORTRAITS = {}; }
  try {
    MAPD = await get("map.json");
    MAPD.countries.forEach((m) => { if (m.i) MAPIDX[m.i] = { s: Math.max(m.s, MAPIDX[m.i]?.s || 0) }; });
    const inQuiz = new Set(countries.map((c) => c.id));
    MAP_MARKUP = MAPD.countries.map((m) => `<path class="land${m.i && inQuiz.has(m.i) ? "" : " bg"}" data-id="${m.i || ""}" d="${m.d}"/>`).join("");
  } catch { MAPD = null; }
  renderLearn();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
init();
