"""Cliente de IA multi-proveedor (compatible con OpenAI) con respaldo.

Reglas clave:
- La IA solo ORDENA datos ya extraídos de la web; no inventa.
- El email que devuelve debe estar entre los encontrados en la página.
- Cada llamada tiene un **límite de tiempo real** (wall-clock): si un modelo
  free queda en cola o manda keep-alives, se corta y se pasa al siguiente.
- Se limita la **concurrencia** y se detecta el error 429 (cupo diario agotado)
  para no desperdiciar llamadas.
"""

from __future__ import annotations

import json
import re
import threading
import time

import requests

from .config import ProveedorIA

PROMPT_SISTEMA = (
    "Sos un asistente que ORDENA datos de contacto ya extraídos de la web de una "
    "empresa. REGLAS ESTRICTAS: no inventes nada; usá solo la información recibida. "
    "Devolvé ÚNICAMENTE un objeto JSON válido, sin texto extra."
)

_MARCAS_MOJIBAKE = ("Ã", "Â", "â", "\x80", "\x91", "\x92", "\x93", "\x94")


def reparar_texto(texto: str) -> str:
    """Repara 'mojibake' típico: UTF-8 leído como latin-1 (Cordón -> CordÃ³n)."""
    if not isinstance(texto, str) or not any(m in texto for m in _MARCAS_MOJIBAKE):
        return texto
    try:
        return texto.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return texto


def _reparar_rec(valor):
    if isinstance(valor, str):
        return reparar_texto(valor)
    if isinstance(valor, dict):
        return {k: _reparar_rec(v) for k, v in valor.items()}
    if isinstance(valor, list):
        return [_reparar_rec(v) for v in valor]
    return valor


def extraer_json(texto: str) -> dict:
    if not texto:
        return {}
    texto = texto.strip()
    datos: dict = {}
    try:
        datos = json.loads(texto)
    except Exception:
        m = re.search(r"\{.*\}", texto, re.S)
        if m:
            try:
                datos = json.loads(m.group(0))
            except Exception:
                return {}
        else:
            return {}
    return _reparar_rec(datos)


def _es_429(exc: Exception) -> bool:
    resp = getattr(exc, "response", None)
    return resp is not None and getattr(resp, "status_code", None) == 429


class ClienteIA:
    def __init__(
        self,
        proveedores: list[ProveedorIA],
        timeout: int = 20,
        deadline: int = 45,
        concurrentes: int = 2,
    ):
        self.proveedores = [p for p in proveedores if p.disponible()]
        self.timeout = timeout
        self.deadline = deadline
        self.ultimo_proveedor = ""
        # Guardamos la base_url de los proveedores que devolvieron 429 (cupo), para
        # no reintentarlos en esta corrida. Es por proveedor: si OpenRouter se agota,
        # NVIDIA (otra cuenta) sigue funcionando.
        self._agotados: set[str] = set()
        self._sem = threading.Semaphore(max(1, int(concurrentes)))

    @property
    def disponible(self) -> bool:
        return any(p.base_url not in self._agotados for p in self.proveedores)

    def agotar(self, contiene: str) -> None:
        """Marca como agotados los proveedores cuya URL contenga el texto dado."""
        contiene = (contiene or "").lower()
        for p in self.proveedores:
            if contiene in p.base_url.lower():
                self._agotados.add(p.base_url)

    def _activos(self) -> list[ProveedorIA]:
        return [p for p in self.proveedores if p.base_url not in self._agotados]

    def _llamar(self, prov: ProveedorIA, mensajes: list[dict]) -> str:
        """Llama al proveedor con streaming y corta por tiempo real."""
        t0 = time.time()
        partes: list[str] = []
        crudo: list[str] = []
        with requests.post(
            prov.url_chat(),
            headers={
                "Authorization": f"Bearer {prov.clave()}",
                "Content-Type": "application/json",
            },
            json={
                "model": prov.modelo,
                "messages": mensajes,
                "temperature": 0,
                "stream": True,
            },
            timeout=(10, self.timeout),
            stream=True,
        ) as r:
            r.raise_for_status()
            for linea in r.iter_lines(decode_unicode=True):
                if time.time() - t0 > self.deadline:
                    raise TimeoutError(f"{prov.nombre} superó {self.deadline}s")
                if not linea:
                    continue
                if linea.startswith("data:"):
                    payload = linea[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        obj = json.loads(payload)
                        delta = (obj.get("choices") or [{}])[0].get("delta", {})
                        trozo = delta.get("content")
                        if trozo:
                            partes.append(trozo)
                    except Exception:
                        continue
                else:
                    crudo.append(linea)

        if partes:
            return "".join(partes).strip()

        texto = "\n".join(crudo).strip()
        if texto:
            try:
                obj = json.loads(texto)
                return str(obj["choices"][0]["message"]["content"]).strip()
            except Exception:
                return texto
        return ""

    def chat(self, mensajes: list[dict]) -> str:
        activos = self._activos()
        if not activos:
            raise RuntimeError("no quedan proveedores de IA disponibles")
        errores: list[str] = []
        for prov in activos:
            try:
                with self._sem:
                    texto = self._llamar(prov, mensajes)
                if not texto.strip():
                    raise ValueError("respuesta vacía")
                self.ultimo_proveedor = prov.nombre
                return texto
            except Exception as exc:  # noqa: BLE001
                if _es_429(exc):
                    # Cupo/límite de ese proveedor: no reintentarlo en esta corrida.
                    self._agotados.add(prov.base_url)
                errores.append(f"{prov.nombre}: {exc}")
        raise RuntimeError("Ningún proveedor de IA respondió. " + " | ".join(errores))

    def estructurar(self, contexto: dict) -> dict:
        mensajes = [
            {"role": "system", "content": PROMPT_SISTEMA},
            {"role": "user", "content": _prompt_estructurar(contexto)},
        ]
        return extraer_json(self.chat(mensajes))


def _prompt_estructurar(ctx: dict) -> str:
    texto = (ctx.get("texto") or "")[:4000]
    return (
        "Empresa detectada en la búsqueda.\n"
        f"Título: {ctx.get('titulo','')}\n"
        f"Web: {ctx.get('web','')}\n"
        f"Snippet de búsqueda: {ctx.get('descripcion','')}\n"
        f"Correos detectados automáticamente: {ctx.get('emails', [])}\n"
        f"Teléfonos detectados: {ctx.get('telefonos', [])}\n"
        f"WhatsApp detectado: {ctx.get('whatsapp', [])}\n\n"
        "TEXTO DE LA PÁGINA OFICIAL (única fuente válida para el email):\n"
        f"{texto}\n\n"
        "REGLA: el email debe APARECER LITERALMENTE en el TEXTO de arriba. Si no "
        "aparece, devolvé 'No disponible' (no inventes nunca).\n\n"
        "Devolvé SOLO este JSON:\n"
        '{"es_objetivo": true, '
        '"nombre": "nombre real de la empresa", '
        '"categoria": "rubro (ej: administradora de edificios, inmobiliaria)", '
        '"email": "un email que aparezca literalmente en el TEXTO, o No disponible", '
        '"telefono": "un teléfono que aparezca, o cadena vacía", '
        '"whatsapp": "un whatsapp que aparezca, o cadena vacía"}'
    )
