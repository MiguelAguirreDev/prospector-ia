import fs from 'fs';
import path from 'path';

export interface RedesSociales {
  whatsapp?: string;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
}

export interface Empresa {
  id: number;
  nombre: string;
  web: string;
  dominio: string;
  telefono: string;
  telefonos_secundarios?: string[];
  whatsapp: string;
  email: string;
  emails_secundarios?: string[];
  categoria: string;
  zona: string;
  direccion?: string;
  meta_description?: string;
  estado_email: string; // 'verificado', 'encontrado', 'sin_email'
  score_confianza?: number; // 0 a 100
  origen_contacto?: string; // 'schema_org' | 'regex_web' | 'contacto_subpagina' | 'ia_gemini'
  es_objetivo: number; // 1 | 0
  fuente: string;
  notas: string;
  redes?: RedesSociales;
  fecha_alta: string;
  fecha_check: string;
}

export interface DominioVisto {
  dominio: string;
  primer_visto: string;
  ultimo_intento: string;
  resultado: string;
}

export interface Lista {
  id: number;
  nombre: string;
  creada: string;
}

export interface EmpresaLista {
  empresa_id: number;
  lista_id: number;
  fecha: string;
}

export interface BusquedaHistorial {
  id: string;
  nombre: string;
  consultas: string[];
  zona: string;
  max: number;
  usar_ia: boolean;
  modo_rapido: boolean;
  usar_maps: boolean;
  usar_maps_visible: boolean;
  usar_buscadores: boolean;
  lista_nombre: string;
  lista_auto: boolean;
  auto_barrios: boolean;
  modo: 'simple' | 'continuo';
  estado: 'en_curso' | 'pausada' | 'completada';
  fecha_inicio: string;
  fecha_fin?: string;
  empresas_nuevas: number;
  con_email: number;
  con_telefono: number;
  procesadas: number;
  indice_consulta?: number;
  consultas_totales?: number;
  vuelta?: number;
}

export interface DBData {
  empresas: Empresa[];
  dominios: Record<string, DominioVisto>;
  listas: Lista[];
  empresa_lista: EmpresaLista[];
  busquedas: BusquedaHistorial[];
  uso_ia: Record<string, number>;
  siguiente_id_empresa: number;
  siguiente_id_lista: number;
}

const DATOS_DIR = path.resolve(process.cwd(), 'datos');
const DB_FILE = path.join(DATOS_DIR, 'prospector.json');

export class BaseDatos {
  private data: DBData;

  constructor() {
    if (!fs.existsSync(DATOS_DIR)) {
      fs.mkdirSync(DATOS_DIR, { recursive: true });
    }

    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        if (!Array.isArray(this.data.busquedas)) {
          this.data.busquedas = [];
        }
      } catch (err) {
        console.error('Error loading DB file, initializing fresh:', err);
        this.data = this.getDefaultData();
      }
    } else {
      this.data = this.getDefaultData();
      this.guardar();
    }
  }

  private getDefaultData(): DBData {
    return {
      empresas: [],
      dominios: {},
      listas: [],
      empresa_lista: [],
      busquedas: [],
      uso_ia: {},
      siguiente_id_empresa: 1,
      siguiente_id_lista: 1,
    };
  }

  public guardar(): void {
    try {
      const tempPath = `${DB_FILE}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tempPath, DB_FILE);
    } catch (err) {
      console.error('Error saving DB:', err);
    }
  }

  public estadisticas() {
    const total = this.data.empresas.length;
    const con_email = this.data.empresas.filter(e => !!e.email).length;
    const verificado = this.data.empresas.filter(e => e.estado_email === 'verificado').length;
    const con_telefono = this.data.empresas.filter(e => !!e.telefono || !!e.whatsapp).length;
    const dominios_vistos = Object.keys(this.data.dominios).length;
    return {
      empresas: total,
      con_email,
      verificado,
      con_telefono,
      dominios_vistos,
    };
  }

  public normalizarDominio(url: string): string {
    if (!url) return '';
    let limpia = url.trim();
    if (!limpia.includes('://')) {
      limpia = 'http://' + limpia;
    }
    try {
      let host = new URL(limpia).hostname.toLowerCase();
      if (host.startsWith('www.')) {
        host = host.slice(4);
      }
      return host;
    } catch {
      return '';
    }
  }

  public reservarDominio(dominio: string): boolean {
    const d = dominio.toLowerCase().trim();
    if (!d) return false;
    if (this.data.dominios[d]) {
      return false; // ya reservado o visto
    }
    const ahora = new Date().toISOString();
    this.data.dominios[d] = {
      dominio: d,
      primer_visto: ahora,
      ultimo_intento: ahora,
      resultado: 'en_curso',
    };
    this.guardar();
    return true;
  }

  public liberarDominio(dominio: string): void {
    const d = dominio.toLowerCase().trim();
    if (d && this.data.dominios[d] && this.data.dominios[d].resultado === 'en_curso') {
      delete this.data.dominios[d];
      this.guardar();
    }
  }

  public registrarDominio(dominio: string, resultado: string) {
    const d = dominio.toLowerCase().trim();
    if (!d) return;
    const ahora = new Date().toISOString();
    if (!this.data.dominios[d]) {
      this.data.dominios[d] = {
        dominio: d,
        primer_visto: ahora,
        ultimo_intento: ahora,
        resultado,
      };
    } else {
      this.data.dominios[d].ultimo_intento = ahora;
      this.data.dominios[d].resultado = resultado;
    }
    this.guardar();
  }

  public yaVisto(dominio: string): boolean {
    const d = dominio.toLowerCase().trim();
    return Boolean(this.data.dominios[d]);
  }

  public buscarPorDominio(dominio: string): Empresa | undefined {
    const d = dominio.toLowerCase().trim();
    return this.data.empresas.find(e => e.dominio === d);
  }

  public obtenerOCrearLista(nombre: string): Lista {
    const n = nombre.trim();
    let l = this.data.listas.find(item => item.nombre.toLowerCase() === n.toLowerCase());
    if (!l) {
      l = {
        id: this.data.siguiente_id_lista++,
        nombre: n,
        creada: new Date().toISOString(),
      };
      this.data.listas.push(l);
      this.guardar();
    }
    return l;
  }

  public agregarEmpresaALista(empresaId: number, listaId: number) {
    const existe = this.data.empresa_lista.some(
      el => el.empresa_id === empresaId && el.lista_id === listaId
    );
    if (!existe) {
      this.data.empresa_lista.push({
        empresa_id: empresaId,
        lista_id: listaId,
        fecha: new Date().toISOString(),
      });
      this.guardar();
    }
  }

  public guardarEmpresa(datos: Partial<Empresa>, listas: string[] = []): Empresa {
    const dominio = (datos.dominio || this.normalizarDominio(datos.web || '')).toLowerCase();
    const ahora = new Date().toISOString();

    let empresa = this.data.empresas.find(e => e.dominio === dominio);
    if (empresa) {
      // Actualizar campos si se proporcionan nuevos datos
      if (datos.nombre && (!empresa.nombre || empresa.nombre === dominio)) empresa.nombre = datos.nombre;
      if (datos.telefono && !empresa.telefono) empresa.telefono = datos.telefono;
      if (datos.telefonos_secundarios) empresa.telefonos_secundarios = datos.telefonos_secundarios;
      if (datos.whatsapp && !empresa.whatsapp) empresa.whatsapp = datos.whatsapp;
      if (datos.email && !empresa.email) {
        empresa.email = datos.email;
        empresa.estado_email = datos.estado_email || 'encontrado';
      }
      if (datos.emails_secundarios) empresa.emails_secundarios = datos.emails_secundarios;
      if (datos.categoria && (!empresa.categoria || empresa.categoria === 'Empresa')) empresa.categoria = datos.categoria;
      if (datos.zona && !empresa.zona) empresa.zona = datos.zona;
      if (datos.direccion && !empresa.direccion) empresa.direccion = datos.direccion;
      if (datos.meta_description && !empresa.meta_description) empresa.meta_description = datos.meta_description;
      if (datos.redes) empresa.redes = { ...(empresa.redes || {}), ...datos.redes };
      if (datos.score_confianza !== undefined) empresa.score_confianza = datos.score_confianza;
      if (datos.origen_contacto) empresa.origen_contacto = datos.origen_contacto;
      empresa.fecha_check = ahora;
    } else {
      empresa = {
        id: this.data.siguiente_id_empresa++,
        nombre: datos.nombre || '',
        web: datos.web || `http://${dominio}`,
        dominio,
        telefono: datos.telefono || '',
        telefonos_secundarios: datos.telefonos_secundarios || [],
        whatsapp: datos.whatsapp || '',
        email: datos.email || '',
        emails_secundarios: datos.emails_secundarios || [],
        categoria: datos.categoria || 'Empresa',
        zona: datos.zona || '',
        direccion: datos.direccion || '',
        meta_description: datos.meta_description || '',
        estado_email: datos.estado_email || (datos.email ? 'encontrado' : 'sin_email'),
        score_confianza: datos.score_confianza || (datos.email ? 85 : 50),
        origen_contacto: datos.origen_contacto || 'regex_web',
        es_objetivo: datos.es_objetivo !== undefined ? datos.es_objetivo : 1,
        fuente: datos.fuente || '',
        notas: datos.notas || '',
        redes: datos.redes || {},
        fecha_alta: ahora,
        fecha_check: ahora,
      };
      this.data.empresas.push(empresa);
    }

    // Vincular a listas
    for (const nom of listas) {
      if (nom && nom.trim()) {
        const lista = this.obtenerOCrearLista(nom.trim());
        this.agregarEmpresaALista(empresa.id, lista.id);
      }
    }

    this.registrarDominio(dominio, empresa.email ? 'con_email' : 'sin_email');
    this.guardar();
    return empresa;
  }

  public listar(limite: number = 200): Empresa[] {
    return [...this.data.empresas].reverse().slice(0, limite);
  }

  public conEmail(limite?: number): Empresa[] {
    const res = this.data.empresas.filter(e => !!e.email);
    return limite ? res.slice(0, limite) : res;
  }

  public listarListas(): Array<{ id: number; nombre: string; creada: string; n: number; con_email: number }> {
    return this.data.listas.map(lista => {
      const vinculos = this.data.empresa_lista.filter(el => el.lista_id === lista.id);
      const empresaIds = new Set(vinculos.map(el => el.empresa_id));
      const empresas = this.data.empresas.filter(e => empresaIds.has(e.id));
      const con_email = empresas.filter(e => !!e.email).length;

      return {
        id: lista.id,
        nombre: lista.nombre,
        creada: lista.creada,
        n: empresas.length,
        con_email,
      };
    });
  }

  public empresasDeLista(nombre: string): Empresa[] {
    const lista = this.data.listas.find(
      l => l.nombre.toLowerCase() === nombre.trim().toLowerCase()
    );
    if (!lista) return [];
    const vinculos = this.data.empresa_lista.filter(el => el.lista_id === lista.id);
    const empresaIds = new Set(vinculos.map(el => el.empresa_id));
    return this.data.empresas.filter(e => empresaIds.has(e.id));
  }

  public borrarLista(nombre: string, tambienEmpresas: boolean = false): { ok: boolean; empresasBorradas: number } {
    const idx = this.data.listas.findIndex(
      l => l.nombre.toLowerCase() === nombre.trim().toLowerCase()
    );
    if (idx === -1) return { ok: false, empresasBorradas: 0 };
    const listaId = this.data.listas[idx].id;

    let empresasBorradas = 0;
    if (tambienEmpresas) {
      const ids = new Set(
        this.data.empresa_lista.filter(el => el.lista_id === listaId).map(el => el.empresa_id)
      );
      // Borrado directo (no usar borrarEmpresa para guardar una sola vez al final)
      const dominiosABorrar: string[] = [];
      for (const e of this.data.empresas) {
        if (ids.has(e.id)) {
          if (e.dominio) dominiosABorrar.push(e.dominio.toLowerCase());
          empresasBorradas++;
        }
      }
      this.data.empresas = this.data.empresas.filter(e => !ids.has(e.id));
      for (const d of dominiosABorrar) delete this.data.dominios[d];
    }

    this.data.listas.splice(idx, 1);
    this.data.empresa_lista = this.data.empresa_lista.filter(el => el.lista_id !== listaId);
    if (tambienEmpresas) {
      // Quitar vínculos huérfanos de las empresas borradas
      const vivas = new Set(this.data.empresas.map(e => e.id));
      this.data.empresa_lista = this.data.empresa_lista.filter(el => vivas.has(el.empresa_id));
    }
    this.guardar();
    return { ok: true, empresasBorradas };
  }

  /** Borra una empresa por id, sus vínculos con listas y su dominio (para poder re-descubrirla). */
  public borrarEmpresa(id: number): boolean {
    const idx = this.data.empresas.findIndex(e => e.id === id);
    if (idx === -1) return false;
    const dominio = (this.data.empresas[idx].dominio || '').toLowerCase();
    this.data.empresas.splice(idx, 1);
    this.data.empresa_lista = this.data.empresa_lista.filter(el => el.empresa_id !== id);
    if (dominio) delete this.data.dominios[dominio];
    this.guardar();
    return true;
  }

  /** Empresas guardadas que todavía no tienen email (para el rescate). */
  public sinEmail(): Empresa[] {
    return this.data.empresas.filter(e => !e.email);
  }

  /** Crea o registra una nueva búsqueda en el historial */
  public crearBusqueda(params: Partial<BusquedaHistorial>): BusquedaHistorial {
    const id = 'busq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const nombre =
      params.nombre ||
      (params.consultas && params.consultas[0]) ||
      (params.auto_barrios ? 'Búsqueda por todos los barrios' : 'Búsqueda');

    const nueva: BusquedaHistorial = {
      id,
      nombre,
      consultas: params.consultas || [],
      zona: params.zona || '',
      max: params.max || 20,
      usar_ia: params.usar_ia ?? true,
      modo_rapido: params.modo_rapido ?? true,
      usar_maps: params.usar_maps ?? false,
      usar_maps_visible: params.usar_maps_visible ?? false,
      usar_buscadores: params.usar_buscadores ?? true,
      lista_nombre: params.lista_nombre || '',
      lista_auto: params.lista_auto ?? true,
      auto_barrios: params.auto_barrios ?? false,
      modo: params.modo || 'simple',
      estado: 'en_curso',
      fecha_inicio: new Date().toISOString(),
      empresas_nuevas: 0,
      con_email: 0,
      con_telefono: 0,
      procesadas: 0,
      indice_consulta: 0,
      consultas_totales: (params.consultas || []).length,
      vuelta: 1,
    };

    if (!Array.isArray(this.data.busquedas)) {
      this.data.busquedas = [];
    }
    this.data.busquedas.unshift(nueva);
    if (this.data.busquedas.length > 100) {
      this.data.busquedas = this.data.busquedas.slice(0, 100);
    }
    this.guardar();
    return nueva;
  }

  public actualizarBusqueda(id: string, parcial: Partial<BusquedaHistorial>): BusquedaHistorial | null {
    if (!this.data.busquedas) this.data.busquedas = [];
    const item = this.data.busquedas.find(b => b.id === id);
    if (!item) return null;
    Object.assign(item, parcial);
    item.fecha_fin = new Date().toISOString();
    this.guardar();
    return item;
  }

  public obtenerBusqueda(id: string): BusquedaHistorial | null {
    if (!this.data.busquedas) this.data.busquedas = [];
    return this.data.busquedas.find(b => b.id === id) || null;
  }

  public listarBusquedas(): BusquedaHistorial[] {
    return this.data.busquedas || [];
  }

  public borrarBusqueda(id: string): boolean {
    if (!this.data.busquedas) return false;
    const prevLen = this.data.busquedas.length;
    this.data.busquedas = this.data.busquedas.filter(b => b.id !== id);
    if (this.data.busquedas.length !== prevLen) {
      this.guardar();
      return true;
    }
    return false;
  }

  public borrarHistorialBusquedas(): { ok: boolean; borradas: number } {
    const borradas = (this.data.busquedas || []).length;
    this.data.busquedas = [];
    this.guardar();
    return { ok: true, borradas };
  }

  /** Borra TODA la base de datos: empresas, dominios, listas, vínculos, historial y uso de IA.
   * Deja la base vacía como si acabara de crearse. */
  public reiniciarTodo(): { ok: boolean; empresasBorradas: number; listasBorradas: number; busquedasBorradas: number } {
    const empresasBorradas = this.data.empresas.length;
    const listasBorradas = this.data.listas.length;
    const busquedasBorradas = (this.data.busquedas || []).length;
    this.data.empresas = [];
    this.data.dominios = {};
    this.data.listas = [];
    this.data.empresa_lista = [];
    this.data.busquedas = [];
    this.data.uso_ia = {};
    this.data.siguiente_id_empresa = 1;
    this.data.siguiente_id_lista = 1;
    this.guardar();
    return { ok: true, empresasBorradas, listasBorradas, busquedasBorradas };
  }
}

export const db = new BaseDatos();
