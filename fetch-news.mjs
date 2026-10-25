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
export function pickTopic(feed, title, summary, rulesets = {}) {
  const rules = rulesets[feed.rules] || [];
  const text = (title + " " + summary).toLowerCase();
  for (const r of rules) if (r.words.some((w) => text.includes(w))) return r.topic;
  return feed.topic;
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
      region: feed.section === "lesen" ? null : feed.region || "beide",
      lang: feed.lang || "de",
      topic: pickTopic(feed, title, summary, rulesets),
      date: isNaN(date) ? null : date.toISOString(),
      image: /\.(jpe?g|png|webp)/i.test(image) ? image : "",
      _paid: feedMarksPaid(title, b),
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

  // Pro Bereich begrenzen, Hilfsfelder entfernen
  const count = { news: 0, lesen: 0 };
  const items = [];
  for (const it of all) {
    const sec = it.section;
    if (count[sec] >= (LIMITS[sec] || LIMITS.news).max) continue;
    count[sec]++;
    const { _feed, _paid, _verdict, ...pub } = it;
    items.push(pub);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    updated: new Date().toISOString(),
    stats: { paywallRemoved: stats.feedPaid + stats.pagePaid },
    sources,
    items,
  }));

  const okFeeds = sources.filter((s) => s.ok).length;
  console.log(`${count.news} Nachrichten und ${count.lesen} Lese-Artikel aus ${okFeeds}/${sources.length} Feeds gespeichert.`);
  console.log(`BEZAHLARTIKEL ENTFERNT: ${stats.feedPaid + stats.pagePaid} (Feed-Marker ${stats.feedPaid}, Seitenprüfung ${stats.pagePaid}) | Seiten geprüft: ${stats.pageOk}, nicht prüfbar: ${stats.pageFail}, zurückgestellt: ${stats.pageSkipped}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
