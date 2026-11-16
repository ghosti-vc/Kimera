// Plugin de Kino: Fan Pelis (fanpelis.to)
// Versión 0.4.0 — catálogo/búsqueda con TMDB (kino.tmdb integrado de Kino),
// TODOS los servidores de fanpelis.to como copias etiquetadas (apiVersion 6)
// y resolución perezosa al elegir servidor en el menú.
// Si kino.tmdb no está disponible (Kino viejo), la búsqueda cae a fanpelis.

var BASE = "https://fanpelis.to";
var API = BASE + "/api/rest";

// ---------- utilidades ----------

function limpiar(t) {
  return String(t == null ? "" : t)
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "–")
    .trim();
}

function urlImg(u) {
  if (!u) return null;
  if (u.indexOf("http") === 0) return u;
  if (u.indexOf("/") === 0) return BASE + u;
  return BASE + "/wp-content/uploads/" + u;
}

function itemDe(o) {
  if (!o) return null;
  var link = o.link || o.url || o.permalink || o.slug_url || "";
  if (!link && o.slug) link = BASE + "/" + o.slug;
  if (link.indexOf("http") !== 0 && link.indexOf("/") === 0) link = BASE + link;
  var title = limpiar(
    (o.title && (o.title.rendered || o.title)) ||
    o.post_title || o.name || o.titulo || ""
  );
  if (!link || !title) return null;
  var ref = link.replace(BASE, "") || link;
  var poster = urlImg(
    (o.images && (o.images.poster || o.images.thumbnail)) ||
    o.poster || o.thumbnail || o.featured_image ||
    (o.episode_image && o.episode_image.url) ||
    ""
  );
  var esSerie =
    ref.indexOf("/serie") === 0 || ref.indexOf("/series/") === 0 ||
    o.type === "tvshows" || o.post_type === "tvshows";
  var esAnime =
    ref.indexOf("/anime") === 0 || o.type === "animes" || o.post_type === "animes";
  return {
    id: String(o.id || o.ID || ref),
    ref: ref,
    kind: (esSerie || esAnime) ? "series" : "movie",
    title: title,
    poster: poster,
    year: o.year || o.release_year || null,
    rating: o.imdbRating || o.rating || null,
    genres: Array.isArray(o.genres) ? o.genres.map(function (g) {
      return (g && (g.name || g)) || "";
    }).filter(Boolean) : null
  };
}

// GET JSON genérico
async function getJson(url) {
  var res = await kino.fetch(url);
  var txt = await res.text();
  try { return JSON.parse(txt); } catch (e) { return null; }
}

// ---------- listados (Inicio y categorías) ----------

// listing?page=N&post_type=X&posts_per_page=24
// post_type: movies | tvshows | animes
async function listar(postType, page, extra) {
  var u = API + "/listing?page=" + (page || 1) +
    "&post_type=" + encodeURIComponent(postType) +
    "&posts_per_page=24";
  if (extra) u += "&" + extra;
  var data = await getJson(u);
  if (!data) return [];
  // la lista puede venir en data, items, posts, results o data.posts, etc.
  var arr = data.items || data.posts || data.results || data.data ||
    (data.data && data.data.posts) || null;
  if (Array.isArray(data)) arr = data;
  if (!Array.isArray(arr)) return [];
  var items = [];
  for (var i = 0; i < arr.length; i++) {
    var it = itemDe(arr[i]);
    if (it) items.push(it);
  }
  return items;
}

// ---------- API de Kino ----------

// Inicio: filas del catálogo
export async function home() {
  await kino.sleep(1);
  return [
    { title: "Películas", ref: "ruta:movies", genre: "peliculas" },
    { title: "Series", ref: "ruta:tvshows", genre: "series" },
    { title: "Animes", ref: "ruta:animes", genre: "animes" }
  ];
}

// Explorar filas y categorías (con paginación por cursor)
export async function browse(ref, cursor) {
  await kino.sleep(1);
  var postType = String(ref || "").replace("ruta:", "") || "movies";
  var pag = parseInt(cursor || "1", 10) || 1;
  var items = await listar(postType, pag);
  return { items: items, next: items.length >= 24 ? String(pag + 1) : null };
}

// Búsqueda: primero TMDB (catálogo completo y confiable); si kino.tmdb no
// existe o falla, se usa la búsqueda de fanpelis.
export async function search(query) {
  await kino.sleep(1);
  var q = String(query || "").trim();
  if (!q) return { items: [] };
  var tmdb = await tmdbBuscar(q);
  if (tmdb && tmdb.length) return { items: tmdb };
  var intentos = [
    API + "/listing?page=1&posts_per_page=24&search=" + encodeURIComponent(q),
    API + "/listing?page=1&posts_per_page=24&s=" + encodeURIComponent(q)
  ];
  for (var i = 0; i < intentos.length; i++) {
    var items = await getJson(intentos[i]);
    if (items) {
      var data = items.items || items.posts || items.results || items.data ||
        (items.data && items.data.posts) || null;
      if (Array.isArray(items)) data = items;
      var out = [];
      if (Array.isArray(data)) {
        for (var j = 0; j < data.length; j++) {
          var it = itemDe(data[j]);
          if (it) out.push(it);
        }
        if (out.length) return { items: out };
      }
    }
  }
  return { items: [] };
}

// Capítulos de una serie. La API auxiliar del sitio es
// https://fanpelis.to/wp-json/wpf/v1/episodes — probamos con los nombres
// de parámetro más probables.
export async function episodes(ref) {
  await kino.sleep(1);
  var urls = [
    BASE + "/wp-json/wpf/v1/episodes?post_id=" + encodeURIComponent(ref),
    BASE + "/wp-json/wpf/v1/episodes?id=" + encodeURIComponent(ref),
    BASE + "/wp-json/wpf/v1/episodes?post=" + encodeURIComponent(ref)
  ];
  for (var i = 0; i < urls.length; i++) {
    var data = await getJson(urls[i]);
    if (!data) continue;
    var arr = Array.isArray(data) ? data : (data.episodes || data.items || data.data);
    if (Array.isArray(arr) && arr.length) return { episodes: episodiosDe(arr) };
  }
  return { episodes: [] };
}

function episodiosDe(arr) {
  var eps = [];
  for (var i = 0; i < arr.length; i++) {
    var e = arr[i] || {};
    var title = limpiar(e.title || e.post_title || e.name || ("Episodio " + (e.number || (i + 1))));
    var link = e.link || e.url || e.permalink || "";
    if (link.indexOf("http") !== 0 && link.indexOf("/") === 0) link = BASE + link;
    var num = title.match(/(\d+)\s*[x×]\s*(\d+)/i);
    eps.push({
      ref: link ? link.replace(BASE, "") : (e.id ? String(e.id) : ""),
      title: title,
      season: e.season || (num ? parseInt(num[1], 10) : 1),
      number: e.number || e.episode || (num ? parseInt(num[2], 10) : (i + 1)),
      poster: urlImg(e.thumbnail || e.poster || "")
    });
  }
  return eps;
}

// Resolver el video de un título o capítulo.
// 1) Vía oficial (API player): pide TODOS los embeds/servidores.
// 2) Intenta el HTML del permalink (a veces incrusta la config del player).
// 3) Extrae m3u8 (vimeos.net / vimeos.zip, JWPlayer) o iframe.

// Etiqueta legible para el menú "Servidor" de Kino.
function nombreServidor(emb, i) {
  var u = (emb && (emb.url || emb.src)) || "";
  var host = (u.match(/https?:\/\/([^\/'"]+)/) || [])[1] || "servidor " + (i + 1);
  var partes = [host];
  if (emb.lang) partes.push(String(emb.lang));
  if (emb.quality) partes.push(String(emb.quality));
  return partes.join(" · ");
}

// Resuelve UN embed concreto de un post: devuelve stream o null.
async function resolverEmbed(emb) {
  if (!emb) return null;
  var eu = emb.url || emb.src || "";
  if (!eu) return null;
  if (eu.indexOf("http") !== 0) eu = "https:" + eu;
  if (/\.m3u8/i.test(eu)) {
    var limpio = limpiarM3u8(eu);
    return limpio ? { url: limpio, kind: "hls" } : null;
  }
  try {
    var r = await kino.fetch(eu);
    var h = await r.text();
    var m = extraerM3u8(h);
    return m ? { url: m, kind: "hls" } : null;
  } catch (err) {
    return null; // servidor caído o bloqueado
  }
}

// Devuelve los embeds de un post vía la API oficial del APK:
// GET /api/rest/player?post_id=ID&_any=N -> { data: { embeds: [...] } }.
async function embedsDePost(postId) {
  var pj = await getJson(API + "/player?post_id=" + postId + "&_any=0");
  if (!pj) return [];
  var embs = (pj.data && pj.data.embeds) || pj.embeds || [];
  return Array.isArray(embs) ? embs : [];
}

export async function resolve(ref) {
  await kino.sleep(1);
  if (!ref) throw kino.error("not_found");

  // Copia perezosa: "servidor|<postId>|<índice>" — el usuario eligió otro
  // servidor en el menú; Kino llama resolve solo con ese.
  if (ref.indexOf("servidor|") === 0) {
    var p = ref.split("|");
    var embs2 = await embedsDePost(p[1]);
    var st = await resolverEmbed(embs2[parseInt(p[2], 10)]);
    if (st) return st;
    throw kino.error("unavailable");
  }

  // Ítem que vino de TMDB: primero encontramos su página en fanpelis.
  if (ref.indexOf("tmdb:") === 0) {
    ref = await refFanpelisDeTmdb(ref);
    if (!ref) throw kino.error("unavailable");
  }
  var url = ref.indexOf("http") === 0 ? ref : BASE + ref;
  var res = await kino.fetch(url);
  var html = await res.text();

  // Vía oficial: la API player devuelve TODOS los servidores del título.
  // El primero que responde se reproduce; los demás van como copias
  // perezosas { label, ref } en el menú "Servidor" de Kino.
  var pid = html.match(/postid-(\d+)/) || html.match(/data-post-id="(\d+)"/) ||
            html.match(/["']?ID["']?\s*[:=]\s*(\d{2,})/);
  if (pid) {
    var embs = await embedsDePost(pid[1]);
    if (embs.length) {
      var principal = null;
      var demas = [];
      for (var e = 0; e < embs.length; e++) {
        if (principal) {
          // resto de servidores: perezosos, se resuelven al elegirlos
          demas.push({
            label: nombreServidor(embs[e], e),
            ref: "servidor|" + pid[1] + "|" + e
          });
        } else {
          principal = await resolverEmbed(embs[e]);
          if (principal) {
            principal.label = nombreServidor(embs[e], e);
          }
        }
      }
      if (principal) {
        if (demas.length) principal.alternatives = demas;
        return principal;
      }
    }
  }

  // Fallback: extraer del HTML de la página.
  var m3u8 = extraerM3u8(html);
  if (m3u8) return { url: m3u8, kind: "hls" };
  // iframe del reproductor
  var iframes = kino.html.select(html, "iframe.player, iframe[src*='embed'], .player iframe, iframe");
  for (var i = 0; i < iframes.length; i++) {
    var src = iframes[i].getAttribute("src");
    if (!src) continue;
    if (src.indexOf("http") !== 0) src = "https:" + src;
    var r2 = await kino.fetch(src);
    var h2 = await r2.text();
    var m = extraerM3u8(h2);
    if (m) return { url: m, kind: "hls" };
  }
  var mp4 = html.match(/https?:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*/);
  if (mp4) return { url: mp4[0], kind: "file" };
  throw kino.error("unavailable");
}

// Vimeos (JWPlayer): el m3u8 suele estar en la config del player
// ("file":"https://vimeos.zip/hls2/.../master.m3u8?t=..."), a veces ofuscado.
function extraerM3u8(html) {
  var m = html.match(/https?:\/\/[\w.-]*(?:vimeos\.net|vimeos\.zip|vimeos)\.[\w.]+\/[^"'\\\s]*\.m3u8[^"'\\\s]*/);
  if (!m) m = html.match(/https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*/);
  if (m) return limpiarM3u8(m[0]);
  var f = html.match(/file\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/);
  if (f) return limpiarM3u8(f[1]);
  var plano = html.replace(/["']\s*\+\s*["']/g, "");
  var m3 = plano.match(/https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*/);
  if (m3) return limpiarM3u8(m3[0]);
  return null;
}

function limpiarM3u8(u) {
  if (/(spix|adangle|pinup|preroll)/.test(u)) return null; // anuncios
  return u.replace(/\\\\/g, "");
}

// ---------- capa TMDB ----------

var TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Busca en TMDB usando el helper integrado de Kino. Devuelve ítems de Kino
// con ref "tmdb:movie:<título urlencoded>" o "tmdb:series:<título urlencoded>"
// (el resolve los convierte después en página de fanpelis).
async function tmdbBuscar(q) {
  if (typeof kino.tmdb !== "function") return null;
  var formas = [
    function () { return kino.tmdb.search(q); },
    function () { return kino.tmdb("search/multi", { query: q }); },
    function () { return kino.tmdb.searchMulti(q); }
  ];
  for (var i = 0; i < formas.length; i++) {
    var res = null;
    try { res = await formas[i](); } catch (e) { res = null; }
    var arr = extraerArray(res);
    if (arr && arr.length) {
      var out = [];
      for (var j = 0; j < arr.length && out.length < 30; j++) {
        var it = itemTmdb(arr[j]);
        if (it) out.push(it);
      }
      if (out.length) return out;
    }
  }
  return null;
}

function extraerArray(res) {
  if (Array.isArray(res)) return res;
  if (!res) return null;
  if (Array.isArray(res.results)) return res.results;
  if (Array.isArray(res.items)) return res.items;
  if (res.data && Array.isArray(res.data.results)) return res.data.results;
  return null;
}

function itemTmdb(o) {
  if (!o || o.media_type === "person") return null;
  var esSerie = o.media_type === "tv" || o.name && !o.title;
  var title = o.title || o.name || "";
  if (!title) return null;
  var poster = o.poster_path ? TMDB_IMG + o.poster_path : null;
  return {
    id: "tmdb:" + (esSerie ? "tv" : "movie") + ":" + (o.id || 0),
    ref: "tmdb:" + (esSerie ? "series" : "movie") + ":" + encodeURIComponent(title),
    kind: esSerie ? "series" : "movie",
    title: String(title),
    poster: poster
  };
}

// De un ref "tmdb:...:<título>" saca el título y busca su página en fanpelis.
async function refFanpelisDeTmdb(ref) {
  var partes = ref.split(":");
  var titulo = "";
  try { titulo = decodeURIComponent(partes.slice(2).join(":")); } catch (e) { titulo = ""; }
  if (!titulo) return null;
  var r = await search(titulo);
  var items = (r && r.items) || [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it && it.ref && it.ref.indexOf("tmdb:") !== 0) return it.ref;
  }
  return null;
}
