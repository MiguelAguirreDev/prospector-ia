"""Configuración: proveedores de IA (editables a mano) y ajustes generales."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CONFIG_DEFECTO = RAIZ / "config.json"
CONFIG_EJEMPLO = RAIZ / "config.example.json"


def cargar_env() -> None:
    """Carga variables desde .env / .env.local si existe la librería."""
    try:
        from dotenv import load_dotenv

        for nombre in (".env", ".env.local"):
            ruta = RAIZ / nombre
            if ruta.exists():
                load_dotenv(ruta)
    except Exception:
        pass


@dataclass
class ProveedorIA:
    """Un endpoint compatible con OpenAI (/chat/completions)."""

    nombre: str
    base_url: str
    modelo: str
    api_key_env: str = ""
    api_key: str = ""

    def clave(self) -> str:
        if self.api_key:
            return self.api_key
        return os.environ.get(self.api_key_env, "") if self.api_key_env else ""

    def disponible(self) -> bool:
        return bool(self.clave() and self.base_url and self.modelo)

    def url_chat(self) -> str:
        return self.base_url.rstrip("/") + "/chat/completions"


@dataclass
class Ajustes:
    lote: int = 20
    max_por_corrida: int = 20
    idioma: str = "es"
    region: str = "uy"
    usar_ia: bool = True
    # --- modo rápido --- #
    modo_rapido: bool = True        # rastrea solo la portada y no gasta IA si ya hay email
    ia_solo_email: bool = True      # la IA solo se usa para ENCONTRAR el email (si falta)
    timeout: int = 8
    tiempo_max_ia: int = 30
    concurrentes: int = 20
    concurrentes_ia: int = 4
    ia_max_diario: int = 45
    max_paginas_por_sitio: int = 2
    user_agent: str = "Mozilla/5.0 (compatible; ProspectorIA/1.0)"


@dataclass
class Config:
    proveedores: list[ProveedorIA] = field(default_factory=list)
    ajustes: Ajustes = field(default_factory=Ajustes)
    excluir_dominios: list[str] = field(default_factory=list)
    ruta: str = ""

    def proveedores_disponibles(self) -> list[ProveedorIA]:
        return [p for p in self.proveedores if p.disponible()]


# Dominios que NO son empresas: portales, directorios y redes sociales.
EXCLUIR_DEFECTO = [
    "infocasas.com.uy",
    "eldirectorio.co",
    "mercadolibre.com",
    "mercadolibre.com.uy",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "youtube.com",
    "twitter.com",
    "tiktok.com",
    "google.com",
    "wikipedia.org",
    "paginasamarillas",
    "guiacomercial",
    "guia.com.uy",
    "directorio",
    "clasificados",
    "guitel",
    "buscoinfo",
    "zonaprop",
    "argenprop",
    "properati",
    "gallito",
    "deremate",
    "olx.",
    "tripadvisor",
    "booking.com",
    "airbnb",
    "waze.com",
    "whatsapp.com",
    "yapo",
    "solotodo",
    "guiaempresas",
    "empresite",
    "axesor",
    # Portales/clasificados de terceros (no son la empresa en sí).
    "inmobiliaria.com",
    "1122.com.uy",
    "inmuebles.com.uy",
    "buscojobs",
    "busqueda.com.uy",
    # Los propios buscadores se colan entre los resultados; no son empresas.
    "bing.com",
    "duckduckgo.com",
    "mojeek.com",
    "ecosia.org",
    "startpage.com",
    "brave.com",
    "qwant.com",
    "marginalia",
    "searx",
]


def cargar_config(ruta: str | None = None) -> Config:
    cargar_env()
    camino = Path(ruta) if ruta else (CONFIG_DEFECTO if CONFIG_DEFECTO.exists() else CONFIG_EJEMPLO)
    datos: dict = {}
    if camino.exists():
        datos = json.loads(camino.read_text(encoding="utf-8"))

    proveedores: list[ProveedorIA] = []
    for p in datos.get("proveedores", []):
        proveedores.append(
            ProveedorIA(
                nombre=p.get("nombre", "sin-nombre"),
                base_url=p.get("base_url", ""),
                modelo=p.get("modelo", ""),
                api_key_env=p.get("api_key_env", ""),
                api_key=p.get("api_key", "") or "",
            )
        )

    aj = datos.get("ajustes", {})
    campos = set(Ajustes.__dataclass_fields__)
    ajustes = Ajustes(**{k: v for k, v in aj.items() if k in campos})

    return Config(
        proveedores=proveedores,
        ajustes=ajustes,
        excluir_dominios=datos.get("excluir_dominios") or list(EXCLUIR_DEFECTO),
        ruta=str(camino),
    )
