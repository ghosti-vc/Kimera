// Plugin de Kino: Fan Pelis (fanpelis.to)
// Versión 0.2.0 — usa la API JSON del sitio:
//   https://fanpelis.to/api/rest/listing?page=1&post_type=movies&posts_per_page=16

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

async function getJson(url) {
  var res = await kino.fetch(url);
  var txt = await res.text();
  try { return JSON.parse(txt); } catch (e) { return null; }
}

// ---------- listados ----------

async function listar(postType, page, extra) {
  var u = API + "/listing?page=" + (page || 1) +
    "&post_type=" + encodeURIComponent(postType) +
    "&posts_per_page=24";
  if (extra) u += "&" + extra;
  var data = await getJson(u);
  if (!data) return [];
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

export async function home() {
  await kino.sleep(1);
  return [
    { title: "Películas", ref: "ruta:movies", genre: "peliculas" },
    { title: "Series", ref: "ruta:tvshows", genre: "series" },
    { title: "Animes", ref: "ruta:animes", genre: "animes" }
  ];
}

export async function browse(ref, cursor) {
  await kino.sleep(1);
  var postType = String(ref || "").replace("ruta:", "") || "movies";
  var pag = parseInt(cursor || "1", 10) || 1;
  var items = await listar(postType, pag);
  return { items: items, next: items.length >= 24 ? String(pag + 1) : null };
}

export async function search(query) {
  await kino.sleep(1);
  var q = String(query || "").trim();
  if (!q) return { items: [] };
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

export async function resolve(ref) {
  await kino.sleep(1);
  if (!ref) throw kino.error("not_found");
  var url = ref.indexOf("http") === 0 ? ref : BASE + ref;
  var res = await kino.fetch(url);
  var html = await res.text();
  var m3u8 = extraerM3u8(html);
  if (m3u8) return { url: m3u8, kind: "hls" };
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
  if (/(spix|adangle|pinup|preroll)/.test(u)) return null;
  return u.replace(/\\/g, "");
}
