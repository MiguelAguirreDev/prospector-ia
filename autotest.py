#!/usr/bin/env python3
"""Autotest sin internet: verifica extracción, dedup, lotes y elección de email."""

import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

from prospector import exportar  # noqa: E402
from prospector.db import BaseDatos, normalizar_dominio  # noqa: E402
from prospector.rastreo import (  # noqa: E402
    elegir_email,
    extraer_emails,
    extraer_telefonos,
    extraer_whatsapp,
)

ok = 0
fail = 0


def check(nombre, cond):
    global ok, fail
    if cond:
        ok += 1
        print(f"  \u2714 {nombre}")
    else:
        fail += 1
        print(f"  \u2718 {nombre}")


print("1) Extracción de emails")
html = """
Contacto: info@inmobiliariaejemplo.com.uy y ventas@otra.com
<a href="mailto:admin@tercera.uy">escribinos</a>
<img src="logo@2x.png"> falso@example.com  x@y.png
"""
emails = extraer_emails(html)
check("encuentra info@...", "info@inmobiliariaejemplo.com.uy" in emails)
check("encuentra ventas@...", "ventas@otra.com" in emails)
check("encuentra mailto:", "admin@tercera.uy" in emails)
check("descarta example.com", all("example.com" not in e for e in emails))
check("descarta .png", all(not e.endswith(".png") for e in emails))

print("2) Teléfonos y WhatsApp (UY)")
check("detecta 099 123 456", "099123456" in extraer_telefonos("Llamanos al 099 123 456"))
check("detecta 2xxx xxxx", "29001234" in extraer_telefonos("Tel: 2900 1234"))
check(
    "detecta wa.me/598...",
    "59899123456" in extraer_whatsapp("https://wa.me/59899123456"),
)
check(
    "detecta api.whatsapp",
    "59891234567" in extraer_whatsapp("https://api.whatsapp.com/send?phone=59891234567"),
)

print("3) Elección de email")
check(
    "prefiere el del mismo dominio",
    elegir_email(["otro@gmail.com", "info@empresa.com.uy"], "empresa.com.uy") == "info@empresa.com.uy",
)
check("prefiere info@", elegir_email(["juan@empresa.uy", "info@empresa.uy"], "") == "info@empresa.uy")
check("vacío si no hay", elegir_email([], "x.uy") == "")

print("4) Normalizar dominio")
check("saca www y mayúsculas", normalizar_dominio("https://WWW.Ejemplo.com.uy/x") == "ejemplo.com.uy")
check("sin esquema", normalizar_dominio("empresa.uy") == "empresa.uy")

print("5) Base de datos y dedup")
with tempfile.TemporaryDirectory() as tmp:
    db = BaseDatos(Path(tmp) / "t.db")
    primera = db.guardar_empresa({"nombre": "A", "web": "https://a.com.uy", "email": "info@a.com.uy"})
    repetida = db.guardar_empresa({"nombre": "A otra vez", "web": "https://a.com.uy"})
    check("primera se guarda", primera is True)
    check("repetida NO se guarda", repetida is False)
    check("dominio visto", db.dominio_visto("a.com.uy") is True)
    db.marcar_dominio("b.com.uy")
    check("marcar dominio", db.dominio_visto("b.com.uy") is True)
    check("estadísticas", db.estadisticas()["con_email"] == 1)

print("6) Exportación en lotes de a 20")
with tempfile.TemporaryDirectory() as tmp:
    db = BaseDatos(Path(tmp) / "t.db")
    for i in range(45):
        db.guardar_empresa(
            {"nombre": f"E{i}", "web": f"https://e{i}.com.uy", "email": f"info@e{i}.com.uy"}
        )
    carpeta = Path(tmp) / "salida"
    archivos = exportar.exportar_emails(db, carpeta, lote=20)
    check("45 -> 3 lotes", len(archivos) == 3)
    lineas_lote1 = (carpeta / "emails_01.csv").read_text(encoding="utf-8-sig").strip().splitlines()
    check("lote 1 = cabecera + 20", len(lineas_lote1) == 21)

print("7) Modo rápido: búsqueda multi-fuente")
from prospector import busqueda  # noqa: E402
from prospector.config import cargar_config  # noqa: E402
from prospector.pipeline import _limpiar_nombre  # noqa: E402
from prospector.rastreo import _texto_limpio  # noqa: E402

check(
    "redirección DDG decodificada",
    busqueda._normalizar_url(
        "//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rem.com.uy%2F&rut=abc"
    ) == "https://www.rem.com.uy/")
check("url relativa descartada", busqueda._normalizar_url("/search?q=x") == "")
unidos = busqueda._unir(
    [
        {"titulo": "a", "url": "https://www.aaa.com.uy/", "descripcion": ""},
        {"titulo": "a repetido", "url": "https://aaa.com.uy/otra", "descripcion": ""},
        {"titulo": "b", "url": "https://bbb.com.uy/", "descripcion": ""},
    ],
    20,
)
check("unir quita dominio repetido", len(unidos) == 2 and unidos[0]["titulo"] == "a")
check(
    "sin repetir tras unir",
    len({busqueda._dominio(x["url"]) for x in unidos}) == len(unidos),
)

print("8) Modo rápido: nombres y texto para la IA de respaldo")
check(
    "sufijo de búsqueda quitado",
    _limpiar_nombre("Inmobiliaria Rivera | Pocitos") == "Inmobiliaria Rivera",
)
check(
    "título genérico saltado",
    _limpiar_nombre("Contacto — Administración Mandía, Pocitos") == "Administración Mandía, Pocitos",
)
check("título vacío no truena", _limpiar_nombre("") == "")
limpio = _texto_limpio("<html><script>var a=1;</script><style>b{}</style><p>Hola info@x.uy</p>")
check("scripts quitados del texto", "var a=1" not in limpio and "Hola" in limpio)
check("texto acotado", len(_texto_limpio("<p>" + "x" * 20000 + "</p>", 500)) <= 500)

print("9) Ajustes de modo rápido por defecto")
aj = cargar_config().ajustes
check("modo_rapido activo", aj.modo_rapido is True)
check("ia_solo_email activo", aj.ia_solo_email is True)
check("concurrencia alta", aj.concurrentes >= 10)
check("portadas por defecto", aj.max_paginas_por_sitio <= 2)

print("10) Monitor en vivo")
from prospector.pipeline import Monitor, Prospector  # noqa: E402

mon = Monitor()
check("arranca en reposo", mon.estado()["fase"] == "inactivo")
mon.poner(fase="procesando", candidatos=10, consulta="prueba")
mon.empieza("a.com.uy")
mon.empieza("b.com.uy")
mon.empieza("a.com.uy")          # repetido: no debe duplicar
check("dominios en curso (sin repetir)", mon.estado()["en_curso"] == ["a.com.uy", "b.com.uy"])
mon.termina("a.com.uy")
check("al terminar saca el dominio", mon.estado()["en_curso"] == ["b.com.uy"])
mon.tiempo_rastreo(0.4)
mon.tiempo_rastreo(0.6)
check("promedio de rastreo", mon.estado()["t_rastreo_prom"] == 0.5)
mon.tiempo_ia(3.0)
mon.tiempo_ia(5.0)
check("promedio de IA", mon.estado()["t_ia_prom"] == 4.0)
mon.suma("con_email")
mon.suma("con_email")
check("contadores suman", mon.estado()["con_email"] == 2)
copia = mon.estado()
copia["con_email"] = 999
check("la copia no toca el original", mon.estado()["con_email"] == 2)
mon.reiniciar()
check("reiniciar limpia todo", mon.estado()["con_email"] == 0 and mon.estado()["en_curso"] == [])

with tempfile.TemporaryDirectory() as tmp:
    cfg = cargar_config()
    db2 = BaseDatos(Path(tmp) / "m.db")
    p2 = Prospector(cfg, db2, ia=None, log=lambda *_: None, mon=mon)
    check("Prospector usa el monitor pasado", p2.mon is mon)
    check("sin monitor crea el suyo", Prospector(cfg, db2).mon is not None)

print("11) emails reales vs enmascarados")
from prospector.pipeline import _email_valido  # noqa: E402

check("email real aceptado", _email_valido("info@inmobiliaria.com.uy"))
check("enmascarado [email protected] rechazado",
      not _email_valido("[email protected]"))
check("enmascarado __cf_email__ rechazado", not _email_valido("__cf_email__"))
check("vacío rechazado", not _email_valido(""))
check("sin punto de TLD rechazado", not _email_valido("a@b"))

print("12) Dominios aparcados / en venta")
from prospector.pipeline import _en_venta  # noqa: E402

check("título 'for sale' detectado", _en_venta("dydinmobiliaria.com for sale"))
check("dominio en venta (es) detectado", _en_venta("Este dominio está en venta"))
check("comprar dominio detectado", _en_venta("Comprá este dominio ahora"))
check("empresa normal no se descarta", not _en_venta("Administración Mandía, Pocitos"))
check("vacío no se descarta", not _en_venta(""))

print(f"\nRESULTADO: {ok} OK, {fail} fallos")
sys.exit(1 if fail else 0)
