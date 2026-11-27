// Holt alle aktivierten RSS/Atom-Feeds, sortiert Themen ein, entfernt Bezahlartikel
// und schreibt news.json. Läuft in der GitHub Action, braucht keine Abhängigkeiten (Node 20+).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "news.json");
const CACHE_FILE = process.env.PAYWALL_CACHE || join(ROOT, ".paywall-cache.json");
const UA = "Mozilla/5.0 (compatible; DailyBrain/2.0; privater Feed-Leser)";

const LIMITS = {
  news: { maxAgeH: 72, max: 700, perFeed: 30, perSource: 70 },
  lesen: { maxAgeH: 24 * 30, max: 400, perFeed: 25, perSource: 50 },
};
const MAX_PAGE_CHECKS = 150;   // Artikelseiten pro Lauf, die auf Bezahlschranke geprüft werden
const CHECK_BUDGET_MS = 90000; // Zeitbudget für die Seitenprüfung
const CACHE_TTL_MS = 14 * 24 * 3600 * 1000;

// Schlagzeilen: Meldungen, über die mehrere Quellen berichten. Werte nach dem Action-Log feinjustieren.
export const HEADLINES = {
  windowH: 30,   // nur Meldungen der letzten 30 Stunden werden verglichen
  freshH: 6,     // jünger als 6 Stunden: Frischebonus
  freshBonus: 2,
  topWeight: 2,  // Quellen mit "top": true in feeds.json zählen doppelt
  minShared: 2,  // so viele seltene Wörter müssen zwei Meldungen gemeinsam haben
  rareCap: 15,   // Wörter, die in mehr Meldungen vorkommen, gelten als allgemein
  splitAt: 10,   // größere Gruppen werden mit strengerer Schwelle geprüft
  minScore: 4,   // darunter keine Schlagzeile: zwei normale Quellen brauchen den Frischebonus
};

/* ---------- Text-Helfer ---------- */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
function clean(s = "") {
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = decode(s);
  s = s.replace(/<[^>]+>/g, " ");
  s = decode(s);
  return s.replace(/\s+/g, " ").trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}
function attr(block, name, attribute) {
  const m = block.match(new RegExp(`<${name}\\s[^>]*${attribute}=["']([^"']+)["'][^>]*>`, "i"));
  return m ? decode(m[1]) : "";
}
function atomLink(block) {
  const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const pick = links.find((l) => /rel=["']alternate["']/i.test(l)) || links.find((l) => !/rel=/i.test(l)) || links[0];
  const m = pick && pick.match(/href=["']([^"']+)["']/i);
  return m ? decode(m[1]) : "";
}
function truncate(s, n = 260) {
  if (s.length <= n) return s;
  return s.slice(0, s.lastIndexOf(" ", n)) + " …";
}
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* ---------- Thema und Bezahlschranke ---------- */
function ruleHit(rules, text) {
  for (const r of rules) {
    if (r.not && r.not.some((w) => text.includes(w))) continue;
    if (r.words.some((w) => text.includes(w))) return r.topic;
  }
  return null;
}
export function pickTopic(feed, title, summary, rulesets = {}) {
  const rules = rulesets[feed.rules] || [];
  return ruleHit(rules, (title + " " + summary).toLowerCase()) || feed.topic;
}

/* ---------- Region je Artikel (nur wo der Feed "beide" sagt) ---------- */
const DE_HINT = /deutschland|deutsche[nrms]?\b|bundestag|bundesrat|bundesregierung|bundeskanzler|kanzler|merz|bundesland|bundesländer|\bländer\b|bayern|bayerisch|berlin\b|münchen|hamburg\b|nrw|sachsen|thüringen|hessen|baden-württemberg|bundesliga|bundeswehr|deutsche bahn|\bbahn\b|bundesnetzagentur|bundesverfassungsgericht|\bcdu\b|\bcsu\b|\bspd\b|\bafd\b|\bgrüne[n]?\b|bundesamt|krankenkasse|jobcenter|\bdax\b|bafög|bürgergeld|deutschlandticket|augsburg|schwaben/i;
const WORLD_HINT = /\busa\b|\bus-|amerikanisch|trump|biden|harris|washington|china|chinesisch|peking|russland|russisch|putin|ukraine|kiew|israel|gaza|iran|nahost|indien|japan|taiwan|nato\b|\beu\b|brüssel|europäisch|frankreich|macron|großbritannien|london|türkei|syrien|afrika|asien|lateinamerika|weltweit|\buno\b|\bun-|g7|g20|opec|wall street|nasdaq|dow jones/i;
export function detectRegion(feed, title, summary) {
  const base = feed.region || "beide";
  if (feed.section === "lesen" || base !== "beide") return base;
  const text = title + " " + summary;
  const de = DE_HINT.test(text), world = WORLD_HINT.test(text);
  if (de && !world) return "deutschland";
  if (world && !de) return "welt";
  return "beide";
}

// Stufe 1: Kennzeichnung direkt im Feed (Titel-Präfix, Plus-Marker, Paywall-Tag mit positivem Wert)
export function feedMarksPaid(title, block = "") {
  if (/^\s*(?:heise\+|SPIEGEL\+|Spektrum\+|Z\+|ZEIT\+|WELT\s?plus)(?:\s|\||:|$)/i.test(title)) return true;
  if (/\(\s*(?:[SZ]|g)\+\s*\)/i.test(title)) return true;
  if (/<(?:[a-z]+:)?paywall[^>]*>\s*(?:true|yes|1|plus|paid|locked)\s*<\//i.test(block)) return true;
  return false;
}

// Stufe 2: Artikelseite prüfen (schema.org / Meta-Angaben, die Verlage für Google setzen)
export function looksPaywalled(html) {
  if (/"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test(html)) return true;
  if (/itemprop=["']isAccessibleForFree["'][^>]*content=["']false["']/i.test(html)) return true;
  if (/content=["']false["'][^>]*itemprop=["']isAccessibleForFree["']/i.test(html)) return true;
  if (/<meta[^>]+(?:property|name)=["']article:content_tier["'][^>]*content=["'](?:locked|metered)["']/i.test(html)) return true;
  if (/<meta[^>]+content=["'](?:locked|metered)["'][^>]*(?:property|name)=["']article:content_tier["']/i.test(html)) return true;
  if (/["']?(?:isPaywalled|paywall|isPremium)["']?\s*:\s*true/i.test(html)) return true;
  return false;
}

/* ---------- Feed lesen ---------- */
export function parseFeed(xml, feed, rulesets = {}) {
  const items = [];
  const rss = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const atom = rss.length === 0;
  const list = atom ? [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]) : rss;

  for (const b of list) {
    const title = clean(tag(b, "title"));
    let link = atom ? atomLink(b) : clean(tag(b, "link"));
    if (!link) link = clean(tag(b, "guid"));
    if (!title || !/^https?:/.test(link)) continue;

    const summaryRaw = clean(tag(b, "description") || tag(b, "summary") || tag(b, "content"));
    const summary = truncate(summaryRaw === title ? "" : summaryRaw);
    if (feed.onlyMatched && !ruleHit(rulesets[feed.rules] || [], (title + " " + summary).toLowerCase())) continue;
    const dateRaw = clean(tag(b, "pubDate") || tag(b, "dc:date") || tag(b, "published") || tag(b, "updated"));
    const date = new Date(dateRaw);
    const image =
      attr(b, "enclosure", "url") || attr(b, "media:content", "url") || attr(b, "media:thumbnail", "url") || "";

    items.push({
      id: hash(link),
      title,
      summary,
      link,
      source: feed.name,
      section: feed.section || "news",
      region: feed.section === "lesen" ? null : detectRegion(feed, title, summary),
      lang: feed.lang || "de",
      topic: pickTopic(feed, title, summary, rulesets),
      date: isNaN(date) ? null : date.toISOString(),
      image: /\.(jpe?g|png|webp)/i.test(image) ? image : "",
      _paid: feedMarksPaid(title, b),
      _top: !!feed.top,
    });
  }
  return items;
}

async function fetchText(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function readPage(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9", Accept: "text/html" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let html = "";
    while (html.length < 700000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
    }
    try { await reader.cancel(); } catch { /* egal */ }
    return html;
  } finally {
    clearTimeout(t);
  }
}

async function pool(list, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < list.length) await fn(list[i++]);
  }));
}

async function loadCache() {
  try { return JSON.parse(await readFile(CACHE_FILE, "utf8")); } catch { return {}; }
}
async function saveCache(cache) {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const k of Object.keys(cache)) if (cache[k].t < cutoff) delete cache[k];
  try {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache));
  } catch (e) { console.warn("Merker konnte nicht gespeichert werden:", e.message); }
}

/* ---------- Fristen & Änderungen ---------- */
// Findet in Artikeltexten Stichtage ("läuft am 30. November aus", "ab 1. Januar"). Gespeichert werden nur
// Datum und Art, nie der Artikeltext. Ein Artikel wird nur einmal geladen (Merker im Cache).
export const FRIST = {
  horizonD: 120,    // nur Stichtage in den nächsten 120 Tagen
  maxFetch: 40,     // Artikelseiten pro Lauf
  budgetMs: 60000,  // Zeitbudget für das Laden
  keepAfterD: 1,    // nach dem Stichtag noch 1 Tag anzeigen
  maxItems: 30,
};
const MONTH_NAMES = "januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|mrz|apr|jun|jul|aug|sep|sept|okt|nov|dez";
const MONTH_NUM = { januar: 1, jan: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, mrz: 3, april: 4, apr: 4, mai: 5, juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12 };
const WEEKDAY = "(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag),?\\s+(?:den\\s+)?";
const RE_DATE_TXT = new RegExp(`(?:${WEEKDAY})?(\\d{1,2})\\.\\s?(${MONTH_NAMES})\\.?(?:\\s+(\\d{4}))?(?![\\p{L}\\d])`, "giu");
const RE_DATE_NUM = /(?:^|[^\d.])(\d{1,2})\.(\d{1,2})\.(?:(\d{4})|(?!\d))/g;
const RE_MONTH_END = new RegExp(`ende\\s+(${MONTH_NAMES})(?:\\s+(\\d{4}))?(?![\\p{L}])`, "giu");
const RE_YEAR_END = /jahresende|ende\s+(?:des\s+)?jahres/gi;
// Was vor / nach dem Datum steht, entscheidet über die Art
const BEFORE_END = /(?:läuft(?:\s+noch)?|läuft[^.;]{0,40}aus|laufen[^.;]{0,40}aus|endet|enden|ende|ablauf|abläuft|spätestens|frist|stichtag|letzter?\s+tag|bis(?:\s+zum|\s+zu|\s+einschließlich)?|befristet\s+bis|nur\s+noch\s+bis)\s*(?:am|zum|dem|den|des)?\s*(?:\p{L}+,\s+)?(?:den\s+)?$/iu;
const BEFORE_START = /(?:\bab(?:\s+dem|\s+den)?|tritt|tritt[^.;]{0,30}in\s+kraft|gilt|gelten|startet|beginnt|eingeführt|zum|vom)\s*(?:\p{L}+,\s+)?(?:den\s+)?$/iu;
const AFTER_END = /^\s*(?:\p{L}+\s+)?aus\b|^[^.;]{0,50}?(?:läuft[^.;]{0,25}aus|endet|ist\s+schluss|laufen[^.;]{0,25}aus|abgelaufen|verfällt|fällt\s+weg)/iu;
const AFTER_START = /^\s*in\s+kraft|^[^.;]{0,30}?(?:tritt[^.;]{0,20}in\s+kraft|gilt|startet|beginnt|wird\s+eingeführt)/iu;

const pad = (n) => String(n).padStart(2, "0");
export function berlinToday(now = Date.now()) {
  return new Date(now).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }); // YYYY-MM-DD
}
const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
export const daysBetween = (fromIso, toIso) => Math.round(dayNum(toIso) - dayNum(fromIso));
const validDay = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

function resolveDate(d, m, y, today) {
  const ty = +today.slice(0, 4);
  if (y) { if (y < 100) y += 2000; return validDay(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null; }
  for (const yy of [ty, ty + 1]) {
    if (!validDay(yy, m, d)) continue;
    const iso = `${yy}-${pad(m)}-${pad(d)}`;
    if (daysBetween(today, iso) >= -1) return iso;
  }
  return null;
}

// Gibt { deadline: "YYYY-MM-DD", kind: "ende" | "start" } oder null zurück. Früheste Frist in der Zukunft zählt.
export function extractDeadline(text, now = Date.now()) {
  const today = berlinToday(now);
  const found = [];
  const classify = (idx, len, weak) => {
    const before = text.slice(Math.max(0, idx - 70), idx);
    const after = text.slice(idx + len, idx + len + 90);
    if (BEFORE_END.test(before) || AFTER_END.test(after)) return "ende";
    if (BEFORE_START.test(before) || AFTER_START.test(after)) return "start";
    return weak ? "ende" : null;
  };
  for (const m of text.matchAll(RE_DATE_TXT)) {
    const iso = resolveDate(+m[1], MONTH_NUM[m[2].toLowerCase().replace(/\.$/, "")], m[3] ? +m[3] : 0, today);
    const idx = m.index + m[0].search(/\d/);
    const kind = iso && classify(idx, m[0].length - (idx - m.index), false);
    if (iso && kind) found.push({ deadline: iso, kind });
  }
  for (const m of text.matchAll(RE_DATE_NUM)) {
    const iso = resolveDate(+m[1], +m[2], m[3] ? +m[3] : 0, today);
    const idx = m.index + m[0].search(/\d/);
    const kind = iso && classify(idx, m[0].length - (idx - m.index), false);
    if (iso && kind) found.push({ deadline: iso, kind });
  }
  for (const m of text.matchAll(RE_MONTH_END)) {
    const mo = MONTH_NUM[m[1].toLowerCase()];
    const ty = +today.slice(0, 4);
    for (const y of m[2] ? [+m[2]] : [ty, ty + 1]) {
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const iso = `${y}-${pad(mo)}-${pad(last)}`;
      if (daysBetween(today, iso) >= -1) { found.push({ deadline: iso, kind: "ende" }); break; }
    }
  }
  for (const m of text.matchAll(RE_YEAR_END)) {
    const ty = +today.slice(0, 4);
    for (const y of [ty, ty + 1]) {
      const iso = `${y}-12-31`;
      if (daysBetween(today, iso) >= -1) { found.push({ deadline: iso, kind: "ende" }); break; }
    }
  }
  const ok = found.filter((f) => { const d = daysBetween(today, f.deadline); return d >= -1 && d <= FRIST.horizonD; });
  if (!ok.length) return null;
  ok.sort((a, b) => a.deadline.localeCompare(b.deadline) || (a.kind === "ende" ? -1 : 1));
  return ok[0];
}

// Grober Vorfilter auf Titel und Kurztext: nur diese Artikel werden im Volltext gelesen
const FRIST_HINT = /tankrabatt|läuft|laufen|auslauf|endet|\bende\b|frist|stichtag|\bab (?:dem )?\d{1,2}\.|\bab (?:januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember|sofort|montag|dienstag|mittwoch|donnerstag|freitag)|in kraft|neue regel|änder|deutschlandticket|rente|steuer|mindestlohn|kindergeld|bürgergeld|wohngeld|bafög|energiepreis|strompreis|gaspreis|förder|zuschuss|gebühr|beitrag|erhöh|abschaff|umstellung|verbraucher|rabatt|entlastung|prämie|bonus|kündig|abgabe|zoll|preis/i;
export function isFristCandidate(it, alltagFeed) {
  if (it.section !== "news" || (it.lang || "de") !== "de") return false;
  if (it.topic === "sport" || it.topic === "kultur") return false;
  return alltagFeed || FRIST_HINT.test(it.title + " " + it.summary);
}

// Sichtbarer Text einer Artikelseite (ohne Skripte, Menüs); nur im Speicher, wird nie gespeichert
export function pageText(html) {
  let h = html.replace(/<(script|style|noscript|nav|footer|aside|header|form|svg)\b[\s\S]*?<\/\1>/gi, " ");
  const art = h.match(/<article\b[\s\S]*?<\/article>/i);
  if (art && art[0].length > 800) h = art[0];
  return clean(h).slice(0, 60000);
}

export function dedupeFristen(list) {
  const out = [];
  for (const f of list) {
    const t = termsOf(f.title, "de");
    const dup = out.some((o) => {
      if (o.deadline !== f.deadline) return false;
      let shared = 0;
      for (const x of t) if (o._t.has(x) && ++shared >= 2) return true;
      return false;
    });
    if (!dup) out.push({ ...f, _t: t });
  }
  return out.map(({ _t, ...rest }) => rest);
}

/* ---------- Schlagzeilen ---------- */
// Meldungen werden über seltene Wörter im Titel verbunden. Zwei Meldungen gehören zusammen, wenn sie
// mindestens HEADLINES.minShared seltene Wörter teilen. Je Quelle zählt nur eine Meldung.
const STOP = {
  de: new Set((
    "der die das den dem des ein eine einer eines einem einen und oder aber als auch bei mit von vom zu zum zur " +
    "für gegen über unter nach aus auf an am im ins ist sind war waren wird werden wurde wurden hat haben hatte hatten " +
    "kann können konnte soll sollen muss müssen nicht kein keine keinen keiner mehr weniger nur noch schon wie was wer " +
    "wo wann warum wieso so sich es er sie ihr ihre ihren ihm ihn sein seine seinen dass ob um vor bis ohne neue neuer " +
    "neues neuen neu jetzt heute gestern morgen hier dort sehr viel viele vielen wieder erst dann denn doch da dies diese " +
    "dieser dieses wir euch uns mich dich man live video bilder ticker bericht exklusiv analyse kommentar interview " +
    "update eilmeldung überblick hintergrund faktencheck dazu wegen trotz"
  ).split(" ")),
  en: new Set((
    "the and for with from that this are was were has have had will would can could not but its it of in on at to by " +
    "as an is be how why what who new after before over into about says say said amid vs more than just also first " +
    "live video update news analysis interview report opinion review watch podcast"
  ).split(" ")),
};
const GENERIC = {
  de: new Set("deutschland deutsche deutscher deutschen deutsch jahr jahre jahren prozent euro million millionen milliarde milliarden mensch menschen welt tag tage woche wochen land länder".split(" ")),
  en: new Set("world year years people percent million billion week day time".split(" ")),
};
const SUFFIX = {
  de: ["ungen", "ung", "heit", "keit", "schaft", "ern", "en", "er", "es", "em", "e", "s"],
  en: ["ing", "ed", "es", "s"],
};
function stem(w, lang) {
  const min = lang === "de" ? 4 : 3;
  for (const s of SUFFIX[lang] || []) if (w.length - s.length >= min && w.endsWith(s)) return w.slice(0, -s.length);
  return w;
}
function termsOf(title, lang) {
  const out = new Set();
  for (const raw of title.split(/[^\p{L}\p{N}]+/u)) {
    const low = raw.toLowerCase();
    if (!low || /^\p{N}+$/u.test(low)) continue;
    if (low.length < 3 && !(raw.length === 2 && raw === raw.toUpperCase())) continue; // kurze Wörter, außer Kürzel wie EU
    const base = lang === "de" ? low.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss") : low;
    const st = stem(base, lang);
    if (STOP[lang]?.has(low) || STOP[lang]?.has(st) || GENERIC[lang]?.has(low) || GENERIC[lang]?.has(st)) continue;
    out.add(st);
  }
  return out;
}

export function groupHeadlines(newsItems, cfg = HEADLINES, now = Date.now()) {
  const recent = newsItems.filter((it) => it.title && it.date && now - Date.parse(it.date) <= cfg.windowH * 3600e3);
  const byLang = new Map();
  for (const it of recent) {
    const lang = it.lang || "de";
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang).push(it);
  }

  const groups = [];
  const info = { considered: recent.length, perLang: {} };
  for (const [lang, list] of byLang) {
    const terms = list.map((it) => termsOf(it.title, lang));
    const df = new Map();
    for (const set of terms) for (const t of set) df.set(t, (df.get(t) || 0) + 1);
    const cap = Math.min(cfg.rareCap, Math.max(4, Math.round(list.length * 0.08)));
    info.perLang[lang] = { n: list.length, cap };
    const rare = (t) => df.get(t) >= 2 && df.get(t) <= cap;

    // Verbundene Meldungen (Union-Find). need = nötige Zahl gemeinsamer seltener Wörter
    const components = (idx, need) => {
      const parent = new Map(idx.map((i) => [i, i]));
      const find = (x) => {
        while (parent.get(x) !== x) x = parent.get(x);
        return x;
      };
      for (let a = 0; a < idx.length; a++) {
        for (let b = a + 1; b < idx.length; b++) {
          const i = idx[a], j = idx[b];
          let shared = 0;
          for (const t of terms[i]) if (rare(t) && terms[j].has(t) && ++shared >= need) break;
          if (shared >= need) parent.set(find(i), find(j));
        }
      }
      const comp = new Map();
      for (const i of idx) {
        const r = find(i);
        if (!comp.has(r)) comp.set(r, []);
        comp.get(r).push(i);
      }
      return [...comp.values()];
    };
    // Sehr große Gruppen werden mit strengerer Schwelle geprüft, damit keine Ketten entstehen
    const comps = components(list.map((_, i) => i), cfg.minShared)
      .flatMap((c) => (c.length > cfg.splitAt ? components(c, cfg.minShared + 1) : [c]));

    for (const c of comps) {
      const members = c.map((i) => list[i]);
      const srcTop = new Map(); // Quelle -> ob eine ihrer Meldungen top-markiert ist
      for (const it of members) srcTop.set(it.source, srcTop.get(it.source) || !!it._top);
      if (srcTop.size < 2) continue;
      const newest = Math.max(...members.map((it) => Date.parse(it.date)));
      let score = now - newest < cfg.freshH * 3600e3 ? cfg.freshBonus : 0;
      for (const top of srcTop.values()) score += top ? cfg.topWeight : 1;
      if (score < cfg.minScore) continue;
      // Führungsmeldung: mit Bild, dann von einer Top-Quelle, dann die neueste
      const sorted = members.slice().sort((a, b) =>
        (!!b.image - !!a.image) || (!!b._top - !!a._top) || (Date.parse(b.date) - Date.parse(a.date)));
      const lead = sorted[0];
      groups.push({
        id: lead.id,
        lead: lead.id,
        lang,
        count: srcTop.size,
        score,
        topic: lead.topic,
        topics: [...new Set(members.map((it) => it.topic))],
        regions: [...new Set(members.map((it) => it.region).filter(Boolean))],
        members: sorted.map((it) => it.id),
        newest: new Date(newest).toISOString(),
      });
    }
  }
  groups.sort((a, b) => b.score - a.score || b.count - a.count || Date.parse(b.newest) - Date.parse(a.newest));
  return { groups, info };
}

/* ---------- Hauptablauf ---------- */
async function main() {
  const cfg = JSON.parse(await readFile(join(ROOT, "feeds.json"), "utf8"));
  const feeds = cfg.feeds.filter((f) => f.enabled !== false);
  const rulesets = cfg.rulesets || {};

  const results = await Promise.allSettled(feeds.map(async (f) => parseFeed(await fetchText(f.url), f, rulesets)));

  const stats = { feedPaid: 0, pagePaid: 0, pageOk: 0, pageFail: 0, pageSkipped: 0 };
  const sources = [];
  let all = [];
  results.forEach((r, i) => {
    const f = feeds[i];
    const base = { name: f.name, section: f.section, topic: f.topic, region: f.region || null };
    if (r.status === "fulfilled") {
      const paid = r.value.filter((x) => x._paid).length;
      stats.feedPaid += paid;
      r.value.filter((x) => !x._paid).forEach((x) => { x._feed = i; all.push(x); });
      sources.push({ ...base, ok: true, count: r.value.length - paid, paid });
    } else {
      sources.push({ ...base, ok: false, error: String(r.reason?.message || r.reason) });
      console.warn(`Feed fehlgeschlagen: ${f.name} / ${f.topic} (${f.url}): ${r.reason?.message || r.reason}`);
    }
  });

  // Doppelte entfernen (je Bereich). Die Reihenfolge in feeds.json entscheidet: Spezielleres zuerst.
  const seen = { news: { link: new Set(), title: new Set() }, lesen: { link: new Set(), title: new Set() } };
  all = all.filter((it) => {
    const s = seen[it.section] || seen.news;
    const key = it.title.toLowerCase().replace(/[^a-zäöüß0-9]/g, "");
    if (s.link.has(it.link) || s.title.has(key)) return false;
    s.link.add(it.link);
    s.title.add(key);
    return true;
  });

  // Alter und Limit je Feed
  const now = Date.now();
  all = all
    .filter((it) => !it.date || Date.parse(it.date) >= now - (LIMITS[it.section] || LIMITS.news).maxAgeH * 3600 * 1000)
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const used = new Map();
  all = all.filter((it) => {
    const n = used.get(it._feed) || 0;
    if (n >= (LIMITS[it.section] || LIMITS.news).perFeed) return false;
    used.set(it._feed, n + 1);
    return true;
  });

  // Eine Quelle soll nicht alles dominieren: Limit je Quelle (neueste zuerst)
  const perSource = new Map();
  all = all.filter((it) => {
    const key = it.section + "|" + it.source;
    const n = perSource.get(key) || 0;
    if (n >= (LIMITS[it.section] || LIMITS.news).perSource) return false;
    perSource.set(key, n + 1);
    return true;
  });

  // Bezahlschranke per Seitenprüfung (nur Quellen mit "paywall": "check"), Ergebnisse werden gemerkt
  const checkFeeds = new Set(feeds.map((f, i) => (f.paywall === "check" ? i : -1)).filter((i) => i >= 0));
  const cache = await loadCache();
  const unknown = [];
  for (const it of all) {
    if (!checkFeeds.has(it._feed)) continue;
    const c = cache[it.link];
    if (c) it._verdict = c.p ? "paid" : "free";
    else unknown.push(it);
  }
  const queue = unknown.slice(0, MAX_PAGE_CHECKS);
  unknown.slice(MAX_PAGE_CHECKS).forEach((it) => { it._verdict = "skip"; });
  const deadline = Date.now() + CHECK_BUDGET_MS;
  await pool(queue, 6, async (it) => {
    if (Date.now() > deadline) { it._verdict = "skip"; return; }
    try {
      const paid = looksPaywalled(await readPage(it.link));
      cache[it.link] = { p: paid, t: Date.now() };
      it._verdict = paid ? "paid" : "free";
      stats.pageOk++;
    } catch {
      it._verdict = "fail"; // Prüfung nicht möglich: Artikel bleibt sichtbar
      stats.pageFail++;
    }
  });
  await saveCache(cache);

  all = all.filter((it) => {
    if (it._verdict === "paid") { stats.pagePaid++; return false; }
    if (it._verdict === "skip") { stats.pageSkipped++; return false; } // wird im nächsten Lauf geprüft
    return true;
  });

  // Fristen & Änderungen: Stichtage aus Kurztext oder Volltext, über Läufe hinweg gemerkt
  const fr = (cache.__fristen ||= { t: Date.now(), seen: {}, items: {} });
  fr.t = Date.now();
  const today = berlinToday(now);
  for (const [id, f] of Object.entries(fr.items)) if (daysBetween(today, f.deadline) < -FRIST.keepAfterD) delete fr.items[id];
  for (const [id, t] of Object.entries(fr.seen)) if (t < now - 21 * 24 * 3600 * 1000) delete fr.seen[id];
  const fristStats = { fromText: 0, fromPage: 0, fetched: 0, failed: 0 };
  const keepFrist = (it, d) => {
    fr.items[it.id] = { id: it.id, title: it.title, summary: it.summary, link: it.link, source: it.source, topic: it.topic, deadline: d.deadline, kind: d.kind };
  };
  const toRead = [];
  for (const it of all) {
    if (it.section !== "news" || fr.items[it.id]) continue;
    const alltagFeed = feeds[it._feed]?.topic === "alltag";
    if (!isFristCandidate(it, alltagFeed)) continue;
    const d = extractDeadline(it.title + ". " + it.summary, now);
    if (d) { keepFrist(it, d); fristStats.fromText++; fr.seen[it.id] = now; continue; }
    if (!fr.seen[it.id]) toRead.push({ it, alltagFeed });
  }
  toRead.sort((a, b) => (b.alltagFeed - a.alltagFeed) || (Date.parse(b.it.date) || 0) - (Date.parse(a.it.date) || 0));
  const frDeadline = Date.now() + FRIST.budgetMs;
  await pool(toRead.slice(0, FRIST.maxFetch), 6, async ({ it }) => {
    if (Date.now() > frDeadline) return;
    try {
      const d = extractDeadline(pageText(await readPage(it.link)), now);
      fr.seen[it.id] = now;
      fristStats.fetched++;
      if (d) { keepFrist(it, d); fristStats.fromPage++; }
    } catch {
      fristStats.failed++; // beim nächsten Lauf nochmal versuchen
    }
  });
  await saveCache(cache);
  const fristen = dedupeFristen(Object.values(fr.items)
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.title.localeCompare(b.title)))
    .slice(0, FRIST.maxItems)
    .map((f) => ({ ...f, summary: truncate(f.summary || "", 200) }));

  // Pro Bereich begrenzen
  const count = { news: 0, lesen: 0 };
  const kept = [];
  for (const it of all) {
    const sec = it.section;
    if (count[sec] >= (LIMITS[sec] || LIMITS.news).max) continue;
    count[sec]++;
    kept.push(it);
  }

  // Schlagzeilen aus den behaltenen Nachrichten, danach Hilfsfelder entfernen
  const { groups, info } = groupHeadlines(kept.filter((it) => it.section === "news"), HEADLINES, now);
  const items = kept.map(({ _feed, _paid, _verdict, _top, ...pub }) => pub);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    updated: new Date().toISOString(),
    stats: { paywallRemoved: stats.feedPaid + stats.pagePaid },
    sources,
    items,
    groups,
    fristen,
  }));

  console.log(`FRISTEN: ${fristen.length} aktiv (aus Kurztext ${fristStats.fromText}, aus Volltext ${fristStats.fromPage}, Seiten geladen ${fristStats.fetched}, fehlgeschlagen ${fristStats.failed})`);
  fristen.slice(0, 8).forEach((f) => console.log(`  ${f.deadline} ${f.kind}: ${f.title} [${f.source}]`));
  const okFeeds = sources.filter((s) => s.ok).length;
  console.log(`${count.news} Nachrichten und ${count.lesen} Lese-Artikel aus ${okFeeds}/${sources.length} Feeds gespeichert.`);
  console.log(`BEZAHLARTIKEL ENTFERNT: ${stats.feedPaid + stats.pagePaid} (Feed-Marker ${stats.feedPaid}, Seitenprüfung ${stats.pagePaid}) | Seiten geprüft: ${stats.pageOk}, nicht prüfbar: ${stats.pageFail}, zurückgestellt: ${stats.pageSkipped}`);
  // Action-Log: die stärksten Schlagzeilen, damit sich die Schwellen nachjustieren lassen
  const byId = new Map(items.map((it) => [it.id, it]));
  const perLang = Object.entries(info.perLang).map(([l, v]) => `${l}: ${v.n} Meldungen, Grenze ${v.cap}`).join(" | ");
  console.log(`SCHLAGZEILEN: ${groups.length} Gruppen aus ${info.considered} Meldungen der letzten ${HEADLINES.windowH} Stunden (${perLang})`);
  groups.slice(0, 10).forEach((g, i) => {
    const srcs = [...new Set(g.members.map((id) => byId.get(id).source))].join(", ");
    console.log(`  ${i + 1}. ${g.score} Pkt, ${g.count} Quellen, ${g.lang}/${g.topic}: ${byId.get(g.lead).title} [${srcs}]`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
