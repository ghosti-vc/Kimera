// Plugin de Kino: Fan Pelis (fanpelis.to)
// OJO: este es el primer borrador. Los selectores HTML (SELECTOR_...) son
// adivinados porque el sitio bloquea mi lector web. Hay que ajustarlos con el
// HTML real de fanpelis.to antes de probar en Kino.

var BASE = "https://fanpelis.to";

// ---- utilidades ----
function urlPagina(ruta, pag) {
  var u = BASE + ruta;
  if (pag && pag > 1) u += (ruta.indexOf("?") >= 0 ? "&" : "?") + "page=" + pag;
  return u;
}

function refDe(href) {
  // ref = la ruta del título, p.ej. "/pelicula/ejemplo"
  if (!href) return "";
  if (href.indexOf("http") === 0) href = href.slice(BASE.length);
  return href;
}

// ---- búsqueda ----
export async function search(query) {
  await kino.sleep(1); // primero await, luego validar (regla de Kino)
  var q = String(query || "").trim();
  if (!q) return { items: [] };
  var res = await kino.fetch(BASE + "/search?q=" + encodeURIComponent(q));
  var html = await res.text();
  var nodos = kino.html.select(html, SELECTOR_RESULTADO);
  var items = [];
  for (var i = 0; i < nodos.length && items.length < 100; i++) {
    var a = nodos[i];
    var href = a.getAttribute("href");
    var title = a.getAttribute("title") || textoDe(a);
    if (!href || !title) continue;
    items.push(itemDe(refDe(href), title, a));
  }
  return { items: kino.rank ? kino.rank.sortBySimilarity(items, q) : items };
}

// ---- Inicio ----
export async function home() {
  await kino.sleep(1);
  return [
    filaDe("Películas", "/peliculas", "peliculas"),
    filaDe("Series", "/series", "series"),
    filaDe("Últimas agregadas", "/home", null)
  ];
}

function filaDe(titulo, ruta, genre) {
  var fila = { title: titulo, ref: "ruta:" + ruta, items: [] };
  if (genre) fila.genre = genre;
  return fila;
}

// ---- explorar (filas de Inicio y categorías) ----
export async function browse(ref, cursor) {
  await kino.sleep(1);
  var pag = 1;
  if (cursor) { try { pag = parseInt(cursor, 10) || 1; } catch (e) { pag = 1; } }
  var ruta = String(ref || "").replace("ruta:", "") || "/home";
  var res = await kino.fetch(urlPagina(ruta, pag));
  var html = await res.text();
  var nodos = kino.html.select(html, SELECTOR_TARJETA);
  var items = [];
  for (var i = 0; i < nodos.length && items.length < 100; i++) {
    var it = itemDeTarjeta(nodos[i]);
    if (it) items.push(it);
  }
  return { items: items, next: items.length >= 24 ? String(pag + 1) : null };
}

// ---- capítulos (series) ----
export async function episodes(ref) {
  await kino.sleep(1);
  var res = await kino.fetch(BASE + ref);
  var html = await res.text();
  var filas = kino.html.select(html, SELECTOR_EPISODIO);
  var eps = [];
  for (var i = 0; i < filas.length; i++) {
    var a = filas[i];
    var href = a.getAttribute("href");
    var num = textoDe(a).match(/(\d+)\s*x\s*(\d+)/i); // "1x2" temporada x capítulo
    eps.push({
      ref: refDe(href),
      title: textoDe(a),
      season: num ? parseInt(num[1], 10) : 1,
      number: num ? parseInt(num[2], 10) : (i + 1)
    });
  }
  return { episodes: eps };
}

// ---- resolver el video ----
export async function resolve(ref) {
  await kino.sleep(1);
  if (!ref) throw kino.error("not_found");
  var url = ref.indexOf("http") === 0 ? ref : BASE + ref;
  var res = await kino.fetch(url);
  var html = await res.text();
  // 1) buscar un iframe del reproductor
  var iframes = kino.html.select(html, SELECTOR_IFRAME);
  if (iframes.length && iframes[0].getAttribute("src")) {
    return await resolverIframe(iframes[0].getAttribute("src"));
  }
  // 2) buscar un enlace directo m3u8/mp4 en el HTML
  var m = html.match(/https?:\/\/[^"'\\s]+\.m3u8[^"'\\s]*/);
  if (m) return { url: m[0], kind: "hls" };
  var m2 = html.match(/https?:\/\/[^"'\\s]+\.mp4[^"'\\s]*/);
  if (m2) return { url: m2[0], kind: "file" };
  throw kino.error("unavailable");
}

async function resolverIframe(src) {
  if (src.indexOf("http") !== 0) src = "https:" + src;
  var res = await kino.fetch(src);
  var html = await res.text();
  var m3u8 = extraerM3u8(html);
  if (m3u8) return { url: m3u8, kind: "hls" };
  throw kino.error("unavailable");
}

// Vimeos.net usa JWPlayer (jw8). El m3u8 (en vimeos.zip) suele estar en la
// config del player: "file":"https://vimeos.zip/hls2/.../master.m3u8?t=..."
// A veces viene ofuscado (string dividido o eval) -> probamos varias formas.
function extraerM3u8(html) {
  // 1) URL directa del m3u8 en cualquier parte del HTML/JS
  var m = html.match(/https?:\/\/[\w.-]*(?:vimeos\.net|vimeos\.zip|vimeos)\.[\w.]+\/[^"'\\\s]*\.m3u8[^"'\\\s]*/);
  if (!m) m = html.match(/https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*/);
  if (m) return limpiarM3u8(m[0]);
  // 2) config de JWPlayer: "file": "..." o sources:[{file:"..."}]
  var f = html.match(/file\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/);
  if (f) return limpiarM3u8(f[1]);
  // 3) string partido con + concatenado (p.ej. "https://vime"+"os.zip/...")
  var plano = html.replace(/["']\s*\+\s*["']/g, "");
  var m3 = plano.match(/https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*/);
  if (m3) return limpiarM3u8(m3[0]);
  return null;
}

function limpiarM3u8(u) {
  // descartar URLs de anuncios (spix/adangle/cdn de pre-roll)
  if (/(spix|adangle|pinup|preroll)/.test(u)) return null;
  return u.replace(/\\/g, "");
}

// ---- ayuda para armar ítems ----
function itemDeTarjeta(nodo) {
  var a = nodo.tagName === "A" ? nodo : kino.html.select(nodo.getAttribute ? nodo.outerHTML : "", "a")[0] || nodo;
  var href = nodo.getAttribute("href") || (a && a.getAttribute("href"));
  var title = nodo.getAttribute("title") || textoDe(nodo);
  if (!href || !title) return null;
  return itemDe(refDe(href), title, nodo);
}

function itemDe(ref, title, nodo) {
  var img = nodo.getAttribute && nodo.getAttribute("data-src") || null;
  var esSerie = ref.indexOf("/serie") === 0 || ref.indexOf("/series/") === 0;
  return {
    id: ref,
    ref: ref,
    kind: esSerie ? "series" : "movie",
    title: title,
    poster: img,
    // PENDIENTE: año, géneros e ids.tmdb si el sitio los trae
  };
}

function textoDe(nodo) {
  try { return String(nodo.textContent || "").trim(); } catch (e) { return ""; }
}

// ---- selectores (ADIVINADOS — ajustar con el HTML real) ----
var SELECTOR_RESULTADO = ".result-item a, .item a, a.movie, a.serie";
var SELECTOR_TARJETA = ".item, .movie-item, .card, article";
var SELECTOR_EPISODIO = ".episodes a, .ep-item, a.episode";
var SELECTOR_IFRAME = "iframe.player, iframe[src*='embed'], .player iframe, iframe";
