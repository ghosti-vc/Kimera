// plugin.js v0.5.0 — Fan Pelis + PelisflixHD + Cuevana
const FAN = "https://fanpelis.to";
const FAN_API = FAN + "/wp-json/wpf/v1";
const PELIS = "https://pelisflixhd.win";
const CUE = "https://cuevana.gs";

async function httpText(url, opts) {
  const r = await fetch(url, { ...opts, headers: { "User-Agent": "Mozilla/5.0", ...(opts && opts.headers) } });
  return r.text();
}

// ---- Ryusaki (PelisflixHD y Cuevana usan el mismo mecanismo) ----
function getNonce(html) {
  const m = html.match(/["']nonce["']\s*:\s*["']([a-f0-9]{10})["']/i) ||
            html.match(/data-nonce=["']([a-f0-9]{10})["']/i);
  return m ? m[1] : null;
}
function getTmdbId(html) {
  const m = html.match(/["']tmdbId["']\s*:\s*["']?(\d+)/i) ||
            html.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
  return m ? m[2] || m[1] : null;
}
async function ryusakiServers(base, html, contentType, season, episode) {
  const nonce = getNonce(html);
  const tmdbId = getTmdbId(html);
  if (!nonce || !tmdbId) return [];
  const r = await fetch(base + "/wp-json/ryusaki-sync/v1/request-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-WP-Nonce": nonce, "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ tmdbId, contentType, serverId: "", ...(season ? { season } : {}), ...(episode ? { episode } : {}) })
  });
  if (!r.ok) return [];
  const j = await r.json().catch(() => null);
  const url = j && (j.stream_url || (j.data && j.data.url) || j.streamUrl);
  return url ? [{ url, title: "Ryusaki (HD)" }] : [];
}

// ---- Catálogos PelisflixHD (scraping HTML) ----
function pfItems(html) {
  const out = [];
  const re = /<article[^>]+id="post-(\d+)"[\s\S]*?<a[^>]+href=["']([^"']+)["'][\s\S]*?<img[^>]+src=["']([^"']+)["'][\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
  let m;
  while ((m = re.exec(html))) out.push({ id: "pf:" + m[2], title: m[4].trim(), image: m[3].startsWith("//") ? "https:" + m[3] : m[3] });
  return out;
}
async function pelisflixList(path) {
  return pfItems(await httpText(PELIS + path));
}

// ---- Catálogos Cuevana (scraping HTML) ----
function cuItems(html) {
  const out = [];
  const re = /<article[^>]+class="[^"]*"(?:[\s\S]*?)href=["'](https:\/\/cuevana\.gs\/(?:pelicula|serie)\/[^"']+)["'][\s\S]*?src=["']([^"']+)["'][\s\S]*?alt=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) out.push({ id: "cu:" + m[1], title: m[3].trim(), image: m[2].startsWith("//") ? "https:" + m[2] : m[2] });
  return out;
}

export default {
  id: "fan-pelis-multi",
  version: "0.5.0",
  name: "Fan Pelis Multi",
  description: "Fan Pelis + PelisflixHD + Cuevana en español",

  async home({ page }) {
    const p = page || 1;
    const items = [];
    try {
      const fan = await fetch(`${FAN_API}/posts?page=${p}`).then(r => r.json());
      const posts = (fan.data && fan.data.posts) || [];
      for (const it of posts) items.push({ id: "fan:" + (it.id ?? it.ID), title: it.title || it.post_title, image: it.poster || it.image });
    } catch (e) {}
    if (p === 1) {
      try { items.push(...(await pelisflixList("/peliculas/"))); } catch (e) {}
      try { items.push(...(await cuItems(await httpText(CUE + "/peliculas/")))); } catch (e) {}
    }
    return items;
  },

  async search({ query, page }) {
    const p = page || 1;
    const items = [];
    try {
      const fan = await fetch(`${FAN_API}/posts?search=${encodeURIComponent(query)}&page=${p}`).then(r => r.json());
      for (const it of ((fan.data && fan.data.posts) || [])) items.push({ id: "fan:" + (it.id ?? it.ID), title: it.title || it.post_title, image: it.poster || it.image });
    } catch (e) {}
    if (p === 1) {
      try { items.push(...pfItems(await httpText(PELIS + "/?s=" + encodeURIComponent(query)))); } catch (e) {}
      try { items.push(...cuItems(await httpText(CUE + "/search?s=" + encodeURIComponent(query)))); } catch (e) {}
    }
    return items;
  },

  async details({ id }) {
    const [prov, rest] = [id.split(":")[0], id.slice(id.indexOf(":") + 1)];
    if (prov === "fan") {
      const d = await fetch(`${FAN_API}/post/${rest}`).then(r => r.json());
      const p = (d.data && (d.data.post || d.data)) || {};
      return { title: p.title || p.post_title, description: p.description || p.content || "", image: p.poster || p.image, episodes: p.episodes || [] };
    }
    if (prov === "pf") {
      const html = await httpText(rest.startsWith("http") ? rest : PELIS + rest);
      const title = (html.match(/<h1[^>]*>([^<]+)<\/h1>/) || [])[1] || "Pelisflix";
      const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
      const poster = (html.match(/property="og:image" content="([^"]*)"/) || [])[1] || "";
      return { title, description: desc, image: poster, isSeries: /season|temporada/i.test(html) };
    }
    if (prov === "cu") {
      const html = await httpText(rest);
      const title = (html.match(/<h1[^>]*>([^<]+)<\/h1>/) || [])[1] || "Cuevana";
      const desc = (html.match(/property="og:description" content="([^"]*)"/) || [])[1] || "";
      const poster = (html.match(/property="og:image" content="([^"]*)"/) || [])[1] || "";
      return { title, description: desc, image: poster, isSeries: /\/serie\//.test(rest) };
    }
    return null;
  },

  async streams({ id }) {
    const [prov, rest] = [id.split(":")[0], id.slice(id.indexOf(":") + 1)];
    const out = [];
    if (prov === "fan") {
      // Igual que v0.4.x: probar servidores y extraer HLS (m3u8)
      const d = await fetch(`${FAN_API}/post/${rest}`).then(r => r.json());
      const servers = ((d.data && d.data.servers) || []).map(s => s.url || s.src).filter(Boolean);
      for (const u of servers) {
        if (/\.m3u8/.test(u)) out.push({ url: u, title: "Fan Pelis (HLS)" });
        else {
          try {
            const html = await httpText(u);
            const m = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
            if (m) out.push({ url: m[0], title: "Fan Pelis (HLS)" });
          } catch (e) {}
        }
      }
    } else if (prov === "pf") {
      const html = await httpText(rest.startsWith("http") ? rest : PELIS + rest);
      out.push(...await ryusakiServers(PELIS, html, "movie"));
    } else if (prov === "cu") {
      const html = await httpText(rest);
      const isSerie = /\/serie\//.test(rest);
      out.push(...await ryusakiServers(CUE, html, isSerie ? "tvshows" : "movies"));
    }
    return out;
  }
};
