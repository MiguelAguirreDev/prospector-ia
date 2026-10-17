#!/usr/bin/env python3
"""Prospector IA — línea de comandos.

Ejemplos:
  python3 run.py buscar "administradoras de edificios Pocitos Montevideo" --max 20 --zona Pocitos
  python3 run.py listar --limite 20
  python3 run.py exportar --tipo emails --lote 20 --salida salida/emails
  python3 run.py exportar --tipo full --salida salida/empresas.csv
  python3 run.py exportar --tipo listas --salida salida/listas
  python3 run.py check --limite 50
  python3 run.py proveedores
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

from prospector import exportar  # noqa: E402
from prospector.config import cargar_config  # noqa: E402
from prospector.db import BaseDatos  # noqa: E402
from prospector.ia import ClienteIA  # noqa: E402
from prospector.pipeline import Prospector  # noqa: E402

DB_DEFECTO = RAIZ / "datos" / "prospector.db"


def _construir(args):
    config = cargar_config(getattr(args, "config", None))
    db = BaseDatos(args.db or DB_DEFECTO)
    ia = ClienteIA(
        config.proveedores,
        timeout=config.ajustes.timeout,
        deadline=config.ajustes.tiempo_max_ia,
        concurrentes=config.ajustes.concurrentes_ia,
    )
    return config, db, ia


def cmd_buscar(args):
    config, db, ia = _construir(args)
    usar_ia = config.ajustes.usar_ia and not args.sin_ia
    if usar_ia and not ia.disponible:
        print("Aviso: no hay proveedor de IA con clave; sigo con heurística.")
    p = Prospector(config, db, ia)
    for consulta in args.consulta:
        listas = [args.lista] if args.lista else [consulta]
        nuevos = p.buscar(consulta, max_nuevos=args.max, usar_ia=usar_ia,
                          zona=args.zona or "", listas=listas)
        print(f"-> {len(nuevos)} empresas nuevas de '{consulta}' (lista: {', '.join(listas)})")
    print("Estado:", db.estadisticas())


def cmd_rastrear(args):
    config, db, ia = _construir(args)
    usar_ia = config.ajustes.usar_ia and not args.sin_ia
    p = Prospector(config, db, ia)
    nuevos = p.rastrear_urls(args.urls, usar_ia=usar_ia, zona=args.zona or "")
    print(f"-> {len(nuevos)} empresas nuevas")


def cmd_check(args):
    config, db, ia = _construir(args)
    p = Prospector(config, db, ia)
    print("Chequeo:", p.check(limite=args.limite))


def cmd_listar(args):
    _, db, _ = _construir(args)
    filas = db.listar(args.limite)
    if not filas:
        print("Sin datos todavía.")
        return
    print(f"{'ID':>4}  {'NOMBRE':28} {'TELEFONO':13} {'WHATSAPP':13} {'EMAIL':30}")
    for f in filas:
        print(
            f"{f['id']:>4}  {f['nombre'][:28]:28} {f['telefono'][:13]:13} "
            f"{f['whatsapp'][:13]:13} {f['email'][:30]:30}"
        )


def cmd_exportar(args):
    _, db, _ = _construir(args)
    if args.tipo == "emails":
        salida = args.salida or str(RAIZ / "salida" / "emails")
        archivos = exportar.exportar_emails(db, salida, lote=args.lote, limite=args.limite)
        print(f"Generados {len(archivos)} lotes de hasta {args.lote} en {salida}")
        for a in archivos:
            print("  ", a)
    elif args.tipo == "listas":
        salida = args.salida or str(RAIZ / "salida" / "listas")
        if args.lista:
            ruta = exportar.exportar_lista(db, args.lista, salida)
            print("Generado:", ruta, "(+ .xlsx)")
        else:
            rutas = exportar.exportar_listas(db, salida)
            print(f"Generados {len(rutas)} Excel (uno por lista) en {salida}")
            for r in rutas:
                print("  ", r)
    else:
        salida = args.salida or str(RAIZ / "salida" / "empresas.csv")
        ruta = exportar.exportar_completo(
            db, salida, limite=args.limite, solo_objetivo=args.solo_objetivo
        )
        print("Generado:", ruta, "(+ .xlsx)")


def cmd_proveedores(args):
    config, _, ia = _construir(args)
    print(f"Config: {config.ruta}")
    for p in config.proveedores:
        estado = "OK" if p.disponible() else "sin clave"
        print(f"  - {p.nombre:18} {p.modelo:38} [{estado}]")
    if ia.disponible:
        try:
            txt = ia.chat([{"role": "user", "content": "Respondé solo: ok"}])
            print(f"Prueba con '{ia.ultimo_proveedor}': {txt.strip()[:60]}")
        except Exception as exc:  # noqa: BLE001
            print("Error de prueba IA:", exc)
    else:
        print("No hay proveedores con clave. Exportá la variable o poné la api_key en config.json.")


def main():
    p = argparse.ArgumentParser(
        prog="prospector", description="Prospector IA — contactos verificados de empresas"
    )
    p.add_argument("--db", default=None, help="Ruta de la base SQLite")
    p.add_argument("--config", default=None, help="Ruta de config.json")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("buscar", help="Buscar y extraer empresas nuevas")
    b.add_argument("consulta", nargs="+", help="Uno o más textos de búsqueda")
    b.add_argument("--max", type=int, default=20, help="Máximo de empresas NUEVAS por consulta")
    b.add_argument("--zona", default="", help="Zona/barrio a guardar")
    b.add_argument("--lista", default="", help="Guardar en la lista (Excel) con ese nombre")
    b.add_argument("--sin-ia", action="store_true", help="No usar IA (solo heurística)")
    b.set_defaults(func=cmd_buscar)

    r = sub.add_parser("rastrear", help="Rastrear URLs concretas")
    r.add_argument("urls", nargs="+")
    r.add_argument("--zona", default="")
    r.add_argument("--sin-ia", action="store_true")
    r.set_defaults(func=cmd_rastrear)

    c = sub.add_parser("check", help="Re-verificar empresas guardadas")
    c.add_argument("--limite", type=int, default=None)
    c.set_defaults(func=cmd_check)

    l = sub.add_parser("listar", help="Ver empresas guardadas")
    l.add_argument("--limite", type=int, default=20)
    l.set_defaults(func=cmd_listar)

    e = sub.add_parser("exportar", help="Exportar CSV/Excel")
    e.add_argument("--tipo", choices=["emails", "full", "listas"], default="emails")
    e.add_argument("--lote", type=int, default=20, help="Tamaño del lote (tipo emails)")
    e.add_argument("--lista", default="", help="Exportar solo esa lista (tipo listas)")
    e.add_argument("--salida", default=None)
    e.add_argument("--limite", type=int, default=None)
    e.add_argument("--solo-objetivo", action="store_true")
    e.set_defaults(func=cmd_exportar)

    pr = sub.add_parser("proveedores", help="Ver/probar proveedores de IA")
    pr.set_defaults(func=cmd_proveedores)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
