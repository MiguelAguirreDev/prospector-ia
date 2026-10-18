import { db, Empresa } from './db.js';
import { busquedaMultiFuente, buscarEmailEnBuscadores, FuentesReporte, SearchResult } from './search.js';
import { rastrearSitio, normalizarTelefonoUY, CrawlResult } from './crawler.js';
import { consultarIA } from './ai.js';
import { exportarTodasLasListas } from './exporter.js';
import { buscarMaps, MapsNegocio, normaliza } from './maps.js';

export interface MonitorState {
  fase: 'inactivo' | 'buscando' | 'procesando' | 'chequeando' | 'esperando';
  consulta: string;
  consulta_n: number;
  consultas_totales: number;
  vuelta: number;
  candidatos: number;
  procesadas: number;
  nuevas: number;
  con_email: number;
  con_telefono: number;
  sin_email: number;
  ia_llamadas: number;
  ia_salvados: number;
  schema_org_encontrados: number;
  excluidas: number;
  repetidas: number;
  en_curso: string[];
  fuentes: FuentesReporte;
  t_total: number;
  t_busqueda: number;
  t_rastreo_prom: number;
  t_ia_prom: number;
  corriendo?: boolean;
  titulo?: string;
}

export class Monitor {
  public data: MonitorState;
  private t0: number = 0;
  private tRastreo: number[] = [];
  private tIa: number[] = [];

  constructor() {
    this.data = this.getDefaultState();
  }

  private getDefaultState(): MonitorState {
    return {
      fase: 'inactivo',
      consulta: '',
      consulta_n: 0,
      consultas_totales: 0,
      vuelta: 0,
      candidatos: 0,
      procesadas: 0,
      nuevas: 0,
      con_email: 0,
      con_telefono: 0,
      sin_email: 0,
      ia_llamadas: 0,
      ia_salvados: 0,
      schema_org_encontrados: 0,
      excluidas: 0,
      repetidas: 0,
      en_curso: [],
      fuentes: {},
      t_total: 0,
      t_busqueda: 0,
      t_rastreo_prom: 0,
      t_ia_prom: 0,
    };
  }

  public reiniciar(): void {
    this.data = this.getDefaultState();
    this.t0 = Date.now();
    this.tRastreo = [];
    this.tIa = [];
  }

  public poner(parcial: Partial<MonitorState>): void {
    Object.assign(this.data, parcial);
  }

  public agregarEnCurso(dominio: string): void {
    if (!this.data.en_curso.includes(dominio)) {
      this.data.en_curso = [...this.data.en_curso, dominio];
    }
  }

  public quitarEnCurso(dominio: string): void {
    this.data.en_curso = this.data.en_curso.filter(d => d !== dominio);
  }

  public registrarTiempoRastreo(seg: number): void {
    this.tRastreo.push(seg);
    if (this.tRastreo.length > 200) {
      this.tRastreo = this.tRastreo.slice(-100);
    }
    const sum = this.tRastreo.reduce((a, b) => a + b, 0);
    this.data.t_rastreo_prom = Number((sum / this.tRastreo.length).toFixed(2));
  }

  public registrarTiempoIA(seg: number): void {
    this.tIa.push(seg);
    if (this.tIa.length > 100) {
      this.tIa = this.tIa.slice(-50);
    }
    const sum = this.tIa.reduce((a, b) => a + b, 0);
    this.data.t_ia_prom = Number((sum / this.tIa.length).toFixed(2));
  }

  public estado(): MonitorState {
    if (this.t0 > 0 && this.data.fase !== 'inactivo') {
      this.data.t_total = Math.round((Date.now() - this.t0) / 1000);
    }
    return { ...this.data };
  }
}

export const monitor = new Monitor();

export interface AppState {
  corriendo: boolean;
  log: string[];
  titulo: string;
  resultado: string;
  parar: boolean;
  pedido: string;
}

export const appState: AppState = {
  corriendo: false,
  log: [],
  titulo: '',
  resultado: '',
  parar: false,
  pedido: '',
};

export function agregarLog(msg: string): void {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const marca = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const linea = `${marca}  ${msg}`;
  appState.log.push(linea);
  if (appState.log.length > 3000) {
    appState.log.splice(0, 1500);
  }
}

export function pedirParar(guardar: boolean = false): void {
  appState.parar = true;
  appState.pedido = guardar ? 'guardar' : 'parar';
  agregarLog(guardar ? '⏹ Solicitud de GUARDAR Y PARAR recibida...' : '⏹ Solicitud de PARAR recibida...');
}

export function debeParar(): boolean {
  return appState.parar;
}

const RUBROS = [
  'administradoras de edificios',
  'inmobiliarias',
  'administración de propiedades',
  'administración de gastos comunes',
];

const BARRIOS_MVD = [
  'Ciudad Vieja', 'Centro', 'Cordón', 'Barrio Sur', 'Palermo', 'Parque Rodó',
  'Punta Carretas', 'Pocitos', 'Buceo', 'Malvín', 'Malvín Norte', 'Punta Gorda',
  'Carrasco', 'Carrasco Norte', 'Bañados de Carrasco', 'Jardines', 'Tres Cruces',
  'La Blanqueada', 'Parque Batlle', 'Villa Dolores', 'Aguada', 'Prado', 'Capurro',
  'Bella Vista', 'Arroyo Seco', 'Paso Molino', 'Belvedere', 'Sayago', 'Peñarol',
  'Colón', 'Lezica', 'Nuevo París', 'Cerro', 'La Teja', 'Ituzaingó',
  'Villa Española', 'Unión', 'Maroñas', 'Flor de Maroñas', 'Manga',
  'Punta de Rieles', 'Toledo', 'Santiago Vázquez',
];

const BARRIOS_CDC = [
  'Ciudad de la Costa', 'Solymar', 'Lagomar', 'El Pinar', 'Shangrilá',
  'Lomas de Solymar', 'Parque del Plata', 'Las Flores', 'La Floresta',
  'Atlántida', 'Salinas', 'Neptunia', 'Pinamar',
];

const BARRIOS_MALDONADO = [
  'Punta del Este', 'Maldonado', 'La Barra', 'Manantiales', 'Piriápolis',
];

export function generarConsultasAuto(): string[] {
  const out: string[] = [];
  for (const barrio of BARRIOS_MVD) {
    for (const rubro of RUBROS) {
      out.push(`${rubro} ${barrio} Montevideo`);
    }
  }
  for (const barrio of BARRIOS_CDC) {
    for (const rubro of RUBROS) {
      out.push(`${rubro} ${barrio} Canelones`);
    }
  }
  for (const barrio of BARRIOS_MALDONADO) {
    for (const rubro of RUBROS) {
      out.push(`${rubro} ${barrio} Maldonado`);
    }
  }
  return out;
}

function listasPara(consulta: string, listaNombre: string, listaAuto: boolean): string[] {
  if (listaAuto) {
    const c = (consulta || '').trim();
    return c ? [c] : ['general'];
  }
  const n = (listaNombre || '').trim();
  return n ? [n] : ['general'];
}

/** ¿El teléfono (ya normalizado) es un celular uruguayo? (para marcar WhatsApp) */
function esCelularUY(tel: string): boolean {
  const d = (tel || '').replace(/\D/g, '');
  return d.startsWith('09') || d.startsWith('5989');
}

/** Convierte un negocio de Google Maps en un candidato del pipeline. */
function mapsASearchResult(m: MapsNegocio): SearchResult {
  const web = (m.sitio_web || '').trim();
  let dominio = '';
  if (web) {
    dominio = db.normalizarDominio(/^https?:\/\//i.test(web) ? web : `http://${web}`);
  }
  const descripcion = [m.categoria, m.direccion].filter(Boolean).join(' · ');
  const base: SearchResult = {
    titulo: m.nombre,
    url: web || m.url || '',
    descripcion,
    dominio,
    fuente: 'google_maps',
    maps: {
      telefono: m.telefono || '',
      direccion: m.direccion || '',
      categoria: m.categoria || '',
      rating: m.rating || '',
      resenas: m.resenas || '',
    },
  };
  if (!dominio) {
    // Negocio sin web: usamos una clave sintética para deduplicar.
    base.solo_maps = true;
    base.dominio = 'maps:' + (normaliza(m.nombre + (m.telefono || '')) || String(Date.now()));
    base.url = m.url || '';
  }
  return base;
}

/** Para negocios de Maps sin web: intenta hallar su sitio real buscando por nombre. */
async function descubrirSitioPorNombre(nombre: string, zona: string): Promise<SearchResult | null> {
  const objetivo = normaliza(nombre).slice(0, 12);
  if (!objetivo) return null;
  try {
    const { resultados } = await busquedaMultiFuente(`${nombre} ${zona || 'Montevideo'}`.trim(), 10);
    for (const r of resultados) {
      if (!r.dominio) continue;
      const t = normaliza(r.titulo);
      const d = normaliza(r.dominio);
      if (t.includes(objetivo) || d.includes(objetivo)) return r;
    }
  } catch {
    // sin resultado
  }
  return null;
}

export async function procesarConsulta(
  consulta: string,
  maxNuevos: number,
  zona: string,
  usarIA: boolean,
  modoRapido: boolean,
  listas: string[],
  usarMaps: boolean = false,
  usarMapsVisible: boolean = false
): Promise<Empresa[]> {
  monitor.poner({ fase: 'buscando', consulta });
  agregarLog(`🔎 Buscando en fuentes paralelas: "${consulta}" (meta: ${maxNuevos} nuevas)`);

  const { resultados, fuentes, duracionSeg } = await busquedaMultiFuente(consulta, Math.max(30, maxNuevos * 2));
  monitor.poner({ fuentes, t_busqueda: duracionSeg });

  agregarLog(
    `Buscadores en ${duracionSeg}s: ` +
      Object.entries(fuentes)
        .map(([k, v]) => `${k}=${v.error ? 'falló' : v.resultados}`)
        .join(', ') +
      ` (${resultados.length} dominios únicos)`
  );

  // Fuente adicional: Google Maps (con navegador real). Trae teléfono/dirección y,
  // cuando el negocio los publica, el sitio web que luego se rastrea para el email.
  if (usarMaps) {
    agregarLog(`🗺️  Google Maps: abriendo navegador y buscando "${consulta}"...`);
    try {
      const tMaps = Date.now();
      // Modo rápido: NO abre detalle de cada ficha (lee todo de la tarjeta).
      // Esto es mucho más rápido (estilo scraper del escritorio).
      // Si usarMapsVisible, el navegador de Chromium se ve mientras busca.
      const negocios = await buscarMaps(consulta, Math.max(8, Math.min(30, maxNuevos + 6)), {
        enriquecerDetalles: false,
        concurrencia: 2,
        headless: !usarMapsVisible,
      });
      const items = negocios.map(mapsASearchResult).filter(r => r.dominio);
      resultados.unshift(...items);
      const conWeb = items.filter(i => !i.solo_maps).length;
      fuentes['google_maps'] = { resultados: items.length, error: false };
      monitor.poner({
        fuentes,
        t_busqueda: duracionSeg + Number(((Date.now() - tMaps) / 1000).toFixed(2)),
      });
      agregarLog(
        `🗺️  Google Maps en ${((Date.now() - tMaps) / 1000).toFixed(1)}s: ${items.length} negocios ` +
          `(${conWeb} con web, ${items.length - conWeb} solo teléfono)`
      );
    } catch (err: any) {
      fuentes['google_maps'] = { resultados: 0, error: true };
      monitor.poner({ fuentes });
      agregarLog(`[!] Google Maps falló: ${err?.message || err}`);
    }
  }

  // Pre-filtro: descartar ya vistas o ya guardadas
  const pendientes: SearchResult[] = [];
  let repetidas = 0;

  for (const r of resultados) {
    const dom = r.dominio;
    const existente = db.buscarPorDominio(dom);
    if (existente) {
      for (const nom of listas) {
        if (nom) {
          const l = db.obtenerOCrearLista(nom);
          db.agregarEmpresaALista(existente.id, l.id);
        }
      }
      repetidas++;
      continue;
    }

    if (db.yaVisto(dom)) {
      repetidas++;
      continue;
    }

    pendientes.push(r);
  }

  monitor.poner({
    fase: 'procesando',
    candidatos: pendientes.length,
    repetidas: monitor.data.repetidas + repetidas,
  });

  agregarLog(`Candidatos a rastrear: ${pendientes.length} nuevos (${repetidas} ya conocidos/asociados)`);

  const empresasGuardadas: Empresa[] = [];
  // Alta concurrencia (15 sitios simultáneos)
  const CONCURRENCIA = 15;

  for (let i = 0; i < pendientes.length; i += CONCURRENCIA) {
    if (debeParar()) {
      agregarLog('⏹ Deteniendo rastreo por petición del usuario.');
      break;
    }

    if (empresasGuardadas.length >= maxNuevos) {
      agregarLog(`Alcanzada meta de ${maxNuevos} empresas nuevas para esta consulta.`);
      break;
    }

    const lote = pendientes.slice(i, i + CONCURRENCIA);

    await Promise.all(
      lote.map(async item => {
        if (debeParar() || empresasGuardadas.length >= maxNuevos) return;

        // Negocio de Maps SIN web: lo guardamos con teléfono/dirección y, si el modo IA
        // está activo, buscamos el correo con buscadores + IA (Paso 3-4). Maps no da email.
        if (item.solo_maps) {
          let emailEncontrado = '';
          let origenEmail = '';
          let emailEnWeb = '';
          const m = item.maps || {};

          if (usarIA && !debeParar()) {
            // Paso 3: buscar en buscadores ("nombre @gmail.com", "nombre contacto", etc.)
            const hallado = await buscarEmailEnBuscadores(item.titulo, zona, modoRapido ? 1 : 3);
            if (hallado) {
              emailEncontrado = hallado.email;
              origenEmail = 'buscador';
              agregarLog(`🔎 Buscador encontró email para ${item.titulo}: ${hallado.email} (vía ${hallado.fuente})`);
            }

            // Paso 2 alternativo: intentar descubrir su sitio web por nombre y rastrearlo para el email.
            if (!emailEncontrado && !debeParar()) {
              const sitio = await descubrirSitioPorNombre(item.titulo, zona);
              if (sitio && sitio.dominio && !db.yaVisto(sitio.dominio)) {
                try {
                  const crawl = await rastrearSitio(sitio.url, sitio.dominio, sitio.titulo, !modoRapido, 6000);
                  if (crawl.emailElegido) {
                    emailEncontrado = crawl.emailElegido;
                    origenEmail = crawl.origenContacto || 'regex_web';
                    emailEnWeb = sitio.url;
                    agregarLog(`🌐 Web encontrada para ${item.titulo}: ${sitio.url} → email ${emailEncontrado}`);
                  }
                } catch {
                  // si falla el rastreo, seguimos con IA abajo
                }
              }
            }

            // Paso 4: IA de respaldo (sobre la web descubierta o sobre datos de Maps).
            if (!emailEncontrado && !debeParar()) {
              const textoWeb = emailEnWeb ? '' : `${item.titulo} ${item.descripcion || ''} ${m.direccion || ''} ${m.telefono || ''}`;
              const iaRes = await consultarIA({
                titulo: item.titulo,
                web: emailEnWeb || item.url,
                snippet: item.descripcion || '',
                emailsEncontrados: [],
                telefonosEncontrados: [m.telefono].filter(Boolean) as string[],
                textoWeb,
              });
              if (iaRes.duracionSeg > 0) monitor.registrarTiempoIA(iaRes.duracionSeg);
              if (iaRes.resuelto && iaRes.email) {
                emailEncontrado = iaRes.email;
                origenEmail = 'ia_gemini';
                monitor.poner({ ia_salvados: monitor.data.ia_salvados + 1 });
                agregarLog(`🤖 IA (${iaRes.proveedor || 'n/d'}) resolvió email para ${item.titulo}: ${emailEncontrado}`);
              }
            }
          }

          if (!db.reservarDominio(item.dominio)) return;
          monitor.agregarEnCurso(item.dominio);
          try {
            const m = item.maps || {};
            const tel = normalizarTelefonoUY(m.telefono || '');
            const wa = esCelularUY(tel) ? tel : '';
            const nota = [m.rating ? `Maps ★${m.rating}${m.resenas ? ` (${m.resenas})` : ''}` : '', 'sin web en Maps']
              .filter(Boolean)
              .join(' · ');
            const nueva = db.guardarEmpresa(
              {
                nombre: item.titulo,
                web: emailEnWeb || item.url,
                dominio: item.dominio,
                telefono: tel,
                whatsapp: wa,
                email: emailEncontrado,
                categoria: m.categoria || 'Empresa',
                zona: zona || '',
                direccion: m.direccion || '',
                estado_email: emailEncontrado ? (origenEmail === 'ia_gemini' ? 'encontrado' : 'verificado') : 'sin_email',
                score_confianza: emailEncontrado ? (origenEmail === 'buscador' ? 70 : 85) : 40,
                origen_contacto: origenEmail || 'google_maps',
                fuente: 'google_maps',
                notas: nota,
              },
              listas
            );
            empresasGuardadas.push(nueva);
            monitor.poner({
              procesadas: monitor.data.procesadas + 1,
              nuevas: monitor.data.nuevas + 1,
              con_email: monitor.data.con_email + (emailEncontrado ? 1 : 0),
              con_telefono: monitor.data.con_telefono + (tel || wa ? 1 : 0),
              sin_email: monitor.data.sin_email + (emailEncontrado ? 0 : 1),
            });
            const telIcon = tel ? `📞 ${tel}` : '';
            const waIcon = wa ? `💬 WA: ${wa}` : '';
            const dirIcon = m.direccion ? `📍 ${m.direccion}` : '';
            const emailIcon = emailEncontrado ? `📧 ${emailEncontrado}` : '⚪ sin email';
            agregarLog(`+ 🗺️ [maps] ${item.titulo} | ${emailIcon} ${telIcon} ${waIcon} ${dirIcon}`.trim());
          } catch {
            db.liberarDominio(item.dominio);
          } finally {
            monitor.quitarEnCurso(item.dominio);
          }
          return;
        }

        const dominio = item.dominio;
        if (!db.reservarDominio(dominio)) return;

        monitor.agregarEnCurso(dominio);

        try {
          // Rastrear sitio a alta velocidad con Schema.org + microdatos
          const crawl = await rastrearSitio(item.url, dominio, item.titulo, !modoRapido, 5500);
          monitor.registrarTiempoRastreo(crawl.duracionSeg);

          if (crawl.descartado) {
            monitor.poner({ excluidas: monitor.data.excluidas + 1 });
            db.registrarDominio(dominio, 'descartado');
            return;
          }

          if (crawl.origenContacto === 'schema_org') {
            monitor.poner({ schema_org_encontrados: monitor.data.schema_org_encontrados + 1 });
          }

          let finalNombre = crawl.nombre;
          let finalEmail = crawl.emailElegido;
          let finalTel = crawl.telefonoElegido;
          let finalWa = crawl.whatsappElegido;
          let categoria = crawl.categoria || 'Empresa';
          let finalDireccion = crawl.direccion || '';
          let estadoEmail = finalEmail ? 'verificado' : 'sin_email';

          // Completar con los datos de Google Maps cuando la web no los tenga.
          const mm = item.maps;
          if (mm) {
            if (!finalNombre) finalNombre = item.titulo;
            if (!finalTel && mm.telefono) finalTel = normalizarTelefonoUY(mm.telefono);
            if (!finalWa && finalTel && esCelularUY(finalTel)) finalWa = finalTel;
            if ((!categoria || categoria === 'Empresa') && mm.categoria) categoria = mm.categoria;
            if (!finalDireccion && mm.direccion) finalDireccion = mm.direccion;
          }

          // Paso 3: si la web no tenía email, probamos buscadores ("nombre" "@gmail.com" / "contacto").
          if (!finalEmail && !debeParar()) {
            const hallado = await buscarEmailEnBuscadores(
              finalNombre || item.titulo || dominio,
              zona,
              modoRapido ? 1 : 3
            );
            if (hallado) {
              finalEmail = hallado.email;
              estadoEmail = 'encontrado';
              agregarLog(
                `🔎 Buscador encontró email para ${dominio}: ${finalEmail} (vía ${hallado.fuente})`
              );
            }
          }

          // IA de respaldo únicamente si no se encontró email
          const invocarIA = usarIA && (!finalEmail || !modoRapido);

          if (invocarIA && !debeParar()) {
            monitor.poner({ ia_llamadas: monitor.data.ia_llamadas + 1 });
            const iaRes = await consultarIA({
              titulo: item.titulo,
              web: item.url,
              snippet: item.descripcion,
              emailsEncontrados: crawl.emails,
              telefonosEncontrados: crawl.telefonos,
              textoWeb: crawl.textoLimpio,
            });

            if (iaRes.duracionSeg > 0) {
              monitor.registrarTiempoIA(iaRes.duracionSeg);
            }

            if (iaRes.nombre && (!finalNombre || finalNombre === dominio)) finalNombre = iaRes.nombre;
            if (iaRes.categoria && (!categoria || categoria === 'Empresa')) categoria = iaRes.categoria;
            if (iaRes.telefono && !finalTel) finalTel = normalizarTelefonoUY(iaRes.telefono);
            if (iaRes.whatsapp && !finalWa) finalWa = normalizarTelefonoUY(iaRes.whatsapp);

            if (iaRes.resuelto && iaRes.email) {
              finalEmail = iaRes.email;
              estadoEmail = 'verificado';
              monitor.poner({ ia_salvados: monitor.data.ia_salvados + 1 });
              agregarLog(
                `🤖 IA (${iaRes.proveedor || 'n/d'}) resolvió email para ${dominio}: ${finalEmail}`
              );
            } else if (iaRes.duracionSeg > 0) {
              agregarLog(
                `🤖 IA (${iaRes.proveedor || 'n/d'}) revisó ${dominio} sin email verificado (no publica o no lo expone)`
              );
            }
          }

          const nuevaEmpresa = db.guardarEmpresa(
            {
              nombre: finalNombre || dominio,
              web: crawl.url,
              dominio,
              telefono: finalTel,
              telefonos_secundarios: crawl.telefonos.slice(1),
              whatsapp: finalWa,
              email: finalEmail,
              emails_secundarios: crawl.emails.slice(1),
              categoria,
              zona: zona || '',
              direccion: finalDireccion,
              meta_description: crawl.metaDescripcion || '',
              estado_email: estadoEmail,
              score_confianza: crawl.scoreConfianza,
              origen_contacto: crawl.origenContacto,
              redes: crawl.redes,
              fuente: item.fuente || item.titulo,
            },
            listas
          );

          empresasGuardadas.push(nuevaEmpresa);

          monitor.poner({
            procesadas: monitor.data.procesadas + 1,
            nuevas: monitor.data.nuevas + 1,
            con_email: monitor.data.con_email + (finalEmail ? 1 : 0),
            con_telefono: monitor.data.con_telefono + (finalTel || finalWa ? 1 : 0),
            sin_email: monitor.data.sin_email + (finalEmail ? 0 : 1),
          });

          const emailIcon = finalEmail ? `📧 ${finalEmail}` : '⚪ sin email';
          const telIcon = finalTel ? `📞 ${finalTel}` : '';
          const waIcon = finalWa ? `💬 WA: ${finalWa}` : '';
          const schemaIcon = crawl.origenContacto === 'schema_org' ? '🏷️ Schema.org' : '';
          const catIcon = `[${categoria}]`;
          const dirIcon = finalDireccion ? `📍 ${finalDireccion}` : '';
          agregarLog(`+ [${dominio}] ${catIcon} ${finalNombre} | ${emailIcon} ${telIcon} ${waIcon} ${schemaIcon} ${dirIcon}`.trim());
        } catch {
          // Si falló por red transitoria, liberar para no descartar para siempre
          db.liberarDominio(dominio);
        } finally {
          monitor.quitarEnCurso(dominio);
        }
      })
    );
  }

  return empresasGuardadas;
}

export async function lanzarTareaBuscar(
  consultas: string[],
  maxN: number,
  zona: string,
  usarIA: boolean,
  listaNombre: string,
  listaAuto: boolean,
  modoRapido: boolean,
  usarMaps: boolean = false,
  usarMapsVisible: boolean = false
): Promise<void> {
  let totalNuevas = 0;
  agregarLog(`=== Iniciando búsqueda de ${consultas.length} consulta(s) a alta velocidad ===`);

  for (let i = 0; i < consultas.length; i++) {
    if (debeParar()) break;
    const c = consultas[i];
    const listas = listasPara(c, listaNombre, listaAuto);
    monitor.poner({
      consulta_n: i + 1,
      consultas_totales: consultas.length,
    });

    const guardadas = await procesarConsulta(c, maxN, zona, usarIA, modoRapido, listas, usarMaps, usarMapsVisible);
    totalNuevas += guardadas.length;
    agregarLog(`-> ${guardadas.length} nuevas de "${c}" (listas: ${listas.join(', ')})`);
  }

  monitor.poner({ fase: 'inactivo' });
  const exportadas = exportarTodasLasListas();
  if (exportadas.length > 0) {
    agregarLog(`💾 Guardadas ${exportadas.length} listas en formato Excel en salida/listas`);
  }

  const stats = db.estadisticas();
  agregarLog(`Estado actual: ${JSON.stringify(stats)}`);
  appState.resultado = `${totalNuevas} empresas nuevas`;
}

export async function lanzarTareaContinua(
  consultas: string[],
  maxN: number,
  zona: string,
  usarIA: boolean,
  autoBarrios: boolean,
  listaNombre: string,
  listaAuto: boolean,
  modoRapido: boolean,
  usarMaps: boolean = false,
  usarMapsVisible: boolean = false
): Promise<void> {
  const listaConsultas = autoBarrios ? generarConsultasAuto() : consultas;
  agregarLog(
    `=== Modo Continuo iniciado con ${listaConsultas.length} consultas ${autoBarrios ? '(Montevideo + Canelones + Maldonado)' : ''} ===`
  );

  let vuelta = 1;
  let totalNuevasGlobal = 0;

  while (!debeParar()) {
    monitor.poner({ vuelta });
    let nuevasEnEstaVuelta = 0;

    for (let i = 0; i < listaConsultas.length; i++) {
      if (debeParar()) break;
      const c = listaConsultas[i];
      const listas = listasPara(c, listaNombre, listaAuto);
      monitor.poner({
        consulta_n: i + 1,
        consultas_totales: listaConsultas.length,
      });

      const guardadas = await procesarConsulta(c, maxN, zona, usarIA, modoRapido, listas, usarMaps, usarMapsVisible);
      nuevasEnEstaVuelta += guardadas.length;
      totalNuevasGlobal += guardadas.length;
      agregarLog(`[Vuelta ${vuelta}] -> ${guardadas.length} nuevas de "${c}"`);
    }

    if (debeParar()) break;

    if (nuevasEnEstaVuelta === 0) {
      monitor.poner({ fase: 'esperando' });
      agregarLog('⏸️ Vuelta completa sin empresas nuevas. Esperando 20 segundos antes de reintentar...');
      for (let s = 0; s < 20; s++) {
        if (debeParar()) break;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    vuelta++;
  }

  monitor.poner({ fase: 'inactivo' });
  exportarTodasLasListas();
  appState.resultado = `${totalNuevasGlobal} empresas procesadas en modo continuo`;
  agregarLog(`=== Modo Continuo finalizado. Total acumulado: ${totalNuevasGlobal} ===`);
}

/**
 * Rescate de emails: recorre las empresas guardadas SIN email, vuelve a visitar su web,
 * busca el correo en buscadores y (si hace falta) usa la IA. Escribe el resultado de vuelta
 * en la base. Es el "Paso 4" del flujo (bucle + IA por cada negocio).
 */
export async function lanzarTareaRescatarEmails(usarIA: boolean): Promise<void> {
  const objetivo = db.sinEmail();
  agregarLog(`=== Rescate de emails: ${objetivo.length} empresa(s) sin email ===`);
  if (objetivo.length === 0) {
    agregarLog('Nada que rescatar: todas las empresas ya tienen email.');
    appState.resultado = '0 emails rescatados';
    return;
  }

  monitor.poner({ fase: 'chequeando', consultas_totales: objetivo.length, consulta_n: 0 });
  let encontrados = 0;

  for (let i = 0; i < objetivo.length; i++) {
    if (debeParar()) break;
    const e = objetivo[i];
    monitor.poner({ consulta_n: i + 1, consulta: e.nombre || e.dominio, procesadas: i });
    monitor.agregarEnCurso(e.dominio);

    try {
      let email = '';
      let origen = '';
      let textoWeb = '';
      let emailsCrawl: string[] = [];
      let telefonos: string[] = [];

      // 1) Re-rastrear su web (portada + contacto)
      if (e.web && /^https?:\/\//i.test(e.web)) {
        const crawl = await rastrearSitio(e.web, e.dominio, e.nombre, true, 6000);
        textoWeb = crawl.textoLimpio || '';
        emailsCrawl = crawl.emails || [];
        telefonos = crawl.telefonos || [];
        if (crawl.emailElegido) {
          email = crawl.emailElegido;
          origen = crawl.origenContacto || 'regex_web';
        }
      }

      // 2) Buscadores (Paso 3)
      if (!email) {
        const f = await buscarEmailEnBuscadores(e.nombre || e.dominio, e.zona, 3);
        if (f) {
          email = f.email;
          origen = 'buscador';
        }
      }

      // 3) IA (Paso 4)
      if (!email && usarIA && (textoWeb || emailsCrawl.length)) {
        monitor.poner({ ia_llamadas: monitor.data.ia_llamadas + 1 });
        const iaRes = await consultarIA({
          titulo: e.nombre,
          web: e.web,
          snippet: e.meta_description || '',
          emailsEncontrados: emailsCrawl,
          telefonosEncontrados: telefonos,
          textoWeb,
        });
        if (iaRes.duracionSeg > 0) monitor.registrarTiempoIA(iaRes.duracionSeg);
        if (iaRes.resuelto && iaRes.email) {
          email = iaRes.email;
          origen = 'ia_gemini';
          monitor.poner({ ia_salvados: monitor.data.ia_salvados + 1 });
        }
      }

      if (email) {
        db.guardarEmpresa({
          dominio: e.dominio,
          email,
          estado_email: origen === 'ia_gemini' || origen === 'buscador' ? 'encontrado' : 'verificado',
          origen_contacto: origen,
          score_confianza: origen === 'buscador' ? 70 : undefined,
        });
        encontrados++;
        monitor.poner({ con_email: monitor.data.con_email + 1, sin_email: Math.max(0, monitor.data.sin_email - 1) });
        agregarLog(`✅ Email rescatado para ${e.dominio}: ${email} (${origen})`);
      } else {
        agregarLog(`⚪ ${e.dominio}: sigue sin email`);
      }
    } catch {
      // aislamos errores por empresa
    } finally {
      monitor.quitarEnCurso(e.dominio);
    }
  }

  monitor.poner({ fase: 'inactivo' });
  const stats = db.estadisticas();
  agregarLog(`=== Rescate terminado: ${encontrados} email(s) nuevos. Estado: ${JSON.stringify(stats)} ===`);
  appState.resultado = `${encontrados} emails rescatados`;
}

export function iniciarTarea(nombre: string, fn: () => Promise<void>): boolean {
  if (appState.corriendo) return false;
  appState.corriendo = true;
  appState.log = [];
  appState.titulo = nombre;
  appState.resultado = '';
  appState.parar = false;
  appState.pedido = '';

  monitor.reiniciar();

  (async () => {
    try {
      await fn();
    } catch (err: any) {
      agregarLog(`[!] Error crítico en tarea: ${err.message || err}`);
    } finally {
      agregarLog('=== Terminado ===');
      appState.corriendo = false;
      monitor.poner({ fase: 'inactivo' });
    }
  })();

  return true;
}
