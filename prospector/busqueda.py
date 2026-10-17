"""Búsqueda multi-fuente EN PARALELO.

Antes las fuentes se consultaban en serie (esperar a una para probar la otra).
Ahora se lanzan TODAS a la vez y se combinan los resultados (sin repetir
dominio). Sale más resultado y más rápido. Ninguna fuente es obligatoria: si una
falla o cae, las demás igual responden.

Fuentes gratis (sin clave): DuckDuckGo, Bing y Mojeek.
Fuentes con clave (si las hay): Serper (Google) y Google Custom Search.

Nota: se probó OpenStreetMap (Overpass) como fuente "tipo mapas" y se descartó:
Uruguay no tiene negocios de este rubro con página web taggeada (0 resultados,
aunque se consulte por categoría `estate_agent`).
"""

from __future__ import annotations

import os
import threading
from urllib.parse import parse_qs, unquote, urlparse

import requests
from bs4 import BeautifulSoup

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


# --------------------------------------------------------------------------- #
def _dominio(url: str) -> str:
    try:
        h = urlparse(url).netloc.lower()
        return h[4:] if h.startswith("www.") else h
    except Exception:
        return ""


def _normalizar_url(url: str) -> str:
    """Saca las redirecciones de los buscadores (//duckduckgo.com/l/?uddg=...)."""
    if not url:
        return ""
    url = url.strip()
    if url.startswith("//"):
        url = "https:" + url
    if "/l/?" in url and "uddg=" in url:
        q = parse_qs(urlparse(url).query)
        url = unquote((q.get("uddg") or [""])[0])
    if not url.startswith("http"):
        return ""
    return url


def _unir(items: list[dict], max_resultados: int) -> list[dict]:
    """Combina y quita repetidos por dominio (conserva el primero)."""
    vistos: set[str] = set()
    salida: list[dict] = []
    for it in items:
        url = _normalizar_url(it.get("url", ""))
        if not url:
            continue
        dom = _dominio(url)
        if not dom or dom in vistos:
            continue
        vistos.add(dom)
        it["url"] = url
        salida.append(it)
        if len(salida) >= max_resultados:
            break
    return salida


# --------------------------------------------------------------------------- #
# Fuentes gratis sin clave
# --------------------------------------------------------------------------- #
def _ddg_html(consulta: str, maximo: int, timeout: int) -> list[dict]:
    r = requests.get(
        "https://html.duckduckgo.com/html/",
        params={"q": consulta},
        headers={"User-Agent": UA},
        timeout=timeout,
    )
    r.raise_for_status()
    s = BeautifulSoup(r.text, "html.parser")
    out: list[dict] = []
    for res in s.select("div.result, div.results_links"):
        a = res.select_one("a.result__a")
        if not a:
            continue
        url = _normalizar_url(a.get("href", ""))
        if not url:
            continue
        sn = res.select_one("div.result__snippet")
        out.append(
            {
                "titulo": a.get_text(" ", strip=True),
                "url": url,
                "descripcion": sn.get_text(" ", strip=True) if sn else "",
            }
        )
        if len(out) >= maximo:
            break
    return out


def _bing(consulta: str, maximo: int, timeout: int, region: str) -> list[dict]:
    r = requests.get(
        "https://www.bing.com/search",
        params={"q": consulta, "setlang": region or "es", "count": max(10, maximo)},
        headers={"User-Agent": UA},
        timeout=timeout,
    )
    r.raise_for_status()
    s = BeautifulSoup(r.text, "html.parser")
    out: list[dict] = []
    for li in s.select("li.b_algo"):
        a = li.select_one("h2 a")
        if not a:
            continue
        url = _normalizar_url(a.get("href", ""))
        if not url:
            continue
        p = li.select_one("div.b_caption p") or li.select_one("p")
        out.append(
            {
                "titulo": a.get_text(" ", strip=True),
                "url": url,
                "descripcion": p.get_text(" ", strip=True) if p else "",
            }
        )
        if len(out) >= maximo:
            break
    return out


def _mojeek(consulta: str, maximo: int, timeout: int) -> list[dict]:
    r = requests.get(
        "https://www.mojeek.com/search",
        params={"q": consulta},
        headers={"User-Agent": UA},
        timeout=timeout,
    )
    r.raise_for_status()
    s = BeautifulSoup(r.text, "html.parser")
    out: list[dict] = []
    for li in s.select("ul.results-standard li"):
        a = li.select_one("a.title")
        if not a:
            continue
        url = _normalizar_url(a.get("href", ""))
        if not url:
            continue
        d = li.select_one("p.s") or li.select_one("a.ob")
        out.append(
            {
                "titulo": a.get_text(" ", strip=True),
                "url": url,
                "descripcion": d.get_text(" ", strip=True) if d else "",
            }
        )
        if len(out) >= maximo:
            break
    return out


# --------------------------------------------------------------------------- #
# Fuentes con clave (opcionales)
# --------------------------------------------------------------------------- #
def _ddg_lib(consulta: str, maximo: int, region: str, idioma: str) -> list[dict]:
    try:
        from ddgs import DDGS
    except Exception:
        from duckduckgo_search import DDGS  # type: ignore

    reg = f"{region}-{idioma}" if region else None
    out: list[dict] = []
    with DDGS() as d:
        for r in d.text(consulta, region=reg, max_results=maximo):
            out.append(
                {
                    "titulo": r.get("title", ""),
                    "url": r.get("href", ""),
                    "descripcion": r.get("body", ""),
                }
            )
    return out


def _serper(consulta, max_resultados, region, idioma, key) -> list[dict]:
    r = requests.post(
        "https://google.serper.dev/search",
        headers={"X-API-KEY": key, "Content-Type": "application/json"},
        json={"q": consulta, "gl": region, "hl": idioma, "num": min(max_resultados, 100)},
        timeout=20,
    )
    r.raise_for_status()
    return [
        {
            "titulo": it.get("title", ""),
            "url": it.get("link", ""),
            "descripcion": it.get("snippet", ""),
        }
        for it in r.json().get("organic", [])[:max_resultados]
    ]


def _google_cse(consulta, max_resultados, key, cx) -> list[dict]:
    out: list[dict] = []
    for inicio in range(1, min(max_resultados, 100), 10):
        r = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": key, "cx": cx, "q": consulta, "num": 10, "start": inicio},
            timeout=20,
        )
        r.raise_for_status()
        items = r.json().get("items", [])
        for it in items:
            out.append(
                {
                    "titulo": it.get("title", ""),
                    "url": it.get("link", ""),
                    "descripcion": it.get("snippet", ""),
                }
            )
        if len(items) < 10:
            break
    return out[:max_resultados]


# --------------------------------------------------------------------------- #
def buscar(
    consulta: str,
    max_resultados: int = 20,
    region: str = "uy",
    idioma: str = "es",
    timeout: int = 10,
    detalle: dict | None = None,
) -> list[dict]:
    """Consulta todas las fuentes en paralelo y devuelve resultados únicos.

    Si pasás `detalle` (un dict), se rellena con cuántos resultados aportó cada
    fuente y cuáles fallaron, para mostrarlo en vivo en la interfaz.
    """
    resultados: list[dict] = []
    candado = threading.Lock()

    def _agregar(nombre: str, fn, *args):
        try:
            items = fn(*args) or []
            error = ""
        except Exception as exc:  # noqa: BLE001
            items, error = [], f"{type(exc).__name__}"
        with candado:
            resultados.extend(items)
            if detalle is not None:
                detalle[nombre] = {"resultados": len(items), "error": error}

    hilos: list[threading.Thread] = []

    key = os.environ.get("SERPER_API_KEY")
    if key:
        hilos.append(
            threading.Thread(target=_agregar, args=("serper", _serper, consulta, max_resultados, region, idioma, key))
        )
    cse_key = os.environ.get("GOOGLE_CSE_KEY")
    cse_cx = os.environ.get("GOOGLE_CSE_CX")
    if cse_key and cse_cx:
        hilos.append(
            threading.Thread(target=_agregar, args=("google_cse", _google_cse, consulta, max_resultados, cse_key, cse_cx))
        )

    # Fuentes gratis: todas a la vez.
    hilos.append(threading.Thread(target=_agregar, args=("duckduckgo", _ddg_html, consulta, max_resultados, timeout)))
    hilos.append(threading.Thread(target=_agregar, args=("bing", _bing, consulta, max_resultados, timeout, region)))
    hilos.append(threading.Thread(target=_agregar, args=("mojeek", _mojeek, consulta, max_resultados, timeout)))
    hilos.append(threading.Thread(target=_agregar, args=("ddgs", _ddg_lib, consulta, max_resultados, region, idioma)))

    if detalle is not None:
        detalle["en_curso"] = len(hilos)

    for h in hilos:
        h.start()
    for h in hilos:
        h.join(timeout + 10)

    if detalle is not None:
        detalle["unicos"] = 0
    salida = _unir(resultados, max_resultados)
    if detalle is not None:
        detalle["unicos"] = len(salida)
    return salida
