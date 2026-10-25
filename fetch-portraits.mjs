// Holt Porträts der Personen aus Wikimedia Commons und schreibt portraits/portraits.json.
// Nur frei lizenzierte Bilder werden übernommen, Urheber und Lizenz werden mitgespeichert.
// Läuft in der GitHub Action (Node 20+), braucht keine Abhängigkeiten. Fehlt ein Bild, nutzt die App Initialen.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIR = join(ROOT, "portraits");
const INDEX = join(DIR, "portraits.json");
const WIKI = process.env.WIKI_BASE || "https://de.wikipedia.org";
const COMMONS = process.env.COMMONS_BASE || "https://commons.wikimedia.org";
const WIDTH = 420;
const MAX_BYTES = 600 * 1024;
const repo = process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : "privates Lernprojekt";
const UA = `DailyBrain/3.0 (${repo}; Lern-App, kleine Zahl von Abrufen pro Tag)`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function getImage(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`Bild HTTP ${res.status}`);
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type];
    if (!ext) throw new Error(`Bildtyp ${type || "unbekannt"}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error(`Bild zu groß (${Math.round(buf.length / 1024)} KB)`);
    return { buf, ext };
  } finally { clearTimeout(t); }
}

// Dateiname auf Commons aus der Bild-URL der Wikipedia ableiten. Nur Commons-Dateien sind frei nutzbar.
export function commonsFileName(src) {
  let u;
  try { u = new URL(src); } catch { return null; }
  const parts = u.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("commons");
  if (u.hostname !== "upload.wikimedia.org" && !u.hostname.startsWith("localhost") && u.hostname !== "127.0.0.1") return null;
  if (i < 0 || parts[i - 1] !== "wikipedia") return null; // z. B. /wikipedia/de/ = lokal hochgeladen, evtl. nicht frei
  const t = parts.indexOf("thumb");
  const name = t >= 0 ? parts[t + 3] : parts[parts.length - 1];
  return name ? decodeURIComponent(name) : null;
}

export function stripHtml(s = "") {
  return s.replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Nur klar freie Lizenzen akzeptieren
export function isFreeLicense(meta = {}) {
  const val = (k) => (meta[k]?.value ?? "").toString();
  if (/^(true|1|yes)$/i.test(val("NonFree"))) return false;
  const lic = val("LicenseShortName") || val("UsageTerms");
  return /^(CC0|CC[ -]BY|Public domain|PD[ -]|GFDL|Copyrighted free use|Attribution)/i.test(lic.trim());
}

async function fetchPortrait(p) {
  const title = encodeURIComponent(p.wiki.replace(/ /g, "_"));
  const sum = await getJson(`${WIKI}/api/rest_v1/page/summary/${title}`);
  const src = sum.originalimage?.source || sum.thumbnail?.source;
  if (!src) throw new Error("Artikel hat kein Bild");
  const name = commonsFileName(sum.thumbnail?.source || src) || commonsFileName(src);
  if (!name) throw new Error("Bild liegt nicht auf Commons (evtl. nicht frei)");

  const q = `${COMMONS}/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=${WIDTH}&titles=${encodeURIComponent("File:" + name)}`;
  const info = (await getJson(q)).query?.pages?.[0]?.imageinfo?.[0];
  if (!info) throw new Error("Keine Bildinfos auf Commons");
  const meta = info.extmetadata || {};
  if (!isFreeLicense(meta)) throw new Error(`Lizenz nicht eindeutig frei (${meta.LicenseShortName?.value || "unbekannt"})`);

  const { buf, ext } = await getImage(info.thumburl || info.url);
  const file = `portraits/${p.id}.${ext}`;
  await writeFile(join(ROOT, file), buf);
  return {
    file,
    artist: stripHtml(meta.Artist?.value).slice(0, 80) || "unbekannt",
    license: stripHtml(meta.LicenseShortName?.value) || "frei",
    licenseUrl: stripHtml(meta.LicenseUrl?.value) || "",
    page: info.descriptionurl || "",
    v: Date.now().toString(36),
  };
}

async function main() {
  const content = JSON.parse(await readFile(join(ROOT, "content.json"), "utf8"));
  const people = content.people.filter((p) => p.wiki);
  await mkdir(DIR, { recursive: true });

  let items = {};
  try { items = JSON.parse(await readFile(INDEX, "utf8")).items || {}; } catch { /* erster Lauf */ }
  // Einträge ohne Datei (z. B. Cache-Rest) verwerfen
  for (const id of Object.keys(items)) if (!(await exists(join(ROOT, items[id].file)))) delete items[id];

  const missing = [], fresh = [];
  for (const p of people) {
    if (items[p.id]) continue;
    try {
      items[p.id] = await fetchPortrait(p);
      fresh.push(p.id);
    } catch (e) {
      missing.push(`${p.id} (${e.message})`);
    }
    await sleep(250);
  }
  await writeFile(INDEX, JSON.stringify({ updated: new Date().toISOString(), items }));
  console.log(`PORTRÄTS: ${Object.keys(items).length} von ${people.length} vorhanden, neu geholt: ${fresh.length}`);
  if (missing.length) console.log(`Ohne Porträt:\n - ${missing.join("\n - ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
