#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prospector IA — Interfaz web local (sin dependencias extra).

Levanta un servidor en 127.0.0.1 y abre una página en el navegador con:
  - cuadro de búsquedas (una por línea),
  - opciones (máximo por consulta, zona, usar IA),
  - botón grande para BUSCAR,
  - lista de empresas guardadas,
  - exportar emails en lotes de a 20 / lista completa,
  - chequeo de empresas guardadas,
  - registro de salida en vivo,
  - botón para abrir la carpeta de salida.

Uso:
    python3 app.py              # levanta la interfaz y abre el navegador
    PUERTO=9000 python3 app.py
    NO_ABRIR=1 python3 app.py   # no abre el navegador automáticamente
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

from prospector import exportar  # noqa: E402
from prospector.config import cargar_config  # noqa: E402
from prospector.db import BaseDatos  # noqa: E402
from prospector.ia import ClienteIA  # noqa: E402
from prospector.pipeline import Monitor, Prospector  # noqa: E402

PUERTO = int(os.environ.get("PUERTO", "8765"))
DB_RUTA = RAIZ / "datos" / "prospector.db"
SALIDA = RAIZ / "salida"
SALIDA_LISTAS = SALIDA / "listas"

_cerrojo = threading.Lock()
_estado: dict = {"corriendo": False, "log": [], "titulo": "", "resultado": "",
                 "parar": False, "pedido": ""}
# Estado "en vivo" del trabajo (fase, tiempos, qué se rastrea ahora).
_MON = Monitor()


def log(msg) -> None:
    marca = time.strftime("%H:%M:%S")
    with _cerrojo:
        _estado["log"].append(f"{marca}  {msg}")
        if len(_estado["log"]) > 3000:
            del _estado["log"][:1500]


def _debe_parar() -> bool:
    with _cerrojo:
        return bool(_estado["parar"])


def _pedir_parar(guardar: bool = False) -> None:
    with _cerrojo:
        _estado["parar"] = True
        _estado["pedido"] = "guardar" if guardar else "parar"


def _componentes():
    config = cargar_config()
    db = BaseDatos(DB_RUTA)
    ia = ClienteIA(
        config.proveedores,
        timeout=config.ajustes.timeout,
        deadline=config.ajustes.tiempo_max_ia,
        concurrentes=config.ajustes.concurrentes_ia,
    )
    return config, db, ia


def _lanzar(nombre: str, fn) -> bool:
    with _cerrojo:
        if _estado["corriendo"]:
            return False
        _estado["corriendo"] = True
        _estado["log"] = []
        _estado["titulo"] = nombre
        _estado["resultado"] = ""
        _estado["parar"] = False
        _estado["pedido"] = ""
    _MON.reiniciar()
    _MON.arrancar()

    def _envolver():
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            log(f"[!] Error: {exc}")
        finally:
            log("=== Terminado ===")
            with _cerrojo:
                _estado["corriendo"] = False

    threading.Thread(target=_envolver, daemon=True).start()
    return True


# --------------------------------------------------------------------------- #
# Tareas (corren en segundo plano)
# --------------------------------------------------------------------------- #
def _listas_para(consulta: str, lista_nombre: str, lista_auto: bool) -> list[str]:
    """Qué lista(s) de destino usa una búsqueda.

    - lista_auto=True  -> cada búsqueda va a su propia lista (nombre = consulta).
    - lista_auto=False -> todo va a la lista `lista_nombre` (o "general" si está vacía).
    """
    if lista_auto:
        c = (consulta or "").strip()
        return [c] if c else ["general"]
    n = (lista_nombre or "").strip()
    return [n] if n else ["general"]


def tarea_buscar(consultas: list[str], max_n: int, zona: str, usar_ia: bool,
                 lista_nombre: str = "", lista_auto: bool = True,
                 modo_rapido: bool = True) -> None:
    config, db, ia = _componentes()
    usar_ia = usar_ia and config.ajustes.usar_ia
    if usar_ia and not ia.disponible:
        log("Aviso: no hay proveedor de IA con clave; uso la heurística (igual saca emails).")
    p = Prospector(config, db, ia, log=log, mon=_MON)
    p.aj.modo_rapido = bool(modo_rapido)
    p.aj.ia_solo_email = bool(modo_rapido)
    total = 0
    for i, consulta in enumerate(consultas):
        listas = _listas_para(consulta, lista_nombre, lista_auto)
        _MON.poner(consulta_n=i + 1, consultas_totales=len(consultas))
        nuevos = p.buscar(consulta, max_nuevos=max_n, usar_ia=usar_ia, zona=zona, listas=listas)
        total += len(nuevos)
        log(f"-> {len(nuevos)} nuevas de '{consulta}'  (lista: {', '.join(listas)})")
    log(f"TOTAL nuevas en esta corrida: {total}")
    _MON.poner(fase="inactivo")
    rutas = exportar.exportar_listas(db, SALIDA_LISTAS)
    if rutas:
        log(f"💾 Guardados {len(rutas)} Excel de listas en salida/listas")
    log(f"Estado: {db.estadisticas()}")
    with _cerrojo:
        _estado["resultado"] = f"{total} empresas nuevas"


def tarea_exportar_emails(lote: int) -> None:
    _, db, _ = _componentes()
    archivos = exportar.exportar_emails(db, SALIDA / "emails", lote=lote)
    log(f"Generados {len(archivos)} lotes de hasta {lote} en salida/emails")
    for a in archivos:
        log(f"   {a.name}")
    with _cerrojo:
        _estado["resultado"] = f"{len(archivos)} lotes de emails"


def tarea_exportar_full() -> None:
    _, db, _ = _componentes()
    ruta = exportar.exportar_completo(db, SALIDA / "empresas.csv")
    log(f"Generado: {ruta}")
    log(f"También Excel: {ruta.with_suffix('.xlsx')}")
    rutas = exportar.exportar_listas(db, SALIDA_LISTAS)
    if rutas:
        log(f"💾 Y un Excel por cada lista en salida/listas ({len(rutas)}).")
    with _cerrojo:
        _estado["resultado"] = "empresas.csv + empresas.xlsx"


def tarea_exportar_una_lista(nombre: str) -> None:
    _, db, _ = _componentes()
    ruta = exportar.exportar_lista(db, nombre, SALIDA_LISTAS)
    log(f"💾 Lista '{nombre}' guardada: {ruta} (+ .xlsx)")
    with _cerrojo:
        _estado["resultado"] = f"lista '{nombre}' exportada"


def tarea_exportar_listas() -> None:
    _, db, _ = _componentes()
    rutas = exportar.exportar_listas(db, SALIDA_LISTAS)
    log(f"💾 {len(rutas)} Excel de listas en salida/listas:")
    for r in rutas:
        log(f"   {r.stem}.xlsx")
    with _cerrojo:
        _estado["resultado"] = f"{len(rutas)} listas exportadas"


def tarea_check(limite: int) -> None:
    config, db, ia = _componentes()
    p = Prospector(config, db, ia, log=log, mon=_MON)
    res = p.check(limite=limite or None)
    log(f"Chequeo: {res}")
    with _cerrojo:
        _estado["resultado"] = f"{res['verificadas']} verificadas"


# --------------------------------------------------------------------------- #
# Modo continuo: procesa de a lotes, guarda cada lote y NO para hasta que el
# usuario toque "Parar" o "Guardar".
# --------------------------------------------------------------------------- #
RUBROS = [
    "administradoras de edificios",
    "inmobiliarias",
    "administración de propiedades",
]

BARRIOS_MVD = [
    "Ciudad Vieja", "Centro", "Cordón", "Barrio Sur", "Palermo", "Parque Rodó",
    "Punta Carretas", "Pocitos", "Buceo", "Malvín", "Malvín Norte", "Punta Gorda",
    "Carrasco", "Carrasco Norte", "Bañados de Carrasco", "Jardines", "Tres Cruces",
    "La Blanqueada", "Parque Batlle", "Villa Dolores", "Aguada", "Prado", "Capurro",
    "Bella Vista", "Arroyo Seco", "Paso Molino", "Belvedere", "Sayago", "Peñarol",
    "Colón", "Lezica", "Nuevo París", "Cerro", "La Teja", "Ituzaingó",
    "Villa Española", "Unión", "Maroñas", "Flor de Maroñas", "Manga",
    "Punta de Rieles", "Toledo", "Santiago Vázquez",
]

BARRIOS_CDC = [
    "Ciudad de la Costa", "Solymar", "Lagomar", "El Pinar", "Shangrilá",
    "Lomas de Solymar", "Parque del Plata", "Las Flores", "La Floresta",
    "Atlántida", "Salinas", "Neptunia", "Pinamar",
]


def _consultas_auto() -> list[str]:
    """Arma consultas para todos los barrios (Montevideo + Ciudad de la Costa)."""
    out: list[str] = []
    for barrio in BARRIOS_MVD:
        for rubro in RUBROS:
            out.append(f"{rubro} {barrio} Montevideo")
    for barrio in BARRIOS_CDC:
        for rubro in RUBROS:
            out.append(f"{rubro} {barrio} Canelones")
    return out


def tarea_continua(consultas: list[str], max_n: int, zona: str, usar_ia: bool,
                   auto_barrios: bool = False, lista_nombre: str = "",
                   lista_auto: bool = True, modo_rapido: bool = True) -> None:
    config, db, ia = _componentes()
    usar_ia = usar_ia and config.ajustes.usar_ia
    if usar_ia and not ia.disponible:
        log("Aviso: no hay proveedor de IA con clave; uso la heurística (igual saca emails).")

    if auto_barrios:
        consultas = _consultas_auto()
    if not consultas:
        consultas = _consultas_auto()

    lote = int(config.ajustes.lote or 20)
    p = Prospector(config, db, ia, log=log, mon=_MON)
    p.aj.modo_rapido = bool(modo_rapido)
    p.aj.ia_solo_email = bool(modo_rapido)
    log(f"MODO CONTINUO: procesa de a {lote} y NO para hasta que toques PARAR o GUARDAR.")
    log(f"Lista de búsquedas: {len(consultas)}.")

    ultimo_guardado = db.estadisticas()["con_email"]
    total = 0
    vuelta = 0
    while not _debe_parar():
        vuelta += 1
        nuevos_vuelta = 0
        log(f"===== VUELTA {vuelta} =====")
        for i, consulta in enumerate(consultas):
            if _debe_parar():
                break
            listas = _listas_para(consulta, lista_nombre, lista_auto)
            _MON.poner(consulta_n=i + 1, consultas_totales=len(consultas), vuelta=vuelta)
            try:
                nuevos = p.buscar(consulta, max_nuevos=max_n, usar_ia=usar_ia, zona=zona,
                                  debe_parar=_debe_parar, listas=listas)
            except Exception as exc:  # noqa: BLE001
                log(f"  [!] {consulta}: {exc}")
                nuevos = []
            nuevos_vuelta += len(nuevos)
            total += len(nuevos)
            con_email = db.estadisticas()["con_email"]
            if con_email - ultimo_guardado >= lote:
                archivos = exportar.exportar_emails(db, SALIDA / "emails", lote=lote)
                rl = exportar.exportar_listas(db, SALIDA_LISTAS)
                log(f"💾 GUARDADO: {con_email} emails en {len(archivos)} lote(s) de {lote} "
                    f"(más {len(rl)} Excel de listas).")
                ultimo_guardado = con_email
        if _debe_parar():
            break
        if nuevos_vuelta == 0:
            log("Sin novedades en esta vuelta. Espero 60 s y sigo (tocá PARAR para terminar).")
            _MON.poner(fase="esperando")
            for _ in range(60):
                if _debe_parar():
                    break
                time.sleep(1)

    # Cierre: siempre guardamos lo hecho (y la lista completa si pidió "Guardar").
    archivos = exportar.exportar_emails(db, SALIDA / "emails", lote=lote)
    log(f"Guardados {len(archivos)} lote(s) de emails en salida/emails.")
    rutas_listas = exportar.exportar_listas(db, SALIDA_LISTAS)
    if rutas_listas:
        log(f"💾 Guardados {len(rutas_listas)} Excel de listas en salida/listas:")
        for r in rutas_listas:
            log(f"   {r.stem}.xlsx")
    with _cerrojo:
        pedido = _estado.get("pedido")
    if pedido == "guardar":
        ruta = exportar.exportar_completo(db, SALIDA / "empresas.csv")
        log(f"Lista completa guardada: {ruta} (+ .xlsx)")
    log(f"TOTAL nuevas en la corrida: {total}")
    log(f"Estado final: {db.estadisticas()}")
    _MON.poner(fase="inactivo")
    with _cerrojo:
        _estado["resultado"] = f"{total} nuevas · {db.estadisticas()['con_email']} con email"


# --------------------------------------------------------------------------- #
# Página
# --------------------------------------------------------------------------- #
PAGINA = r"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prospector IA</title>
<style>
  :root { --bg:#12151b; --panel:#1b2029; --borde:#2b3240; --txt:#e7ecf3; --sub:#9aa7b8;
          --ok:#2ecc71; --azul:#3b82f6; --amar:#f1c40f; --rojo:#e74c3c; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--txt); }
  header { padding:16px 22px; background:var(--panel); border-bottom:1px solid var(--borde);
           display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  header h1 { font-size:19px; margin:0; }
  header .sub { color:var(--sub); font-size:13px; }
  .stats { margin-left:auto; display:flex; gap:14px; font-size:13px; color:var(--sub); }
  .stats b { color:var(--txt); }
  main { max-width:1000px; margin:0 auto; padding:20px; }
  section { background:var(--panel); border:1px solid var(--borde); border-radius:12px;
            padding:18px; margin-bottom:18px; }
  h2 { font-size:15px; margin:0 0 12px; color:var(--sub); text-transform:uppercase; letter-spacing:.5px; }
  textarea, input, select { width:100%; background:#0e1116; color:var(--txt); border:1px solid var(--borde);
            border-radius:8px; padding:10px; font-size:14px; font-family:inherit; }
  textarea { min-height:96px; resize:vertical; }
  .fila { display:flex; gap:14px; flex-wrap:wrap; margin-top:12px; }
  .campo { flex:1; min-width:130px; }
  .campo label { display:block; font-size:12px; color:var(--sub); margin-bottom:5px; }
  label.chk { display:flex; align-items:center; gap:8px; font-size:14px; color:var(--txt); margin-top:26px; }
  label.chk input { width:auto; }
  button { cursor:pointer; border:0; border-radius:9px; padding:11px 18px; font-size:14px; font-weight:600;
           color:#fff; background:var(--azul); transition:.15s; }
  button:hover { filter:brightness(1.12); }
  button:disabled { opacity:.45; cursor:not-allowed; }
  button.grande { background:var(--ok); font-size:16px; padding:14px 26px; }
  button.gris { background:#39414f; }
  button.rojo { background:var(--rojo); }
  .botones { display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }
  pre { background:#0a0d12; border:1px solid var(--borde); border-radius:8px; padding:12px;
        height:280px; overflow:auto; font-size:12.5px; line-height:1.5; white-space:pre-wrap; margin:0; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--borde); }
  th { color:var(--sub); font-weight:600; }
  tr:hover td { background:#161b23; }
  .pill { font-size:11px; padding:2px 8px; border-radius:20px; background:#243040; color:var(--sub); }
  .pill.ok { background:#14351f; color:var(--ok); }
  .vacio { color:var(--sub); padding:16px 0; }
  .estado { font-size:13px; color:var(--amar); }
  .scroll { max-height:360px; overflow:auto; }
  /* --- Panel en vivo del trabajo --- */
  .hud { background:#0a0d12; border:1px solid var(--borde); border-radius:8px;
         padding:12px 14px; margin-bottom:12px; }
  .hud_top { display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:13px; }
  .fase { font-weight:700; color:var(--ok); }
  .fase.bus { color:var(--amar); }
  .fase.off { color:var(--sub); }
  .hud_consulta { color:var(--sub); overflow:hidden; text-overflow:ellipsis;
                  white-space:nowrap; max-width:52%; }
  .hud_tiempo { margin-left:auto; color:var(--sub); font-variant-numeric:tabular-nums; }
  .barra { height:8px; background:#161b23; border-radius:6px; margin:10px 0 12px;
           overflow:hidden; }
  .barra > i { display:block; height:100%; width:0%; border-radius:6px;
               background:linear-gradient(90deg,var(--ok),#3ad07f);
               transition:width .4s ease; }
  .hud_nums { display:flex; gap:16px; flex-wrap:wrap; font-size:12.5px; color:var(--sub); }
  .hud_nums b { color:#e7edf7; font-variant-numeric:tabular-nums; }
  .hud_nums .bueno b { color:var(--ok); }
  .hud_nums .ia b { color:var(--amar); }
  .hud_curso { margin-top:9px; font-size:11.5px; color:var(--sub); line-height:1.7;
               word-break:break-all; }
  .hud_curso span { background:#161b23; border:1px solid var(--borde); border-radius:5px;
                    padding:1px 7px; margin-right:6px; display:inline-block; }
  .hud_fuente { font-size:11.5px; color:var(--sub); margin-top:6px; }
</style>
</head>
<body>
<header>
  <h1>🧭 Prospector IA</h1>
  <span class="sub">Empresas con email verificado en su web</span>
  <div class="stats" id="stats"></div>
</header>

<main>
  <section>
    <h2>1 · Buscar empresas (modo continuo)</h2>
    <textarea id="consultas">administradoras de edificios Pocitos Montevideo
inmobiliarias Cordón Montevideo
inmobiliarias Ciudad de la Costa</textarea>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="auto_barrios"> Recorrer automáticamente TODOS los barrios (Montevideo + Ciudad de la Costa)</label>
    <div class="fila">
      <div class="campo">
        <label>Empresas nuevas por tanda (lote)</label>
        <input type="number" id="max" value="20" min="1" max="200">
      </div>
      <div class="campo">
        <label>Zona / barrio (opcional)</label>
        <input type="text" id="zona" placeholder="Ej: Pocitos">
      </div>
      <label class="chk"><input type="checkbox" id="usar_ia" checked> Usar IA</label>
      <label class="chk"><input type="checkbox" id="modo_rapido" checked> ⚡ Modo rápido (IA solo si falta el email)</label>
    </div>
    <div class="fila">
      <div class="campo" style="min-width:260px">
        <label>Guardar en el Excel (lista)</label>
        <input type="text" id="lista_nombre" list="listas_existentes" placeholder="Vacío = una lista por cada búsqueda">
        <datalist id="listas_existentes"></datalist>
      </div>
      <label class="chk"><input type="checkbox" id="lista_auto" checked> Una lista por cada búsqueda (usa el texto buscado)</label>
    </div>
    <div class="botones">
      <button class="grande" id="btn_iniciar" onclick="iniciar()">▶ INICIAR (no para hasta Parar/Guardar)</button>
      <button class="rojo" id="btn_parar" onclick="parar()" disabled>⏹ PARAR</button>
      <button class="gris" id="btn_guardar" onclick="guardar()" disabled>💾 GUARDAR Y PARAR</button>
    </div>
    <div class="botones" style="margin-top:8px">
      <button class="gris" onclick="verEmpresas()">📋 Ver empresas</button>
      <button class="gris" onclick="abrirSalida()">📂 Abrir carpeta de salida</button>
    </div>
  </section>

  <section>
    <h2>2 · Exportar</h2>
    <div class="botones">
      <button onclick="exportar('emails')">📧 Emails en lotes de a 20</button>
      <button onclick="exportar('full')">📄 Lista completa (CSV + Excel)</button>
      <button onclick="exportar('listas')">🗂️ Un Excel por lista</button>
      <button class="gris" onclick="hacerCheck()">✅ Chequear empresas guardadas</button>
    </div>
  </section>

  <section>
    <h2>3 · Listas guardadas (una carpeta por lista)</h2>
    <div class="botones" style="margin-top:0">
      <button class="gris" onclick="cargarListas()">🔄 Actualizar listas</button>
    </div>
    <div class="scroll" style="margin-top:12px">
      <table id="tabla_listas"><thead><tr><th>Nombre</th><th>Empresas</th><th>Con email</th><th></th></tr></thead><tbody><tr><td class="vacio">Cargando…</td></tr></tbody></table>
    </div>
  </section>

  <section>
    <h2>Actividad</h2>
    <div class="hud" id="hud">
      <div class="hud_top">
        <span class="fase off" id="hud_fase">En reposo</span>
        <span class="hud_consulta" id="hud_consulta"></span>
        <span class="hud_tiempo" id="hud_tiempo"></span>
      </div>
      <div class="barra"><i id="hud_barra"></i></div>
      <div class="hud_nums" id="hud_nums"></div>
      <div class="hud_curso" id="hud_curso"></div>
      <div class="hud_fuente" id="hud_fuente"></div>
    </div>
    <div class="estado" id="estado"></div>
    <pre id="log">Listo. Configurá las búsquedas y tocá INICIAR (corre sin parar hasta Parar/Guardar).</pre>
  </section>

  <section>
    <h2>Empresas guardadas</h2>
    <div class="scroll"><table id="tabla"><tbody><tr><td class="vacio">Tocá "Ver empresas".</td></tr></tbody></table></div>
  </section>
</main>

<script>
async function api(ruta, datos) {
  const o = datos ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(datos)} : {};
  const r = await fetch(ruta, o);
  return await r.json();
}
async function stats() {
  try {
    const s = await api('/api/estado');
    document.getElementById('stats').innerHTML =
      `<span>Empresas: <b>${s.empresas}</b></span>` +
      `<span>Con email: <b>${s.con_email}</b></span>` +
      `<span>Verificados: <b>${s.verificado}</b></span>` +
      `<span>Dominios vistos: <b>${s.dominios_vistos}</b></span>`;
  } catch(e) {}
}
async function iniciar() {
  const consultas = document.getElementById('consultas').value.split('\n').map(x=>x.trim()).filter(Boolean);
  const auto = document.getElementById('auto_barrios').checked;
  if (!consultas.length && !auto) { alert('Escribí al menos una búsqueda (o marcá "todos los barrios").'); return; }
  const datos = {
    consultas: consultas,
    auto_barrios: auto,
    max: parseInt(document.getElementById('max').value) || 20,
    zona: document.getElementById('zona').value.trim(),
    usar_ia: document.getElementById('usar_ia').checked,
    modo_rapido: document.getElementById('modo_rapido').checked,
    lista_nombre: document.getElementById('lista_nombre').value.trim(),
    lista_auto: document.getElementById('lista_auto').checked
  };
  const r = await api('/api/continuo', datos);
  if (r.error) alert(r.error);
  refrescar();
  cargarListas();
}
async function parar() { await api('/api/parar', {}); refrescar(); }
async function guardar() { await api('/api/guardar', {}); refrescar(); }
async function exportar(tipo) {
  const r = await api('/api/exportar', {tipo: tipo});
  if (r.error) alert(r.error);
  refrescar();
}
async function hacerCheck() {
  const r = await api('/api/check', {limite: 50});
  if (r.error) alert(r.error);
  refrescar();
}
function renderTabla(filas, vacio) {
  const t = document.getElementById('tabla');
  if (!filas.length) {
    t.innerHTML = `<tbody><tr><td class="vacio">${vacio || 'Todavía no hay empresas.'}</td></tr></tbody>`;
    return;
  }
  let h = '<thead><tr><th>Nombre</th><th>Teléfono</th><th>WhatsApp</th><th>Email</th><th>Web</th><th></th></tr></thead><tbody>';
  for (const f of filas) {
    const pill = f.estado_email === 'verificado' ? '<span class="pill ok">verificado</span>'
               : (f.email ? '<span class="pill">' + esc(f.estado_email) + '</span>' : '');
    h += `<tr><td>${esc(f.nombre)}</td><td>${esc(f.telefono)}</td><td>${esc(f.whatsapp)}</td>` +
         `<td>${esc(f.email)}</td><td>${esc(f.web)}</td><td>${pill}</td></tr>`;
  }
  t.innerHTML = h + '</tbody>';
}
async function verEmpresas() { renderTabla(await api('/api/lista')); }
async function verLista(nombre) {
  renderTabla(await api('/api/lista_de?nombre=' + encodeURIComponent(nombre)),
              `La lista "${nombre}" no tiene empresas todavía.`);
}
function jsq(s) { return "'" + String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'") + "'"; }
async function cargarListas() {
  const listas = await api('/api/listas');
  const t = document.getElementById('tabla_listas');
  if (!listas.length) {
    t.innerHTML = '<tbody><tr><td class="vacio" colspan="4">Todavía no hay listas. Hacé una búsqueda y elegí dónde guardar.</td></tr></tbody>';
  } else {
    let h = '<tbody>';
    for (const l of listas) {
      h += `<tr><td>${esc(l.nombre)}</td><td>${l.n}</td><td>${l.con_email||0}</td>` +
           `<td style="text-align:right; white-space:nowrap">` +
           `<button class="gris" style="padding:5px 10px; font-size:12px" onclick="verLista(${jsq(l.nombre)})">👁 Ver</button> ` +
           `<button class="gris" style="padding:5px 10px; font-size:12px" onclick="exportarLista(${jsq(l.nombre)})">💾 Excel</button> ` +
           `<button class="rojo" style="padding:5px 10px; font-size:12px" onclick="borrarLista(${jsq(l.nombre)})">🗑 Quitar</button>` +
           `</td></tr>`;
    }
    t.innerHTML = h + '</tbody>';
  }
  const dl = document.getElementById('listas_existentes');
  if (dl) dl.innerHTML = listas.map(l => `<option value="${esc(l.nombre)}">`).join('');
}
async function exportarLista(nombre) {
  const r = await api('/api/exportar_lista', {nombre: nombre});
  if (r.error) alert(r.error);
  refrescar();
}
async function borrarLista(nombre) {
  if (!confirm(`¿Quitar la lista "${nombre}"? (las empresas NO se borran, solo esta carpeta)`)) return;
  await api('/api/borrar_lista', {nombre: nombre});
  cargarListas();
}
function esc(s) { return (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
async function abrirSalida() { await api('/api/abrir', {}); }
let desde = 0, timer = null;
async function refrescar() {
  const r = await api('/api/log?desde=' + desde);
  desde = r.total;
  if (r.lineas.length) {
    const log = document.getElementById('log');
    log.textContent += '\n' + r.lineas.join('\n');
    log.scrollTop = log.scrollHeight;
  }
  const btn = document.getElementById('btn_iniciar');
  btn.disabled = r.corriendo;
  document.getElementById('btn_parar').disabled = !r.corriendo;
  document.getElementById('btn_guardar').disabled = !r.corriendo;
  document.getElementById('estado').textContent =
    r.corriendo ? ('⏳ Trabajando: ' + r.titulo) : (r.resultado ? ('✔ ' + r.resultado) : 'Listo.');
  await progreso();
  if (r.corriendo) { if (!timer) timer = setInterval(refrescar, 1200); }
  else { if (timer) { clearInterval(timer); timer = null; } stats(); cargarListas(); if (r.lineas.length) verEmpresas(); }
}

const FASES = {buscando:'🔎 Consultando buscadores', procesando:'🕷️ Rastreando webs',
               chequeando:'✅ Chequeando guardadas', esperando:'⏸️ Sin novedades, esperando',
               inactivo:'En reposo'};
function seg(s) {
  s = Math.round(s || 0);
  return s < 60 ? s + 's' : Math.floor(s/60) + 'm ' + String(s%60).padStart(2,'0') + 's';
}
async function progreso() {
  let p;
  try { p = await api('/api/progreso'); } catch (e) { return; }
  const fase = p.fase || 'inactivo';
  const lbl = document.getElementById('hud_fase');
  lbl.textContent = FASES[fase] || fase;
  lbl.className = 'fase ' + (fase === 'buscando' ? 'bus' : (fase === 'inactivo' ? 'off' : ''));
  document.getElementById('hud_consulta').textContent =
    (p.vuelta > 1 ? `Vuelta ${p.vuelta} · ` : '') + (p.consulta || '') +
    (p.consultas_totales > 1 ? `  (consulta ${p.consulta_n} de ${p.consultas_totales})` : '');
  document.getElementById('hud_tiempo').textContent = p.t_total ? ('⏱ ' + seg(p.t_total)) : '';

  const cand = p.candidatos || 0, hechas = p.procesadas || 0;
  const pct = cand ? Math.min(100, Math.round(hechas * 100 / cand)) : (p.corriendo && fase === 'buscando' ? 100 : 0);
  document.getElementById('hud_barra').style.width = pct + '%';

  const n = (k, txt, cls) => `<span class="${cls || ''}">${txt}: <b>${p[k] ?? 0}</b></span>`;
  document.getElementById('hud_nums').innerHTML =
    `<span>Rastreadas: <b>${hechas}${cand ? '/' + cand : ''}</b></span>` +
    n('nuevas', 'Nuevas', 'bueno') + n('con_email', 'Con email', 'bueno') +
    n('sin_email', 'Sin email') + n('ia_llamadas', 'IA usada', 'ia') +
    n('ia_salvados', 'IA resolvió', 'ia') + n('excluidas', 'Descartadas') +
    n('repetidas', 'Ya vistas');

  const curso = (p.en_curso || []).slice(0, 14);
  document.getElementById('hud_curso').innerHTML = curso.length
    ? '<b style="color:#e7edf7">Rastreando ahora: </b>' + curso.map(d => `<span>${esc(d)}</span>`).join('')
    : '';
  const fuentes = Object.entries(p.fuentes || {})
    .filter(([k, v]) => v && typeof v === 'object')
    .map(([k, v]) => `${k}: ${v.error ? 'caído' : v.resultados}`).join(' · ');
  document.getElementById('hud_fuente').textContent = fuentes
    ? ('Buscadores → ' + fuentes +
       (p.t_busqueda ? `   ⏱ búsqueda ${seg(p.t_busqueda)}` : '') +
       (p.t_rastreo_prom ? `   ·   rastreo prom. ${p.t_rastreo_prom}s` : '') +
       (p.t_ia_prom ? `   ·   IA prom. ${p.t_ia_prom}s` : ''))
    : '';
}
setInterval(()=>{ if(!document.getElementById('btn_iniciar').disabled) stats(); }, 8000);
setInterval(()=>{ progreso(); }, 2000);
stats();
progreso();
cargarListas();
</script>
</body>
</html>
"""


class Manejador(BaseHTTPRequestHandler):
    def _json(self, datos, codigo=200):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def _leer(self) -> dict:
        largo = int(self.headers.get("Content-Length", 0) or 0)
        if not largo:
            return {}
        try:
            return json.loads(self.rfile.read(largo).decode("utf-8"))
        except Exception:
            return {}

    def log_message(self, *args):  # silencio en consola
        pass

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/index"):
            cuerpo = PAGINA.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)
            return
        if self.path.startswith("/api/log"):
            desde = 0
            if "desde=" in self.path:
                try:
                    desde = int(self.path.split("desde=")[1].split("&")[0])
                except Exception:
                    desde = 0
            with _cerrojo:
                lineas = _estado["log"][desde:]
                total = len(_estado["log"])
                corriendo = _estado["corriendo"]
                titulo = _estado["titulo"]
                resultado = _estado["resultado"]
            self._json({"lineas": lineas, "total": total, "corriendo": corriendo,
                        "titulo": titulo, "resultado": resultado})
            return
        if self.path.startswith("/api/listas"):
            _, db, _ = _componentes()
            self._json(db.listar_listas())
            return
        if self.path.startswith("/api/lista_de"):
            import urllib.parse as _up
            q = _up.parse_qs(_up.urlparse(self.path).query)
            nombre = (q.get("nombre") or [""])[0]
            _, db, _ = _componentes()
            self._json(db.empresas_de_lista(nombre) if nombre else [])
            return
        if self.path.startswith("/api/lista"):
            _, db, _ = _componentes()
            self._json(db.listar(200))
            return
        if self.path.startswith("/api/estado"):
            _, db, _ = _componentes()
            self._json(db.estadisticas())
            return
        if self.path.startswith("/api/progreso"):
            with _cerrojo:
                corriendo = _estado["corriendo"]
                titulo = _estado["titulo"]
            progreso = _MON.estado()
            progreso["corriendo"] = corriendo
            progreso["titulo"] = titulo
            self._json(progreso)
            return
        self._json({"error": "no encontrado"}, 404)

    def do_POST(self):
        datos = self._leer()
        if self.path.startswith("/api/buscar"):
            consultas = [c for c in (datos.get("consultas") or []) if c.strip()]
            if not consultas:
                self._json({"error": "No hay búsquedas."})
                return
            ok = _lanzar("Buscando empresas...", lambda: tarea_buscar(
                consultas, int(datos.get("max") or 20), datos.get("zona") or "",
                bool(datos.get("usar_ia", True)), datos.get("lista_nombre") or "",
                bool(datos.get("lista_auto", True)), bool(datos.get("modo_rapido", True))))
            self._json({} if ok else {"error": "Ya hay una tarea corriendo."})
            return
        if self.path.startswith("/api/continuo"):
            consultas = [c for c in (datos.get("consultas") or []) if c.strip()]
            auto = bool(datos.get("auto_barrios"))
            if not consultas and not auto:
                self._json({"error": "No hay búsquedas."})
                return
            ok = _lanzar("Modo continuo (no para hasta Parar/Guardar)...", lambda: tarea_continua(
                consultas, int(datos.get("max") or 20), datos.get("zona") or "",
                bool(datos.get("usar_ia", True)), auto, datos.get("lista_nombre") or "",
                bool(datos.get("lista_auto", True)), bool(datos.get("modo_rapido", True))))
            self._json({} if ok else {"error": "Ya hay una tarea corriendo."})
            return
        if self.path.startswith("/api/parar"):
            _pedir_parar(guardar=False)
            self._json({"ok": True})
            return
        if self.path.startswith("/api/guardar"):
            _pedir_parar(guardar=True)
            self._json({"ok": True})
            return
        if self.path.startswith("/api/exportar_lista"):
            nombre = (datos.get("nombre") or "").strip()
            if not nombre:
                self._json({"error": "Falta el nombre de la lista."})
                return
            ok = _lanzar(f"Exportando lista '{nombre}'...",
                         lambda: tarea_exportar_una_lista(nombre))
            self._json({} if ok else {"error": "Ya hay una tarea corriendo."})
            return
        if self.path.startswith("/api/borrar_lista"):
            nombre = (datos.get("nombre") or "").strip()
            _, db, _ = _componentes()
            borrada = db.borrar_lista(nombre) if nombre else False
            self._json({"ok": borrada, "nombre": nombre})
            return
        if self.path.startswith("/api/exportar"):
            tipo = datos.get("tipo", "emails")
            if tipo == "emails":
                ok = _lanzar("Exportando emails en lotes...", lambda: tarea_exportar_emails(20))
            elif tipo == "listas":
                ok = _lanzar("Exportando listas (Excel)...", tarea_exportar_listas)
            else:
                ok = _lanzar("Exportando lista completa...", tarea_exportar_full)
            self._json({} if ok else {"error": "Ya hay una tarea corriendo."})
            return
        if self.path.startswith("/api/check"):
            ok = _lanzar("Chequeando empresas guardadas...", lambda: tarea_check(int(datos.get("limite") or 0)))
            self._json({} if ok else {"error": "Ya hay una tarea corriendo."})
            return
        if self.path.startswith("/api/abrir"):
            SALIDA.mkdir(parents=True, exist_ok=True)
            try:
                subprocess.Popen(["xdg-open", str(SALIDA)])
                self._json({"ok": True})
            except Exception as exc:  # noqa: BLE001
                self._json({"error": str(exc)})
            return
        self._json({"error": "no encontrado"}, 404)


def main() -> None:
    url = f"http://127.0.0.1:{PUERTO}/"
    print("=" * 56)
    print("  🧭  Prospector IA")
    print(f"  Interfaz:  {url}")
    print("  Cerrá esta ventana (o Ctrl+C) para apagar.")
    print("=" * 56)
    if os.environ.get("NO_ABRIR") != "1":
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    servidor = ThreadingHTTPServer(("127.0.0.1", PUERTO), Manejador)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nApagado.")
        servidor.shutdown()


if __name__ == "__main__":
    main()
