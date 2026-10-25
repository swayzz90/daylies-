// Holt alle aktivierten RSS/Atom-Feeds und schreibt data/news.json.
// Läuft in der GitHub Action, braucht keine Abhängigkeiten (Node 20+).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "news.json");
const MAX_AGE_HOURS = 72;
const MAX_ITEMS = 400;

const feeds = JSON.parse(await readFile(join(ROOT, "scripts", "feeds.json"), "utf8"))
  .filter((f) => f.enabled !== false);

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
function truncate(s, n = 280) {
  if (s.length <= n) return s;
  return s.slice(0, s.lastIndexOf(" ", n)) + " …";
}
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function parseFeed(xml, feed) {
  const items = [];
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const atom = blocks.length === 0;
  const list = atom ? [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]) : blocks;

  for (const b of list) {
    const title = clean(tag(b, "title"));
    let link = atom ? attr(b, "link", "href") : clean(tag(b, "link"));
    if (!link) link = clean(tag(b, "guid"));
    if (!title || !/^https?:/.test(link)) continue;

    const summary = truncate(clean(tag(b, "description") || tag(b, "summary") || tag(b, "content")));
    const dateRaw = clean(tag(b, "pubDate") || tag(b, "dc:date") || tag(b, "updated") || tag(b, "published"));
    const date = new Date(dateRaw);
    const image =
      attr(b, "enclosure", "url") || attr(b, "media:content", "url") || attr(b, "media:thumbnail", "url") || "";

    items.push({
      id: hash(link),
      title,
      summary: summary === title ? "" : summary,
      link,
      source: feed.name,
      category: feed.category,
      date: isNaN(date) ? null : date.toISOString(),
      image: /\.(jpe?g|png|webp)/i.test(image) ? image : "",
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "DailyBrain/1.0 (privater RSS-Leser)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseFeed(await res.text(), feed);
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const sources = [];
  let all = [];
  results.forEach((r, i) => {
    const f = feeds[i];
    if (r.status === "fulfilled") {
      all.push(...r.value);
      sources.push({ name: f.name, category: f.category, ok: true, count: r.value.length });
    } else {
      sources.push({ name: f.name, category: f.category, ok: false, error: String(r.reason?.message || r.reason) });
      console.warn(`Feed fehlgeschlagen: ${f.name} (${f.category}): ${r.reason}`);
    }
  });

  // Doppelte Links und doppelte Überschriften entfernen
  const seenLinks = new Set();
  const seenTitles = new Set();
  all = all.filter((it) => {
    const key = it.title.toLowerCase().replace(/[^a-zäöüß0-9]/g, "");
    if (seenLinks.has(it.link) || seenTitles.has(key)) return false;
    seenLinks.add(it.link);
    seenTitles.add(key);
    return true;
  });

  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;
  all = all
    .filter((it) => !it.date || Date.parse(it.date) >= cutoff)
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .slice(0, MAX_ITEMS);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), sources, items: all }));
  console.log(`${all.length} Meldungen aus ${sources.filter((s) => s.ok).length}/${sources.length} Feeds gespeichert.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
