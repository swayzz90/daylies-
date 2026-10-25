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
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ---------- Tabs ---------- */
const views = { news: $("#view-news"), learn: $("#view-learn") };
const scrollPos = { news: 0, learn: 0 };
let currentTab = store.get("tab", "news");

function showTab(tab) {
  scrollPos[currentTab] = window.scrollY;
  currentTab = tab;
  store.set("tab", tab);
  for (const [name, el] of Object.entries(views)) el.hidden = name !== tab;
  document.querySelectorAll(".tabbar button").forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  window.scrollTo(0, scrollPos[tab] || 0);
  if (tab === "learn") renderLearn();
}
document.querySelectorAll(".tabbar button").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.tab === currentTab) window.scrollTo({ top: 0, behavior: "smooth" });
    else showTab(b.dataset.tab);
  })
);

/* =================================================================
   NACHRICHTEN
   ================================================================= */
const news = { items: [], updated: null, cat: "alle", query: "", loadedAt: 0 };
const readIds = new Set(store.get("read", []));

function markRead(id) {
  readIds.add(id);
  store.set("read", [...readIds].slice(-3000));
}

async function loadNews() {
  try {
    const res = await fetch("news.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    news.items = data.items || [];
    news.updated = data.updated;
    news.loadedAt = Date.now();
  } catch {
    if (!news.items.length) $("#news-sub").textContent = "Offline. Keine gespeicherten Meldungen.";
  }
  renderNews();
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

function renderNews() {
  const sub = $("#news-sub");
  const dateText = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  sub.textContent = news.updated
    ? `${dateText}, aktualisiert um ${new Date(news.updated).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`
    : dateText;

  const q = news.query.trim().toLowerCase();
  const items = news.items.filter((it) =>
    (news.cat === "alle" || it.category === news.cat) &&
    (!q || (it.title + " " + it.summary + " " + it.source).toLowerCase().includes(q))
  );

  const list = $("#news-list");
  if (!news.items.length) {
    list.innerHTML = `<div class="empty"><strong>Noch keine Meldungen</strong>
      Die Nachrichten kommen nach dem ersten Lauf der GitHub Action. Starte sie unter Actions mit „Run workflow“.</div>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = `<div class="empty"><strong>Keine Treffer</strong>
      Für „${esc(news.query)}“ gibt es gerade keine Meldung. Versuch einen anderen Begriff oder wechsle den Bereich.</div>`;
    return;
  }

  let html = "";
  let lastDay = "";
  for (const it of items) {
    const label = dayLabel(it.date);
    if (label !== lastDay) { html += `<h2 class="day-label">${esc(label)}</h2>`; lastDay = label; }
    const cat = news.cat === "alle" ? `<span class="cat">${it.category === "welt" ? "Welt" : "Deutschland"}</span>` : "";
    html += `
      <a class="news-item${readIds.has(it.id) ? " read" : ""}" href="${esc(it.link)}" target="_blank" rel="noopener" data-id="${esc(it.id)}">
        <div>
          <div class="news-meta"><span class="src">${esc(it.source)}</span><span>${esc(relTime(it.date))}</span>${cat}</div>
          <h3 class="news-title">${esc(it.title)}</h3>
          ${it.summary ? `<p class="news-summary">${esc(it.summary)}</p>` : ""}
        </div>
        ${it.image ? `<img class="news-thumb" src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      </a>`;
  }
  list.innerHTML = html;
}

$("#news-list").addEventListener("click", (e) => {
  const a = e.target.closest(".news-item");
  if (!a) return;
  markRead(a.dataset.id);
  a.classList.add("read");
});

document.querySelectorAll(".segmented button").forEach((b) =>
  b.addEventListener("click", () => {
    news.cat = b.dataset.cat;
    document.querySelectorAll(".segmented button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    renderNews();
  })
);

let searchTimer;
$("#news-search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { news.query = e.target.value; renderNews(); }, 120);
});

/* Zum Aktualisieren ziehen */
(() => {
  const pull = $("#pull");
  let startY = null, dist = 0;
  window.addEventListener("touchstart", (e) => {
    if (currentTab !== "news" || window.scrollY > 0 || !$("#quiz").hidden) return;
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
   LERNEN: Welt-Quiz
   ================================================================= */
let countries = [];
const REGIONS = ["Alle", "Europa", "Asien", "Afrika", "Amerika", "Ozeanien"];
let region = store.get("region", "Alle");

const MODES = [
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

/* Fortschritt: Lernkasten-System
   Kasten 0 = falsch beantwortet, 1..5 = immer sicherer. Ab Kasten 3 gilt ein Land als „sicher“. */
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

function pickQuestions(mode, n = 10) {
  const now = Date.now();
  const all = pool(mode);
  const due = shuffle(all.filter((c) => { const r = rec(mode.id, c.id); return r && r.box < 5 && r.due <= now; }))
    .sort((a, b) => rec(mode.id, a.id).box - rec(mode.id, b.id).box);
  const fresh = shuffle(all.filter((c) => !rec(mode.id, c.id)));
  const rest = shuffle(all.filter((c) => !due.includes(c) && !fresh.includes(c)))
    .sort((a, b) => rec(mode.id, a.id).due - rec(mode.id, b.id).due);

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

function streakInfo() {
  const set = new Set(activity);
  let n = 0;
  const d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (set.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return { n, today: set.has(dayKey()), set };
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

  const totalMastered = MODES.reduce((s, m) => s + countries.filter((c) => (rec(m.id, c.id)?.box ?? 0) >= MASTERED).length, 0);
  $("#learn-sub").textContent = `${totalMastered} Antworten sitzen sicher`;

  $("#regions").innerHTML = REGIONS.map((r) =>
    `<button role="radio" aria-checked="${r === region}" data-region="${r}">${r}</button>`).join("");

  const now = Date.now();
  $("#modes").innerHTML = MODES.map((m) => {
    const p = pool(m);
    const mastered = p.filter((c) => (rec(m.id, c.id)?.box ?? 0) >= MASTERED).length;
    const dueCount = p.filter((c) => { const r = rec(m.id, c.id); return r && r.box < 5 && r.due <= now; }).length;
    const pct = p.length ? Math.round((mastered / p.length) * 100) : 0;
    const dueText = dueCount ? `, ${dueCount} zum Wiederholen` : "";
    return `
      <button class="mode" data-mode="${m.id}">
        <span class="mode-icon${m.iconText ? " text" : ""}" aria-hidden="true">${m.icon}</span>
        <span>
          <span class="mode-title">${m.title}</span>
          <span class="mode-sub" style="display:block">${mastered} von ${p.length} sicher${dueText}</span>
          <span class="bar" aria-hidden="true"><b style="width:${pct}%"></b></span>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </button>`;
  }).join("");
}

$("#regions").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  region = b.dataset.region; store.set("region", region); renderLearn();
});
$("#modes").addEventListener("click", (e) => {
  const b = e.target.closest(".mode"); if (!b) return;
  startQuiz(MODES.find((m) => m.id === b.dataset.mode));
});

/* ---------- Quiz-Ablauf ---------- */
let quiz = null;

function startQuiz(mode) {
  const questions = pickQuestions(mode);
  if (!questions.length) return;
  quiz = { mode, questions, i: 0, results: [] };
  $("#quiz").hidden = false;
  document.body.style.overflow = "hidden";
  renderQuestion();
}

function closeQuiz() {
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

function renderQuestion() {
  const { mode } = quiz;
  const target = quiz.questions[quiz.i];
  const opts = options(mode, target);
  renderDots();
  $("#quiz-body").innerHTML = `
    <div class="prompt">${mode.prompt(target)}</div>
    <div class="answers${mode.flagAnswers ? " flags" : ""}">
      ${opts.map((o) => `<button class="answer" data-id="${o.id}">${mode.answerLabel(o)}</button>`).join("")}
    </div>
    <div class="feedback" id="feedback"></div>`;

  $("#quiz-body").querySelectorAll(".answer").forEach((btn) =>
    btn.addEventListener("click", () => answer(btn, target, opts), { once: true })
  );
}

function answer(btn, target, opts) {
  const { mode } = quiz;
  const correct = btn.dataset.id === target.id;
  const buttons = $("#quiz-body").querySelectorAll(".answer");
  buttons.forEach((b) => {
    b.disabled = true;
    if (b.dataset.id === target.id) b.classList.add("correct");
  });
  if (!correct) {
    btn.classList.add("wrong");
    if (mode.flagAnswers) {
      // Bei Flaggen zeigen, welche Länder die Flaggen waren
      buttons.forEach((b) => {
        const c = opts.find((o) => o.id === b.dataset.id);
        b.insertAdjacentHTML("beforeend", `<span class="hint">${esc(c.name)}</span>`);
      });
    }
  }
  saveRec(mode.id, target.id, correct);
  const chosen = opts.find((o) => o.id === btn.dataset.id);
  quiz.results[quiz.i] = { correct, target, chosen };
  renderDots();

  const fb = $("#feedback");
  if (correct) {
    setTimeout(next, 650);
  } else {
    fb.innerHTML = `<p>Richtig wäre <strong>${esc(mode.answerText(target))}</strong></p>
      <button class="btn" id="next">Weiter</button>`;
    $("#next").focus();
    $("#next").addEventListener("click", next);
  }
}

function next() {
  if (!quiz) return;
  quiz.i++;
  if (quiz.i < quiz.questions.length) renderQuestion();
  else renderResult();
}

function renderResult() {
  const { mode, results } = quiz;
  const score = results.filter((r) => r.correct).length;
  const total = results.length;
  if (!activity.includes(dayKey())) { activity.push(dayKey()); activity = activity.slice(-400); store.set("activity", activity); }

  const msg =
    score === total ? "Fehlerfrei. Die Fragen kommen erst in ein paar Tagen wieder." :
    score >= total * 0.7 ? "Gute Runde. Die Fehler kommen in der nächsten Runde wieder dran." :
    "Die falschen Antworten kommen gleich in der nächsten Runde wieder. So bleibt es hängen.";

  const wrong = results.filter((r) => !r.correct);
  renderDots();
  $("#quiz-count").textContent = "";
  $("#quiz-body").innerHTML = `
    <div class="result">
      <p class="result-score">${score}<small> von ${total}</small></p>
      <p class="result-msg">${msg}</p>
      ${wrong.length ? `<ul class="mistakes">${wrong.map((r) => `
        <li><span class="f">${r.target.flag}</span>
          <div><strong>${esc(r.target.name)}</strong><span>${mode.id.startsWith("capital") ? "Hauptstadt " + esc(r.target.capital) : "Deine Wahl: " + esc(r.chosen.name)}</span></div>
        </li>`).join("")}</ul>` : ""}
    </div>
    <div class="result-actions">
      <button class="btn ghost" id="done">Fertig</button>
      <button class="btn" id="again">Nächste Runde</button>
    </div>`;
  $("#done").addEventListener("click", closeQuiz);
  $("#again").addEventListener("click", () => startQuiz(mode));
}

/* ---------- Start ---------- */
async function init() {
  showTab(currentTab);
  loadNews();
  try {
    countries = await (await fetch("countries.json")).json();
    renderLearn();
  } catch {
    $("#modes").innerHTML = `<div class="empty"><strong>Länderdaten fehlen</strong>Die Datei countries.json konnte nicht geladen werden.</div>`;
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
init();
