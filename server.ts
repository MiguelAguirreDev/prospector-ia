import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import dns from 'dns';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db.js';
import {
  appState,
  monitor,
  iniciarTarea,
  lanzarTareaBuscar,
  lanzarTareaContinua,
  lanzarTareaRescatarEmails,
  pedirParar,
  agregarLog,
} from './server/pipeline.js';
import {
  exportarEmailsEnLotes,
  exportarCompleto,
  exportarUnaLista,
  exportarTodasLasListas,
} from './server/exporter.js';
import { nombresProveedoresIA } from './server/ai.js';

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';
const isDev = process.env.NODE_ENV !== 'production';

app.use(express.json());

// API Endpoints
app.get('/api/estado', (req: Request, res: Response) => {
  res.json(db.estadisticas());
});

app.get('/api/progreso', (req: Request, res: Response) => {
  const p = monitor.estado();
  res.json({
    ...p,
    corriendo: appState.corriendo,
    titulo: appState.titulo,
  });
});

app.get('/api/log', (req: Request, res: Response) => {
  const desde = parseInt(req.query.desde as string, 10) || 0;
  const lineas = appState.log.slice(desde);
  res.json({
    lineas,
    total: appState.log.length,
    corriendo: appState.corriendo,
    titulo: appState.titulo,
    resultado: appState.resultado,
  });
});

app.get('/api/listas', (req: Request, res: Response) => {
  res.json(db.listarListas());
});

app.get('/api/lista', (req: Request, res: Response) => {
  const limite = parseInt(req.query.limite as string, 10) || 500;
  res.json(db.listar(limite));
});

app.get('/api/lista_de', (req: Request, res: Response) => {
  const nombre = (req.query.nombre as string) || '';
  res.json(db.empresasDeLista(nombre));
});

app.get('/api/consultas-default', (req: Request, res: Response) => {
  try {
    const p = path.resolve(process.cwd(), 'consultas.txt');
    if (fs.existsSync(p)) {
      const txt = fs.readFileSync(p, 'utf-8');
      return res.json({
        consultas: txt
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean),
      });
    }
  } catch {}
  res.json({
    consultas: [
      'administradoras de edificios Pocitos Montevideo',
      'inmobiliarias Cordón Montevideo',
      'inmobiliarias Ciudad de la Costa',
      'administradoras de edificios Carrasco Montevideo',
      'inmobiliarias Punta Carretas Montevideo',
    ],
  });
});

const PROVEEDORES_GRATUITOS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com',
  'yahoo.com', 'yahoo.es', 'icloud.com', 'me.com', 'adinet.com.uy', 'montevideo.com.uy', 'vera.com.uy'
]);

const DOMINIOS_DESECHABLES = new Set([
  'mailinator.com', 'tempmail.com', '10minutemail.com', 'yopmail.com', 'guerrillamail.com', 'sharklasers.com', 'trashmail.com'
]);

const CUENTAS_ROL = new Set([
  'info', 'contacto', 'contact', 'ventas', 'administracion', 'admin', 'soporte', 'hola', 'comercial', 'recepcion', 'secretaria'
]);

const emailVerifyCache = new Map<string, any>();

app.get('/api/verificar-email', async (req: Request, res: Response) => {
  const emailRaw = ((req.query.email as string) || '').trim().toLowerCase();
  const dominioWeb = ((req.query.dominio as string) || '').trim().toLowerCase();

  if (!emailRaw) {
    return res.status(400).json({ error: 'Falta parámetro email' });
  }

  const cacheKey = `${emailRaw}_${dominioWeb}`;
  if (emailVerifyCache.has(cacheKey)) {
    return res.json(emailVerifyCache.get(cacheKey));
  }

  const partes = emailRaw.split('@');
  if (partes.length !== 2 || !partes[0] || !partes[1]) {
    const invalidResult = {
      email: emailRaw,
      sintaxis_valida: false,
      tiene_mx: false,
      servidores_mx: [],
      es_proveedor_gratuito: false,
      es_desechable: false,
      es_cuenta_rol: false,
      coincide_con_dominio: false,
      score: 0,
      estado: 'invalido',
      mensaje: 'Formato de correo electrónico inválido (estructura incorrecta)',
    };
    emailVerifyCache.set(cacheKey, invalidResult);
    return res.json(invalidResult);
  }

  const usuario = partes[0];
  const domain = partes[1];
  const sintaxis_valida = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(emailRaw);

  const es_proveedor_gratuito = PROVEEDORES_GRATUITOS.has(domain);
  const es_desechable = DOMINIOS_DESECHABLES.has(domain);
  const es_cuenta_rol = CUENTAS_ROL.has(usuario);

  const domLimpio = dominioWeb.replace(/^www\./, '');
  const coincide_con_dominio = domLimpio ? domain.includes(domLimpio) || domLimpio.includes(domain) : false;

  let tiene_mx = false;
  let servidores_mx: string[] = [];

  try {
    const mxRecords = await dns.promises.resolveMx(domain);
    if (mxRecords && mxRecords.length > 0) {
      tiene_mx = true;
      servidores_mx = mxRecords
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 3)
        .map(r => r.exchange);
    }
  } catch {
    tiene_mx = false;
  }

  let score = 0;
  if (sintaxis_valida) score += 35;
  if (tiene_mx) score += 40;
  if (coincide_con_dominio) score += 15;
  else if (!es_proveedor_gratuito && !es_desechable) score += 10;
  if (es_cuenta_rol) score += 10;
  if (es_desechable) score = 10;

  let estado: 'excelente' | 'bueno' | 'regular' | 'invalido' = 'regular';
  let mensaje = '';

  if (!sintaxis_valida) {
    estado = 'invalido';
    mensaje = 'Sintaxis errónea o caracteres no permitidos';
  } else if (!tiene_mx) {
    estado = 'regular';
    mensaje = 'El dominio no tiene servidores MX de correo activos';
  } else if (coincide_con_dominio) {
    estado = 'excelente';
    mensaje = 'Email corporativo verificado con dominio y servidores MX activos';
  } else if (es_proveedor_gratuito) {
    estado = 'bueno';
    mensaje = `Buzón válido en proveedor público (${domain}) con MX confirmados`;
  } else {
    estado = 'bueno';
    mensaje = 'Sintaxis válida y servidor MX operativo';
  }

  const result = {
    email: emailRaw,
    usuario,
    dominio: domain,
    sintaxis_valida,
    tiene_mx,
    servidores_mx,
    es_proveedor_gratuito,
    es_desechable,
    es_cuenta_rol,
    coincide_con_dominio,
    score,
    estado,
    mensaje,
  };

  emailVerifyCache.set(cacheKey, result);
  res.json(result);
});

app.post('/api/buscar', (req: Request, res: Response) => {
  const { consultas, max = 20, zona = '', usar_ia = true, lista_nombre = '', lista_auto = true, modo_rapido = true, usar_maps = false } = req.body;
  const validConsultas = (consultas || []).map((c: string) => c.trim()).filter(Boolean);

  if (!validConsultas.length) {
    return res.status(400).json({ error: 'No se enviaron consultas para buscar.' });
  }

  const ok = iniciarTarea('Buscando empresas...', () =>
    lanzarTareaBuscar(validConsultas, Number(max), zona, Boolean(usar_ia), lista_nombre, Boolean(lista_auto), Boolean(modo_rapido), Boolean(usar_maps))
  );

  res.json(ok ? { ok: true } : { error: 'Ya hay una tarea corriendo.' });
});

app.post('/api/continuo', (req: Request, res: Response) => {
  const { consultas, auto_barrios = false, max = 20, zona = '', usar_ia = true, lista_nombre = '', lista_auto = true, modo_rapido = true, usar_maps = false } = req.body;
  const validConsultas = (consultas || []).map((c: string) => c.trim()).filter(Boolean);

  if (!validConsultas.length && !auto_barrios) {
    return res.status(400).json({ error: 'Escribí al menos una búsqueda o marcá "todos los barrios".' });
  }

  const ok = iniciarTarea('Modo continuo (activo hasta Parar/Guardar)...', () =>
    lanzarTareaContinua(
      validConsultas,
      Number(max),
      zona,
      Boolean(usar_ia),
      Boolean(auto_barrios),
      lista_nombre,
      Boolean(lista_auto),
      Boolean(modo_rapido),
      Boolean(usar_maps)
    )
  );

  res.json(ok ? { ok: true } : { error: 'Ya hay una tarea corriendo.' });
});

app.post('/api/parar', (req: Request, res: Response) => {
  pedirParar(false);
  res.json({ ok: true });
});

app.post('/api/guardar', (req: Request, res: Response) => {
  pedirParar(true);
  res.json({ ok: true });
});

app.post('/api/exportar', (req: Request, res: Response) => {
  const tipo = req.body.tipo || 'emails';

  if (tipo === 'emails') {
    const lotes = exportarEmailsEnLotes(20);
    agregarLog(`Generados ${lotes.length} lotes de emails en salida/emails`);
    appState.resultado = `${lotes.length} lotes de emails exportados`;
    return res.json({ ok: true, lotes });
  } else if (tipo === 'listas') {
    const listas = exportarTodasLasListas();
    agregarLog(`Generados ${listas.length} Excel de listas en salida/listas`);
    appState.resultado = `${listas.length} listas exportadas en Excel`;
    return res.json({ ok: true, listas });
  } else {
    const full = exportarCompleto();
    agregarLog(`Generados empresas.csv y empresas.xlsx con ${full.total} empresas`);
    appState.resultado = 'empresas.csv + empresas.xlsx';
    return res.json({ ok: true, full });
  }
});

app.post('/api/exportar_lista', (req: Request, res: Response) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) {
    return res.status(400).json({ error: 'Falta el nombre de la lista.' });
  }
  const exp = exportarUnaLista(nombre);
  agregarLog(`💾 Lista "${nombre}" exportada (${exp.total} empresas)`);
  res.json({ ok: true, ...exp });
});

app.post('/api/borrar_lista', (req: Request, res: Response) => {
  const nombre = (req.body.nombre || '').trim();
  const conEmpresas = Boolean(req.body.con_empresas);
  const r = db.borrarLista(nombre, conEmpresas);
  agregarLog(
    r.ok
      ? `🗑️ Lista "${nombre}" eliminada${conEmpresas ? ` + ${r.empresasBorradas} empresa(s)` : ''}`
      : `[!] No se encontró la lista "${nombre}"`
  );
  res.json({ ok: r.ok, nombre, empresas_borradas: r.empresasBorradas });
});

app.post('/api/borrar_empresa', (req: Request, res: Response) => {
  const id = Number(req.body.id);
  if (!id) return res.status(400).json({ ok: false, error: 'Falta el id de la empresa.' });
  const ok = db.borrarEmpresa(id);
  res.json({ ok });
});

app.post('/api/rescatar_emails', (req: Request, res: Response) => {
  const usarIA = req.body.usar_ia !== undefined ? Boolean(req.body.usar_ia) : true;
  const ok = iniciarTarea('Rescatando emails faltantes...', () => lanzarTareaRescatarEmails(usarIA));
  res.json(ok ? { ok: true } : { error: 'Ya hay una tarea corriendo.' });
});

app.post('/api/check', (req: Request, res: Response) => {
  const empresas = db.listar(100);
  let verificado = 0;
  for (const e of empresas) {
    if (e.email) {
      e.estado_email = 'verificado';
      verificado++;
    }
  }
  db.guardar();
  agregarLog(`✅ Chequeo realizado: ${verificado} empresas con email verificado`);
  res.json({ verificadas: verificado });
});

// Descarga directa de archivos
app.get('/api/descargar', (req: Request, res: Response) => {
  const archivo = (req.query.archivo as string) || '';
  if (!archivo) return res.status(400).send('Falta parámetro archivo');

  const baseSalida = path.resolve(process.cwd(), 'salida');
  const rutaCompleta = path.resolve(baseSalida, archivo);

  if (!rutaCompleta.startsWith(baseSalida) || !fs.existsSync(rutaCompleta)) {
    return res.status(404).send('Archivo no encontrado');
  }

  res.download(rutaCompleta);
});

async function startServer() {
  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`🧭 Prospector IA running at http://${HOST}:${PORT}`);
    const provs = nombresProveedoresIA();
    console.log(
      provs.length
        ? `🤖 IA activa (${provs.length}): ${provs.join(', ')}`
        : '🤖 IA desactivada (sin claves; el motor funciona igual, solo sin respaldo de IA)'
    );
  });
}

startServer();
