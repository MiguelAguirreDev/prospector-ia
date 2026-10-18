import { chromium, Browser, Page } from 'playwright';

/**
 * Scraper de Google Maps (puerto a TypeScript del proyecto scraper-maps-montevideo).
 *
 * Abre Google Maps con un navegador real (Playwright/Chromium), acepta el aviso
 * de cookies, hace scroll del panel y lee las tarjetas de resultados:
 *   nombre, teléfono, sitio web, dirección, categoría, rating y reseñas.
 *
 * Google Maps NO da el email: eso lo resuelve después el rastreo de la web
 * (server/crawler.ts) y, si no aparece, la IA (server/ai.ts).
 *
 * AVISO: esto va contra los Términos de Servicio de Google y es frágil (el DOM
 * cambia). Se usa como fuente de descubrimiento adicional.
 */

export interface MapsNegocio {
  nombre: string;
  telefono: string;
  sitio_web: string;
  direccion: string;
  categoria: string;
  rating: string;
  resenas: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Selectores del DOM de Google Maps (con respaldo)
// ---------------------------------------------------------------------------
const SEL_FEED = 'div[role="feed"]';
const SEL_TARJETA = 'div.Nv2PK';
const SEL_TARJETA_ALT = 'div[role="feed"] > div > div[jsaction]';
const SEL_ENLACE = 'a.hfpxzc';
const SEL_MAIN = 'div[role="main"]';
const SEL_TELEFONO = 'span.UsdlK'; // teléfono visible en la tarjeta (DOM actual de Maps)
const SELECTORES_NOMBRE = ['div.qBF1Pd', 'div.fontHeadlineSmall', 'div.fontTitleMedium'];
const SELECTORES_RATING = ['span.MW4etd', "div.F7nice span[aria-hidden='true']"];
const SELECTORES_RESENAS = [
  'span.UY7F9',
  "div.F7nice span[aria-label*='reseña']",
  "div.F7nice span[aria-label*='opinion']",
  "div.F7nice span[aria-label*='review']",
];

const FIN_LISTA = [
  'llegaste al final', 'reached the end', 'se acabaron los resultados',
  'no hay más resultados', 'no more results',
];

const RUIDO_UI = new Set([
  'sitio web', 'indicaciones', 'guardar', 'compartir', 'llamar', 'cómo llegar',
  'sitios web', 'menú', 'pedir', 'reservar', 'más', 'sugerir una edición',
]);

const ESTADO_RE =
  /^(abierto|cerrado|abre|cierra|abierto las 24|cerrado permanentemente|permanentemente cerrado|reabre|cierra pronto|open|closed)/i;

const SECUENCIA_TEL = /\+?\d[\d\s\-.]{5,}\d/g;

// Sitios que NO son la web propia del negocio (redes, portales, google)
const WEB_NO_PROPIA = [
  'instagram.com', 'facebook.com', 'fb.com', 'wa.me', 'linktr.ee',
  'tiktok.com', 'linkedin.com', 'twitter.com', 'x.com',
  'mercadolibre.com', 'mercadolibre.com.uy',
];

function limpiarUrl(u: string): string {
  u = (u || '').trim();
  if (!u) return '';
  try {
    const p = new URL(u);
    // quitar parámetros de tracking y fragmento
    p.search = '';
    p.hash = '';
    return p.toString().replace(/\/+$/, '');
  } catch {
    return u;
  }
}

function esWebNoPropia(u: string): boolean {
  try {
    let host = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
    return WEB_NO_PROPIA.some(d => host === d || host.endsWith('.' + d));
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Utilidades de parseo
// ---------------------------------------------------------------------------

export function normaliza(s: string): string {
  return (s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function telefonoValido(bruto: string, digitos: string): boolean {
  if (!(digitos.length >= 8 && digitos.length <= 12)) return false;
  if (bruto.startsWith('+') || digitos.slice(0, 4).includes('598')) {
    return digitos.length >= 10 && digitos.length <= 12;
  }
  return digitos.startsWith('09') || (digitos.length === 8 && '23456789'.includes(digitos[0]));
}

export function buscarTelefonoUY(texto: string): string {
  const matches = (texto || '').match(SECUENCIA_TEL) || [];
  for (const bruto of matches) {
    const limpio = bruto.trim();
    const digitos = limpio.replace(/\D/g, '');
    if (telefonoValido(limpio, digitos)) return limpio.replace(/\s+/g, ' ').trim();
  }
  return '';
}

function esRatingOResenas(linea: string): boolean {
  const plano = linea.replace(/\s/g, '');
  return /^\d[.,]\d(\(\d+\))?$/.test(plano) || /^\(\d+\)$/.test(plano);
}

function pareceDireccion(linea: string): boolean {
  if (/\b(av\.?|avenida|calle|esquina|esq\.?|ruta|bvar|bulevar|rambla|cno\.?|camino)\b/i.test(linea)) {
    return true;
  }
  if (/\d/.test(linea) && (linea.includes(',') || linea.toLowerCase().includes('montevideo'))) {
    return true;
  }
  return false;
}

function analizarLineas(
  lineas: string[],
  nombre: string,
  telefono: string
): { direccion: string; categoria: string } {
  let direccion = '';
  let categoria = '';
  for (const original of lineas) {
    if (!original || original === nombre) continue;
    let partes: string[];
    if (original.includes(' · ')) partes = original.split(' · ').map(p => p.trim()).filter(Boolean);
    else if (original.includes(' ⋅ ')) partes = original.split(' ⋅ ').map(p => p.trim()).filter(Boolean);
    else partes = [original];

    for (const linea of partes) {
      if (!linea || linea === nombre) continue;
      if (RUIDO_UI.has(linea.trim().toLowerCase())) continue;
      if (esRatingOResenas(linea)) continue;
      if (ESTADO_RE.test(linea)) continue;
      if (telefono && buscarTelefonoUY(linea)) continue;
      if (!direccion && pareceDireccion(linea)) {
        direccion = linea;
        continue;
      }
      if (!categoria && !/\d/.test(linea) && linea.length <= 45) categoria = linea;
    }
  }
  return { direccion, categoria };
}

// ---------------------------------------------------------------------------
// Navegador reutilizable
// ---------------------------------------------------------------------------

let navegador: Browser | null = null;
let lanzando: Promise<Browser> | null = null;

async function getNavegador(headless: boolean): Promise<Browser> {
  if (navegador && navegador.isConnected()) return navegador;
  if (!lanzando) {
    lanzando = chromium
      .launch({
        headless,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
      })
      .then(b => {
        navegador = b;
        return b;
      });
  }
  return lanzando;
}

export async function cerrarMaps(): Promise<void> {
  if (navegador) {
    await navegador.close().catch(() => {});
  }
  navegador = null;
  lanzando = null;
}

export function mapsDisponible(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Parseo de tarjetas / panel
// ---------------------------------------------------------------------------

async function primerTexto(alcance: any, selectores: string[]): Promise<string> {
  for (const sel of selectores) {
    try {
      const loc = alcance.locator(sel).first();
      if ((await loc.count()) === 0) continue;
      const txt = ((await loc.innerText()) || '').trim();
      if (txt) return txt;
    } catch {
      continue;
    }
  }
  return '';
}

async function datoPorItem(
  alcance: any,
  itemId: string,
  atributo?: string,
  prefijosAria: string[] = [],
  comodin: '=' | '^=' = '='
): Promise<string> {
  try {
    const sel = comodin === '^=' ? `[data-item-id^="${itemId}"]` : `[data-item-id="${itemId}"]`;
    const loc = alcance.locator(sel).first();
    if ((await loc.count()) === 0) return '';
    if (atributo) return ((await loc.getAttribute(atributo)) || '').trim();
    const raw = (await loc.getAttribute('data-item-id')) || '';
    if (raw.startsWith('phone:')) return raw.split(':').slice(2).join(':').trim();
    const aria = ((await loc.getAttribute('aria-label')) || '').trim();
    if (aria) {
      const bajo = aria.toLowerCase();
      if (prefijosAria.some(p => bajo.includes(p)) && aria.includes(':')) {
        return aria.split(':').slice(1).join(':').trim();
      }
      return aria;
    }
  } catch {
    // ignore
  }
  return '';
}

async function rasparTarjeta(tarjeta: any): Promise<MapsNegocio | null> {
  let texto = '';
  try {
    texto = await tarjeta.innerText();
  } catch {
    return null;
  }

  let nombre = '';
  let url = '';
  try {
    const enlace = tarjeta.locator(SEL_ENLACE).first();
    if ((await enlace.count()) > 0) {
      url = ((await enlace.getAttribute('href')) || '').trim();
      nombre = ((await enlace.getAttribute('aria-label')) || '').trim();
      if (!nombre) nombre = ((await enlace.innerText()) || '').trim();
    }
  } catch {
    // ignore
  }
  if (!nombre) nombre = await primerTexto(tarjeta, SELECTORES_NOMBRE);
  if (!nombre) nombre = (texto.split('\n', 1)[0] || '').trim();
  if (!nombre) return null;

  let telefono = await datoPorItem(tarjeta, 'phone', undefined, ['teléfono', 'telefono', 'phone']);
  // Teléfono visible en la tarjeta (selector actual de Maps) y phone:tel: con comodín.
  if (!telefono) {
    try {
      const telEl = tarjeta.locator(SEL_TELEFONO).first();
      if ((await telEl.count()) > 0) {
        const t = ((await telEl.innerText()) || '').trim();
        if (buscarTelefonoUY(t)) telefono = t;
      }
    } catch {}
  }
  if (!telefono) {
    try {
      const telRaw = await datoPorItem(tarjeta, 'phone:tel:', undefined, [], '^=');
      if (telRaw) telefono = telRaw;
    } catch {}
  }
  // Sitio web: leer cualquier enlace externo de la tarjeta que no sea Google
  // ni red social (igual que el scraper de escritorio).
  let sitio = '';
  try {
    const enlaces = tarjeta.locator('a[href]');
    const nEnlaces = await enlaces.count();
    for (let i = 0; i < nEnlaces; i++) {
      const h = ((await enlaces.nth(i).getAttribute('href')) || '').trim();
      if (h.startsWith('http') && !h.includes('google.') && !h.includes('/maps/')) {
        const limpia = limpiarUrl(h);
        if (limpia && !esWebNoPropia(limpia)) {
          sitio = limpia;
          break;
        }
      }
    }
  } catch {}
  // fallback: data-item-id authority
  if (!sitio) {
    sitio = await datoPorItem(tarjeta, 'authority', 'href');
  }
  let direccion = await datoPorItem(tarjeta, 'address', undefined, ['dirección', 'direccion', 'address']);
  const rating = await primerTexto(tarjeta, SELECTORES_RATING);
  let resenas = (await primerTexto(tarjeta, SELECTORES_RESENAS)).replace(/[()]/g, '');

  const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  if (!telefono) {
    for (const linea of lineas) {
      telefono = buscarTelefonoUY(linea);
      if (telefono) break;
    }
  }
  if (!resenas) {
    for (const linea of lineas) {
      const m = linea.match(/^\((\d{1,6})\)$/);
      if (m) {
        resenas = m[1];
        break;
      }
    }
  }

  const { direccion: dirTxt, categoria } = analizarLineas(lineas, nombre, telefono);
  if (!direccion) direccion = dirTxt;

  return { nombre, telefono, sitio_web: sitio, direccion, categoria, rating, resenas, url };
}

async function rasparDetalleUnico(page: Page): Promise<MapsNegocio | null> {
  const nombre = await primerTexto(page, [`${SEL_MAIN} h1`, 'h1']);
  if (!nombre) return null;
  return {
    nombre,
    telefono: await datoPorItem(page, 'phone', undefined, ['teléfono', 'telefono', 'phone']),
    sitio_web: await datoPorItem(page, 'authority', 'href'),
    direccion: await datoPorItem(page, 'address', undefined, ['dirección', 'direccion', 'address']),
    categoria: await primerTexto(page, [
      `${SEL_MAIN} button[jsaction*='category']`,
      `${SEL_MAIN} span.DkEaL`,
    ]),
    rating: await primerTexto(page, [`${SEL_MAIN} span.MW4etd`, 'span.MW4etd']),
    resenas: (await primerTexto(page, [`${SEL_MAIN} span.UY7F9`, 'span.UY7F9'])).replace(/[()]/g, ''),
    url: page.url(),
  };
}

async function aceptarConsentimiento(page: Page): Promise<boolean> {
  const selectores = [
    'button:has-text("Aceptar todo")',
    'button:has-text("Acepto")',
    'button:has-text("Aceptar")',
    'button:has-text("Accept all")',
    'button[aria-label="Aceptar todo"]',
    'form[action*="consent"] button',
  ];
  for (const sel of selectores) {
    try {
      const boton = page.locator(sel).first();
      if ((await boton.count()) > 0 && (await boton.isVisible())) {
        await boton.click({ timeout: 2500 });
        await page.waitForTimeout(600);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function esSinResultados(page: Page): Promise<boolean> {
  try {
    const cuerpo = (await page.locator(SEL_MAIN).innerText({ timeout: 2000 })).toLowerCase();
    return ['no se encontraron', 'no se ha encontrado', 'no results', "google maps can't find"].some(f =>
      cuerpo.includes(f)
    );
  } catch {
    return false;
  }
}

async function locadorTarjetas(page: Page) {
  let tarjetas = page.locator(SEL_TARJETA);
  if ((await tarjetas.count()) === 0) tarjetas = page.locator(SEL_TARJETA_ALT);
  return tarjetas;
}

async function cargarResultados(page: Page, feed: any, maximo: number): Promise<void> {
  let previos = -1;
  let estancado = 0;
  for (let i = 0; i < 100; i++) {
    const tarjetas = await locadorTarjetas(page);
    const n = await tarjetas.count();
    if (maximo && n >= maximo) break;

    // Detectar fin de lista (texto "no hay más resultados" o similar)
    try {
      const cuerpo = (await page.locator(SEL_MAIN).innerText({ timeout: 1000 })).toLowerCase();
      if (FIN_LISTA.some(f => cuerpo.includes(f))) break;
    } catch {}

    if (n === previos) {
      estancado++;
      if (estancado >= 4) break;
      // Intentar click en "Mostrar más" si existe
      try {
        const mas = page.locator('button:has-text("Mostrar más"), button:has-text("Ver más"), a:has-text("Más lugares")').first();
        if ((await mas.count()) > 0 && (await mas.isVisible())) {
          await mas.click({ timeout: 2000 });
          await page.waitForTimeout(1200);
          continue;
        }
      } catch {}
    } else {
      estancado = 0;
    }
    previos = n;
    try {
      await feed.evaluate((nodo: HTMLElement) => nodo.scrollTo(0, nodo.scrollHeight));
    } catch {
      break;
    }
    await page.waitForTimeout(900 + Math.floor(Math.random() * 700));
  }
}

async function unaBusqueda(page: Page, termino: string, maxPor: number, esperaMs: number): Promise<MapsNegocio[]> {
  const url = 'https://www.google.com/maps/search/' + encodeURIComponent(termino) + '?hl=es';
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: esperaMs });
  } catch {
    return [];
  }

  await aceptarConsentimiento(page);

  try {
    await page.waitForSelector(SEL_FEED, { timeout: esperaMs });
  } catch {
    if (await esSinResultados(page)) return [];
    const unico = await rasparDetalleUnico(page);
    return unico ? [unico] : [];
  }

  const feed = page.locator(SEL_FEED).first();
  await cargarResultados(page, feed, maxPor);

  const tarjetas = await locadorTarjetas(page);
  let total = await tarjetas.count();
  if (maxPor) total = Math.min(total, maxPor);

  const encontrados: MapsNegocio[] = [];
  for (let i = 0; i < total; i++) {
    try {
      const datos = await rasparTarjeta(tarjetas.nth(i));
      if (datos) encontrados.push(datos);
    } catch {
      continue;
    }
  }
  return encontrados;
}

/** Abre el detalle de un lugar y saca la web, el teléfono y la dirección completa. */
async function detalleLugar(context: any, url: string): Promise<Partial<MapsNegocio>> {
  if (!url) return {};
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1300);

    // Una sola lectura del DOM: evita esperas de 20s por selectores ausentes.
    const info = (await page.evaluate(() => {
      const items: Array<{ id: string; href: string; aria: string }> = [];
      document.querySelectorAll('[data-item-id]').forEach(el => {
        items.push({
          id: el.getAttribute('data-item-id') || '',
          href: el.getAttribute('href') || '',
          aria: el.getAttribute('aria-label') || '',
        });
      });
      const catEl = document.querySelector(
        'div[role="main"] button[jsaction*="category"], div[role="main"] span.DkEaL'
      );
      return { items, cat: catEl ? (catEl.textContent || '').trim() : '' };
    })) as { items: Array<{ id: string; href: string; aria: string }>; cat: string };

    const out: Partial<MapsNegocio> = {};
    for (const it of info.items) {
      if (it.id.startsWith('authority') && it.href && !out.sitio_web) {
        out.sitio_web = it.href.trim();
      } else if (it.id.startsWith('phone:') && !out.telefono) {
        const t = it.id.split(':').slice(2).join(':').trim();
        if (t) out.telefono = t;
      } else if (it.id === 'address' && it.aria && !out.direccion) {
        out.direccion = it.aria.replace(/^\s*(Direcci[oó]n|Address)\s*:\s*/i, '').trim();
      }
    }
    if (info.cat) out.categoria = info.cat;

    return out;
  } catch {
    return {};
  } finally {
    await page.close().catch(() => {});
  }
}

/** Enriquesé los negocios abriendo su detalle (con un paralelismo bajo). */
async function enriquecer(
  context: any,
  negocios: MapsNegocio[],
  maximo: number,
  concurrencia = 4
): Promise<MapsNegocio[]> {
  const lista = negocios.slice(0, maximo);
  let idx = 0;
  const worker = async () => {
    while (idx < lista.length) {
      const i = idx++;
      const d = await detalleLugar(context, lista[i].url);
      if (d.sitio_web) lista[i].sitio_web = d.sitio_web;
      if (d.telefono) lista[i].telefono = d.telefono;
      if (d.direccion) lista[i].direccion = d.direccion;
      if (d.categoria) lista[i].categoria = d.categoria;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrencia, lista.length || 1) }, worker));
  return lista;
}

/**
 * Busca negocios en Google Maps. Devuelve la lista de negocios crudos.
 * El navegador se reutiliza entre llamadas (no se cierra en cada búsqueda).
 */
export async function buscarMaps(
  consulta: string,
  maxPorBusqueda: number = 20,
  opciones: { headless?: boolean; esperaMs?: number; enriquecerDetalles?: boolean; concurrencia?: number } = {}
): Promise<MapsNegocio[]> {
  const headless = opciones.headless ?? process.env.PROSPECTOR_MAPS_HEADLESS !== '0';
  const esperaMs = opciones.esperaMs ?? 20000;
  const enriquecerDetalles = opciones.enriquecerDetalles !== false; // por defecto true (para obtener web)
  const concurrencia = opciones.concurrencia ?? 4;

  const nav = await getNavegador(headless);
  const context = await nav.newContext({
    locale: 'es-UY',
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(esperaMs);

  try {
    const negocios = await unaBusqueda(page, consulta, maxPorBusqueda, esperaMs);
    if (enriquecerDetalles) {
      return await enriquecer(context, negocios, maxPorBusqueda, concurrencia);
    }
    return negocios.slice(0, maxPorBusqueda);
  } finally {
    await context.close().catch(() => {});
  }
}
