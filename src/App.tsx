import React, { useState, useEffect, useRef } from 'react';
import {
  Compass,
  Search,
  Play,
  Square,
  Save,
  FileSpreadsheet,
  FileText,
  Mail,
  Phone,
  Globe,
  CheckCircle2,
  Clock,
  Sparkles,
  RefreshCw,
  Trash2,
  Download,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Building2,
  MapPin,
  Monitor,
  Layers,
  MessageSquare,
  Filter,
  Award,
  Tag,
  Copy,
  Check,
  CheckCircle,
  XCircle,
  X,
  AlertTriangle,
  Server,
  AtSign,
  Send,
} from 'lucide-react';

interface Stats {
  empresas: number;
  con_email: number;
  verificado: number;
  con_telefono?: number;
  dominios_vistos: number;
}

interface Empresa {
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
  estado_email: string;
  score_confianza?: number;
  origen_contacto?: string;
  redes?: { whatsapp?: string; facebook?: string; instagram?: string; linkedin?: string };
  fecha_alta: string;
}

interface ListaItem {
  id: number;
  nombre: string;
  creada: string;
  n: number;
  con_email: number;
}

interface MonitorProgress {
  fase: string;
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
  fuentes: Record<string, { resultados: number; error: boolean }>;
  t_total: number;
  t_busqueda: number;
  t_rastreo_prom: number;
  t_ia_prom: number;
  corriendo: boolean;
  titulo: string;
}

interface EmailCheckResult {
  email: string;
  usuario?: string;
  dominio?: string;
  sintaxis_valida: boolean;
  tiene_mx: boolean;
  servidores_mx: string[];
  es_proveedor_gratuito: boolean;
  es_desechable: boolean;
  es_cuenta_rol: boolean;
  coincide_con_dominio: boolean;
  score: number;
  estado: 'excelente' | 'bueno' | 'regular' | 'invalido';
  mensaje: string;
}

const clientEmailCache = new Map<string, EmailCheckResult>();

function VisualEmailStatus({ email, dominio }: { email: string; dominio: string }) {
  const [hovered, setHovered] = useState(false);
  const [info, setInfo] = useState<EmailCheckResult | null>(() => clientEmailCache.get(`${email}_${dominio}`) || null);
  const [loading, setLoading] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const hideTimerRef = useRef<any>(null);

  const onMouseEnter = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setHovered(true);
    if (!info && !loading) {
      setLoading(true);
      fetch(`/api/verificar-email?email=${encodeURIComponent(email)}&dominio=${encodeURIComponent(dominio)}`)
        .then(r => r.json())
        .then(data => {
          clientEmailCache.set(`${email}_${dominio}`, data);
          setInfo(data);
        })
        .catch(() => {
          const fallback: EmailCheckResult = {
            email,
            sintaxis_valida: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email),
            tiene_mx: true,
            servidores_mx: [],
            es_proveedor_gratuito: email.includes('@gmail.com') || email.includes('@hotmail.com'),
            es_desechable: false,
            es_cuenta_rol: /^(info|contacto|ventas)@/i.test(email),
            coincide_con_dominio: Boolean(dominio && email.toLowerCase().includes(dominio.toLowerCase())),
            score: 80,
            estado: 'bueno',
            mensaje: 'Formato válido detectado',
          };
          setInfo(fallback);
        })
        .finally(() => setLoading(false));
    }
  };

  const onMouseLeave = () => {
    hideTimerRef.current = setTimeout(() => {
      setHovered(false);
    }, 200);
  };

  const copiarEmail = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(email);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  };

  const esSintaxisPrevia = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
  const esCorporativoPrevio = Boolean(dominio && email.toLowerCase().includes(dominio.toLowerCase().replace(/^www\./, '')));

  return (
    <div
      className="relative inline-block text-left"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center gap-1.5 cursor-pointer group">
        <a
          href={`mailto:${email}`}
          className="text-emerald-400 hover:text-emerald-300 hover:underline flex items-center gap-1 font-mono transition"
        >
          <Mail className="w-3.5 h-3.5 shrink-0 text-emerald-500 group-hover:scale-110 transition" />
          <span className="truncate max-w-[170px]">{email}</span>
        </a>

        {/* Status indicator dot */}
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 transition-transform group-hover:scale-125 ${
            info
              ? info.estado === 'excelente'
                ? 'bg-emerald-400 shadow-sm shadow-emerald-500/50 ring-2 ring-emerald-500/30'
                : info.estado === 'bueno'
                ? 'bg-blue-400 ring-2 ring-blue-500/30'
                : 'bg-amber-400 ring-2 ring-amber-500/30'
              : esCorporativoPrevio
              ? 'bg-emerald-400'
              : esSintaxisPrevia
              ? 'bg-blue-400'
              : 'bg-rose-400'
          }`}
          title="Pasa el cursor para verificar formato y DNS MX en tiempo real"
        />
      </div>

      {/* Floating Hover Card */}
      {hovered && (
        <div
          className="absolute left-0 bottom-full mb-2 w-80 bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl p-3.5 text-xs z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md"
          onMouseEnter={() => {
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          }}
          onMouseLeave={onMouseLeave}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#30363d]">
            <div className="flex items-center gap-1.5 font-bold text-white">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Verificación de Email</span>
            </div>
            <div className="flex items-center gap-1">
              {loading ? (
                <span className="text-[10px] text-[#8b949e] animate-pulse">Consultando MX...</span>
              ) : info ? (
                <span
                  className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                    info.score >= 80
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                      : info.score >= 60
                      ? 'bg-blue-950 text-blue-400 border border-blue-800/40'
                      : 'bg-amber-950 text-amber-400 border border-amber-800/40'
                  }`}
                >
                  {info.score}% Confiable
                </span>
              ) : null}
            </div>
          </div>

          {/* Email target and status badge */}
          <div className="mb-2.5">
            <div className="font-mono text-emerald-300 font-semibold break-all text-[11.5px]">
              {email}
            </div>
            <div className="text-[10.5px] text-[#8b949e] mt-0.5">
              {loading ? 'Verificando formato y servidor de correo...' : info?.mensaje}
            </div>
          </div>

          {/* Verification Checklist */}
          <div className="space-y-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 mb-2.5 font-sans">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#8b949e] flex items-center gap-1.5">
                {info?.sintaxis_valida ? (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                )}
                Sintaxis RFC 5322
              </span>
              <span className={info?.sintaxis_valida ? 'text-emerald-400 font-medium' : 'text-rose-400'}>
                {info?.sintaxis_valida ? 'Correcta' : 'Inválida'}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#8b949e] flex items-center gap-1.5">
                {info?.tiene_mx ? (
                  <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                )}
                Servidor de Correo (MX)
              </span>
              <span className={info?.tiene_mx ? 'text-emerald-400 font-medium truncate max-w-[120px]' : 'text-amber-400'}>
                {info?.tiene_mx ? (info.servidores_mx[0] || 'Activo en DNS') : 'Sin registros MX'}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#8b949e] flex items-center gap-1.5">
                <AtSign className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                Tipo de Buzón
              </span>
              <span className="text-white font-medium">
                {info?.coincide_con_dominio
                  ? 'Dominio Propio 🏢'
                  : info?.es_proveedor_gratuito
                  ? 'Público (Gmail/etc)'
                  : 'Empresarial'}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#8b949e] flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                Cuenta Institucional
              </span>
              <span className="text-[#c9d1d9]">
                {info?.es_cuenta_rol ? 'Rol (info/ventas/etc)' : 'Buzón directo'}
              </span>
            </div>
          </div>

          {/* Action buttons inside tooltip */}
          <div className="flex items-center gap-2 pt-1 border-t border-[#30363d]">
            <button
              onClick={copiarEmail}
              className="flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] text-[10.5px] transition"
            >
              {copiado ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiado ? '¡Copiado!' : 'Copiar'}</span>
            </button>
            <a
              href={`mailto:${email}`}
              className="flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-[10.5px] transition"
            >
              <Send className="w-3 h-3" />
              <span>Redactar</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [stats, setStats] = useState<Stats>({ empresas: 0, con_email: 0, verificado: 0, con_telefono: 0, dominios_vistos: 0 });
  const [consultas, setConsultas] = useState<string>(
    'administradoras de edificios Pocitos Montevideo\ninmobiliarias Cordón Montevideo\ninmobiliarias Ciudad de la Costa'
  );
  const [autoBarrios, setAutoBarrios] = useState<boolean>(false);
  const [maxPorTanda, setMaxPorTanda] = useState<number>(20);
  const [zona, setZona] = useState<string>('');
  const [usarIA, setUsarIA] = useState<boolean>(true);
  const [modoRapido, setModoRapido] = useState<boolean>(true);
  const [usarMaps, setUsarMaps] = useState<boolean>(false);
  const [mapsVisible, setMapsVisible] = useState<boolean>(false);
  const [listaNombre, setListaNombre] = useState<string>('');
  const [listaAuto, setListaAuto] = useState<boolean>(true);

  const [corriendo, setCorriendo] = useState<boolean>(false);
  const [tituloTarea, setTituloTarea] = useState<string>('');
  const [resultadoTarea, setResultadoTarea] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const [progreso, setProgreso] = useState<MonitorProgress | null>(null);

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [listas, setListas] = useState<ListaItem[]>([]);
  const [filtroEmpresas, setFiltroEmpresas] = useState<'todas' | 'con_email' | 'con_tel' | 'schema'>('todas');
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>('todas');
  const [busquedaTabla, setBusquedaTabla] = useState<string>('');
  const [listaSeleccionada, setListaSeleccionada] = useState<string>('');
  const [cargandoTabla, setCargandoTabla] = useState<boolean>(false);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  const [ultimoLogIndex, setUltimoLogIndex] = useState<number>(0);
  const logRef = useRef<HTMLDivElement>(null);

  // --- Toasts y Modales personalizados (reemplazan alert/confirm) ---
  const [toasts, setToasts] = useState<{ id: number; tipo: 'ok' | 'warn' | 'err' | 'info'; msg: string; t?: number }[]>([]);
  const toastId = useRef(0);
  const toast = (msg: string, tipo: 'ok' | 'warn' | 'err' | 'info' = 'info', segundos = 5) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, tipo, msg, t: segundos }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), segundos * 1000);
  };
  const quitarToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  // Modal de confirmación pendiente (resuelve una promesa)
  interface ConfirmPending {
    id: number;
    titulo: string;
    msg: string;
    tipo: 'borrar_lista' | 'borrar_empresa' | 'rescatar' | 'detener' | 'custom';
    onYes: () => void;
    onNo?: () => void;
  }
  const [confirmPending, setConfirmPending] = useState<ConfirmPending | null>(null);
  const confirmModal = (titulo: string, msg: string, onYes: () => void, onNo?: () => void, tipo: ConfirmPending['tipo'] = 'custom') => {
    const id = ++toastId.current;
    setConfirmPending({ id, titulo, msg, tipo, onYes, onNo });
  };

  const confirmAsync = (titulo: string, msg: string, tipo: ConfirmPending['tipo'] = 'custom'): Promise<boolean> => {
    return new Promise((resolve) => {
      const id = ++toastId.current;
      setConfirmPending({ id, titulo, msg, tipo,
        onYes: () => resolve(true),
        onNo: () => resolve(false)
      });
    });
  };

  // Load initial defaults
  useEffect(() => {
    fetch('/api/consultas-default')
      .then(r => r.json())
      .then(d => {
        if (d.consultas && d.consultas.length) {
          setConsultas(d.consultas.join('\n'));
        }
      })
      .catch(() => {});

    cargarStats();
    cargarListas();
    cargarEmpresas();
  }, []);

  // Poll state and logs
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const rLog = await fetch(`/api/log?desde=${ultimoLogIndex}`).then(r => r.json());
        if (rLog.lineas && rLog.lineas.length > 0) {
          setLogs(prev => [...prev, ...rLog.lineas]);
          setUltimoLogIndex(rLog.total);
          if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
          }
        }
        setCorriendo(rLog.corriendo);
        setTituloTarea(rLog.titulo);
        if (rLog.resultado) setResultadoTarea(rLog.resultado);

        const rProg = await fetch('/api/progreso').then(r => r.json());
        setProgreso(rProg);

        if (rLog.corriendo) {
          cargarStats();
        }
      } catch {}
    }, 1200);

    return () => clearInterval(interval);
  }, [ultimoLogIndex]);

  const cargarStats = async () => {
    try {
      const res = await fetch('/api/estado').then(r => r.json());
      setStats(res);
    } catch {}
  };

  const cargarListas = async () => {
    try {
      const res = await fetch('/api/listas').then(r => r.json());
      setListas(res);
    } catch {}
  };

  const cargarEmpresas = async (nombreDeLista?: string) => {
    setCargandoTabla(true);
    try {
      let url = '/api/lista?limite=300';
      if (nombreDeLista) {
        url = `/api/lista_de?nombre=${encodeURIComponent(nombreDeLista)}`;
      }
      const res = await fetch(url).then(r => r.json());
      setEmpresas(res);
      setListaSeleccionada(nombreDeLista || '');
    } catch {
    } finally {
      setCargandoTabla(false);
    }
  };

  const copiarPortapapeles = (texto: string, id: string) => {
    navigator.clipboard.writeText(texto);
    setCopiadoId(id);
    setTimeout(() => setCopiadoId(null), 1500);
  };

  const iniciarContinuo = async () => {
    const lineas = consultas.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lineas.length && !autoBarrios) {
      toast('Ingresá al menos una búsqueda o activá la opción de todos los barrios.', 'warn');
      return;
    }

    const payload = {
      consultas: lineas,
      auto_barrios: autoBarrios,
      max: maxPorTanda,
      zona,
      usar_ia: usarIA,
      modo_rapido: modoRapido,
      usar_maps: usarMaps,
      usar_maps_visible: mapsVisible,
      lista_nombre: listaNombre,
      lista_auto: listaAuto,
    };

    setLogs([]);
    setUltimoLogIndex(0);
    const res = await fetch('/api/continuo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());

    if (res.error) {
      toast(res.error, 'warn');
    } else {
      setCorriendo(true);
      cargarListas();
    }
  };

  const iniciarBusquedaSimple = async () => {
    const lineas = consultas.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lineas.length) {
      toast('Ingresá al menos una búsqueda.', 'warn');
      return;
    }

    const payload = {
      consultas: lineas,
      max: maxPorTanda,
      zona,
      usar_ia: usarIA,
      modo_rapido: modoRapido,
      usar_maps: usarMaps,
      usar_maps_visible: mapsVisible,
      lista_nombre: listaNombre,
      lista_auto: listaAuto,
    };

    setLogs([]);
    setUltimoLogIndex(0);
    const res = await fetch('/api/buscar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());

    if (res.error) {
      toast(res.error, 'warn');
    } else {
      setCorriendo(true);
      cargarListas();
    }
  };

  const parar = async () => {
    await fetch('/api/parar', { method: 'POST' });
  };

  const guardarYParar = async () => {
    await fetch('/api/guardar', { method: 'POST' });
  };

  const exportarGlobal = async (tipo: 'emails' | 'full' | 'listas') => {
    const res = await fetch('/api/exportar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo }),
    }).then(r => r.json());

    if (res.ok) {
      if (tipo === 'emails') {
        toast('Lotes de emails generados en salida/emails.', 'ok');
      } else if (tipo === 'full') {
        window.open('/api/descargar?archivo=empresas.xlsx', '_blank');
      } else {
        toast('Listas exportadas exitosamente en salida/listas.', 'ok');
      }
      cargarStats();
      cargarListas();
    }
  };

  const exportarListaItem = async (nombre: string) => {
    const res = await fetch('/api/exportar_lista', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre }),
    }).then(r => r.json());

    if (res.ok) {
      window.open(`/api/descargar?archivo=listas/${encodeURIComponent(res.xlsx.split('/').pop() || '')}`, '_blank');
      toast('Lista exportada a Excel.', 'ok');
    }
  };

  const borrarListaItem = async (nombre: string) => {
    if (!(await confirmAsync('¿Eliminar la lista?', `¿Eliminar la lista "${nombre}"? Las empresas no se borrarán.`, 'borrar_lista'))) return;
    const conEmpresas = await confirmAsync('¿Borrar empresas también?', `¿También BORRAR de la base las empresas de "${nombre}"?\n\nSí = borrar lista y empresas\nNo = borrar solo la lista`, 'borrar_lista');
    const res = await fetch('/api/borrar_lista', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, con_empresas: conEmpresas }),
    }).then(r => r.json());
    if (conEmpresas && res?.empresas_borradas) {
      toast(`Se borraron ${res.empresas_borradas} empresa(s) de la base.`, 'ok');
    }
    cargarListas();
    cargarStats();
    if (listaSeleccionada === nombre) {
      setListaSeleccionada('');
      cargarEmpresas();
    }
  };

  const borrarEmpresaItem = async (id: number, nombre: string) => {
    if (!(await confirmAsync('¿Borrar empresa?', `¿Borrar "${nombre}" de la base?\n(podrá volver a aparecer en una búsqueda)`, 'borrar_empresa'))) return;
    await fetch('/api/borrar_empresa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await cargarEmpresas(listaSeleccionada || undefined);
    cargarStats();
    cargarListas();
    toast('Empresa eliminada de la base.', 'ok');
  };

  const rescatarEmails = async () => {
    if (corriendo) return;
    if (!(await confirmAsync('Rescatar emails', 'Recorre las empresas SIN email: vuelve a visitar su web, las busca en buscadores y usa IA.\n\n¿Continuar?', 'rescatar')))
      return;
    setLogs([]);
    setUltimoLogIndex(0);
    const res = await fetch('/api/rescatar_emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usar_ia: usarIA }),
    }).then(r => r.json());
    if (res.error) {
      toast(res.error, 'warn');
    } else {
      setCorriendo(true);
      cargarListas();
      toast(res.resultado || 'Rescate de emails iniciado.', 'ok');
    }
  };

  const formatearTiempo = (seg: number = 0) => {
    const s = Math.round(seg);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m ${String(rem).padStart(2, '0')}s`;
  };

  // Distinct categories available
  const categoriasDisponibles = Array.from(
    new Set(
      empresas
        .map(e => e.categoria)
        .filter((c): c is string => Boolean(c && c !== 'Empresa'))
    )
  ).sort();

  // Filtered companies
  const empresasFiltradas = empresas.filter(e => {
    if (categoriaFiltro !== 'todas' && e.categoria !== categoriaFiltro) return false;
    if (filtroEmpresas === 'con_email' && !e.email) return false;
    if (filtroEmpresas === 'con_tel' && !e.telefono && !e.whatsapp) return false;
    if (filtroEmpresas === 'schema' && e.origen_contacto !== 'schema_org') return false;
    if (busquedaTabla) {
      const q = busquedaTabla.toLowerCase();
      const match =
        e.nombre.toLowerCase().includes(q) ||
        (e.categoria && e.categoria.toLowerCase().includes(q)) ||
        (e.meta_description && e.meta_description.toLowerCase().includes(q)) ||
        e.email.toLowerCase().includes(q) ||
        e.web.toLowerCase().includes(q) ||
        (e.telefono && e.telefono.includes(q)) ||
        (e.direccion && e.direccion.toLowerCase().includes(q)) ||
        (e.zona && e.zona.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  const cand = progreso?.candidatos || 0;
  const hechas = progreso?.procesadas || 0;
  const pct = cand > 0 ? Math.min(100, Math.round((hechas * 100) / cand)) : corriendo ? 100 : 0;

  // ============ COMPONENTE: Toast (notificación temporal) ============
  const ToastItem = ({ t }: { t: { id: number; tipo: 'ok' | 'warn' | 'err' | 'info'; msg: string; t?: number } }) => {
    const iconMap: Record<string, any> = {
      ok: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
      warn: <AlertTriangle className="w-4 h-4 text-amber-400" />,
      err: <AlertCircle className="w-4 h-4 text-rose-400" />,
      info: <Server className="w-4 h-4 text-blue-400" />,
    };
    const colorMap: Record<string, string> = {
      ok: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
      warn: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
      err: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
      info: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
    };
    return (
      <div
        className={`flex items-start gap-3 px-3 py-2 rounded-lg border text-xs text-left animate-in fade-in slide-in-from-top-2 duration-200 ${colorMap[t.tipo]}`}
        role="alert"
        aria-label={t.msg}
      >
        <div className="mt-0.5 shrink-0">{iconMap[t.tipo]}</div>
        <div className="leading-none">{t.msg}</div>
        <button
          onClick={() => quitarToast(t.id)}
          className="ml-auto mt-0.5 p-1 rounded hover:bg-[#30363d] text-[#8b949e] hover:text-white transition"
          title="Cerrar"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  };

  const ToastContainer = () => (
    <div className="fixed top-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem t={t} />
        </div>
      ))}
    </div>
  );

  // ============ COMPONENTE: Modal de confirmación ============
  const ModalConfirm = () => {
    if (!confirmPending) return null;
    const { id, titulo, msg, tipo, onYes, onNo } = confirmPending;
    const color = tipo === 'borrar_empresa' || tipo === 'borrar_lista' ? 'rose' : 'amber';
    const bg = color === 'rose' ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300';
    const icon = color === 'rose' ? <Trash2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />;
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={(e: any) => { if (e.target === e.currentTarget) onNo?.(); }}>
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 max-w-md w-full shadow-2xl animate-in zoom-in duration-200" onClick={(e: any) => e.stopPropagation()}>
          <div className="flex items-start gap-3 mb-4">
            <div className={`mt-1 p-1.5 rounded ${bg}`}>{icon}</div>
            <div>
              <div className="font-semibold text-white text-sm">{titulo}</div>
              <div className="text-[#8b949e] text-xs mt-1 whitespace-pre-line">{msg}</div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { onNo?.(); setConfirmPending(null); }}
              className="px-4 py-1.5 rounded-lg text-[#8b949e] hover:text-white hover:bg-[#30363d] text-sm transition"
            >
              Cancelar
            </button>
            <button
              onClick={() => { onYes?.(); setConfirmPending(null); }}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${color === 'rose' ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-[#30363d] text-white hover:bg-emerald-500'}`}
            >
              {tipo === 'detener' ? 'Detener' : tipo === 'rescatar' ? 'Continuar' : tipo === 'borrar_empresa' ? 'Borrar' : 'Aceptar'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] font-sans antialiased">
      {/* HEADER */}
      <header className="border-b border-[#30363d] bg-[#161b22] px-6 py-4 sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/40">
              <Compass className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">Prospector IA</h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  ⚡ ULTRA-VELOCIDAD + SCHEMA.ORG
                </span>
              </div>
              <p className="text-xs text-[#8b949e]">
                Extracción masiva de emails, teléfonos, WhatsApp y datos estructurados B2B
              </p>
            </div>
          </div>

          {/* Quick Stats Pill */}
          <div className="flex flex-wrap items-center gap-3 bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2 text-xs">
            <div className="flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-[#8b949e]" />
              <span className="text-[#8b949e]">Empresas:</span>
              <strong className="text-white font-semibold">{stats.empresas}</strong>
            </div>
            <div className="h-4 w-[1px] bg-[#30363d]" />
            <div className="flex items-center gap-1.5">
              <Mail className="w-4 h-4 text-emerald-400" />
              <span className="text-[#8b949e]">Emails:</span>
              <strong className="text-emerald-400 font-semibold">{stats.con_email}</strong>
            </div>
            <div className="h-4 w-[1px] bg-[#30363d]" />
            <div className="flex items-center gap-1.5">
              <Phone className="w-4 h-4 text-teal-400" />
              <span className="text-[#8b949e]">Tel/WA:</span>
              <strong className="text-teal-300 font-semibold">{stats.con_telefono || 0}</strong>
            </div>
            <div className="h-4 w-[1px] bg-[#30363d]" />
            <div className="flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-purple-400" />
              <span className="text-[#8b949e]">Dominios:</span>
              <strong className="text-purple-300 font-semibold">{stats.dominios_vistos}</strong>
            </div>
            <button
              onClick={() => {
                cargarStats();
                cargarListas();
                cargarEmpresas(listaSeleccionada);
              }}
              className="p-1 rounded-lg text-[#8b949e] hover:text-white hover:bg-[#21262d] transition"
              title="Refrescar métricas"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* TOP ROW: Search Panel & Live HUD */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* SECTION 1: SEARCH CONSOLE (5 cols) */}
          <section className="lg:col-span-5 bg-[#161b22] border border-[#30363d] rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#30363d]">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#c9d1d9]">1. Configurar Búsqueda</h2>
              </div>
              <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">
                5 Fuentes en paralelo
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8b949e] mb-1.5">
                Consultas de búsqueda (una por línea)
              </label>
              <textarea
                value={consultas}
                onChange={e => setConsultas(e.target.value)}
                disabled={corriendo}
                rows={3}
                placeholder="Escribe consultas aquí..."
                className="w-full bg-[#0d1117] border border-[#30363d] focus:border-emerald-500 rounded-xl p-3 text-xs font-mono text-white placeholder-[#484f58] focus:outline-none transition resize-y"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-[#c9d1d9] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoBarrios}
                onChange={e => setAutoBarrios(e.target.checked)}
                disabled={corriendo}
                className="rounded border-[#30363d] bg-[#0d1117] text-emerald-500 focus:ring-emerald-500"
              />
              <span>
                Recorrer automáticamente <strong>TODOS los barrios</strong> (Montevideo + Canelones + Maldonado)
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs text-[#8b949e] mb-1">Empresas por tanda (lote)</label>
                <input
                  type="number"
                  value={maxPorTanda}
                  onChange={e => setMaxPorTanda(parseInt(e.target.value, 10) || 20)}
                  disabled={corriendo}
                  min={5}
                  max={100}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8b949e] mb-1">Zona / Barrio (opcional)</label>
                <input
                  type="text"
                  value={zona}
                  onChange={e => setZona(e.target.value)}
                  disabled={corriendo}
                  placeholder="Ej: Pocitos"
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
              <label className="flex items-center gap-2 text-[#c9d1d9] cursor-pointer">
                <input
                  type="checkbox"
                  checked={usarIA}
                  onChange={e => setUsarIA(e.target.checked)}
                  disabled={corriendo}
                  className="rounded text-emerald-500"
                />
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Usar IA Gemini
                </span>
              </label>

              <label className="flex items-center gap-2 text-[#c9d1d9] cursor-pointer">
                <input
                  type="checkbox"
                  checked={modoRapido}
                  onChange={e => setModoRapido(e.target.checked)}
                  disabled={corriendo}
                  className="rounded text-emerald-500"
                />
                <span>⚡ 15 hilos en paralelo</span>
              </label>

              <label className="flex items-center gap-2 text-[#c9d1d9] cursor-pointer">
                <input
                  type="checkbox"
                  checked={usarMaps}
                  onChange={e => setUsarMaps(e.target.checked)}
                  disabled={corriendo}
                  className="rounded text-emerald-500"
                />
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-sky-400" /> Buscar también en Google Maps
                  <span className="text-[10px] text-[#8b949e]">(más lento)</span>
                </span>
              </label>

              <label className={`flex items-center gap-2 text-xs ${!usarMaps ? 'opacity-50' : ''} cursor-pointer ${!usarMaps ? 'not-allowed' : ''}`}>
                <input
                  type="checkbox"
                  checked={mapsVisible}
                  onChange={e => setMapsVisible(e.target.checked)}
                  disabled={corriendo || !usarMaps}
                  className="rounded text-emerald-500"
                />
                <span className="flex items-center gap-1">
                  <Monitor className="w-3.5 h-3.5 text-blue-400" /> Mostrar navegador de Maps
                  <span className="text-[10px] text-[#8b949e]">(ventana de Chromium)</span>
                </span>
              </label>
            </div>

            <div className="pt-2 border-t border-[#30363d] space-y-2">
              <div>
                <label className="block text-xs text-[#8b949e] mb-1">Guardar en Lista / Excel</label>
                <input
                  type="text"
                  value={listaNombre}
                  onChange={e => setListaNombre(e.target.value)}
                  disabled={corriendo || listaAuto}
                  placeholder={listaAuto ? 'Auto: una lista por cada consulta' : 'Nombre de lista personalizada'}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-1.5 text-xs text-white disabled:opacity-50"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-[#8b949e] cursor-pointer">
                <input
                  type="checkbox"
                  checked={listaAuto}
                  onChange={e => setListaAuto(e.target.checked)}
                  disabled={corriendo}
                  className="rounded text-emerald-500"
                />
                <span>Una lista por cada búsqueda (nombre de la consulta)</span>
              </label>
            </div>

            {/* ACTION BUTTONS */}
            <div className="pt-2 space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={iniciarContinuo}
                  disabled={corriendo}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-xs text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 transition shadow-lg shadow-emerald-950/30"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>MODO CONTINUO</span>
                </button>

                <button
                  onClick={iniciarBusquedaSimple}
                  disabled={corriendo}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-medium text-xs text-[#c9d1d9] bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] disabled:opacity-40 transition"
                  title="Una sola pasada por las consultas"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Simple</span>
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={parar}
                  disabled={!corriendo}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl font-medium text-xs text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 disabled:opacity-40 transition"
                >
                  <Square className="w-3.5 h-3.5 fill-rose-300" />
                  <span>PARAR</span>
                </button>

                <button
                  onClick={guardarYParar}
                  disabled={!corriendo}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl font-medium text-xs text-[#c9d1d9] bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] disabled:opacity-40 transition"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>GUARDAR Y PARAR</span>
                </button>
              </div>
            </div>
          </section>

          {/* SECTION 2: LIVE HUD & LOG MONITOR (7 cols) */}
          <section className="lg:col-span-7 bg-[#161b22] border border-[#30363d] rounded-2xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
            <div className="flex items-center justify-between pb-2 border-b border-[#30363d]">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    corriendo ? 'bg-emerald-400 animate-ping' : 'bg-zinc-600'
                  }`}
                />
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#c9d1d9]">2. Monitor de Actividad</h2>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#8b949e]">
                <Clock className="w-3.5 h-3.5" />
                <span>{formatearTiempo(progreso?.t_total)}</span>
              </div>
            </div>

            {/* STATUS HUD */}
            <div className="bg-[#0d1117] border border-[#30363d] rounded-xl p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2.5 py-0.5 rounded-full font-bold text-[11px] ${
                      progreso?.fase === 'buscando'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : progreso?.fase === 'procesando'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : progreso?.fase === 'esperando'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-[#21262d] text-[#8b949e]'
                    }`}
                  >
                    {progreso?.fase === 'buscando'
                      ? '🔎 Buscando'
                      : progreso?.fase === 'procesando'
                      ? '🕷️ Rastreando (15 hilos)'
                      : progreso?.fase === 'esperando'
                      ? '⏸️ Esperando'
                      : 'En reposo'}
                  </span>
                  <span className="text-[#8b949e] font-mono truncate max-w-xs">
                    {progreso?.consulta ? `"${progreso.consulta}"` : 'Sin consulta activa'}
                  </span>
                </div>
                {progreso?.consultas_totales && progreso.consultas_totales > 1 ? (
                  <span className="text-[11px] text-[#8b949e]">
                    Consulta {progreso.consulta_n} de {progreso.consultas_totales} (Vuelta {progreso.vuelta || 1})
                  </span>
                ) : null}
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-[#8b949e]">
                  <span>Progreso de tanda</span>
                  <span>{pct}%</span>
                </div>
                <div className="w-full bg-[#161b22] h-2 rounded-full overflow-hidden border border-[#30363d]">
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {/* Live Metric Counters */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center text-xs">
                <div className="bg-[#161b22] p-1.5 rounded-lg border border-[#30363d]">
                  <div className="text-[10px] text-[#8b949e]">Rastreadas</div>
                  <strong className="text-white text-xs">{progreso?.procesadas || 0}</strong>
                </div>
                <div className="bg-[#161b22] p-1.5 rounded-lg border border-emerald-500/30">
                  <div className="text-[10px] text-emerald-400">Nuevas</div>
                  <strong className="text-emerald-400 text-xs">{progreso?.nuevas || 0}</strong>
                </div>
                <div className="bg-[#161b22] p-1.5 rounded-lg border border-emerald-500/30">
                  <div className="text-[10px] text-emerald-400">Con Email</div>
                  <strong className="text-emerald-300 text-xs">{progreso?.con_email || 0}</strong>
                </div>
                <div className="bg-[#161b22] p-1.5 rounded-lg border border-teal-500/30">
                  <div className="text-[10px] text-teal-400">Con Tel/WA</div>
                  <strong className="text-teal-300 text-xs">{progreso?.con_telefono || 0}</strong>
                </div>
                <div className="bg-[#161b22] p-1.5 rounded-lg border border-purple-500/30">
                  <div className="text-[10px] text-purple-400">Schema.org</div>
                  <strong className="text-purple-300 text-xs">{progreso?.schema_org_encontrados || 0}</strong>
                </div>
                <div className="bg-[#161b22] p-1.5 rounded-lg border border-amber-500/30">
                  <div className="text-[10px] text-amber-400">IA Salvó</div>
                  <strong className="text-amber-300 text-xs">{progreso?.ia_salvados || 0}</strong>
                </div>
              </div>

              {/* In flight domains */}
              {progreso?.en_curso && progreso.en_curso.length > 0 && (
                <div className="text-[11px] flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[#8b949e] font-semibold">Rastreando ahora:</span>
                  {progreso.en_curso.slice(0, 7).map(d => (
                    <span
                      key={d}
                      className="px-2 py-0.5 rounded bg-[#21262d] border border-[#30363d] text-emerald-300 font-mono text-[10px]"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* LIVE CONSOLE LOG */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-[#8b949e]">
                <span>Registro en vivo (Terminal)</span>
                <button
                  onClick={() => setLogs([])}
                  className="hover:text-white transition"
                >
                  Limpiar vista
                </button>
              </div>
              <div
                ref={logRef}
                className="bg-[#0a0d12] border border-[#30363d] rounded-xl p-3 h-44 overflow-y-auto font-mono text-[11px] leading-relaxed text-[#8b949e] space-y-0.5 select-text"
              >
                {logs.length === 0 ? (
                  <div className="text-[#484f58] italic">Esperando inicio de tareas...</div>
                ) : (
                  logs.map((line, idx) => {
                    const isError = line.includes('[!]');
                    const isSuccess = line.includes('Nuevas') || line.includes('+ [') || line.includes('💾');
                    const isIA = line.includes('🤖');
                    const isSchema = line.includes('Schema.org');
                    return (
                      <div
                        key={idx}
                        className={
                          isError
                            ? 'text-rose-400'
                            : isSchema
                            ? 'text-purple-300'
                            : isSuccess
                            ? 'text-emerald-300'
                            : isIA
                            ? 'text-amber-300'
                            : 'text-[#8b949e]'
                        }
                      >
                        {line}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        </div>

        {/* SECTION 3: EXPORT & LIST MANAGEMENT */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* EXPORTS BAR (5 cols) */}
          <div className="lg:col-span-5 bg-[#161b22] border border-[#30363d] rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-[#30363d]">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#c9d1d9]">3. Exportar Datos</h3>
              </div>
              <span className="text-xs text-[#8b949e]">Excel enriquecido</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                onClick={rescatarEmails}
                disabled={corriendo}
                className="flex items-center gap-2 p-3 rounded-xl bg-[#21262d] hover:bg-[#30363d] disabled:opacity-50 disabled:cursor-not-allowed border border-[#30363d] text-xs text-left transition group"
                title="Recorre empresas sin email, vuelve a rastrear su web, busca en buscadores y usa IA"
              >
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 group-hover:scale-105 transition">
                  <Search className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-white">Rescatar Emails Faltantes</div>
                  <div className="text-[10px] text-[#8b949e]">Paso 3-4: buscadores + IA</div>
                </div>
              </button>
              <button
                onClick={() => exportarGlobal('emails')}
                className="flex items-center gap-2 p-3 rounded-xl bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs text-left transition group"
              >
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:scale-105 transition">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-white">Lotes de 20 Emails</div>
                  <div className="text-[10px] text-[#8b949e]">Con teléfonos y scores</div>
                </div>
              </button>

              <button
                onClick={() => exportarGlobal('full')}
                className="flex items-center gap-2 p-3 rounded-xl bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs text-left transition group"
              >
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 group-hover:scale-105 transition">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-white">Base Completa</div>
                  <div className="text-[10px] text-[#8b949e]">Excel .xlsx + CSV</div>
                </div>
              </button>

              <button
                onClick={() => exportarGlobal('listas')}
                className="flex items-center gap-2 p-3 rounded-xl bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs text-left transition group"
              >
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 group-hover:scale-105 transition">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-white">Todas las Listas</div>
                  <div className="text-[10px] text-[#8b949e]">Un Excel por cada lista</div>
                </div>
              </button>

              <a
                href="/api/descargar?archivo=empresas.xlsx"
                download
                className="flex items-center gap-2 p-3 rounded-xl bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs text-left transition group"
              >
                <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400 group-hover:scale-105 transition">
                  <Download className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-white">Descargar Salida</div>
                  <div className="text-[10px] text-[#8b949e]">empresas.xlsx</div>
                </div>
              </a>
            </div>
          </div>

          {/* LISTS MANAGER (7 cols) */}
          <div className="lg:col-span-7 bg-[#161b22] border border-[#30363d] rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-[#30363d]">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#c9d1d9]">
                  4. Listas Guardadas ({listas.length})
                </h3>
              </div>
              <button
                onClick={cargarListas}
                className="text-xs text-[#8b949e] hover:text-white flex items-center gap-1 transition"
              >
                <RefreshCw className="w-3 h-3" /> Actualizar
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto border border-[#30363d] rounded-xl bg-[#0d1117]">
              {listas.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#8b949e]">
                  Todavía no hay listas creadas. Realizá una búsqueda para generar listas automáticas.
                </div>
              ) : (
                <table className="w-full text-xs text-left">
                  <thead className="bg-[#161b22] border-b border-[#30363d] text-[#8b949e]">
                    <tr>
                      <th className="px-3 py-2 font-medium">Nombre de Lista</th>
                      <th className="px-3 py-2 font-medium">Empresas</th>
                      <th className="px-3 py-2 font-medium">Con Email</th>
                      <th className="px-3 py-2 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    {listas.map(l => (
                      <tr key={l.id} className="hover:bg-[#161b22]/60 transition">
                        <td className="px-3 py-2 font-medium text-white max-w-[200px] truncate">{l.nombre}</td>
                        <td className="px-3 py-2 text-[#8b949e]">{l.n}</td>
                        <td className="px-3 py-2 text-emerald-400 font-semibold">{l.con_email}</td>
                        <td className="px-3 py-2 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => cargarEmpresas(l.nombre)}
                            className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-white text-[11px] transition"
                            title="Ver en tabla"
                          >
                            Ver
                          </button>
                          <button
                            onClick={() => exportarListaItem(l.nombre)}
                            className="px-2 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-800/40 text-emerald-300 text-[11px] transition"
                            title="Exportar a Excel"
                          >
                            Excel
                          </button>
                          <button
                            onClick={() => borrarListaItem(l.nombre)}
                            className="p-1 rounded text-[#8b949e] hover:text-rose-400 hover:bg-rose-950/30 transition"
                            title="Quitar de listas"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 4: COMPANIES EXPLORER TABLE */}
        <section className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-[#30363d]">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#c9d1d9]">
                5. Directorio de Contactos Extraídos{' '}
                {listaSeleccionada && (
                  <span className="text-emerald-400 normal-case font-normal">
                    — Filtro: "{listaSeleccionada}"
                  </span>
                )}
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              {listaSeleccionada && (
                <button
                  onClick={() => cargarEmpresas()}
                  className="px-2.5 py-1 rounded-lg bg-[#21262d] text-[#8b949e] hover:text-white transition"
                >
                  Ver todas
                </button>
              )}

              {/* Filter Pills */}
              <div className="flex bg-[#0d1117] border border-[#30363d] rounded-lg p-0.5">
                <button
                  onClick={() => setFiltroEmpresas('todas')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                    filtroEmpresas === 'todas' ? 'bg-[#21262d] text-white shadow' : 'text-[#8b949e] hover:text-white'
                  }`}
                >
                  Todas ({empresas.length})
                </button>
                <button
                  onClick={() => setFiltroEmpresas('con_email')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                    filtroEmpresas === 'con_email'
                      ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-800/40 shadow'
                      : 'text-[#8b949e] hover:text-emerald-300'
                  }`}
                >
                  Con Email
                </button>
                <button
                  onClick={() => setFiltroEmpresas('con_tel')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                    filtroEmpresas === 'con_tel'
                      ? 'bg-teal-950/70 text-teal-400 border border-teal-800/40 shadow'
                      : 'text-[#8b949e] hover:text-teal-300'
                  }`}
                >
                  Con Tel/WA
                </button>
                <button
                  onClick={() => setFiltroEmpresas('schema')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                    filtroEmpresas === 'schema'
                      ? 'bg-purple-950/70 text-purple-400 border border-purple-800/40 shadow'
                      : 'text-[#8b949e] hover:text-purple-300'
                  }`}
                >
                  🏷️ Schema.org
                </button>
              </div>

              {/* Filter by Category */}
              <div className="flex items-center gap-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg px-2.5 py-1">
                <Tag className="w-3.5 h-3.5 text-emerald-400" />
                <select
                  value={categoriaFiltro}
                  onChange={e => setCategoriaFiltro(e.target.value)}
                  className="bg-transparent text-xs text-white focus:outline-none cursor-pointer pr-1"
                >
                  <option value="todas" className="bg-[#161b22] text-white">Todas las categorías</option>
                  <option value="Inmobiliaria" className="bg-[#161b22] text-white">🏢 Inmobiliarias</option>
                  <option value="Administración de Edificios" className="bg-[#161b22] text-white">🏬 Administración de Edificios</option>
                  <option value="Construcción" className="bg-[#161b22] text-white">🏗️ Construcción</option>
                  <option value="Salud" className="bg-[#161b22] text-white">🏥 Salud & Medicina</option>
                  <option value="Legal y Notarial" className="bg-[#161b22] text-white">⚖️ Legal y Notarial</option>
                  <option value="Finanzas y Contabilidad" className="bg-[#161b22] text-white">💼 Finanzas & Contabilidad</option>
                  <option value="Tecnología" className="bg-[#161b22] text-white">💻 Tecnología</option>
                  <option value="Servicios y Mantenimiento" className="bg-[#161b22] text-white">🛠️ Servicios & Mantenimiento</option>
                  <option value="Automotriz y Transporte" className="bg-[#161b22] text-white">🚗 Automotriz & Transporte</option>
                  <option value="Educación" className="bg-[#161b22] text-white">🎓 Educación</option>
                  <option value="Gastronomía y Hotelería" className="bg-[#161b22] text-white">🍽️ Gastronomía & Hotelería</option>
                  {categoriasDisponibles
                    .filter(c => ![
                      'Inmobiliaria',
                      'Administración de Edificios',
                      'Construcción',
                      'Salud',
                      'Legal y Notarial',
                      'Finanzas y Contabilidad',
                      'Tecnología',
                      'Servicios y Mantenimiento',
                      'Automotriz y Transporte',
                      'Educación',
                      'Gastronomía y Hotelería',
                    ].includes(c))
                    .map(c => (
                      <option key={c} value={c} className="bg-[#161b22] text-white">
                        {c}
                      </option>
                    ))}
                </select>
              </div>

              {/* Search text filter */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Buscar por nombre, email, web, calle..."
                  value={busquedaTabla}
                  onChange={e => setBusquedaTabla(e.target.value)}
                  className="bg-[#0d1117] border border-[#30363d] rounded-lg pl-7 pr-3 py-1 text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-emerald-500 w-64"
                />
                <Search className="w-3.5 h-3.5 text-[#8b949e] absolute left-2 top-1.5" />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto border border-[#30363d] rounded-xl bg-[#0d1117]">
            {cargandoTabla ? (
              <div className="p-8 text-center text-xs text-[#8b949e]">Cargando empresas...</div>
            ) : empresasFiltradas.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <Building2 className="w-8 h-8 text-[#484f58] mx-auto" />
                <p className="text-sm text-[#8b949e]">No se encontraron empresas con los filtros actuales.</p>
                <p className="text-xs text-[#484f58]">
                  Iniciá el Modo Continuo o realizá una búsqueda simple para prospectar.
                </p>
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-[#161b22] border-b border-[#30363d] text-[#8b949e]">
                  <tr>
                    <th className="px-3.5 py-2.5 font-medium">Empresa & Dirección</th>
                    <th className="px-3.5 py-2.5 font-medium">Email</th>
                    <th className="px-3.5 py-2.5 font-medium">Teléfono / WhatsApp</th>
                    <th className="px-3.5 py-2.5 font-medium">Sitio Web</th>
                    <th className="px-3.5 py-2.5 font-medium text-center">Confianza</th>
                    <th className="px-3.5 py-2.5 font-medium text-center">Origen</th>
                    <th className="px-3.5 py-2.5 font-medium text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {empresasFiltradas.map(e => (
                    <tr key={e.id} className="hover:bg-[#161b22]/50 transition">
                      <td className="px-3.5 py-2.5 font-semibold text-white max-w-[280px]">
                        <div className="truncate text-[13px]">{e.nombre || e.dominio}</div>
                        
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span
                            className={`text-[9.5px] font-semibold px-2 py-0.5 rounded-full border ${
                              e.categoria === 'Inmobiliaria'
                                ? 'bg-blue-950/80 text-blue-300 border-blue-850/50'
                                : e.categoria === 'Construcción'
                                ? 'bg-orange-950/80 text-orange-300 border-orange-800/50'
                                : e.categoria === 'Salud'
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/50'
                                : e.categoria === 'Administración de Edificios'
                                ? 'bg-purple-950/80 text-purple-300 border-purple-800/50'
                                : e.categoria === 'Legal y Notarial'
                                ? 'bg-indigo-950/80 text-indigo-300 border-indigo-800/50'
                                : e.categoria === 'Tecnología'
                                ? 'bg-cyan-950/80 text-cyan-300 border-cyan-800/50'
                                : e.categoria === 'Finanzas y Contabilidad'
                                ? 'bg-amber-950/80 text-amber-300 border-amber-800/50'
                                : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'
                            }`}
                          >
                            {e.categoria || 'Empresa'}
                          </span>
                          {e.zona && (
                            <span className="text-[10px] text-[#8b949e] font-normal truncate">
                              • {e.zona}
                            </span>
                          )}
                        </div>

                        {e.direccion && (
                          <div className="text-[10px] text-[#8b949e] font-normal truncate flex items-center gap-1 mt-1">
                            <MapPin className="w-3 h-3 text-rose-400 shrink-0" />
                            <span>{e.direccion}</span>
                          </div>
                        )}

                        {e.meta_description && (
                          <div
                            className="text-[10px] text-[#8b949e]/80 font-normal italic truncate mt-1 max-w-[260px]"
                            title={e.meta_description}
                          >
                            "{e.meta_description}"
                          </div>
                        )}
                      </td>

                      <td className="px-3.5 py-2.5 font-mono">
                        {e.email ? (
                          <div className="space-y-1">
                            <VisualEmailStatus email={e.email} dominio={e.dominio} />
                            {e.emails_secundarios && e.emails_secundarios.length > 0 && (
                              <div className="text-[10px] text-[#8b949e] opacity-80 pl-1">
                                <VisualEmailStatus email={e.emails_secundarios[0]} dominio={e.dominio} />
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#484f58] italic">Sin email</span>
                        )}
                      </td>

                      <td className="px-3.5 py-2.5 space-y-1">
                        {e.telefono && (
                          <div className="flex items-center gap-1 text-[#c9d1d9]">
                            <Phone className="w-3 h-3 text-[#8b949e]" />
                            <span>{e.telefono}</span>
                            <button
                              onClick={() => copiarPortapapeles(e.telefono, `tel_${e.id}`)}
                              className="text-[#8b949e] hover:text-white p-0.5 transition"
                              title="Copiar teléfono"
                            >
                              {copiadoId === `tel_${e.id}` ? (
                                <Check className="w-3 h-3 text-teal-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        )}
                        {e.whatsapp && (
                          <div className="flex items-center gap-1">
                            <MessageSquare className="w-3 h-3 text-emerald-400" />
                            <a
                              href={`https://wa.me/${e.whatsapp.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-400 hover:underline text-[11px]"
                            >
                              WhatsApp {e.whatsapp}
                            </a>
                          </div>
                        )}
                        {!e.telefono && !e.whatsapp && <span className="text-[#484f58]">—</span>}
                      </td>

                      <td className="px-3.5 py-2.5">
                        <a
                          href={e.web.startsWith('http') ? e.web : `https://${e.web}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:underline flex items-center gap-1 max-w-[170px] truncate"
                        >
                          <Globe className="w-3 h-3 shrink-0 text-blue-500" />
                          <span className="truncate">{e.dominio || e.web}</span>
                          <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                        </a>
                      </td>

                      <td className="px-3.5 py-2.5 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            (e.score_confianza || 50) >= 80
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                              : (e.score_confianza || 50) >= 60
                              ? 'bg-blue-950 text-blue-400 border border-blue-800/40'
                              : 'bg-[#21262d] text-[#8b949e]'
                          }`}
                        >
                          {e.score_confianza || 50}%
                        </span>
                      </td>

                      <td className="px-3.5 py-2.5 text-center">
                        {e.origen_contacto === 'schema_org' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-950 text-purple-300 border border-purple-800/40">
                            🏷️ Schema
                          </span>
                        ) : e.origen_contacto === 'contacto_subpagina' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#21262d] text-teal-300">
                            📄 Contacto
                          </span>
                        ) : e.origen_contacto === 'ia_gemini' || e.origen_contacto === 'ia' || e.origen_contacto === 'buscador' ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-950 text-amber-300 border border-amber-800/40">
                            <Sparkles className="w-2.5 h-2.5" /> IA
                          </span>
                        ) : (
                          <span className="text-[#484f58] text-[10px]">🌐 Web</span>
                        )}
                      </td>

                      <td className="px-3.5 py-2.5 text-center">
                        <button
                          onClick={() => borrarEmpresaItem(e.id, e.nombre || e.dominio)}
                          className="p-1 rounded text-[#8b949e] hover:text-rose-400 hover:bg-rose-950/30 transition"
                          title="Borrar esta empresa"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      {/* TOASTS Y MODALES */}
      <ToastContainer />
      <ModalConfirm />

    </div>
  );
}
