import * as cheerio from 'cheerio';
import net from 'net';

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/gi;
const WA_RE = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=|web\.whatsapp\.com\/send\?phone=)([\d\s\-()+]{6,})/gi;

// Teléfonos Uruguayos: Celulares 09x xxx xxx / +598 9x xxx xxx, y Fijos 2xxx xxxx / 4xxx xxxx
const TEL_RE = /(?:\+?598[\s\-]?)?(?:0?9[1-9][\s\-]?\d{3}[\s\-]?\d{3}|[24]\d{3}[\s\-]?\d{4})/g;

const EMAILS_IGNORAR = [
  'example.com',
  'sentry',
  'wixpress',
  'googleapis',
  'domain.com',
  'email.com',
  'tudominio',
  '@2x',
  '@3x',
  'sentry.io',
  'cloudflare.com',
  'yourdomain.com',
  'sitename.com',
  'test.com',
];

const EXT_BASURA = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.css', '.js', '.ico', '.pdf', '.zip'];

const PISTAS_CONTACTO = [
  'contact',
  'contacto',
  'nosotros',
  'quienes',
  'quienes-somos',
  'about',
  'empresa',
  'equipo',
  'info',
  'donde-estamos',
  'sucursales',
];

const EN_VENTA_RE = /for sale|domain is for sale|este dominio.{0,25}(en venta|a la venta)|compr[áa] (este |el )?dominio|buy this domain|domain parking|parked free|sedo|afternic|godaddy|precio de venta del dominio/i;

const MARCAS_ENMASCARADO = ['[email', 'email protected', '__cf_email__', 'cfemail'];

export function esEmailValido(e: string): boolean {
  if (!e || e.length > 80) return false;
  const lower = e.toLowerCase();
  if (MARCAS_ENMASCARADO.some(m => lower.includes(m))) return false;
  return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(e);
}

export function esIpPrivada(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname === '127.0.0.1') {
    return true;
  }
  if (net.isIP(hostname)) {
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16
    if (hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('127.') || hostname.startsWith('169.254.')) {
      return true;
    }
    const parts = hostname.split('.').map(Number);
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      return true;
    }
  }
  return false;
}

export function extraerEmails(texto: string): string[] {
  if (!texto) return [];
  const encontrados = new Set<string>();
  const matches = texto.match(EMAIL_RE) || [];

  for (const m of matches) {
    const e = m.toLowerCase().replace(/^[.,;:\s<>()]+|[.,;:\s<>()]+$/g, '');
    if (!esEmailValido(e)) continue;
    if (EMAILS_IGNORAR.some(x => e.includes(x))) continue;
    if (EXT_BASURA.some(x => e.endsWith(x))) continue;
    encontrados.add(e);
  }

  return Array.from(encontrados).sort();
}

export function extraerTelefonos(texto: string): string[] {
  if (!texto) return [];
  const vistos = new Set<string>();
  const matches = texto.match(TEL_RE) || [];

  for (const m of matches) {
    const t = m.replace(/[^\d+]/g, '');
    if (t.length >= 7) {
      vistos.add(t);
    }
  }

  return Array.from(vistos);
}

export function extraerWhatsApp(texto: string): string[] {
  if (!texto) return [];
  const vistos = new Set<string>();
  let match;
  const regex = new RegExp(WA_RE.source, 'gi');
  while ((match = regex.exec(texto)) !== null) {
    if (match[1]) {
      const clean = match[1].replace(/[^\d]/g, '');
      if (clean.length >= 7) {
        vistos.add(clean);
      }
    }
  }
  return Array.from(vistos);
}

export function esDominioEnVenta(texto: string): boolean {
  return EN_VENTA_RE.test(texto || '');
}

const GENERICOS_NOMBRE = new Set([
  'inicio',
  'home',
  'contacto',
  'contact',
  'nosotros',
  'quienes somos',
  'empresa',
  'bienvenido',
  'bienvenida',
  'welcome',
  'principal',
  'servicios',
  'servicio',
  'index',
  'pagina principal',
  'página principal',
  'inmobiliaria',
  'administradora',
]);

export function limpiarNombre(titulo: string, fallback: string = ''): string {
  const t = (titulo || '').trim();
  if (!t) return fallback;
  const partes = t
    .split(/\s*(?:\||—|–|·|::|\/\/|>)\s*|\s+-\s+/)
    .map(p => p.trim())
    .filter(Boolean);

  const buenos = partes.filter(p => !GENERICOS_NOMBRE.has(p.toLowerCase()) && p.length >= 4);
  const elegido = buenos[0] || partes[0] || fallback;
  return elegido.replace(/\s+/g, ' ').slice(0, 100).trim();
}

export function normalizarTelefonoUY(valor: string): string {
  if (!valor) return '';
  const d = valor.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('598')) return '+' + d;
  if (d.startsWith('09')) return '+598' + d.slice(1);
  if (d.length === 8 && (d.startsWith('2') || d.startsWith('4') || d.startsWith('9'))) {
    return '+598' + d;
  }
  return valor;
}

export interface SchemaOrgData {
  nombre?: string;
  telefonos: string[];
  emails: string[];
  direccion?: string;
  coordenadas?: { lat: number; lng: number };
  tipo?: string;
}

export function extraerSchemaOrg(html: string): SchemaOrgData {
  const data: SchemaOrgData = { telefonos: [], emails: [] };
  const $ = cheerio.load(html);

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text().trim();
      if (!raw) return;
      const parsed = JSON.parse(raw);

      const items = Array.isArray(parsed) ? parsed : parsed['@graph'] ? parsed['@graph'] : [parsed];

      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const tipo = String(item['@type'] || '');

        if (
          tipo.includes('RealEstateAgent') ||
          tipo.includes('LocalBusiness') ||
          tipo.includes('Organization') ||
          tipo.includes('ProfessionalService') ||
          tipo.includes('Corporation')
        ) {
          data.tipo = tipo;
          if (item.name && typeof item.name === 'string' && !data.nombre) {
            data.nombre = item.name.trim();
          }
          if (item.telephone) {
            const tels = Array.isArray(item.telephone) ? item.telephone : [item.telephone];
            for (const t of tels) {
              if (typeof t === 'string' && t.trim()) data.telefonos.push(t.trim());
            }
          }
          if (item.email) {
            const ems = Array.isArray(item.email) ? item.email : [item.email];
            for (const em of ems) {
              if (typeof em === 'string' && esEmailValido(em.trim())) data.emails.push(em.trim().toLowerCase());
            }
          }
          if (item.address) {
            if (typeof item.address === 'string') {
              data.direccion = item.address.trim();
            } else if (typeof item.address === 'object') {
              const street = item.address.streetAddress || '';
              const locality = item.address.addressLocality || '';
              const region = item.address.addressRegion || '';
              data.direccion = [street, locality, region].filter(Boolean).join(', ');
            }
          }
          if (item.geo && typeof item.geo === 'object') {
            const lat = parseFloat(item.geo.latitude);
            const lng = parseFloat(item.geo.longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
              data.coordenadas = { lat, lng };
            }
          }
        }
      }
    } catch {}
  });

  return data;
}

export function categorizarPorContenido(
  metaDesc: string,
  metaKeywords: string,
  titulo: string,
  schemaTipo: string,
  textoVisible: string
): string {
  const corpus = `${schemaTipo} ${metaDesc} ${metaKeywords} ${titulo} ${textoVisible.slice(0, 1500)}`.toLowerCase();

  if (
    corpus.includes('administradora de edificios') ||
    corpus.includes('administracion de edificios') ||
    corpus.includes('gastos comunes') ||
    corpus.includes('copropietarios') ||
    corpus.includes('consorcios') ||
    corpus.includes('administración de propiedades') ||
    corpus.includes('administracion de propiedades')
  ) {
    return 'Administración de Edificios';
  }

  if (
    schemaTipo.includes('RealEstateAgent') ||
    corpus.includes('inmobiliaria') ||
    corpus.includes('inmobiliario') ||
    corpus.includes('bienes raíces') ||
    corpus.includes('bienes raices') ||
    corpus.includes('real estate') ||
    corpus.includes('alquiler de casas') ||
    corpus.includes('alquiler de apartamentos') ||
    corpus.includes('venta de apartamentos') ||
    corpus.includes('venta de casas') ||
    corpus.includes('tasaciones de inmuebles') ||
    corpus.includes('tasaciones') ||
    corpus.includes('terrenos en venta')
  ) {
    return 'Inmobiliaria';
  }

  if (
    corpus.includes('construccion') ||
    corpus.includes('construcción') ||
    corpus.includes('constructora') ||
    corpus.includes('arquitectura') ||
    corpus.includes('arquitecto') ||
    corpus.includes('reformas integrales') ||
    corpus.includes('obras civiles') ||
    corpus.includes('albanileria') ||
    corpus.includes('albañilería') ||
    corpus.includes('impermeabilizacion') ||
    corpus.includes('impermeabilización') ||
    corpus.includes('hormigon') ||
    corpus.includes('hormigón') ||
    corpus.includes('pintura de obras')
  ) {
    return 'Construcción';
  }

  if (
    corpus.includes('clinica') ||
    corpus.includes('clínica') ||
    corpus.includes('sanatorio') ||
    corpus.includes('odontolog') ||
    corpus.includes('dentista') ||
    corpus.includes('medico') ||
    corpus.includes('médico') ||
    corpus.includes('medicina') ||
    corpus.includes('psicolog') ||
    corpus.includes('fisioterap') ||
    corpus.includes('farmacia') ||
    corpus.includes('laboratorio clinico') ||
    corpus.includes('pediatria') ||
    corpus.includes('oftalmolog')
  ) {
    return 'Salud';
  }

  if (
    corpus.includes('abogado') ||
    corpus.includes('abogados') ||
    corpus.includes('estudio juridico') ||
    corpus.includes('estudio jurídico') ||
    corpus.includes('escriban') ||
    corpus.includes('notari') ||
    corpus.includes('asesoramiento legal') ||
    corpus.includes('derecho laboral') ||
    corpus.includes('derecho civil')
  ) {
    return 'Legal y Notarial';
  }

  if (
    corpus.includes('estudio contable') ||
    corpus.includes('contador publico') ||
    corpus.includes('contadores') ||
    corpus.includes('asesoria contable') ||
    corpus.includes('auditoria') ||
    corpus.includes('finanzas') ||
    corpus.includes('financiera') ||
    corpus.includes('prestamos') ||
    corpus.includes('seguros') ||
    corpus.includes('tributario')
  ) {
    return 'Finanzas y Contabilidad';
  }

  if (
    corpus.includes('software') ||
    corpus.includes('desarrollo web') ||
    corpus.includes('tecnologia') ||
    corpus.includes('tecnología') ||
    corpus.includes('sistemas') ||
    corpus.includes('ciberseguridad') ||
    corpus.includes('informatica') ||
    corpus.includes('informática') ||
    corpus.includes('marketing digital') ||
    corpus.includes('it solutions')
  ) {
    return 'Tecnología';
  }

  if (
    corpus.includes('limpieza') ||
    corpus.includes('seguridad privada') ||
    corpus.includes('sanitaria') ||
    corpus.includes('plomeria') ||
    corpus.includes('electricista') ||
    corpus.includes('cerrajeria') ||
    corpus.includes('cerrajería') ||
    corpus.includes('aire acondicionado') ||
    corpus.includes('fumigacion') ||
    corpus.includes('fumigación')
  ) {
    return 'Servicios y Mantenimiento';
  }

  if (
    corpus.includes('taller mecanico') ||
    corpus.includes('taller mecánico') ||
    corpus.includes('automotriz') ||
    corpus.includes('repuestos') ||
    corpus.includes('concesionaria') ||
    corpus.includes('rent a car') ||
    corpus.includes('fletes') ||
    corpus.includes('logistica') ||
    corpus.includes('logística')
  ) {
    return 'Automotriz y Transporte';
  }

  if (
    corpus.includes('colegio') ||
    corpus.includes('escuela') ||
    corpus.includes('universidad') ||
    corpus.includes('instituto') ||
    corpus.includes('academia') ||
    corpus.includes('cursos') ||
    corpus.includes('capacitacion') ||
    corpus.includes('capacitación')
  ) {
    return 'Educación';
  }

  if (
    corpus.includes('restaurante') ||
    corpus.includes('hotel') ||
    corpus.includes('posada') ||
    corpus.includes('gastronomia') ||
    corpus.includes('gastronomía') ||
    corpus.includes('cafe') ||
    corpus.includes('cafeteria') ||
    corpus.includes('catering')
  ) {
    return 'Gastronomía y Hotelería';
  }

  return 'Comercio / Servicios';
}

export interface CrawlResult {
  url: string;
  dominio: string;
  nombre: string;
  titulo: string;
  categoria: string;
  metaDescripcion: string;
  emails: string[];
  telefonos: string[];
  whatsapps: string[];
  emailElegido: string;
  telefonoElegido: string;
  whatsappElegido: string;
  direccion: string;
  redes: { whatsapp?: string; facebook?: string; instagram?: string; linkedin?: string };
  scoreConfianza: number;
  origenContacto: string;
  textoLimpio: string;
  descartado: boolean;
  motivoDescarte?: string;
  duracionSeg: number;
}

export async function rastrearSitio(
  urlObjetivo: string,
  dominio: string,
  tituloBusqueda: string,
  seguirContacto: boolean = true,
  timeoutMs: number = 5500
): Promise<CrawlResult> {
  const t0 = Date.now();
  let url = urlObjetivo.startsWith('http') ? urlObjetivo : `https://${dominio}`;

  const defaultResult: CrawlResult = {
    url,
    dominio,
    nombre: limpiarNombre(tituloBusqueda, dominio),
    titulo: tituloBusqueda,
    categoria: 'Empresa',
    metaDescripcion: '',
    emails: [],
    telefonos: [],
    whatsapps: [],
    emailElegido: '',
    telefonoElegido: '',
    whatsappElegido: '',
    direccion: '',
    redes: {},
    scoreConfianza: 50,
    origenContacto: 'regex_web',
    textoLimpio: '',
    descartado: false,
    duracionSeg: 0,
  };

  try {
    const parsedUrl = new URL(url);
    if (esIpPrivada(parsedUrl.hostname)) {
      defaultResult.descartado = true;
      defaultResult.motivoDescarte = 'IP privada/SSRF bloqueada';
      return defaultResult;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let html = '';
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      // Stream cap at 400KB
      const reader = res.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        const maxBytes = 400000;
        while (true) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          chunks.push(value);
          totalBytes += value.length;
          if (totalBytes >= maxBytes) break;
        }
        html = Buffer.concat(chunks).toString('utf-8');
      } else {
        html = await res.text();
      }
    } finally {
      clearTimeout(timer);
    }

    if (!html) {
      defaultResult.duracionSeg = Number(((Date.now() - t0) / 1000).toFixed(2));
      return defaultResult;
    }

    // 1. Extraer JSON-LD Schema.org primero (la fuente más fidedigna)
    const schema = extraerSchemaOrg(html);

    const $ = cheerio.load(html);

    // Tags directos semánticos
    const mailtoHrefs: string[] = [];
    $('a[href^="mailto:"]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
      if (esEmailValido(email)) mailtoHrefs.push(email.toLowerCase());
    });

    const telHrefs: string[] = [];
    $('a[href^="tel:"]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const tel = href.replace(/^tel:/i, '').trim();
      if (tel) telHrefs.push(tel);
    });

    // Enlaces a Redes Sociales
    const redes: { whatsapp?: string; facebook?: string; instagram?: string; linkedin?: string } = {};
    $('a[href]').each((_, a) => {
      const href = $(a).attr('href') || '';
      if (href.includes('facebook.com/') && !href.includes('/sharer')) redes.facebook = href;
      if (href.includes('instagram.com/')) redes.instagram = href;
      if (href.includes('linkedin.com/company/')) redes.linkedin = href;
    });

    const metaDescription =
      $('meta[name="description"]').attr('content')?.trim() ||
      $('meta[property="og:description"]').attr('content')?.trim() ||
      $('meta[name="twitter:description"]').attr('content')?.trim() ||
      '';
    const metaKeywords = $('meta[name="keywords"]').attr('content')?.trim() || '';

    // Filtros de scripts y estilos para texto visible
    $('script, style, svg, noscript, link, iframe').remove();

    const titleTag = $('title').text().trim();
    const ogSiteName = $('meta[property="og:site_name"]').attr('content')?.trim() || '';
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
    const h1 = $('h1').first().text().trim();

    if (esDominioEnVenta(titleTag) || esDominioEnVenta(html.slice(0, 4000))) {
      defaultResult.descartado = true;
      defaultResult.motivoDescarte = 'Dominio en venta o aparcado';
      defaultResult.duracionSeg = Number(((Date.now() - t0) / 1000).toFixed(2));
      return defaultResult;
    }

    const textoVisible = $('body').text().replace(/\s+/g, ' ').trim();
    const categoriaDetectada = categorizarPorContenido(
      metaDescription,
      metaKeywords,
      ogTitle || titleTag || h1 || tituloBusqueda,
      schema.tipo || '',
      textoVisible
    );
    const regexEmails = extraerEmails(html + ' ' + textoVisible);
    const regexTelefonos = extraerTelefonos(textoVisible);
    const regexWhatsapps = extraerWhatsApp(html);

    // Unir emails sin duplicados
    const todosEmails = Array.from(new Set([...schema.emails, ...mailtoHrefs, ...regexEmails]));
    const todosTelefonos = Array.from(new Set([...schema.telefonos, ...telHrefs, ...regexTelefonos]));
    const todosWhatsapps = Array.from(new Set([...regexWhatsapps]));

    // Selección inteligente de nombre comercial
    let nombreLimpio = '';
    if (schema.nombre && schema.nombre.length >= 3) {
      nombreLimpio = schema.nombre;
    } else if (ogSiteName && ogSiteName.length >= 3 && !GENERICOS_NOMBRE.has(ogSiteName.toLowerCase())) {
      nombreLimpio = ogSiteName;
    } else {
      nombreLimpio = limpiarNombre(ogTitle || h1 || titleTag || tituloBusqueda, dominio);
    }

    let origenContacto = schema.emails.length > 0 ? 'schema_org' : mailtoHrefs.length > 0 ? 'mailto_link' : 'regex_web';

    // Si aún no hay email y seguirContacto está habilitado, rastrear página de contacto
    if (todosEmails.length === 0 && seguirContacto) {
      const contactLinks: string[] = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const txt = $(el).text().toLowerCase().trim();
        if (PISTAS_CONTACTO.some(p => href.toLowerCase().includes(p) || txt.includes(p))) {
          try {
            const absolute = new URL(href, url).toString();
            if (new URL(absolute).hostname.replace(/^www\./, '') === dominio.replace(/^www\./, '')) {
              if (!contactLinks.includes(absolute)) {
                contactLinks.push(absolute);
              }
            }
          } catch {}
        }
        if (contactLinks.length >= 2) return false;
      });

      if (contactLinks.length > 0) {
        try {
          const contactUrl = contactLinks[0];
          const cCtrl = new AbortController();
          const cTimer = setTimeout(() => cCtrl.abort(), 3500);
          const cRes = await fetch(contactUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            },
            signal: cCtrl.signal,
          });
          clearTimeout(cTimer);
          if (cRes.ok) {
            const cHtml = await cRes.text();
            const cSchema = extraerSchemaOrg(cHtml);
            const c$ = cheerio.load(cHtml);
            c$('script, style, svg, noscript').remove();
            const cText = c$('body').text();
            const cEmails = extraerEmails(cHtml + ' ' + cText);
            const cPhones = extraerTelefonos(cText);
            const cWa = extraerWhatsApp(cHtml);

            for (const em of [...cSchema.emails, ...cEmails]) {
              if (!todosEmails.includes(em)) {
                todosEmails.push(em);
                origenContacto = 'contacto_subpagina';
              }
            }
            for (const ph of [...cSchema.telefonos, ...cPhones]) {
              if (!todosTelefonos.includes(ph)) todosTelefonos.push(ph);
            }
            for (const wa of cWa) {
              if (!todosWhatsapps.includes(wa)) todosWhatsapps.push(wa);
            }
            if (cSchema.direccion && !schema.direccion) {
              schema.direccion = cSchema.direccion;
            }
          }
        } catch {}
      }
    }

    // Elegir el mejor email (preferir del mismo dominio, luego genéricos)
    let emailElegido = '';
    if (todosEmails.length > 0) {
      const delMismo = todosEmails.filter(e => e.includes(dominio));
      const pool = delMismo.length > 0 ? delMismo : todosEmails;
      const genericos = ['contacto@', 'info@', 'ventas@', 'administracion@', 'admin@', 'hola@'];
      emailElegido = pool.find(e => genericos.some(g => e.startsWith(g))) || pool[0];
    }

    const telElegido = todosTelefonos[0] ? normalizarTelefonoUY(todosTelefonos[0]) : '';
    const waElegido = todosWhatsapps[0] ? normalizarTelefonoUY(todosWhatsapps[0]) : '';
    if (waElegido) redes.whatsapp = `https://wa.me/${waElegido.replace(/\D/g, '')}`;

    // Calcular score de confianza (0 - 100)
    let scoreConfianza = 40;
    if (schema.emails.length > 0 || schema.telefonos.length > 0) scoreConfianza += 30;
    if (emailElegido && emailElegido.includes(dominio)) scoreConfianza += 25;
    else if (emailElegido) scoreConfianza += 15;
    if (telElegido) scoreConfianza += 10;
    if (waElegido) scoreConfianza += 10;
    if (schema.direccion) scoreConfianza += 10;
    scoreConfianza = Math.min(100, scoreConfianza);

    return {
      url,
      dominio,
      nombre: nombreLimpio,
      titulo: titleTag || tituloBusqueda,
      categoria: categoriaDetectada,
      metaDescripcion: metaDescription.slice(0, 300),
      emails: todosEmails,
      telefonos: todosTelefonos,
      whatsapps: todosWhatsapps,
      emailElegido,
      telefonoElegido: telElegido,
      whatsappElegido: waElegido,
      direccion: schema.direccion || '',
      redes,
      scoreConfianza,
      origenContacto,
      textoLimpio: textoVisible.slice(0, 4000),
      descartado: false,
      duracionSeg: Number(((Date.now() - t0) / 1000).toFixed(2)),
    };
  } catch {
    defaultResult.duracionSeg = Number(((Date.now() - t0) / 1000).toFixed(2));
    return defaultResult;
  }
}
