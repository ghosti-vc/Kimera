// Kimera - películas, series, animes, dramas y donghuas desde kimeraweb.com.
// El sitio entrega el video directo (HLS) desde su propio servidor: no se usan reproductores externos.

const SITE = "https://kimeraweb.com";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const HOME_ROW = 18;
const enc = encodeURIComponent;

function log(...a) { try { kino.log(...a); } catch { /* el registro no debe romper nada */ } }
function tr(es, en) { return (typeof kino !== "undefined" && kino.lang === "en-US") ? en : es; }
function dec(s) { try { return decodeURIComponent(s); } catch { return String(s || ""); } }

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}
function stripTags(s) { return decodeEntities(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")); }
function httpsUrl(u) { const s = String(u || ""); return /^https?:\/\//i.test(s) ? s : undefined; }

// ---- Red ----------------------------------------------------------------------------------------
async function getText(url, extra) {
  let r;
  try {
    r = await kino.fetch(url, { headers: Object.assign({ "User-Agent": UA, "Accept-Language": "es-MX,es;q=0.9", Referer: SITE + "/" }, extra || {}) });
  } catch (e) {
    log("fetch falló " + url.slice(0, 80) + " " + String((e && e.message) || e).slice(0, 60));
    throw kino.error("unavailable", "fetch falló", { userMessage: tr("No se pudo abrir el sitio. Prueba de nuevo en un momento.", "Could not open the site. Try again in a moment.") });
  }
  if (!r.ok) {
    log("fetch " + url.slice(0, 80) + " status=" + r.status);
    const um = { userMessage: tr("El sitio respondió con el error " + r.status + ".", "The site answered with error " + r.status + ".") };
    if (r.status === 404) throw kino.error("not_found", "el sitio respondió 404", um);
    if (r.status === 429) throw kino.error("rate_limited", "el sitio respondió 429", um);
    throw kino.error("unavailable", "el sitio respondió " + r.status, um);
  }
  return r.text();
}
async function getJson(url) {
  const t = await getText(url, { Accept: "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest" });
  try { return JSON.parse(t); } catch (e) {
    log("json inválido " + url.slice(0, 80) + " inicio=" + t.slice(0, 80).replace(/\s+/g, " "));
    throw kino.error("unavailable", "respuesta no válida", { userMessage: tr("El sitio respondió algo inesperado.", "The site answered something unexpected.") });
  }
}
// Bloque <script type="application/json" id="..."> de la página.
function jsonBlock(html, id) {
  const m = new RegExp("<script[^>]*id=[\"']" + id + "[\"'][^>]*>([\\s\\S]*?)</script>", "i").exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// ---- Catálogo -----------------------------------------------------------------------------------
const TYPES = {
  movie: { kind: "movie", genre: "peliculas" },
  serie: { kind: "series", genre: "series" },
  anime: { kind: "series", genre: "anime" },
  drama: { kind: "series", genre: "doramas" },
  donghua: { kind: "series", genre: "anime" },
  short: { kind: "series", genre: "otros" },
};

function mkItem(o) {
  const path = String(o.title_url || o.url || "");
  const id = Number(o.id) || Number((/-(\d+)\/?$/.exec(path) || [])[1]);
  const name = stripTags(o.name || o.title || "");
  if (!id || !name || !path) return null;
  const t = TYPES[o.type] || (path.indexOf("/movies/") === 0 ? TYPES.movie : TYPES.serie);
  return {
    id: "k-" + id,
    ref: "t|" + enc(path) + "|" + id + "|" + enc(name.slice(0, 80)),
    title: name.slice(0, 200),
    kind: t.kind,
    genres: [t.genre],
    poster: httpsUrl(o.vertical_cover_url || o.cover_url),
  };
}

// Respaldo: tarjetas del HTML (<figure data-catalog-card> con enlace, portada y título).
function itemsFromHtml(html) {
  const out = [];
  const re = /<figure[^>]*data-catalog-card[^>]*>([\s\S]*?)<\/figure>/gi;
  let m;
  while ((m = re.exec(html))) {
    const b = m[1];
    const href = (/href="(\/[^"]+)"/.exec(b) || [])[1];
    const img = (/data-src="([^"]+)"/.exec(b) || [])[1];
    const name = (/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(b) || [])[1];
    if (!href) continue;
    const it = mkItem({ title_url: href, name: stripTags(name || ""), vertical_cover_url: img });
    if (it) out.push(it);
  }
  return out;
}

async function catalogPage(params, page) {
  const q = Object.keys(params).filter((k) => params[k]).map((k) => k + "=" + enc(params[k])).join("&");
  const html = await getText(SITE + "/catalog?" + q + (q ? "&" : "") + "page=" + page);
  const d = jsonBlock(html, "catalog-initial-data");
  let items = [];
  let hasNext = false;
  if (d && Array.isArray(d.items)) {
    items = d.items.map(mkItem).filter(Boolean);
    hasNext = !!d.has_next;
  } else {
    items = itemsFromHtml(html);
    hasNext = items.length >= 18;
  }
  return { items, hasNext };
}

const SECTIONS = {
  peliculas: { type: "movie", genre: "peliculas", title: ["Películas", "Movies"] },
  series: { type: "serie", genre: "series", title: ["Series", "Series"] },
  anime: { type: "anime", genre: "anime", title: ["Animes", "Anime"] },
  doramas: { type: "drama", genre: "doramas", title: ["Dramas", "Dramas"] },
  donghuas: { type: "donghua", genre: "anime", title: ["Donghuas", "Donghua"] },
};

export async function home() {
  await null;
  const ids = Object.keys(SECTIONS);
  const res = await Promise.allSettled(ids.map((id) => catalogPage({ type: SECTIONS[id].type, sort: "recent" }, 1)));
  const rows = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("home: falló " + ids[i] + " " + String((r.reason && r.reason.message) || r.reason).slice(0, 60)); return; }
    const items = r.value.items.slice(0, HOME_ROW);
    if (items.length) rows.push({ id: "row-" + ids[i], title: tr(SECTIONS[ids[i]].title[0], SECTIONS[ids[i]].title[1]), genre: SECTIONS[ids[i]].genre, ref: ids[i], items });
  });
  log("home filas=" + rows.length);
  if (!rows.length) throw kino.error("unavailable", "inicio sin resultados");
  return rows;
}

export async function browse(ref, cursor) {
  await null;
  const sec = SECTIONS[String(ref || "")];
  if (!sec) throw kino.error("not_found", "catálogo desconocido");
  const n = Math.max(1, parseInt(cursor, 10) || 1);
  const p = await catalogPage({ type: sec.type, sort: "recent" }, n);
  const out = { items: p.items };
  if (p.hasNext && p.items.length) out.next = String(n + 1);
  return out;
}

export async function search(query) {
  await null;
  const q = stripTags(query && query.q).slice(0, 100);
  if (!q) return [];
  const p = await catalogPage({ q }, 1);
  log("búsqueda: " + p.items.length + " resultados");
  return p.items;
}

// ---- Capítulos ----------------------------------------------------------------------------------
function parseRef(ref) {
  const p = String(ref || "").split("|");
  if (p[0] !== "t" || !p[1]) throw kino.error("not_found", "referencia desconocida");
  return { path: dec(p[1]), id: Number(p[2]) || 0, name: dec(p[3] || "") };
}

function numOf(v, dflt) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }

function pushEpisodes(out, season, seasonNo, titlePath) {
  (season.items || []).forEach((e) => {
    if (!e) return;
    const num = numOf(e.number, out.length + 1);
    const eno = Math.floor(num);
    const watch = String(e.url || (titlePath + "/watch/" + e.id + "/season-" + seasonNo + "/episode-" + eno));
    const poster = httpsUrl(e.poster_url || e.cover_url || e.thumbnail_url || e.image_url);
    out.push({
      season: seasonNo,
      number: eno,
      ref: "w|" + enc(watch),
      title: stripTags(e.name || "") || tr("Episodio ", "Episode ") + eno,
      poster,
    });
  });
}

export async function episodes(ref) {
  await null;
  const t = parseRef(ref);
  if (t.path.indexOf("/movies/") === 0) {
    return { series: { title: t.name }, episodes: [{ season: 1, number: 1, ref: "w|" + enc(t.path + "/watch"), title: tr("Película", "Movie") }] };
  }
  if (!t.id) throw kino.error("not_found", "referencia desconocida");
  const out = [];
  const seenSeason = new Set();
  let page = 1;
  // Páginas de temporadas; cada temporada trae su primera página de capítulos.
  for (let guard = 0; guard < 10; guard++) {
    const d = await getJson(SITE + "/api/titles/" + t.id + "/content?sort=asc&page=" + page);
    if (!d || d.success === false) throw kino.error("unavailable", (d && d.message) || "sin datos");
    for (const s of d.seasons || []) {
      if (seenSeason.has(s.id)) continue;
      seenSeason.add(s.id);
      const sno = Math.max(0, Math.floor(numOf(s.number, seenSeason.size)));
      const seasonNo = sno || 1;
      pushEpisodes(out, s, seasonNo, t.path);
      let pg = s.pagination || {};
      let more = pg.has_next;
      let next = pg.next_page || 2;
      for (let g2 = 0; more && g2 < 30; g2++) {
        const d2 = await getJson(SITE + "/api/titles/" + t.id + "/content?sort=asc&season_id=" + s.id + "&page=" + next);
        const s2 = (d2 && d2.seasons && d2.seasons[0]) || null;
        if (!s2) break;
        pushEpisodes(out, s2, seasonNo, t.path);
        pg = s2.pagination || {};
        more = pg.has_next;
        next = pg.next_page || next + 1;
      }
    }
    if (!d.has_next) break;
    page = d.next_page || page + 1;
  }
  const seen = new Set();
  const eps = out.filter((e) => { const k = e.season + "x" + e.number; if (seen.has(k)) return false; seen.add(k); return true; });
  eps.sort((a, b) => (a.season - b.season) || (a.number - b.number));
  log("episodios: " + eps.length);
  if (!eps.length) throw kino.error("not_found", "sin capítulos", { userMessage: tr("Este título aún no tiene capítulos.", "This title has no episodes yet.") });
  return { series: { title: t.name }, episodes: eps };
}

// ---- Reproducción -------------------------------------------------------------------------------
const LANG_ORDER = { lat: 0, latino: 0, cas: 1, castellano: 1, esp: 1, sub: 2, subtitulado: 2 };
function langRank(name) { const k = String(name || "").toLowerCase().trim(); return k in LANG_ORDER ? LANG_ORDER[k] : 5; }
function langLabel(name) {
  const k = String(name || "").toLowerCase().trim();
  if (k === "lat" || k === "latino") return "Latino";
  if (k === "cas" || k === "castellano" || k === "esp") return "Castellano";
  if (k === "sub" || k === "subtitulado") return "Subtitulado";
  return String(name || "");
}

function playHeaders() { return { Referer: SITE + "/", Origin: SITE, "User-Agent": UA }; }

function streamOf(url) {
  const hls = !/\.(mp4|mkv|webm)(\?|$)/i.test(url);
  return { url, mime: hls ? "application/x-mpegurl" : "video/mp4", headers: playHeaders() };
}

async function opensOk(url) {
  try {
    const r = await kino.fetch(url, { headers: playHeaders() });
    if (!r.ok) return false;
    const t = String(await r.text()).slice(0, 400);
    return /#EXTM3U/.test(t);
  } catch { return false; }
}

export async function resolve(ref) {
  await null;
  const p = String(ref || "").split("|");
  if (p[0] !== "w" || !p[1]) throw kino.error("not_found", "referencia desconocida");
  const path = dec(p[1]);
  const pick = p[2] || "";   // "c.o" = categoría y opción elegidas a mano en el menú de servidores
  const html = await getText(SITE + path);
  const d = jsonBlock(html, "content-data");
  const cats = (d && (d.playback || (d.item && d.item.playback_categories))) || [];
  if (!cats.length) throw kino.error("not_found", "sin reproducción", { userMessage: tr("Este título aún no tiene video disponible.", "This title has no video yet.") });

  // Todas las opciones válidas, con su idioma, ordenadas por idioma y luego por el orden del sitio.
  const opts = [];
  cats.forEach((c, ci) => {
    (c.playback_options || []).forEach((o, oi) => {
      if (!o || o.active === false || o.failed || o.ready === false) return;
      const u = httpsUrl(o.url);
      if (!u) return;
      if (!/hls|mp4|m3u8|file|storage/i.test(String(o.type || "")) && !/\.(m3u8|mp4)(\?|$)/i.test(u)) return;
      opts.push({ key: ci + "." + oi, url: u, lang: langLabel(c.name), rank: langRank(c.name), order: (c.order || 0) * 100 + (o.order || 0), name: o.name || "" });
    });
  });
  if (!opts.length) throw kino.error("not_found", "sin servidores", { userMessage: tr("Este título aún no tiene video disponible.", "This title has no video yet.") });
  opts.sort((a, b) => (a.rank - b.rank) || (a.order - b.order));

  let first = pick ? opts.find((o) => o.key === pick) : null;
  if (!first) {
    for (const o of opts.slice(0, 3)) {
      if (await opensOk(o.url)) { first = o; break; }
      log("resolve: " + o.lang + " no abrió");
    }
    if (!first) first = opts[0];
  }
  const out = streamOf(first.url);
  out.label = first.lang + (first.name ? " · " + first.name : "");
  const others = opts.filter((o) => o !== first).slice(0, 7);
  if (!pick && others.length) {
    out.alternatives = others.map((o) => ({ label: (o.lang + (o.name ? " · " + o.name : "")).slice(0, 48), ref: "w|" + enc(path) + "|" + o.key }));
  }
  log("resolve: " + opts.length + " opciones, uso " + first.lang);
  return out;
}
