"""Rastrea la web de una empresa y busca el email EN LA MISMA PÁGINA."""

from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
WA_RE = re.compile(
    r"(?:wa\.me/|api\.whatsapp\.com/send\?phone=|web\.whatsapp\.com/send\?phone=)"
    r"([\d\s\-()+]{6,})",
    re.I,
)
TEL_RE = re.compile(
    r"(?:\+?598[\s\-]?)?(?:0?9\d[\s\-]?\d{3}[\s\-]?\d{3}|[24]\d{3}[\s\-]?\d{4})"
)

_EMAILS_IGNORAR = (
    "example.com",
    "sentry",
    "wixpress",
    "googleapis",
    "domain.com",
    "email.com",
    "tudominio",
    "@2x",
    "@3x",
)
_EXT_BASURA = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js", ".ico")
_PISTAS_CONTACTO = (
    "contact",
    "contacto",
    "nosotros",
    "quienes",
    "about",
    "empresa",
    "equipo",
    "info",
)


def extraer_emails(texto: str) -> list[str]:
    encontrados = set()
    for m in EMAIL_RE.findall(texto or ""):
        e = m.lower().strip(".,;:")
        if any(x in e for x in _EMAILS_IGNORAR):
            continue
        if e.endswith(_EXT_BASURA):
            continue
        encontrados.add(e)
    return sorted(encontrados)


def extraer_telefonos(texto: str) -> list[str]:
    vistos: list[str] = []
    for m in TEL_RE.findall(texto or ""):
        t = re.sub(r"[^\d+]", "", m)
        if t and t not in vistos:
            vistos.append(t)
    return vistos


def extraer_whatsapp(texto: str) -> list[str]:
    vistos: list[str] = []
    for m in WA_RE.findall(texto or ""):
        t = re.sub(r"[^\d]", "", m)
        if t and t not in vistos:
            vistos.append(t)
    return vistos


def elegir_email(candidatos: list[str], dominio: str = "") -> str:
    """Elige el email más probable (mismo dominio, luego genéricos)."""
    if not candidatos:
        return ""
    dominio = (dominio or "").lower()
    genericos = ("info@", "contacto@", "ventas@", "administracion@", "admin@", "hola@")
    del_mismo = [e for e in candidatos if dominio and dominio in e]
    base = del_mismo or candidatos
    for g in genericos:
        for e in base:
            if e.startswith(g):
                return e
    return base[0]


def paginas_contacto(base_url: str, sopa: BeautifulSoup, maximo: int) -> list[str]:
    urls: list[str] = []
    for a in sopa.find_all("a", href=True):
        href = a["href"]
        texto = (a.get_text(" ", strip=True) or "").lower()
        if any(p in href.lower() for p in _PISTAS_CONTACTO) or any(
            p in texto for p in _PISTAS_CONTACTO
        ):
            completa = urljoin(base_url, href)
            if urlparse(completa).netloc == urlparse(base_url).netloc and completa not in urls:
                urls.append(completa)
        if len(urls) >= maximo:
            break
    return urls


def _descargar(url: str, timeout: int, user_agent: str, max_bytes: int = 400_000) -> str:
    # Descarga en streaming y corta al llegar a max_bytes: una página gigante
    # (imágenes, JS) ya no frena el proceso.
    with requests.get(
        url, timeout=timeout, headers={"User-Agent": user_agent}, stream=True
    ) as r:
        if r.status_code >= 400:
            raise requests.HTTPError(str(r.status_code))
        enc = r.encoding or "utf-8"
        buf = bytearray()
        for chunk in r.iter_content(chunk_size=16384):
            buf.extend(chunk)
            if len(buf) >= max_bytes:
                break
    crudo = bytes(buf[:max_bytes])
    # Decodificar bien: casi todas las webs son UTF-8, pero requests a veces
    # asume latin-1 y rompe los acentos (mojibake tipo "Ã³").
    try:
        return crudo.decode("utf-8")
    except UnicodeDecodeError:
        return crudo.decode(enc, errors="replace")


def _texto_limpio(html: str, tope: int = 8000) -> str:
    """Texto visible de la página (sin scripts/estilos) para pasárselo a la IA."""
    s = BeautifulSoup(html or "", "html.parser")
    for t in s(["script", "style", "noscript"]):
        t.decompose()
    return s.get_text(" ", strip=True)[:tope]


def rastrear_sitio(
    web: str,
    timeout: int = 20,
    max_paginas: int = 4,
    user_agent: str = "Mozilla/5.0",
    solo_portada: bool = False,
    texto_max: int = 8000,
) -> dict:
    resultado = {
        "web": web,
        "titulo": "",
        "emails": [],
        "telefonos": [],
        "whatsapp": [],
        "paginas": [],
        "texto": "",
        "error": "",
    }
    if not web.startswith("http"):
        web = "https://" + web

    html = ""
    try:
        html = _descargar(web, timeout, user_agent)
        resultado["paginas"].append(web)
    except Exception:
        try:
            web = web.replace("https://", "http://", 1)
            html = _descargar(web, timeout, user_agent)
            resultado["paginas"].append(web)
            resultado["web"] = web
        except Exception as exc:  # noqa: BLE001
            resultado["error"] = f"no se pudo abrir: {exc}"
            return resultado

    sopa = BeautifulSoup(html, "html.parser")
    if sopa.title and sopa.title.string:
        resultado["titulo"] = sopa.title.string.strip()

    # Texto visible de la portada (la IA solo lo recibe si hace falta, de respaldo).
    for t in sopa(["script", "style", "noscript"]):
        t.decompose()
    partes = [sopa.get_text(" ", strip=True)]

    textos = html
    # Si la portada ya trae un email, no seguimos abriendo páginas (más rápido).
    # En modo rápido (solo_portada) tampoco abrimos páginas adicionales.
    max_sub = 0 if solo_portada else max(0, max_paginas - 1)
    if not extraer_emails(textos) and max_sub > 0:
        for pagina in paginas_contacto(web, sopa, max_sub):
            try:
                sub_html = _descargar(pagina, timeout, user_agent)
            except Exception:
                continue
            textos += "\n" + sub_html
            partes.append(_texto_limpio(sub_html, 4000))
            resultado["paginas"].append(pagina)
            if extraer_emails(sub_html):
                break

    resultado["emails"] = extraer_emails(textos)
    resultado["telefonos"] = extraer_telefonos(textos)
    resultado["whatsapp"] = extraer_whatsapp(textos)
    resultado["texto"] = "\n".join(partes)[:texto_max]
    return resultado
