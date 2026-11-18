// KimeraWeb 1.0.1 — plugin Kino (películas). Solo lee páginas públicas.
const BASE = "https://kimeraweb.com";
const UA = "Mozilla/5.0 (Linux; Android 13; SM-G970F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const MEDIA_RE = /["'`]((?:https?:)?\/\/[^"'`\s<>\\]+?\.(?:m3u8|mp4)(?:\?[^"'`\s<>\\]*)?)["'`]/gi;

function log(...a) { try { kino.log(...a); } catch (e) { /* no romper */ } }
function tr(es, en) { return kino.lang === "en-US" ? en : es; }
function fail(code, detail, es, en) { return kino.error(code, detail, { userMessage: tr(es, en) }); }

async function getText(url, referer) {
  const h = { "User-Agent": UA, "Accept-Language": "es", Accept: "text/html,*/*" };
  if (referer) h.Referer = referer;
  const r = await kino.fetch(url, { headers: h });
  if (!r.ok) {
    log("HTTP " + r.status + " " + url.slice(0, 60));
    throw fail(r.status === 404 ? "not_found" : "unavailable", "status " + r.status, "El sitio respondió con el error " + r.status + ".", "The site answered with error " + r.status + ".");
  }
  return await r.text();
}

function unesc(s) {
  return String(s || "").replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, "/").replace(/\\"/g, '"');
}

// Recorre desde `inicio` ({ o [) hasta cerrar, respetando textos.
function balancear(s, inicio) {
  let prof = 0, enStr = false, esc = false, fin = -1;
  for (let i = inicio; i < s.length; i++) {
    const c = s[i];
    if (enStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') enStr = false;
    } else if (c === '"') enStr = true;
    else if (c === "{" || c === "[") prof++;
    else if (c === "}" || c === "]") { prof--; if (prof === 0) { fin = i + 1; break; } }
  }
  return fin > 0 ? s.slice(inicio, fin) : null;
}

function absUrl(u) {
  let x = String(u || "").trim();
  if (x.startsWith("//")) x = "https:" + x;
  if (x.charAt(0) === "/") x = BASE + x;
  return /^https:\/\//i.test(x) ? x : "";
}

function decH(s) {
  return String(s || "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function cards(html) {
  const items = [];
  const seen = new Set();
  // Tarjetas en HTML: <a href="/movies/slug-123"> ... <img data-src="poster" alt="Título">
  const re = /<a\b[^>]*href="(\/movies\/[a-z0-9-]+-\d+)"[^>]*>([\s\S]{0,700}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (seen.has(m[1])) continue;
    const img = /<img\b[^>]*>/i.exec(m[2]);
    if (!img) continue;
    const alt = /\balt="([^"]+)"/i.exec(img[0]);
    const src = /\b(?:data-src|data-lazy-src|src)="([^"]+)"/i.exec(img[0]);
    const title = decH(alt ? alt[1] : "");
    if (!title) continue;
    seen.add(m[1]);
    items.push({ id: "km-" + m[1], ref: m[1], title: title.slice(0, 200), kind: "movie", genres: ["peliculas"], poster: src ? absUrl(decH(src[1])) || undefined : undefined });
  }
  // Respaldo: JSON embebido en la página.
  const re2 = /"url":"(\/movies\/[a-z0-9-]+-\d+)","name":"((?:[^"\\]|\\.)*)"/g;
  while ((m = re2.exec(html)) !== null) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    items.push({ id: "km-" + m[1], ref: m[1], title: unesc(m[2]).slice(0, 200), kind: "movie", genres: ["peliculas"] });
  }
  return items;
}

export async function home() {
  await null;
  const items = cards(await getText(BASE + "/movies/?page=1"));
  log("inicio: " + items.length);
  if (!items.length) throw fail("unavailable", "sin tarjetas", "No se pudo cargar el catálogo.", "Could not load the catalog.");
  return [{ id: "row-km", title: "KimeraWeb", genre: "peliculas", ref: "1", items }];
}

export async function browse(ref, cursor) {
  await null;
  const page = parseInt(cursor || ref, 10) || 1;
  const items = cards(await getText(BASE + "/movies/?page=" + page));
  return { items, nextCursor: items.length ? String(page + 1) : undefined };
}

export async function search(arg) {
  await null;
  const q = String((arg && (arg.q || arg.query)) || "").trim();
  if (!q) return [];
  const items = cards(await getText(BASE + "/search?q=" + encodeURIComponent(q) + "&page=1"));
  log("buscar " + q + " -> " + items.length);
  return items;
}

export async function episodes(ref) {
  await null;
  const id = String(ref || "");
  if (id.indexOf("/movies/") !== 0) throw fail("not_found", "referencia desconocida", "No se encontró este título.", "Title not found.");
  let title = "";
  try {
    const html = await getText(BASE + id);
    const t = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || /<title>([^<]*)<\/title>/i.exec(html);
    title = t ? t[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
  } catch (e) { /* el título no es obligatorio */ }
  return { series: { title }, episodes: [{ season: 1, number: 1, ref: id, title: tr("Película", "Movie") }] };
}

function hostsOf(html) {
  const out = [];
  const re = /"hosts":\s*\[/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const arr = balancear(html, m.index + m[0].length - 1);
    if (!arr) continue;
    try { out.push.apply(out, JSON.parse(arr)); } catch (e) { log("hosts: JSON no válido"); }
  }
  return out;
}

async function playlistOk(url, referer) {
  try {
    const r = await kino.fetch(url, { headers: { "User-Agent": UA, Referer: referer } });
    if (!r.ok) return null;
    const t = await r.text();
    if (t.indexOf("#EXTM3U") < 0) return null;
    return t;
  } catch (e) { return null; }
}

export async function resolve(ref) {
  await null;
  const id = String(ref || "");
  const page = BASE + id + "/watch";
  const hosts = hostsOf(await getText(page, BASE + id));
  log("hosts: " + hosts.map((h) => (h && h.type) + ":" + (h && h.name)).join(" , "));
  if (!hosts.length) throw fail("unavailable", "sin hosts", "Esta película no tiene servidores disponibles.", "No servers available for this title.");
  let disguised = false;
  for (const h of hosts) {
    const u = h && absUrl(h.url);
    if (!u) continue;
    const label = String(h.name || "KimeraWeb").slice(0, 40);
    const hdr = { Referer: u.indexOf(BASE) === 0 ? BASE + "/" : u, "User-Agent": UA };
    if (h.type === "iframe") {
      try {
        const t = (await getText(u, page)).replace(/\\\//g, "/");
        let mm; MEDIA_RE.lastIndex = 0;
        while ((mm = MEDIA_RE.exec(t))) {
          const mu = absUrl(mm[1]);
          if (mu) return { url: mu, mime: /\.m3u8/i.test(mu) ? "application/x-mpegurl" : "video/mp4", headers: { Referer: u, "User-Agent": UA }, label };
        }
      } catch (e) { log("iframe falló " + label); }
      continue;
    }
    for (const c of [u, u + "/index.m3u8", u + ".m3u8"]) {
      const t = await playlistOk(c, hdr.Referer);
      if (!t) continue;
      // Si los trozos vienen disfrazados de imagen, Kino no los puede abrir.
      if (/^[^#\n]*\.(?:png|jpe?g|gif|webp)(?:\?[^\n]*)?$/im.test(t)) { disguised = true; log("lista con trozos de imagen: " + label); break; }
      return { url: c, mime: "application/x-mpegurl", headers: hdr, label };
    }
  }
  if (disguised) throw fail("unavailable", "video disfrazado", "Los servidores de esta película usan un formato que Kino no puede reproducir.", "This title's servers use a format Kino cannot play.");
  throw fail("unavailable", "sin video", "No se encontró un video que se pueda reproducir.", "No playable video found.");
}
