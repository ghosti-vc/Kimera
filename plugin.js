// KimeraWeb — plugin Kino (provider)
const BASE = "https://kimeraweb.com";
const UA = "Mozilla/5.0";

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.text();
}

// Extrae el JSON embebido de la página (títulos u hosts)
function extraerJson(html, clave) {
  // busca el primer objeto JSON que contenga la clave (p. ej. "hosts" o "slug")
  const i = html.indexOf('"' + clave + '"');
  if (i < 0) return null;
  // retrocede hasta la llave/ corchete inicial del JSON contenedor
  let inicio = html.lastIndexOf("{", i);
  const obj = balancear(html, inicio);
  if (!obj) return null;
  try { return JSON.parse(obj); } catch { return null; }
}

// recorre desde inicio conteniendo llaves/corchetes respetando strings
function balancear(s, inicio) {
  let prof = 0, enStr = false, esc = false, fin = -1;
  for (let i = inicio; i < s.length; i++) {
    const c = s[i];
    if (enStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') enStr = false;
    } else {
      if (c === '"') enStr = true;
      else if (c === "{" || c === "[") prof++;
      else if (c === "}" || c === "]") { prof--; if (prof === 0) { fin = i + 1; break; } }
    }
  }
  return fin > 0 ? s.slice(inicio, fin) : null;
}

// Catálogo: páginas de películas. Devuelve tarjetas.
async function catalog({ page = 1 } = {}) {
  const html = await getText(BASE + "/movies/?page=" + page);
  const items = [];
  // Cada tarjeta embebida trae slug + título
  const re = /"url":"(\/movies\/[a-z0-9-]+-\d+)","name":"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const nombre = m[2].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    if (!items.some(x => x.id === m[1])) items.push({ id: m[1], title: nombre, type: "movie" });
  }
  return { items, nextPage: items.length > 0 ? page + 1 : null };
}

// Búsqueda
async function search({ query, page = 1 } = {}) {
  const html = await getText(BASE + "/search?q=" + encodeURIComponent(query) + "&page=" + page);
  const items = [];
  const re = /"url":"(\/movies\/[a-z0-9-]+-\d+)","name":"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const nombre = m[2].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    if (!items.some(x => x.id === m[1])) items.push({ id: m[1], title: nombre, type: "movie" });
  }
  return { items, nextPage: null };
}

// Detalle de una película
async function item({ id }) {
  const html = await getText(BASE + id);
  const data = extraerJson(html, "slug");
  if (!data) throw new Error("No se pudo leer la película");
  return {
    id,
    title: data.name || data.title || id,
    poster: data.poster_url || null,
    description: data.synopsis || data.description || "",
    year: data.release_date ? data.release_date.slice(0, 4) : null,
    type: "movie",
  };
}

// Resuelve el stream desde el JSON embebido de /watch
async function sources({ id }) {
  const html = await getText(BASE + id + "/watch");
  const hosts = [];
  const re = /"hosts":($$[^$$]*\])/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { hosts.push(...JSON.parse(m[1])); } catch {}
  }
  if (hosts.length === 0) throw new Error("Sin hosts disponibles");

  const out = [];
  for (const h of hosts) {
    if (!h || !h.url) continue;
    if (h.type === "iframe") {
      out.push({ name: h.name || "Host", type: "url", url: h.url, embed: true });
    } else if (h.type === "hls_storage" || h.type === "storage" || h.type === "url") {
      // el HLS puede estar en la URL tal cual o con sufijos comunes
      const candidatos = [h.url, h.url + "/index.m3u8", h.url + ".m3u8"];
      let elegida = h.url;
      for (const c of candidatos) {
        try {
          const t = await fetch(c, { headers: { "User-Agent": UA } }).then(r => r.ok ? r.text() : "");
          if (t.includes("#EXTM3U")) { elegida = c; break; }
        } catch {}
      }
      out.push({ name: h.name || "Host", type: "url", url: elegida, format: "hls" });
    }
  }
  return out;
}

export { catalog, search, item, sources };
