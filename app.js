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
  if (section === "lesen") renderImpuls();

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

/* ---------- Tagesimpuls (Lesen-Tab) ----------
   Jeden Tag 3 Artikel aus verschiedenen Themen, pro Tag fest gewählt. Gelesene zählen für Tagesziel und Serie. */
const IMPULS_N = 3, IMPULS_WEEK = 10;
const seedHash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function seedRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function seedShuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
let impulsBox = null;
const impulsSt = () => store.get("impuls", { day: "", lang: "", ids: [], log: {} });

function impulsToday() {
  const st = impulsSt();
  const items = news.items.filter((it) => it.section === "lesen");
  const byId = new Map(items.map((it) => [it.id, it]));
  if (st.day === dayKey() && st.lang === langFilter && st.ids.length && st.ids.every((id) => byId.has(id))) return st.ids.map((id) => byId.get(id));
  if (!items.length) return [];
  const rng = seedRng(seedHash("impuls-" + dayKey() + langFilter));
  let pool = items.filter((it) => (langFilter === "alle" || it.lang === langFilter) && it.title && (it.summary || "").length > 40);
  const fresh = pool.filter((it) => !readIds.has(it.id));
  if (fresh.length >= IMPULS_N) pool = fresh;
  const byTopic = {};
  pool.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  pool.forEach((it) => (byTopic[it.topic] ??= []).push(it));
  const topics = seedShuffle(Object.keys(byTopic), rng);
  const out = [];
  for (const t of topics) {
    if (out.length >= IMPULS_N) break;
    const cand = byTopic[t].slice(0, 6).filter((it) => !out.some((o) => o.source === it.source));
    const list = cand.length ? cand : byTopic[t].slice(0, 6);
    out.push(list[Math.floor(rng() * list.length)]);
  }
  for (const it of seedShuffle(pool, rng)) if (out.length < IMPULS_N && !out.includes(it)) out.push(it);
  const ids = out.map((it) => it.id);
  const log = {};
  for (const [d, v] of Object.entries(st.log || {})) if (Date.now() - new Date(d).getTime() < 14 * 86400000) log[d] = v;
  store.set("impuls", { day: dayKey(), lang: langFilter, ids, log });
  return out;
}

function impulsStats() {
  const st = impulsSt();
  const today = st.day === dayKey() ? (st.log[dayKey()] || []).filter((id) => st.ids.includes(id)).length : 0;
  let week = 0;
  for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() - i); week += (st.log?.[dayKey(d)] || []).length; }
  return { today, week, total: st.day === dayKey() ? st.ids.length : IMPULS_N };
}

function impulsRead(id) {
  const st = impulsSt();
  if (st.day !== dayKey() || !st.ids.includes(id)) return;
  const k = dayKey();
  st.log ??= {};
  st.log[k] = [...new Set([...(st.log[k] || []), id])];
  store.set("impuls", st);
  if (!activity.includes(k)) { activity.push(k); activity = activity.slice(-400); store.set("activity", activity); }
}

function renderImpuls() {
  const host = $("#lesen-list");
  if (!host) return;
  if (!impulsBox) {
    impulsBox = document.createElement("section");
    impulsBox.className = "impuls";
    impulsBox.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-id]");
      if (!a) return;
      saveScroll();
      markRead(a.dataset.id);
      impulsRead(a.dataset.id);
      a.classList.add("read");
      renderImpulsFoot();
    });
    host.before(impulsBox);
  }
  const items = impulsToday();
  if (!items.length) { impulsBox.innerHTML = ""; return; }
  impulsBox.innerHTML = `
    <h2 class="section-title">Heute für dich</h2>
    <p class="impuls-sub">${items.length} Artikel aus verschiedenen Themen. Mehr musst du heute nicht lesen.</p>
    ${items.map((it) => `
      <a class="impuls-item${readIds.has(it.id) ? " read" : ""}" href="${esc(it.link)}" target="_blank" rel="noopener" data-id="${esc(it.id)}">
        <span class="impuls-meta">${esc(TOPICS[it.topic] || "")}${TOPICS[it.topic] ? " · " : ""}${esc(it.source)}${it.lang === "en" ? " · EN" : ""}</span>
        <span class="impuls-title">${esc(it.title)}</span>
        <span class="impuls-text">${esc(it.summary || "")}</span>
      </a>`).join("")}
    <div class="impuls-foot" id="impuls-foot"></div>`;
  renderImpulsFoot();
}
function renderImpulsFoot() {
  const f = $("#impuls-foot");
  if (!f) return;
  const s = impulsStats();
  f.textContent = s.today >= s.total && s.total
    ? `Heute geschafft. Diese Woche ${s.week} von ${IMPULS_WEEK} Impulsen.`
    : `Heute ${s.today} von ${s.total}. Diese Woche ${s.week} von ${IMPULS_WEEK}.`;
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
  { id: "who", kind: "who", title: "Die Akte", sub: "Foto enthüllen, Person erraten", icon: "🕵️", sr: true, scored: true, short: "Die Akte", know: true,
    pick: () => pickWho() },
  { id: "links", kind: "links", title: "Verbindungen", sub: "Finde den Weg von Person zu Person", icon: "🕸️", scored: true, short: "Verbindungen", know: true,
    pick: () => pickRoutes() },
  { id: "face", kind: "face", title: "Gesichter", sub: "Porträt sehen, Person wählen", icon: "🖼️", sr: true, short: "Gesichter", know: true,
    avail: () => hasPhotos(), pick: () => pickFrom("face", CONTENT.people.filter((p) => photoUrl(p.id))) },
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
  else if (g.pool) list = g.pool();
  if (list) {
    const pm = g.pmode || g.id;
    const mastered = list.filter((x) => (rec(pm, x.id)?.box ?? 0) >= MASTERED).length;
    const due = list.filter((x) => { const r = rec(pm, x.id); return r && r.box < 5 && r.due <= now; }).length;
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
    let ir = $("#impuls-row");
    if (!ir) { ir = document.createElement("div"); ir.id = "impuls-row"; ir.className = "modes"; $("#deck-row").insertAdjacentElement("afterend", ir); }
    if (news.items.some((it) => it.section === "lesen")) {
      impulsToday();
      const is = impulsStats();
      ir.innerHTML = row({ attr: 'data-open="impuls"', icon: is.today >= is.total ? "✓" : "📖", iconText: is.today >= is.total, title: "Tagesimpuls",
        sub: is.today >= is.total ? "Heute gelesen. Stark." : `${is.today} von ${is.total} Artikeln heute`, pct: Math.round((is.today / is.total) * 100) });
    } else ir.innerHTML = "";
    let zr = $("#zitate-row");
    if (!zr) { zr = document.createElement("div"); zr.id = "zitate-row"; zr.className = "modes"; ir.insertAdjacentElement("afterend", zr); }
    if (ZITATE.length) {
      const zs = zSt(), zread = new Set(zs.read), zt = zToday(), fresh = zt.filter((z) => !zread.has(z.id)).length;
      zr.innerHTML = row({ attr: 'data-open="zitate"', icon: "💬", title: "Zitate",
        sub: `${fresh ? `${fresh} neue für heute` : "Heute gelesen"} · ${zread.size} von ${ZITATE.length} in der Bibliothek`,
        pct: Math.round((zread.size / ZITATE.length) * 100) });
    } else zr.innerHTML = "";
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

  renderVocabRows();

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
  else if (b.dataset.open === "zitate") openSheet(zitateView);
  else if (b.dataset.open === "vocab") startQuiz(VOCAB);
  else if (b.dataset.open === "wsammlung") { wQuery = ""; openSheet(wortView); }
  else if (b.dataset.open === "impuls") { showTab("lesen"); scroller.scrollTo(0, 0); }
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
  $("#quiz").classList.toggle("quiz--vocab", game.kind === "vocab");
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
  country: (t) => renderCountry(t), map: (t) => renderMap(t), tf: (t) => renderTF(t), 
  deck: (t) => renderDeck(t), face: (t) => renderFace(t), links: (t) => renderLinks(t), vocab: (t) => renderVocab(t), 
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

/* ---------- Zitate-Bibliothek: lesen und verstehen ---------- */
let ZITATE = [];
const ZT = { philosophie: "Philosophie", wirtschaft: "Wirtschaft & Strategie", politik: "Politik & Geschichte", wissenschaft: "Wissenschaft", kultur: "Kultur & Literatur" };
const ZE = { b: ["Belegt", "ok"], s: ["Sinngemäß überliefert", "mid"], u: ["Umstritten", "mid"], z: ["Falsch zugeschrieben", "bad"] };
const ZDAY = 3;
const ZVOTE = [["ja", "Ja"], ["teils", "Teilweise"], ["nein", "Nein"]];
let zFilter = "alle", zQuery = "";
const zSt = () => { const s = store.get("zitate", {}); return { read: s.read || [], vote: s.vote || {}, day: s.day || "", today: s.today || [] }; };
const zById = (id) => ZITATE.find((z) => z.id === id);
const zQ = (z) => (z.l === "en" ? `“${esc(z.q)}”` : `„${esc(z.q)}“`);
const zLang = (z) => (z.l ? ` lang="${z.l}"` : "");
function zWho(z) {
  const p = z.p && PEOPLE[z.p];
  return p ? { name: p.name, role: p.role, years: lifeSpan(p), p } : { name: z.w, role: z.r, years: z.y, p: null };
}
function zToday() {
  const st = zSt();
  if (st.day === dayKey() && st.today.length && st.today.every(zById)) return st.today.map(zById);
  const read = new Set(st.read);
  const rng = seedRng(seedHash("zitate-" + dayKey()));
  let pool = ZITATE.filter((z) => !read.has(z.id));
  if (pool.length < ZDAY) pool = ZITATE.slice();
  const out = [];
  for (const z of seedShuffle(pool, rng)) {
    if (out.length >= ZDAY) break;
    if (!out.some((o) => o.t === z.t)) out.push(z);
  }
  for (const z of seedShuffle(pool, rng)) if (out.length < ZDAY && !out.includes(z)) out.push(z);
  store.set("zitate", { ...st, day: dayKey(), today: out.map((z) => z.id) });
  return out;
}
function zMarkRead(id) {
  const st = zSt();
  if (!st.read.includes(id)) { st.read.push(id); store.set("zitate", st); }
  const k = dayKey();
  if (!activity.includes(k)) { activity.push(k); activity = activity.slice(-400); store.set("activity", activity); }
}
function zAvatar(z) {
  const w = zWho(z);
  return w.p ? avatar(w.p, "sm") : `<span class="avatar sm" aria-hidden="true"><span class="ini">${esc(initials(w.name))}</span></span>`;
}
function zRow(z, read) {
  const w = zWho(z);
  const flag = z.e === "z" || z.e === "u" ? `<span class="z-badge ${ZE[z.e][1]}">${ZE[z.e][0]}</span>` : "";
  return `<button class="z-row${read.has(z.id) ? " read" : ""}" data-z="${z.id}" type="button">
    ${zAvatar(z)}
    <span class="z-row-text"><span class="z-row-q"${zLang(z)}>${zQ(z)}</span>
    <span class="z-row-who">${read.has(z.id) ? "✓ " : ""}${esc(w.name)}${flag ? " · " : ""}${flag}</span></span></button>`;
}
function zFiltered() {
  const read = new Set(zSt().read);
  const q = zQuery.trim().toLowerCase();
  return ZITATE.filter((z) =>
    (zFilter === "alle" || z.t === zFilter || (zFilter === "falsch" && (z.e === "z" || z.e === "u")) || (zFilter === "neu" && !read.has(z.id))) &&
    (!q || (z.q + " " + zWho(z).name + " " + z.k).toLowerCase().includes(q)));
}
function zRenderList() {
  const box = $("#z-all");
  if (!box) return;
  const read = new Set(zSt().read);
  const list = zFiltered();
  box.innerHTML = list.length ? list.map((z) => zRow(z, read)).join("") : `<div class="empty"><strong>Nichts gefunden</strong>Versuch einen anderen Begriff oder Filter.</div>`;
}
function zitateView() {
  $("#sheet-title").textContent = "Zitate";
  const read = new Set(zSt().read);
  const today = zToday();
  const chips = [["alle", "Alle"], ["neu", "Ungelesen"], ...Object.entries(ZT), ["falsch", "Falsch zugeschrieben"]];
  $("#sheet-body").innerHTML = `
    <p class="page-sub">${read.size} von ${ZITATE.length} gelesen. Jeden Tag drei neue, die ganze Sammlung steht dir offen.</p>
    <h3 class="z-h">Heute für dich</h3>
    <div class="z-list">${today.map((z) => zRow(z, read)).join("")}</div>
    <h3 class="z-h">Bibliothek</h3>
    <div class="chips z-chips" role="radiogroup" aria-label="Filter">${chips.map(([k, l]) => `<button role="radio" aria-checked="${k === zFilter}" data-zf="${k}">${l}</button>`).join("")}</div>
    <label class="search z-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input id="z-q" type="search" placeholder="Zitat oder Person suchen" autocomplete="off" value="${esc(zQuery)}">
    </label>
    <div class="z-list" id="z-all"></div>`;
  zRenderList();
  const body = $("#sheet-body");
  body.querySelectorAll("[data-zf]").forEach((b) => b.addEventListener("click", () => {
    zFilter = b.dataset.zf;
    body.querySelectorAll("[data-zf]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    zRenderList();
  }));
  $("#z-q").addEventListener("input", (e) => { zQuery = e.target.value; zRenderList(); });
  body.querySelectorAll(".z-list").forEach((l) => l.addEventListener("click", (e) => {
    const b = e.target.closest("[data-z]");
    if (!b) return;
    const order = b.closest("#z-all") ? zFiltered().map((z) => z.id) : today.map((z) => z.id);
    openSheet(() => zitatDetail(b.dataset.z, order));
  }));
}
function zitatDetail(id, order, reveal = false) {
  const z = zById(id);
  if (!z) { sheetBack(); return; }
  zMarkRead(id);
  const w = zWho(z);
  const vote = zSt().vote[id];
  const show = vote || reveal;
  const idx = order.indexOf(id);
  const next = order[idx + 1] || null;
  $("#sheet-title").textContent = ZT[z.t];
  $("#sheet-body").innerHTML = `
    <article class="zd">
      <span class="z-badge ${ZE[z.e][1]}">${ZE[z.e][0]}</span>
      <blockquote class="quote zd-q"${zLang(z)}>${zQ(z)}</blockquote>
      <div class="zd-who">${zAvatar(z)}<span><strong>${esc(w.name)}</strong><span class="muted">${esc(w.role || "")}${w.years ? `, ${esc(w.years)}` : ""}</span></span></div>
      <p class="zd-src">${esc(z.s)}</p>
      <h3>Kontext</h3><p>${esc(z.k)}</p>
      <h3>Bedeutung</h3><p>${esc(z.m)}</p>
      <div class="zd-vote">
        <h3>Heute noch gültig?</h3>
        <p class="muted">Deine Einschätzung. Es gibt kein Richtig oder Falsch.</p>
        <div class="zd-vote-btns">${ZVOTE.map(([k, l]) => `<button type="button" data-vote="${k}" aria-pressed="${vote === k}">${l}</button>`).join("")}</div>
        ${show ? "" : `<button class="zd-skip" type="button" data-reveal>Ohne Antwort weiterlesen</button>`}
      </div>
      ${show ? `<h3>Heute</h3><p>${esc(z.h)}</p>` : ""}
      ${w.p ? `<h3>Zur Person</h3><p>${esc(w.p.short || "")}</p><button class="btn ghost wide" type="button" data-person="${w.p.id}">Profil von ${esc(w.p.name)} öffnen</button>` : ""}
      <div class="zd-nav">
        ${next ? `<button class="btn wide" type="button" data-next="${next}">Nächstes Zitat</button>` : `<p class="muted">Das war das letzte Zitat in dieser Auswahl.</p>`}
      </div>
    </article>`;
  const body = $("#sheet-body");
  const swap = (fn) => { sheetStack[sheetStack.length - 1] = fn; fn(); };
  body.querySelectorAll("[data-vote]").forEach((b) => b.addEventListener("click", () => {
    const st = zSt(); st.vote[id] = b.dataset.vote; store.set("zitate", st);
    const y = body.scrollTop; zitatDetail(id, order); body.scrollTop = y;
  }));
  body.querySelector("[data-reveal]")?.addEventListener("click", () => {
    const y = body.scrollTop; swap(() => zitatDetail(id, order, true)); body.scrollTop = y;
  });
  body.querySelector("[data-person]")?.addEventListener("click", (e) => openProfile(e.currentTarget.dataset.person));
  body.querySelector("[data-next]")?.addEventListener("click", (e) => { const n = e.currentTarget.dataset.next; swap(() => zitatDetail(n, order)); body.scrollTop = 0; });
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
    mode.noAgain ? (mode.noAgainMsg || "Für heute reicht es. Morgen warten 10 neue Karten, falsche Antworten kommen dazwischen wieder.") :
    mode.sr
      ? (score === total ? `Fehlerfrei. Die ${mode.kind === "vocab" ? "Wörter" : "Fragen"} kommen erst in ein paar Tagen wieder.`
        : score >= total * 0.7 ? "Gute Runde. Die Fehler kommen in der nächsten Runde wieder dran."
        : mode.kind === "vocab" ? "Die Wörter, die du nicht wusstest, kommen gleich in der nächsten Runde wieder. So bleiben sie hängen."
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
   WORTSCHATZ: Wörter sammeln, nachschlagen, wiederholen
   Startsammlung in woerter.json (ohne Bedeutung). Eigene Wörter und alle Bedeutungen
   liegen im localStorage ("db:wortschatz"), der Lernstand im Lernkasten ("progress.vocab").
   ================================================================= */
let WORTER = { themes: {}, words: [] };
const VOCAB_N = 5;
const VOCAB = { id: "vocab", kind: "vocab", title: "Wortschatz", sr: true, short: "Wortschatz",
  pick: () => pickFrom("vocab", vocabReady(), VOCAB_N) };

const wst = () => { const s = store.get("wortschatz", {}); return { own: s.own || [], m: s.m || {} }; };
const wstSave = (s) => store.set("wortschatz", s);
// Startwörter + eigene Wörter, jeweils mit den gespeicherten Angaben (m Bedeutung, b Beispiel, c Fundort, q Quelle, ok bestätigt)
function wAll() {
  const s = wst();
  return [
    ...WORTER.words.map((w) => { const sv = s.m[w.id]; return { ...w, ...(sv || {}), ...(sv && typeof sv.m === "string" ? { v: 0 } : {}) }; }),
    ...s.own.map((w) => ({ ...w, ...(s.m[w.id] || {}), own: true })),
  ];
}
const vocabReady = () => wAll().filter((x) => x.m && x.m.trim());
const wById = (id) => wAll().find((x) => x.id === id);
const wLabel = (x) => (x.a ? x.a + " " : "") + x.w;
const wSnip = (s, n = 120) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const wSure = (x) => (rec("vocab", x.id)?.box ?? 0) >= MASTERED;
const wArt = (x) => (x.a ? `<span class="w-art">${esc(x.a)}</span> ` : "");
const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
function speak(t) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "de-DE"; u.rate = 0.9;
    speechSynthesis.speak(u);
  } catch { /* kein Ton */ }
}

/* ---------- Nachschlagen: Wiktionary (Wörterbuch) und Wikipedia (Lexikon) ---------- */
function wikiClean(s) {
  return s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/\{\{K\|([^{}]*)\}\}/g, (m, a) => { const p = a.split("|").filter((x) => x && !/=/.test(x)); return p.length ? `(${p.join(", ")})` : ""; })
    .replace(/\{\{Ü\|[^|{}]*\|([^|{}]*)[^{}]*\}\}/g, "$1")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ").trim();
}
// Wikitext einer Wiktionary-Seite: Abschnitt „Deutsch“, je Wortart die Bedeutungen und Beispiele
function parseWikt(text) {
  const lines = String(text).split("\n");
  const start = lines.findIndex((l) => /^==[^=].*\{\{Sprache\|Deutsch\}\}.*==\s*$/.test(l));
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && /^==[^=]/.test(l));
  if (end < 0) end = lines.length;
  const entries = [];
  let cur = null, mode = "";
  for (const l of lines.slice(start + 1, end)) {
    const h = l.match(/^===([^=].*?)===\s*$/);
    if (h) {
      const wa = h[1].match(/\{\{Wortart\|([^|}]+)\|[^}]*\}\}/);
      if (wa) {
        const art = [...h[1].matchAll(/\{\{([mfn])\}\}/g)].map((g) => ({ m: "der", f: "die", n: "das" })[g[1]]);
        cur = { pos: wa[1].trim(), art, defs: [], ex: {} };
        entries.push(cur);
      } else cur = null;
      mode = "";
      continue;
    }
    if (!cur) continue;
    if (/^====/.test(l)) { mode = ""; continue; }
    const t = l.match(/^\{\{([^|}]+)\}\}\s*$/);
    if (t) { mode = t[1] === "Bedeutungen" ? "b" : t[1] === "Beispiele" ? "e" : ""; continue; }
    const n = l.match(/^:\[([^\]]+)\]\s*(.*)$/);
    if (!n || !mode) continue;
    const txt = wikiClean(n[2]);
    if (!txt) continue;
    if (mode === "b") cur.defs.push({ n: n[1], text: txt, ex: "" });
    else if (!cur.ex[n[1]]) cur.ex[n[1]] = txt;
  }
  entries.forEach((e) => e.defs.forEach((d) => { d.ex = e.ex[d.n] || ""; }));
  return entries.filter((e) => e.defs.length);
}
function wShort(t) {
  const s = String(t).replace(/\s+/g, " ").trim();
  const parts = s.match(/[^.!?]+[.!?]+(\s|$)/g) || [s];
  let out = "";
  for (const p of parts) { if (out && (out + p).length > 380) break; out += p; if (out.length > 160) break; }
  return (out || s).trim().slice(0, 420);
}
const wFetch = (u) => fetch(u, { signal: window.AbortSignal?.timeout ? AbortSignal.timeout(9000) : undefined }).then((r) => r.json());
async function wortLookup(word) {
  const base = word.trim();
  const variants = [...new Set([base, base.charAt(0).toUpperCase() + base.slice(1), base.charAt(0).toLowerCase() + base.slice(1)])];
  const res = { wikt: null, wp: null, net: false };
  const viaWikt = async () => {
    for (const v of variants) {
      try {
        const j = await wFetch(`https://de.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(v)}&prop=wikitext&redirects=1&format=json&formatversion=2&origin=*`);
        res.net = true;
        const entries = j?.parse?.wikitext ? parseWikt(j.parse.wikitext) : [];
        if (entries.length) { res.wikt = { title: j.parse.title, entries, url: `https://de.wiktionary.org/wiki/${encodeURIComponent(j.parse.title)}` }; return; }
      } catch { /* offline oder gesperrt */ }
    }
  };
  const viaWp = async () => {
    for (const v of variants) {
      try {
        const j = await wFetch(`https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(v)}?redirect=true`);
        res.net = true;
        if (j?.extract && j.type !== "disambiguation") {
          res.wp = { title: j.title || v, text: wShort(j.extract), url: j.content_urls?.desktop?.page || `https://de.wikipedia.org/wiki/${encodeURIComponent(v)}` };
          return;
        }
      } catch { /* offline oder gesperrt */ }
    }
  };
  await Promise.all([viaWikt(), viaWp()]);
  return res;
}

/* ---------- Lernen-Übersicht: zwei Zeilen ---------- */
function renderVocabRows() {
  const box = $("#vocab-rows");
  if (!box) return;
  const all = wAll();
  const ready = all.filter((x) => x.m);
  const now = Date.now();
  const due = ready.filter((x) => { const r = rec("vocab", x.id); return r && r.box < 5 && r.due <= now; }).length;
  const fresh = ready.filter((x) => !rec("vocab", x.id)).length;
  const sure = ready.filter(wSure).length;
  const open = all.length - ready.length;
  const practice = ready.length
    ? row({ attr: 'data-open="vocab"', icon: "🔤", title: "Wortschatz üben",
        sub: `${sure} von ${ready.length} sicher${due ? `, ${due} zum Wiederholen` : fresh ? `, ${fresh} neu` : ""}`, pct: Math.round((sure / ready.length) * 100) })
    : row({ attr: 'data-open="wsammlung"', icon: "🔤", title: "Wortschatz üben", sub: "Trag zuerst Bedeutungen ein, dann kannst du üben." });
  box.innerHTML = practice + row({ attr: 'data-open="wsammlung"', icon: "📚", title: "Meine Wörter", sub: `${all.length} Wörter${open ? `, ${open} ohne Bedeutung` : ""}` });
}

/* ---------- Übungsrunde: Karte aufdecken, selbst bewerten ---------- */
function renderVocab(x) {
  $("#quiz-body").innerHTML = `
    <div class="prompt w-prompt">
      <p class="prompt-label">${x.c ? `Gefunden in: ${esc(x.c)}` : "Was bedeutet das Wort?"}</p>
      <h2 class="w-word">${wArt(x)}${esc(x.w)}</h2>
      ${canSpeak ? `<button class="w-speak" type="button" id="w-speak">🔊 Vorlesen</button>` : ""}
      <div class="w-reveal" id="w-reveal" hidden>
        <p class="w-m">${esc(x.m)}</p>
        ${x.b ? `<p class="w-b">${esc(x.b)}</p>` : ""}
      </div>
    </div>
    ${FEEDBACK}
    <div class="card-actions" id="w-actions"><button class="btn wide" id="w-show" type="button">Bedeutung aufdecken</button></div>`;
  $("#w-speak")?.addEventListener("click", () => speak(x.w));
  $("#w-show").addEventListener("click", () => {
    $("#w-reveal").hidden = false;
    $("#w-actions").innerHTML = `<div class="w-rate"><button class="btn ghost" id="w-no" type="button">Nicht gewusst</button><button class="btn" id="w-yes" type="button">Gewusst</button></div>`;
    const rate = (ok) => {
      $("#w-actions").innerHTML = "";
      saveRec("vocab", x.id, ok);
      settle({ correct: ok, show: { icon: "✗", title: wLabel(x), sub: wSnip(x.m) }, auto: true, delay: 220 });
    };
    $("#w-no").addEventListener("click", () => rate(false), { once: true });
    $("#w-yes").addEventListener("click", () => rate(true), { once: true });
  });
}

/* ---------- Sammlung (Overlay) ---------- */
let wFilter = "alle", wQuery = "";
function wFiltered() {
  const q = wQuery.trim().toLowerCase();
  return wAll().filter((x) =>
    (wFilter === "alle" || (wFilter === "offen" && !x.m) || (wFilter === "eigen" && x.own) || (wFilter === "sicher" && x.m && wSure(x)) || x.t === wFilter) &&
    (!q || `${x.w} ${x.m || ""} ${x.c || ""}`.toLowerCase().includes(q)))
    .sort((a, b) => a.w.localeCompare(b.w, "de"));
}
function wRow(x) {
  return `<button class="w-row" data-w="${esc(x.id)}" type="button">
    <span class="w-row-text"><span class="w-row-w">${wArt(x)}${esc(x.w)}</span>
    <span class="w-row-m${x.m ? "" : " open"}">${x.m ? esc(x.m) : "Bedeutung fehlt"}</span></span>
    ${x.m && wSure(x) ? '<span class="w-tick" aria-label="sicher">✓</span>' : ""}</button>`;
}
function wRenderList() {
  const box = $("#w-all");
  if (!box) return;
  const list = wFiltered();
  box.innerHTML = list.length ? list.map(wRow).join("") : `<div class="empty"><strong>Nichts gefunden</strong>Anderer Filter oder anderer Suchbegriff.</div>`;
}
function closeSheets() {
  sheetStack.length = 0;
  $("#sheet").hidden = true;
  document.body.style.overflow = $("#quiz").hidden ? "" : "hidden";
}
const wBackup = () => JSON.stringify({ app: "daily-brain-wortschatz", v: 1, wortschatz: wst(), progress: progress.vocab || {} });
function wRestore(txt) {
  let d;
  try { d = JSON.parse(txt); } catch { return "Das ist kein gültiger Sicherungstext."; }
  if (d?.app !== "daily-brain-wortschatz" || !d.wortschatz) return "Das ist keine Sicherung aus dieser App.";
  const s = wst();
  let n = 0;
  for (const o of d.wortschatz.own || []) {
    if (o && o.id && o.w && !s.own.some((x) => x.id === String(o.id))) { s.own.push({ id: String(o.id), w: String(o.w), a: ["der", "die", "das"].includes(o.a) ? o.a : "", t: "eigen", d: Number(o.d) || Date.now() }); n++; }
  }
  for (const [id, v] of Object.entries(d.wortschatz.m || {})) {
    if (!v || typeof v !== "object" || (s.m[id] && (v.at || 0) < (s.m[id].at || 0))) continue;
    const e = { m: String(v.m || ""), b: String(v.b || ""), c: String(v.c || ""), q: String(v.q || ""), ok: !!v.ok, at: Number(v.at) || Date.now() };
    if (["der", "die", "das"].includes(v.a)) e.a = v.a;
    s.m[id] = e;
  }
  wstSave(s);
  progress.vocab ??= {};
  for (const [id, r] of Object.entries(d.progress || {})) {
    if (r && typeof r.box === "number" && (!progress.vocab[id] || (r.seen || 0) > (progress.vocab[id].seen || 0))) progress.vocab[id] = { box: r.box, due: Number(r.due) || 0, seen: Number(r.seen) || 0, wrong: Number(r.wrong) || 0 };
  }
  store.set("progress", progress);
  return `Wiederhergestellt. ${n ? `${n} eigene Wörter neu dazugekommen.` : "Bedeutungen und Lernstand sind aktualisiert."}`;
}

function wortView() {
  $("#sheet-title").textContent = "Wortschatz";
  const all = wAll();
  const ready = all.filter((x) => x.m);
  const sure = ready.filter(wSure).length;
  const chips = [["alle", "Alle"], ["offen", "Ohne Bedeutung"], ["eigen", "Eigene"], ["sicher", "Sicher"], ...Object.entries(WORTER.themes)];
  $("#sheet-body").innerHTML = `
    <p class="page-sub">${all.length} Wörter, ${ready.length} mit Bedeutung, ${sure} sicher.</p>
    <div class="w-actions">
      <button class="btn wide" type="button" data-w-add>Wort hinzufügen</button>
      ${ready.length ? `<button class="btn ghost wide" type="button" data-w-practice>Jetzt 5 Wörter üben</button>` : ""}
    </div>
    <div class="chips z-chips" role="radiogroup" aria-label="Filter">${chips.map(([k, l]) => `<button role="radio" aria-checked="${k === wFilter}" data-wf="${k}">${esc(l)}</button>`).join("")}</div>
    <label class="search z-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input id="w-q" type="search" placeholder="Wort oder Bedeutung suchen" autocomplete="off" value="${esc(wQuery)}">
    </label>
    <div class="z-list" id="w-all"></div>
    <h3 class="z-h">Sicherung</h3>
    <p class="page-sub">Deine Wörter und dein Lernstand liegen nur auf diesem iPhone. Kopier sie ab und zu als Text und leg sie zum Beispiel in Notizen ab.</p>
    <div class="w-actions">
      <button class="btn ghost wide" type="button" data-w-copy>Alles kopieren</button>
      <button class="btn ghost wide" type="button" data-w-restore>Aus Text wiederherstellen</button>
    </div>
    <div id="w-backup"></div>`;
  wRenderList();
  const body = $("#sheet-body");
  body.querySelectorAll("[data-wf]").forEach((b) => b.addEventListener("click", () => {
    wFilter = b.dataset.wf;
    body.querySelectorAll("[data-wf]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    wRenderList();
  }));
  $("#w-q").addEventListener("input", (e) => { wQuery = e.target.value; wRenderList(); });
  $("#w-all").addEventListener("click", (e) => {
    const b = e.target.closest("[data-w]");
    if (b) openSheet(() => wortDetail(b.dataset.w));
  });
  body.querySelector("[data-w-add]").addEventListener("click", () => openSheet(() => wortEdit(null)));
  body.querySelector("[data-w-practice]")?.addEventListener("click", () => { closeSheets(); startQuiz(VOCAB); });
  const info = $("#w-backup");
  body.querySelector("[data-w-copy]").addEventListener("click", async () => {
    const txt = wBackup();
    try {
      await navigator.clipboard.writeText(txt);
      info.innerHTML = `<p class="wd-src">Kopiert. Füg den Text jetzt irgendwo ein, wo du ihn aufbewahrst.</p>`;
    } catch {
      info.innerHTML = `<p class="wd-src">Das Kopieren wurde blockiert. Halte den Text gedrückt, wähle „Alles auswählen“ und dann „Kopieren“.</p><textarea class="w-text" id="w-copy-area" readonly rows="5"></textarea>`;
      const ta = $("#w-copy-area"); ta.value = txt; ta.focus(); ta.select();
    }
  });
  body.querySelector("[data-w-restore]").addEventListener("click", () => {
    info.innerHTML = `<textarea class="w-text" id="w-restore-area" rows="5" placeholder="Sicherungstext hier einfügen"></textarea><div class="w-actions"><button class="btn wide" type="button" id="w-restore-go">Wiederherstellen</button></div><p class="wd-src" id="w-restore-msg" aria-live="polite"></p>`;
    $("#w-restore-go").addEventListener("click", () => {
      const msg = wRestore($("#w-restore-area").value.trim());
      $("#w-restore-msg").textContent = msg;
      wRenderList();
      if (msg.startsWith("Wiederhergestellt")) $("#sheet-body").querySelector(".page-sub").textContent = `${wAll().length} Wörter, ${wAll().filter((x) => x.m).length} mit Bedeutung.`;
    });
  });
}

function wortDetail(id) {
  const x = wById(id);
  if (!x) { sheetBack(); return; }
  $("#sheet-title").textContent = "Wort";
  const r = rec("vocab", id);
  const when = r ? (r.due <= Date.now() ? "heute fällig" : `wieder am ${new Date(r.due).toLocaleDateString("de-DE")}`) : "";
  const q = encodeURIComponent(x.w);
  $("#sheet-body").innerHTML = `
    <article class="wd">
      ${x.t && WORTER.themes[x.t] ? `<span class="z-badge">${esc(WORTER.themes[x.t])}</span>` : ""}
      <h2 class="wd-word">${wArt(x)}${esc(x.w)}</h2>
      ${x.c ? `<p class="wd-src">Gefunden in: ${esc(x.c)}</p>` : ""}
      ${canSpeak ? `<button class="w-speak" type="button" data-speak>🔊 Vorlesen</button>` : ""}
      ${x.m
        ? `<h3>Bedeutung</h3><p class="wd-m">${esc(x.m)}</p>
           ${x.b ? `<h3>Beispiel</h3><p class="wd-m">${esc(x.b)}</p>` : ""}
           <p class="wd-src">${x.ok ? `<span class="z-badge ok">Bestätigt</span> Quelle: ${esc(x.q || "")}` : x.v ? `<span class="z-badge mid">Vorschlag</span> Von Claude geschrieben, noch nicht gegengeprüft. Prüf ihn mit Duden oder DWDS und ändere ihn, wenn er nicht passt.` : `<span class="z-badge mid">Selbst eingetragen</span>`}</p>
           ${r ? `<p class="wd-src">Lernkasten ${r.box} von 5${when ? `, ${when}` : ""}. ${r.seen}-mal geübt.</p>` : ""}`
        : `<div class="empty"><strong>Noch keine Bedeutung</strong>Schlag das Wort nach und trag die Bedeutung ein. Erst dann kommt es in die Übungsrunde.</div>`}
      <div class="w-actions"><button class="btn wide" type="button" data-w-edit>${x.m ? "Bearbeiten" : "Bedeutung eintragen"}</button></div>
      <h3>Selbst nachschlagen</h3>
      <div class="wd-links">
        <a href="https://de.wiktionary.org/wiki/${q}" target="_blank" rel="noopener">Wiktionary</a>
        <a href="https://www.dwds.de/wb/${q}" target="_blank" rel="noopener">DWDS</a>
        <a href="https://www.duden.de/suchen/dudenonline/${q}" target="_blank" rel="noopener">Duden</a>
      </div>
      ${x.own || wst().m[id] ? `<button class="w-del" type="button" data-w-del>${x.own ? "Wort löschen" : "Auf Vorschlag zurücksetzen"}</button>` : ""}
    </article>`;
  const body = $("#sheet-body");
  body.querySelector("[data-speak]")?.addEventListener("click", () => speak(x.w));
  body.querySelector("[data-w-edit]").addEventListener("click", () => openSheet(() => wortEdit(id)));
  const del = body.querySelector("[data-w-del]");
  let armed = false;
  del?.addEventListener("click", () => {
    if (!armed) { armed = true; del.textContent = "Sicher? Nochmal tippen zum Bestätigen"; return; }
    const s = wst();
    s.own = s.own.filter((o) => o.id !== id);
    delete s.m[id];
    wstSave(s);
    if (progress.vocab) { delete progress.vocab[id]; store.set("progress", progress); }
    sheetBack();
  });
}

let wApplied = null;   // zuletzt aus dem Internet übernommener Text: { q: Quelle, text }
function wSaveWord(id, f) {
  const s = wst();
  const word = f.w.trim();
  let wid = id;
  if (!wid) {
    const dup = wAll().find((x) => x.w.toLowerCase() === word.toLowerCase());
    if (dup) return { dup };
    wid = "o" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    s.own.push({ id: wid, w: word, a: f.a, t: "eigen", d: Date.now() });
  }
  const own = s.own.find((o) => o.id === wid);
  if (own) { own.w = word; own.a = f.a; }
  const prev = s.m[wid] || {};
  let q = "", ok = false;
  if (f.m) {
    if (wApplied && wApplied.text === f.m) { q = wApplied.q; ok = true; }
    else if (f.m === (prev.m || "")) { q = prev.q || "eigen"; ok = !!prev.ok; }
    else q = "eigen";
  }
  const entry = { m: f.m, b: f.b, c: f.c, q, ok, at: Date.now() };
  const base = WORTER.words.find((w) => w.id === wid);
  if (base) entry.a = f.a;
  if (!entry.m && !entry.b && !entry.c && (!base || entry.a === (base.a || ""))) delete s.m[wid];
  else s.m[wid] = entry;
  wstSave(s);
  return { id: wid };
}

function wortEdit(id, note = "") {
  const x = id ? wById(id) : null;
  if (id && !x) { sheetBack(); return; }
  wApplied = null;
  let art = x?.a || "";
  const fixed = !!(x && !x.own);   // Startwörter behalten ihre Schreibweise
  $("#sheet-title").textContent = x ? "Wort bearbeiten" : "Neues Wort";
  $("#sheet-body").innerHTML = `
    <div class="w-form">
      <label class="w-lab" for="wf-w">Wort</label>
      <input class="w-input" id="wf-w" type="text" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(x?.w || "")}" ${fixed ? "readonly" : ""} placeholder="z. B. Neuroplastizität">
      <span class="w-lab">Artikel</span>
      <div class="chips w-art-chips" role="radiogroup" aria-label="Artikel">${[["", "keiner"], ["der", "der"], ["die", "die"], ["das", "das"]].map(([k, l]) => `<button type="button" role="radio" aria-checked="${art === k}" data-art="${k}">${l}</button>`).join("")}</div>
      <label class="w-lab" for="wf-c">Gefunden in (optional)</label>
      <input class="w-input" id="wf-c" type="text" autocomplete="off" value="${esc(x?.c || "")}" placeholder="z. B. Buchtitel">
      <button class="btn ghost wide w-look" type="button" id="wf-look">Online nachschlagen</button>
      <div id="w-res" aria-live="polite"></div>
      <label class="w-lab" for="wf-m">Bedeutung</label>
      <textarea class="w-text" id="wf-m" rows="4" placeholder="Bedeutung hier einfügen oder selbst schreiben">${esc(x?.m || "")}</textarea>
      <button class="w-link" type="button" id="wf-paste">Aus Zwischenablage einfügen</button>
      <label class="w-lab" for="wf-b">Beispielsatz (optional)</label>
      <textarea class="w-text" id="wf-b" rows="2">${esc(x?.b || "")}</textarea>
      <p class="wd-src" id="wf-msg" aria-live="polite">${esc(note)}</p>
      <div class="w-actions"><button class="btn wide" id="wf-save" type="button">Speichern</button></div>
    </div>`;
  const body = $("#sheet-body");
  const msg = (t) => { const m = $("#wf-msg"); if (m) m.textContent = t; };
  const setArt = (a) => { art = a; body.querySelectorAll("[data-art]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.art === art))); };
  body.querySelectorAll("[data-art]").forEach((b) => b.addEventListener("click", () => setArt(b.dataset.art)));
  $("#wf-paste").addEventListener("click", async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (t) { $("#wf-m").value = t; msg(""); } else msg("Die Zwischenablage ist leer.");
    } catch { msg("Einfügen ist blockiert. Halte das Textfeld gedrückt und wähle „Einfügen“."); }
  });

  let token = 0;
  $("#wf-look").addEventListener("click", async () => {
    const w = $("#wf-w").value.trim();
    if (!w) { msg("Trag erst das Wort ein."); return; }
    const my = ++token;
    $("#w-res").innerHTML = `<p class="wd-src">Suche bei Wiktionary und Wikipedia …</p>`;
    const res = await wortLookup(w);
    if (my !== token || !$("#w-res")) return;
    const cands = [];
    let html = "";
    if (res.wikt) {
      html += `<h4 class="w-src-h">Wiktionary · <a href="${esc(res.wikt.url)}" target="_blank" rel="noopener">Seite öffnen</a></h4>`;
      for (const e of res.wikt.entries) {
        html += `<p class="w-pos">${esc(e.pos)}${e.art.length ? `, ${esc(e.art.join(" / "))}` : ""}</p>`;
        for (const d of e.defs) {
          cands.push({ src: "Wiktionary", text: d.text, ex: d.ex, art: e.art.length === 1 ? e.art[0] : "" });
          html += `<button class="w-cand" type="button" aria-pressed="false" data-ci="${cands.length - 1}"><b>[${esc(d.n)}]</b> ${esc(d.text)}</button>`;
        }
      }
    }
    if (res.wp) {
      cands.push({ src: "Wikipedia", text: res.wp.text, ex: "", art: "" });
      html += `<h4 class="w-src-h">Wikipedia (Lexikon) · <a href="${esc(res.wp.url)}" target="_blank" rel="noopener">${esc(res.wp.title)}</a></h4>
        <button class="w-cand" type="button" aria-pressed="false" data-ci="${cands.length - 1}">${esc(res.wp.text)}</button>`;
    }
    if (!cands.length) {
      $("#w-res").innerHTML = `<div class="empty"><strong>${res.net ? "Nichts gefunden" : "Keine Verbindung"}</strong>${res.net ? "Prüf die Schreibweise oder schlag das Wort selbst nach (Link unter „Wort“ nach dem Speichern) und füge die Bedeutung ein." : "Du bist offline oder die Dienste sind gerade nicht erreichbar. Trag die Bedeutung selbst ein."}</div>`;
      return;
    }
    $("#w-res").innerHTML = `<div class="w-res">${html}<p class="wd-src">Tippe auf die passende Bedeutung (mehrere gehen) und dann auf „Auswahl übernehmen“.</p><button class="btn small" type="button" id="w-apply">Auswahl übernehmen</button></div>`;
    $("#w-res").querySelectorAll(".w-cand").forEach((b) => b.addEventListener("click", () => b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"))));
    $("#w-apply").addEventListener("click", () => {
      const sel = [...$("#w-res").querySelectorAll('.w-cand[aria-pressed="true"]')].map((b) => cands[Number(b.dataset.ci)]);
      if (!sel.length) { msg("Wähl erst eine Bedeutung aus."); return; }
      const text = sel.length === 1 ? sel[0].text : sel.map((c, i) => `${i + 1}) ${c.text}`).join("\n");
      $("#wf-m").value = text;
      const ex = sel.find((c) => c.ex)?.ex;
      if (ex && !$("#wf-b").value.trim()) $("#wf-b").value = ex;
      if (!art && sel[0].art) setArt(sel[0].art);
      wApplied = { q: [...new Set(sel.map((c) => c.src))].join(", "), text };
      msg("Übernommen. Lies den Text kurz durch und tippe dann auf „Speichern“.");
    });
  });

  $("#wf-save").addEventListener("click", () => {
    const f = { w: $("#wf-w").value, a: art, c: $("#wf-c").value.trim(), m: $("#wf-m").value.trim(), b: $("#wf-b").value.trim() };
    if (!f.w.trim()) { msg("Trag ein Wort ein."); return; }
    const out = wSaveWord(id, f);
    if (out.dup) { msg(`„${out.dup.w}“ steht schon in deiner Sammlung. Öffne es in der Liste, um die Bedeutung zu ändern.`); return; }
    if (id) { sheetBack(); return; }
    wortEdit(null, `Gespeichert: ${wLabel({ a: f.a, w: f.w.trim() })}${f.m ? "" : " (noch ohne Bedeutung)"}. Du kannst gleich das nächste Wort eintragen.`);
    $("#wf-w").focus();
  });
}

/* ---------- Wortschatz: Bildschirm bleibt beim Wischen still ---------- */
// Quiz und Sammlung liegen fest über der Seite. Wenn nichts zu scrollen ist, darf das Wischen nichts bewegen.
(() => {
  let sx = 0, sy = 0;
  const host = (e) => e.target.closest?.(".quiz--vocab, .sheet");
  window.addEventListener("touchstart", (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1 || sx <= 24) return;             // Kantenwischen bleibt Sache der Zurück-Geste
    const h = host(e);
    if (!h || (h.id === "sheet" && !h.querySelector(".wd, #w-all, .w-input"))) return;
    if (e.target.closest?.(".chips, textarea")) return;         // Filterleiste und Textfelder dürfen selbst wischen
    const t = e.touches[0];
    const horizontal = Math.abs(t.clientX - sx) > Math.abs(t.clientY - sy);
    const sc = e.target.closest(".quiz-body, .sheet-body");
    const canScroll = sc && sc.scrollHeight > sc.clientHeight + 1;
    if (horizontal || !canScroll) { if (e.cancelable) e.preventDefault(); }
  }, { passive: false });
})();

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
  try { ZITATE = (await get("zitate.json")).quotes || []; } catch { ZITATE = []; }
  try { WORTER = await get("woerter.json"); WORTER.words ??= []; WORTER.themes ??= {}; } catch { WORTER = { themes: {}, words: [] }; }
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
