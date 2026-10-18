import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { db, Empresa } from './db.js';

const SALIDA_DIR = path.resolve(process.cwd(), 'salida');
const SALIDA_LISTAS_DIR = path.join(SALIDA_DIR, 'listas');
const SALIDA_EMAILS_DIR = path.join(SALIDA_DIR, 'emails');

function asegurarDirectorios() {
  if (!fs.existsSync(SALIDA_DIR)) fs.mkdirSync(SALIDA_DIR, { recursive: true });
  if (!fs.existsSync(SALIDA_LISTAS_DIR)) fs.mkdirSync(SALIDA_LISTAS_DIR, { recursive: true });
  if (!fs.existsSync(SALIDA_EMAILS_DIR)) fs.mkdirSync(SALIDA_EMAILS_DIR, { recursive: true });
}

function limpiarNombreArchivo(nombre: string): string {
  const limpio = (nombre || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  return limpio.slice(0, 80) || 'lista';
}

function generarCSV(cabeceras: string[], filas: string[][]): string {
  const lineas = [cabeceras.map(c => `"${c.replace(/"/g, '""')}"`).join(',')];
  for (const fila of filas) {
    lineas.push(fila.map(v => `"${(v || '').replace(/"/g, '""')}"`).join(','));
  }
  return '\uFEFF' + lineas.join('\r\n');
}

const CABECERAS_ENRIQUECIDAS = [
  'nombre',
  'categoria',
  'zona',
  'direccion',
  'telefono_principal',
  'telefonos_secundarios',
  'whatsapp',
  'email_principal',
  'emails_secundarios',
  'web',
  'score_confianza',
  'origen_contacto',
  'estado_email',
  'fecha_alta',
];

function filaEmpresa(e: Empresa): string[] {
  return [
    e.nombre || '',
    e.categoria || '',
    e.zona || '',
    e.direccion || '',
    e.telefono || '',
    (e.telefonos_secundarios || []).join(' | '),
    e.whatsapp || '',
    e.email || '',
    (e.emails_secundarios || []).join(' | '),
    e.web || '',
    String(e.score_confianza || 50),
    e.origen_contacto || '',
    e.estado_email || '',
    e.fecha_alta || '',
  ];
}

export function exportarEmailsEnLotes(loteSize: number = 20): Array<{ nombre: string; ruta: string; total: number }> {
  asegurarDirectorios();
  const empresas = db.conEmail();
  const filas = empresas.map(e => [
    e.email,
    e.nombre,
    e.telefono,
    e.whatsapp,
    e.direccion || '',
    e.web,
    String(e.score_confianza || 50),
  ]);
  const cabeceras = ['email', 'nombre', 'telefono', 'whatsapp', 'direccion', 'web', 'score_confianza'];

  const generados: Array<{ nombre: string; ruta: string; total: number }> = [];

  for (let i = 0; i < filas.length; i += loteSize) {
    const chunk = filas.slice(i, i + loteSize);
    const num = Math.floor(i / loteSize) + 1;
    const pad = String(num).padStart(2, '0');
    const nomCsv = `emails_lote_${pad}.csv`;
    const nomXlsx = `emails_lote_${pad}.xlsx`;
    const rutaCsv = path.join(SALIDA_EMAILS_DIR, nomCsv);
    const rutaXlsx = path.join(SALIDA_EMAILS_DIR, nomXlsx);

    fs.writeFileSync(rutaCsv, generarCSV(cabeceras, chunk), 'utf-8');

    // XLSX
    const ws = XLSX.utils.aoa_to_sheet([cabeceras, ...chunk]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Emails');
    XLSX.writeFile(wb, rutaXlsx);

    generados.push({ nombre: nomCsv, ruta: rutaCsv, total: chunk.length });
  }

  return generados;
}

export function exportarCompleto(): { csv: string; xlsx: string; total: number } {
  asegurarDirectorios();
  const empresas = db.listar(10000);
  const filas = empresas.map(filaEmpresa);

  const rutaCsv = path.join(SALIDA_DIR, 'empresas.csv');
  const rutaXlsx = path.join(SALIDA_DIR, 'empresas.xlsx');

  fs.writeFileSync(rutaCsv, generarCSV(CABECERAS_ENRIQUECIDAS, filas), 'utf-8');

  const ws = XLSX.utils.aoa_to_sheet([CABECERAS_ENRIQUECIDAS, ...filas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Empresas');
  XLSX.writeFile(wb, rutaXlsx);

  return { csv: rutaCsv, xlsx: rutaXlsx, total: empresas.length };
}

export function exportarUnaLista(nombreLista: string): { csv: string; xlsx: string; total: number } {
  asegurarDirectorios();
  const empresas = db.empresasDeLista(nombreLista);
  const filas = empresas.map(filaEmpresa);

  const seguro = limpiarNombreArchivo(nombreLista);
  const rutaCsv = path.join(SALIDA_LISTAS_DIR, `${seguro}.csv`);
  const rutaXlsx = path.join(SALIDA_LISTAS_DIR, `${seguro}.xlsx`);

  fs.writeFileSync(rutaCsv, generarCSV(CABECERAS_ENRIQUECIDAS, filas), 'utf-8');

  const ws = XLSX.utils.aoa_to_sheet([CABECERAS_ENRIQUECIDAS, ...filas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Empresas');
  XLSX.writeFile(wb, rutaXlsx);

  return { csv: rutaCsv, xlsx: rutaXlsx, total: empresas.length };
}

export function exportarTodasLasListas(): string[] {
  asegurarDirectorios();
  const listas = db.listarListas();
  const generados: string[] = [];
  for (const l of listas) {
    if (l.n > 0) {
      const res = exportarUnaLista(l.nombre);
      generados.push(res.xlsx);
    }
  }
  return generados;
}

/** Exporta la base completa a JSON (para integración con CRMs externos). */
export function exportarJSONCompleto(): { ruta: string; total: number } {
  asegurarDirectorios();
  const empresas = db.listar(10000);
  const ruta = path.join(SALIDA_DIR, 'empresas.json');
  fs.writeFileSync(ruta, JSON.stringify(empresas, null, 2), 'utf-8');
  return { ruta, total: empresas.length };
}

/** Exporta una lista a JSON (para integración con CRMs externos). */
export function exportarJSONLista(nombreLista: string): { ruta: string; total: number } {
  asegurarDirectorios();
  const empresas = db.empresasDeLista(nombreLista);
  const seguro = limpiarNombreArchivo(nombreLista);
  const ruta = path.join(SALIDA_LISTAS_DIR, `${seguro}.json`);
  fs.writeFileSync(ruta, JSON.stringify(empresas, null, 2), 'utf-8');
  return { ruta, total: empresas.length };
}

/** Exporta la base completa a CSV (para integración con CRMs externos). */
export function exportarCSVCompleto(): { ruta: string; total: number } {
  asegurarDirectorios();
  const empresas = db.listar(10000);
  const filas = empresas.map(filaEmpresa);
  const ruta = path.join(SALIDA_DIR, 'empresas.csv');
  fs.writeFileSync(ruta, generarCSV(CABECERAS_ENRIQUECIDAS, filas), 'utf-8');
  return { ruta, total: empresas.length };
}

/** Exporta una lista a CSV (para integración con CRMs externos). */
export function exportarCSVLista(nombreLista: string): { ruta: string; total: number } {
  asegurarDirectorios();
  const empresas = db.empresasDeLista(nombreLista);
  const filas = empresas.map(filaEmpresa);
  const seguro = limpiarNombreArchivo(nombreLista);
  const ruta = path.join(SALIDA_LISTAS_DIR, `${seguro}.csv`);
  fs.writeFileSync(ruta, generarCSV(CABECERAS_ENRIQUECIDAS, filas), 'utf-8');
  return { ruta, total: empresas.length };
}
