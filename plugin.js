// Plugin de Kino: Fan Pelis (fanpelis.to) — v0.4.0
var BASE = "https://fanpelis.to";
var API = BASE + "/api/rest";
var RUTAS = { movies: "/peliculas/", tvshows: "/series/", animes: "/animes/" };

function limpiar(t) {
  return String(t == null ? "" : t).replace(/<[^>]*>/g, "").trim();
}
function urlImg(u) {
  if (!u) return null;
  u = u.replace(/\\/g, "");
  if (u.indexOf("http") === 0) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("/") === 0) return BASE + u;
  return BASE + "/" + u;
}
function itemDe(link, title, poster, year) {
  link = String(link || "").replace(BASE, "");
  if (link.indexOf("/") !== 0 || !title) return null;
  var esSerie = /\/(serie|series|tvshows)/.test(link);
  var esAnime = /\/anime/.test(link);
  return {
    id: link, ref: link,
    kind: (esSerie || esAnime) ? "series" : "movie",
    title: limpiar(title),
    poster: urlImg(poster),
    year: year ? parseInt(year, 10) : null
  };
}

// ---- respaldo: leer la página HTML del listado ----
function listarHtml(postType) {
  var ruta = RUTAS[postType] || RUTAS.movies;
  var out = [];
  try {
    var res = kino.fetch(BASE + ruta);
    // QuickJS no puede await dentro de sync; usamos versión async abajo
  } catch (e) {}
  return out;
}

async function listarApi(postType, page) {
  var u = API + "/listing?page=" + (page || 1) +
    "&post_type=" + encodeURIComponent(postType) + "&posts_per_page=24";
  var data = await getJson(u);
  if (!data) return [];
  var arr = null;
  if (Array.isArray(data)) arr = data;
  else arr = data.items || data.posts || data.results || data.data ||
    (data.data && data.data.posts) || null;
  if (!Array.isArray(arr)) return [];
  var items = [];
  for (var i = 0; i < arr.length; i++) {
    var o = arr[i] || {};
    var link = o.link || o.url || o.permalink ||
      (o.slug ? BASE + "/" + o.slug : "");
    var title = limpiar((o.title && (o.title.rendered || o.title)) ||
      o.post_title || o.name || o.titulo || "");
    var poster = (o.images && (o.images.poster || o.images.thumbnail)) ||
      o.poster || o.thumbnail || o.featured_image ||
      (o.episode_image && o.episode_image.url) || "";
    var it = itemDe(link, title, poster, o.year || o.release_year);
    if (it) items.push(it);
  }
  return items;
}

async function listarHtmlAsync(postType) {
  var ruta = RUTAS[postType] || RUTAS.movies;
  var res = await kino.fetch(BASE + ruta);
  var html = await res.text();
  var items = [];
  var re = /<a[^>]+href="((?:https?:\/\/[^"]+|)\/(?:pelicula|serie|tvshows|anime|movies|series)[^"]*)"[^>]*>[\s\S]{0,400}?<img[^>]*(?:data-src|src)="([^"]+)"[^>]*?(?:alt="([^"]*)")?[^>]*>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1].indexOf("http") === 0 ? m[1] : BASE + m[1];
    var alt = m[3] || "";
    if (!alt) {
      var tm = html.slice(m.index, m.index + 900).match(/alt="([^"]*)"/);
      alt = tm ? tm[1] : "";
    }
    if (!alt) continue;
    var it = itemDe(href, alt, m[2], null);
    if (it && !items.some(function (x) { return x.id === it.id; })) items.push(it);
    if (items.length >= 24) break;
  }
  return items;
}

async function getJson(url) {
  try {
    var res = await kino.fetch(url);
    var txt = await res.text();
    return JSON.parse(txt);
  } catch (e) { return null; }
}

async function listar(postType, page) {
  var items = await listarApi(postType, page);
  if (!items.length && (page || 1) === 1) items = await listarHtmlAsync(postType);
  return items;
}

// ---------- API de Kino ----------
export async function home() {
  var pelis = await listar("movies", 1);
  var series = await listar("tvshows", 1);
  var animes = await listar("animes", 1);
  var rows = [];
  if (pelis.length) rows.push({ id: "peliculas", title: "Películas", items: pelis.slice(0, 20), ref: "ruta:movies" });
  if (series.length) rows.push({ id: "series", title: "Series", items: series.slice(0, 20), ref: "ruta:tvshows" });
  if (animes.length) rows.push({ id: "animes", title: "Animes", items: animes.slice(0, 20), ref: "ruta:animes" });
  return rows;
}

export async function browse(ref, cursor) {
  var postType = String(ref || "").replace("ruta:", "") || "movies";
  var pag = parseInt(cursor || "1", 10) || 1;
  var items = await listar(postType, pag);
  return { items: items, next: items.length >= 24 ? String(pag + 1) : null };
}

export async function search(query) {
  var q = String(query || "").trim();
  if (!q) return { items: [] };
  var intentos = [
    API + "/listing?page=1&posts_per_page=24&search=" + encodeURIComponent(q),
    API + "/listing?page=1&posts_per_page=24&s=" + encodeURIComponent(q)
  ];
  for (var i = 0; i < intentos.length; i++) {
    var arr = await getJson(intentos[i]);
    if (!arr) continue;
    if (!Array.isArray(arr)) arr = arr.items || arr.posts || arr.results || arr.data ||
      (arr.data && arr.data.posts) || null;
    if (!Array.isArray(arr)) continue;
    var out = [];
    for (var j = 0; j < arr.length; j++) {
      var o = arr[j] || {};
      var link = o.link || o.url || o.permalink || (o.slug ? BASE + "/" + o.slug : "");
      var title = limpiar((o.title && (o.title.rendered || o.title)) ||
        o.post_title || o.name || o.titulo || "");
      var poster = (o.images && (o.images.poster || o.images.thumbnail)) ||
        o.poster || o.thumbnail || o.featured_image || "";
      var it = itemDe(link, title, poster, o.year);
      if (it) out.push(it);
    }
    if (out.length) return { items: out };
  }
  // respaldo: buscar en el HTML
  var res = await kino.fetch(BASE + "/?s=" + encodeURIComponent(q));
  var html = await res.text();
  var out2 = [];
  var re = /<a[^>]+href="((?:https?:\/\/[^"]+|)\/(?:pelicula|serie|tvshows|anime|movies|series)[^"]*)"[^>]*>[\s\S]{0,400}?<img[^>]*(?:data-src|src)="([^"]+)"[^>]*?alt="([^"]*)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href2 = m[1].indexOf("http") === 0 ? m[1] : BASE + m[1];
    var it2 = itemDe(href2, m[3], m[2], null);
    if (it2 && !out2.some(function (x) { return x.id === it2.id; })) out2.push(it2);
    if (out2.length >= 24) break;
  }
  return { items: out2 };
}

export async function episodes(ref) {
  var urls = [
    BASE + "/wp-json/wpf/v1/episodes?post_id=" + encodeURIComponent(ref),
    BASE + "/wp-json/wpf/v1/episodes?id=" + encodeURIComponent(ref)
  ];
  for (var i = 0; i < urls.length; i++) {
    var data = await getJson(urls[i]);
    if (!data) continue;
    var arr = Array.isArray(data) ? data : (data.episodes || data.items || data.data);
    if (!Array.isArray(arr) || !arr.length) continue;
    var eps = [];
    for (var j = 0; j < arr.length; j++) {
      var e = arr[j] || {};
      var title = limpiar(e.title || e.post_title || e.name || ("Episodio " + (e.number || (j + 1))));
      var link = e.link || e.url || e.permalink || "";
      if (link.indexOf("http") !== 0 && link.indexOf("/") === 0) link = BASE + link;
      var num = title.match(/(\d+)\s*[x×]\s*(\d+)/i);
      eps.push({
        ref: link ? String(link).replace(BASE, "") : (e.id ? String(e.id) : ""),
        title: title,
        season: e.season || (num ? parseInt(num[1], 10) : 1),
        number: e.number || e.episode || (num ? parseInt(num[2], 10) : (j + 1)),
        poster: urlImg(e.thumbnail || e.poster || "")
      });
    }
    if (eps.length) return { episodes: eps };
  }
  return { episodes: [] };
}

export async function resolve(ref) {
  if (!ref) throw kino.error("not_found");
  var url = ref.indexOf("http") === 0 ? ref : BASE + ref;
  var res = await kino.fetch(url);
  var html = await res.text();
  var m3u8 = extraerM3u8(html);
  if (m3u8) return { url: m3u8, mime: "application/vnd.apple.mpegurl" };
  var iframes = kino.html.select(html, "iframe");
  for (var i = 0; i < iframes.length; i++) {
    var src = iframes[i].getAttribute("src");
    if (!src) continue;
    if (src.indexOf("http") !== 0) src = "https:" + src;
    try {
      var r2 = await kino.fetch(src);
      var h2 = await r2.text();
      var m = extraerM3u8(h2);
      if (m) return { url: m, mime: "application/vnd.apple.mpegurl" };
    } catch (e) {}
  }
  var mp4 = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
  if (mp4) return { url: mp4[0] };
  throw kino.error("unavailable");
}

function extraerM3u8(html) {
  var m = html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
  if (!m) {
    var f = html.match(/file\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/);
    if (f) return limpiarM3u8(f[1]);
    var plano = html.replace(/["']\s*\+\s*["']/g, "");
    var m3 = plano.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
    if (m3) return limpiarM3u8(m3[0]);
    return null;
  }
  return limpiarM3u8(m[0]);
}

function limpiarM3u8(u) {
  if (/(spix|adangle|pinup|preroll)/.test(u)) return null;
  return u.replace(/\\/g, "");
}
