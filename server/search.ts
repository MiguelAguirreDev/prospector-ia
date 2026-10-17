import * as cheerio from 'cheerio';

export interface SearchResult {
  titulo: string;
  url: string;
  descripcion: string;
  dominio: string;
  fuente?: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const EXCLUIR_DOMINIOS = new Set([
  'infocasas.com.uy',
  'eldirectorio.co',
  'guiacomercial.uy',
  'mercadolibre.com',
  'mercadolibre.com.uy',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'youtube.com',
  'google.com',
  'wikipedia.org',
  'gallito.com.uy',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'pinterest.com',
  'reddit.com',
  'yellowpages.com',
  'paginasamarillas.com',
  'tripadvisor.com',
  'buscatuempresa.com.uy',
  'portaluruguay.com',
  'casasweb.com',
  'guiadeo.com',
  'inmuebles.com.uy',
  'portalinmobiliario.com',
]);

export function normalizarDominio(url: string): string {
  try {
    let clean = url.trim();
    if (!clean.includes('://')) clean = 'http://' + clean;
    let host = new URL(clean).hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host;
  } catch {
    return '';
  }
}

export function normalizarUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let url = rawUrl.trim();
  if (url.startsWith('//')) url = 'https:' + url;

  // DuckDuckGo redirection: /l/?uddg=...
  if (url.includes('/l/?') && url.includes('uddg=')) {
    try {
      const parsed = new URL(url.startsWith('http') ? url : 'https://duckduckgo.com' + url);
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) url = decodeURIComponent(uddg);
    } catch {}
  }

  // Yahoo redirection: r.search.yahoo.com/_ylt=.../RU=.../RK=...
  if (url.includes('r.search.yahoo.com') && url.includes('/RU=')) {
    try {
      const match = url.match(/\/RU=([^/]+)/);
      if (match && match[1]) {
        url = decodeURIComponent(match[1]);
      }
    } catch {}
  }

  if (!url.startsWith('http')) return '';
  return url;
}

export async function buscarDuckDuckGo(consulta: string, maximo: number = 25, timeout: number = 4000): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(consulta), {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
    });

    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('div.result, div.results_links').each((_, el) => {
      const a = $(el).find('a.result__a');
      if (!a.length) return;
      const rawHref = a.attr('href') || '';
      const url = normalizarUrl(rawHref);
      if (!url) return;
      const dominio = normalizarDominio(url);
      if (!dominio) return;

      const titulo = a.text().trim();
      const sn = $(el).find('div.result__snippet, a.result__snippet');
      const descripcion = sn.text().trim();

      results.push({ titulo, url, descripcion, dominio, fuente: 'duckduckgo' });
      if (results.length >= maximo) return false;
    });

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function buscarDuckDuckGoLite(consulta: string, maximo: number = 25, timeout: number = 4000): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-UY,es;q=0.9',
      },
      body: `q=${encodeURIComponent(consulta)}`,
      signal: controller.signal,
    });

    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('table tr').each((_, tr) => {
      const a = $(tr).find('a.result-link');
      if (!a.length) return;
      const rawHref = a.attr('href') || '';
      const url = normalizarUrl(rawHref);
      if (!url) return;
      const dominio = normalizarDominio(url);
      if (!dominio) return;

      const titulo = a.text().trim();
      const nextSnippetTr = $(tr).next().find('td.result-snippet');
      const descripcion = nextSnippetTr.text().trim();

      results.push({ titulo, url, descripcion, dominio, fuente: 'ddg_lite' });
      if (results.length >= maximo) return false;
    });

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function buscarBing(consulta: string, maximo: number = 25, timeout: number = 4000): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(consulta)}&setlang=es&count=${Math.max(15, maximo)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
    });

    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('li.b_algo').each((_, el) => {
      const a = $(el).find('h2 a');
      if (!a.length) return;
      const rawHref = a.attr('href') || '';
      const targetUrl = normalizarUrl(rawHref);
      if (!targetUrl) return;
      const dominio = normalizarDominio(targetUrl);
      if (!dominio) return;

      const titulo = a.text().trim();
      const sn = $(el).find('p, .b_caption p');
      const descripcion = sn.text().trim();

      results.push({ titulo, url: targetUrl, descripcion, dominio, fuente: 'bing' });
      if (results.length >= maximo) return false;
    });

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function buscarYahoo(consulta: string, maximo: number = 25, timeout: number = 4000): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `https://search.yahoo.com/search?p=${encodeURIComponent(consulta)}&n=${Math.max(10, maximo)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-UY,es;q=0.9',
      },
      signal: controller.signal,
    });

    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('#web ol > li, div.dd.algo').each((_, el) => {
      const a = $(el).find('h3 a, a.ac-algo');
      if (!a.length) return;
      const rawHref = a.attr('href') || '';
      const targetUrl = normalizarUrl(rawHref);
      if (!targetUrl) return;
      const dominio = normalizarDominio(targetUrl);
      if (!dominio) return;

      const titulo = a.text().trim();
      const sn = $(el).find('div.compText, p.lh-16');
      const descripcion = sn.text().trim();

      results.push({ titulo, url: targetUrl, descripcion, dominio, fuente: 'yahoo' });
      if (results.length >= maximo) return false;
    });

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function buscarMojeek(consulta: string, maximo: number = 15, timeout: number = 1500): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `https://www.mojeek.com/search?q=${encodeURIComponent(consulta)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });

    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('ul.results-standard > li').each((_, el) => {
      const a = $(el).find('a.ob, a.title');
      if (!a.length) return;
      const rawHref = a.attr('href') || '';
      const targetUrl = normalizarUrl(rawHref);
      if (!targetUrl) return;
      const dominio = normalizarDominio(targetUrl);
      if (!dominio) return;

      const titulo = a.text().trim();
      const sn = $(el).find('p.s');
      const descripcion = sn.text().trim();

      results.push({ titulo, url: targetUrl, descripcion, dominio, fuente: 'mojeek' });
      if (results.length >= maximo) return false;
    });

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export interface FuentesReporte {
  [fuente: string]: {
    resultados: number;
    error: boolean;
  };
}

export async function busquedaMultiFuente(
  consulta: string,
  maxResultados: number = 40
): Promise<{ resultados: SearchResult[]; fuentes: FuentesReporte; duracionSeg: number }> {
  const t0 = Date.now();
  const fuentes: FuentesReporte = {
    duckduckgo: { resultados: 0, error: false },
    ddg_lite: { resultados: 0, error: false },
    bing: { resultados: 0, error: false },
    yahoo: { resultados: 0, error: false },
    mojeek: { resultados: 0, error: false },
  };

  // Run all 5 search engines in parallel with fast timeouts
  const [ddgRes, ddgLiteRes, bingRes, yahooRes, mojeekRes] = await Promise.allSettled([
    buscarDuckDuckGo(consulta, maxResultados),
    buscarDuckDuckGoLite(consulta, maxResultados),
    buscarBing(consulta, maxResultados),
    buscarYahoo(consulta, maxResultados),
    buscarMojeek(consulta, maxResultados),
  ]);

  const rawList: SearchResult[] = [];

  if (ddgRes.status === 'fulfilled') {
    fuentes.duckduckgo.resultados = ddgRes.value.length;
    rawList.push(...ddgRes.value);
  } else {
    fuentes.duckduckgo.error = true;
  }

  if (ddgLiteRes.status === 'fulfilled') {
    fuentes.ddg_lite.resultados = ddgLiteRes.value.length;
    rawList.push(...ddgLiteRes.value);
  } else {
    fuentes.ddg_lite.error = true;
  }

  if (bingRes.status === 'fulfilled') {
    fuentes.bing.resultados = bingRes.value.length;
    rawList.push(...bingRes.value);
  } else {
    fuentes.bing.error = true;
  }

  if (yahooRes.status === 'fulfilled') {
    fuentes.yahoo.resultados = yahooRes.value.length;
    rawList.push(...yahooRes.value);
  } else {
    fuentes.yahoo.error = true;
  }

  if (mojeekRes.status === 'fulfilled') {
    fuentes.mojeek.resultados = mojeekRes.value.length;
    rawList.push(...mojeekRes.value);
  } else {
    fuentes.mojeek.error = true;
  }

  // Deduplicación y filtrado por lista negra
  const vistos = new Set<string>();
  const finalResultados: SearchResult[] = [];

  for (const it of rawList) {
    const dom = it.dominio.toLowerCase();
    if (!dom || vistos.has(dom)) continue;
    if (EXCLUIR_DOMINIOS.has(dom) || Array.from(EXCLUIR_DOMINIOS).some(ex => dom.endsWith('.' + ex))) {
      continue;
    }

    vistos.add(dom);
    finalResultados.push(it);
    if (finalResultados.length >= maxResultados) break;
  }

  const duracionSeg = Number(((Date.now() - t0) / 1000).toFixed(2));
  return { resultados: finalResultados, fuentes, duracionSeg };
}
