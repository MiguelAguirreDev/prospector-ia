"""Orquesta: buscar -> rastrear -> estructurar con IA -> guardar (sin repetir).

El trabajo por empresa es de red (descargar + IA), así que se hace en paralelo
con varios hilos para que la corrida sea mucho más rápida.
"""

from __future__ import annotations

import json
import re
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from . import busqueda, rastreo
from .config import Config
from .db import BaseDatos, normalizar_dominio, normalizar_telefono
from .ia import ClienteIA

# Separadores típicos de los títulos web/búsqueda ("Contacto | Inmobiliaria X").
_SEP_NOMBRE = re.compile(r"\s*(?:\||—|–|·|::|//|>)\s*|\s+-\s+")
# Títulos que no dicen el nombre de la empresa.
_GENERICOS = {
    "inicio", "home", "contacto", "contact", "nosotros", "quienes somos",
    "empresa", "bienvenido", "bienvenida", "welcome", "principal",
    "servicios", "servicio", "index", "pagina principal", "página principal",
}

# Forma válida de un email real.
_EMAIL_OK = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
# Marcas de correos ENMASCARADOS que los sitios escriben literalmente en la página
# (Cloudflare, WordPress, CDNs): "[email protected]", "__cf_email__"...
_MARCAS_ENMASCARADO = ("[email", "email protected", "__cf_email__", "cfemail")


def _email_valido(e: str) -> bool:
    """El email debe tener forma de email real.

    Descarta los enmascarados tipo "[email protected]", que sí aparecen
    literalmente en el HTML y por eso engañaban al control anti-inventar.
    """
    if not e or len(e) > 80:
        return False
    if any(m in e.lower() for m in _MARCAS_ENMASCARADO):
        return False
    return bool(_EMAIL_OK.match(e))


# Páginas de dominios aparcados / en venta: no son empresas.
_EN_VENTA = re.compile(
    r"for sale|domain is for sale|este dominio.{0,25}(en venta|a la venta)"
    r"|compr[áa] (este |el )?dominio|buy this domain|domain parking|parked free"
    r"|sedo|afternic|godaddy|precio de venta del dominio",
    re.I,
)


def _en_venta(titulo: str) -> bool:
    """True si la página es de un dominio aparcado/en venta (hay que saltearla)."""
    return bool(_EN_VENTA.search(titulo or ""))


def _limpiar_nombre(titulo: str) -> str:
    """Saca el nombre real del título, ignorando sufijos y títulos genéricos."""
    t = (titulo or "").strip()
    if not t:
        return ""
    partes = [p.strip() for p in _SEP_NOMBRE.split(t) if p and p.strip()]
    buenos = [p for p in partes if p.lower() not in _GENERICOS and len(p) >= 4]
    elegido = buenos[0] if buenos else (partes[0] if partes else t)
    elegido = re.sub(r"\s+", " ", elegido)
    return elegido[:120].strip()


class Monitor:
    """Estado "en vivo" del trabajo, para mostrarlo en la interfaz.

    Guarda en qué fase está, qué dominios se están rastreando AHORA, cuántos
    salieron con email, cuántas llamadas a la IA se gastaron y los tiempos de
    cada etapa. Es hilo-seguro (varias descargas corren a la vez).
    """

    def __init__(self) -> None:
        self._candado = threading.Lock()
        self.d: dict = {}
        self._t_rastreo: list[float] = []
        self._t_ia: list[float] = []
        self.reiniciar()

    # --- escritura ---------------------------------------------------- #
    def reiniciar(self) -> None:
        with self._candado:
            self.d = {
                "fase": "inactivo",           # buscando | procesando | chequeando | esperando | inactivo
                "consulta": "",
                "consulta_n": 0,              # 1 de 3, 2 de 3...
                "consultas_totales": 0,
                "vuelta": 0,                  # nº de vuelta en modo continuo
                "candidatos": 0,              # sitios nuevos a rastrear
                "excluidas": 0,               # descartados por ser directorios/redes
                "repetidas": 0,               # ya vistas en corridas anteriores
                "ya_guardadas": 0,            # empresas viejas sumadas a la lista
                "procesadas": 0,              # sitios rastreados
                "nuevas": 0,                  # empresas nuevas guardadas
                "con_email": 0,               # ... de ellas, con email
                "sin_email": 0,
                "ia_llamadas": 0,             # llamados a la IA (solo respaldo)
                "ia_salvados": 0,             # emails que encontró la IA
                "en_curso": [],               # dominios que se rastrean AHORA
                "fuentes": {},                # cuántos resultados dio cada buscador
                "ultimo": "",                 # última empresa guardada
                "t_busqueda": 0.0,            # segundos en buscar en los buscadores
                "t_rastreo_prom": 0.0,        # promedio por sitio
                "t_ia_prom": 0.0,             # promedio por llamado a la IA
                "t_total": 0.0,               # desde que arrancó la corrida
                "inicio": 0.0,
            }
            self._t_rastreo = []
            self._t_ia = []

    def arrancar(self) -> None:
        with self._candado:
            self.d["inicio"] = time.time()

    def poner(self, **kw) -> None:
        with self._candado:
            self.d.update(kw)

    def suma(self, clave: str, n: int = 1) -> None:
        with self._candado:
            self.d[clave] = self.d.get(clave, 0) + n

    def empieza(self, dominio: str) -> None:
        with self._candado:
            v = self.d["en_curso"]
            if dominio not in v:
                v.append(dominio)
                del v[:-25]  # no dejar crecer sin límite

    def termina(self, dominio: str) -> None:
        with self._candado:
            v = self.d["en_curso"]
            if dominio in v:
                v.remove(dominio)

    def tiempo_rastreo(self, seg: float) -> None:
        with self._candado:
            self._t_rastreo.append(seg)
            self._t_rastreo[:] = self._t_rastreo[-100:]
            self.d["t_rastreo_prom"] = round(sum(self._t_rastreo) / len(self._t_rastreo), 2)

    def tiempo_ia(self, seg: float) -> None:
        with self._candado:
            self._t_ia.append(seg)
            self._t_ia[:] = self._t_ia[-100:]
            self.d["t_ia_prom"] = round(sum(self._t_ia) / len(self._t_ia), 2)

    def pulso(self) -> None:
        """Actualiza el cronómetro total (lo llama la interfaz al refrescar)."""
        with self._candado:
            if self.d["inicio"]:
                self.d["t_total"] = round(time.time() - self.d["inicio"], 1)

    # --- lectura ------------------------------------------------------ #
    def estado(self) -> dict:
        """Copia segura (JSON) para mandarla a la interfaz."""
        self.pulso()
        with self._candado:
            return json.loads(json.dumps(self.d, ensure_ascii=False))


class Prospector:
    def __init__(
        self,
        config: Config,
        db: BaseDatos,
        ia: ClienteIA | None = None,
        log=print,
        mon: Monitor | None = None,
    ):
        self.config = config
        self.db = db
        self.aj = config.ajustes
        self.ia = ia
        self.log = log
        self.mon = mon if mon is not None else Monitor()
        self.hilos = max(1, int(self.aj.concurrentes))
        self._aviso_cupo = False
        self._aviso_ia = False

    # ------------------------------------------------------------------ #
    def _procesar(self, item: dict, usar_ia: bool, zona: str, fuente: str,
                  listas: list[str] | None = None):
        url = item.get("url", "")
        dominio = normalizar_dominio(url)
        if not dominio:
            return None

        # Saltar portales/directorios/redes: no son empresas.
        if any(x and x in dominio for x in self.config.excluir_dominios):
            self.db.marcar_dominio(dominio, "excluido")
            return None

        # Reserva atómica: si otro hilo (o una corrida previa) ya lo tomó, saltear.
        if not self.db.reservar_dominio(dominio):
            self.mon.suma("repetidas")
            return None

        # Vivo: en la interfaz se ve qué sitios se están rastreando AHORA mismo.
        self.mon.empieza(dominio)
        t0 = time.time()
        try:
            info = rastreo.rastrear_sitio(
                url,
                timeout=self.aj.timeout,
                max_paginas=self.aj.max_paginas_por_sitio,
                user_agent=self.aj.user_agent,
                solo_portada=self.aj.modo_rapido,
            )
        finally:
            self.mon.tiempo_rastreo(time.time() - t0)
            self.mon.termina(dominio)
        self.mon.suma("procesadas")

        if info.get("error"):
            self.db.marcar_dominio(dominio, "error")
            self.log(f"  [-] {dominio}: {info['error']}")
            return None

        # Dominio aparcado / en venta: no es una empresa, y ni siquiera gastamos IA.
        if _en_venta(info.get("titulo", "")):
            self.db.marcar_dominio(dominio, "excluido")
            self.mon.suma("excluidas")
            self.log(f"  [x] {dominio}: dominio en venta, descartado")
            return None

        emails = info.get("emails", [])
        email = rastreo.elegir_email(emails, dominio)
        nombre = _limpiar_nombre(info.get("titulo", "") or item.get("titulo", ""))
        categoria = ""
        telefono = (info.get("telefonos") or [""])[0]
        whatsapp = (info.get("whatsapp") or [""])[0]
        es_objetivo = 1

        # --- IA: SOLO de respaldo --- #
        # En modo rápido la IA NO se gasta si el email ya salió de la página.
        # Se usa únicamente si falta el email (o si desactivaste ia_solo_email).
        texto_pag = (info.get("texto") or "").lower()
        llamar_ia = (
            usar_ia
            and self.ia is not None
            and self.ia.disponible
            and (not self.aj.ia_solo_email or not email)
        )
        if llamar_ia:
            # Respetar el cupo diario gratis (p. ej. 50/día de OpenRouter).
            if self.db.sumar_uso_ia() > self.aj.ia_max_diario:
                self.ia.agotar("openrouter")
            else:
                self.mon.suma("ia_llamadas")
                t_ia = time.time()
                try:
                    ctx = {
                        "titulo": info.get("titulo", ""),
                        "web": info.get("web", url),
                        "descripcion": item.get("descripcion", ""),
                        "texto": info.get("texto", ""),
                        "emails": emails,
                        "telefonos": info.get("telefonos", []),
                        "whatsapp": info.get("whatsapp", []),
                    }
                    r = self.ia.estructurar(ctx)
                    if r:
                        if not self.aj.modo_rapido:
                            nombre = r.get("nombre") or nombre
                        categoria = r.get("categoria", "") or categoria
                        es_objetivo = 1 if r.get("es_objetivo", True) else 0
                        e_ia = (r.get("email") or "").strip().lower()
                        # Anti-inventar: el email debe existir EN LA PÁGINA (en el
                        # texto descargado o entre los ya extraídos) y tener forma
                        # de email real. Si no, se descarta.
                        if (
                            _email_valido(e_ia)
                            and (e_ia in texto_pag or e_ia in [e.lower() for e in emails])
                        ):
                            email = e_ia
                            self.mon.suma("ia_salvados")
                        telefono = r.get("telefono") or telefono
                        whatsapp = r.get("whatsapp") or whatsapp
                except Exception as exc:  # noqa: BLE001
                    if not self._aviso_ia:
                        self._aviso_ia = True
                        self.log(f"  [!] IA no disponible ahora ({exc}); sigo con heurística en el resto.")
                finally:
                    self.mon.tiempo_ia(time.time() - t_ia)
        if self.ia is not None and not self.ia.disponible and not self._aviso_cupo:
            self._aviso_cupo = True
            self.log("  [i] Sin IA disponible; el resto se completa con heurística (igual saca emails).")

        datos = {
            "nombre": (nombre or "").strip(),
            "web": info.get("web", url),
            "dominio": dominio,
            "telefono": normalizar_telefono(telefono),
            "whatsapp": normalizar_telefono(whatsapp),
            "email": email,
            "categoria": categoria,
            "zona": zona,
            "estado_email": "verificado" if email else "no_disponible",
            "es_objetivo": es_objetivo,
            "fuente": fuente,
            "notas": "; ".join(info.get("paginas", [])[:3]),
        }
        nueva = self.db.guardar_empresa(datos)
        # Sumar (sin repetir) a la lista destino que eligió el usuario.
        for l in (listas or []):
            self.db.asignar_lista(dominio, l)
        self.mon.suma("con_email" if email else "sin_email")
        if nueva:
            self.mon.suma("nuevas")
            self.mon.poner(ultimo=(nombre or dominio)[:60])
            self.log(f"  [+] {(nombre or dominio)[:45]:45} | {email or 'sin email'}")
            return datos
        return None

    def _correr_en_paralelo(self, tareas: list, debe_parar=None) -> list:
        """Ejecuta tareas en paralelo. Si `debe_parar()` da True, deja de lanzar
        tareas nuevas y vuelve enseguida (las que están en vuelo terminan solas)."""
        resultados: list = []
        if not tareas:
            return resultados
        ex = ThreadPoolExecutor(max_workers=self.hilos)
        try:
            pendientes = iter(tareas)
            futuros = set()
            for _ in range(self.hilos):
                t = next(pendientes, None)
                if t is None:
                    break
                futuros.add(ex.submit(t))
            while futuros:
                hechos, futuros = wait(futuros, timeout=1.0, return_when=FIRST_COMPLETED)
                for fut in hechos:
                    try:
                        r = fut.result()
                    except Exception as exc:  # noqa: BLE001
                        self.log(f"  [!] {exc}")
                        continue
                    if r:
                        resultados.append(r)
                if debe_parar and debe_parar():
                    break
                while len(futuros) < self.hilos:
                    t = next(pendientes, None)
                    if t is None:
                        break
                    futuros.add(ex.submit(t))
        finally:
            # No esperamos a las que quedaron en vuelo.
            ex.shutdown(wait=False)
        return resultados

    # ------------------------------------------------------------------ #
    def buscar(
        self,
        consulta: str,
        max_nuevos: int = 20,
        usar_ia: bool = True,
        zona: str = "",
        debe_parar=None,
        listas: list[str] | None = None,
    ) -> list[dict]:
        listas = [str(l).strip() for l in (listas or []) if str(l).strip()]
        self.log(f"Buscando: {consulta}")
        # Los contadores del panel son POR CONSULTA: arrancan de cero cada vez.
        self.mon.poner(
            fase="buscando", consulta=consulta,
            candidatos=0, procesadas=0, nuevas=0, con_email=0, sin_email=0,
            ia_llamadas=0, ia_salvados=0, excluidas=0, repetidas=0,
            ya_guardadas=0, en_curso=[], ultimo="",
        )
        detalle: dict = {}
        t_bus = time.time()
        try:
            resultados = busqueda.buscar(
                consulta,
                max_resultados=max(max_nuevos + 10, 20),
                region=self.aj.region,
                idioma=self.aj.idioma,
                detalle=detalle,
            )
        except Exception as exc:  # noqa: BLE001
            self.log(f"  [!] La búsqueda falló: {exc}")
            self.mon.poner(fase="inactivo")
            return []
        dt_bus = round(time.time() - t_bus, 1)
        self.mon.poner(fase="procesando", t_busqueda=dt_bus, fuentes=detalle)
        partes = []
        for k, v in detalle.items():
            if isinstance(v, dict):
                partes.append(f"{k}:{v['resultados']}" if not v.get("error") else f"{k}:caído")
        self.log(f"Resultados únicos: {len(resultados)} en {dt_bus}s  [{', '.join(partes)}]")

        # Pre-filtro: descartar excluidas ANTES de gastar IA. Las que ya están
        # guardadas se suman a la lista destino (sin volver a rastrear), así se
        # puede "mandar búsquedas al Excel que quiera" sin repetir nada.
        candidatos = []
        ya_guardadas: list[str] = []
        excluidas = repetidas = 0
        for item in resultados:
            dom = normalizar_dominio(item.get("url", ""))
            if not dom:
                continue
            if any(x and x in dom for x in self.config.excluir_dominios):
                self.db.marcar_dominio(dom, "excluido")
                excluidas += 1
                continue
            if self.db.id_empresa_por_dominio(dom):
                ya_guardadas.append(dom)
                continue
            if self.db.dominio_visto(dom):
                repetidas += 1
                continue
            candidatos.append(item)

        candidatos = candidatos[: max_nuevos + 5]
        self.mon.poner(
            candidatos=len(candidatos),
            excluidas=excluidas,
            repetidas=repetidas,
            ya_guardadas=len(ya_guardadas),
        )

        sumadas = 0
        for dom in ya_guardadas:
            for l in listas:
                if self.db.asignar_lista(dom, l):
                    sumadas += 1
        if sumadas:
            self.log(f"  [=] {sumadas} empresa(s) ya guardadas sumadas a la lista destino")

        if not candidatos:
            self.log("  (nada nuevo: todas ya estaban guardadas o excluidas)")
            self.mon.poner(fase="inactivo")
            return []
        self.log(f"Nuevas para procesar: {len(candidatos)} ({self.hilos} en paralelo)")

        tareas = [
            (lambda it=item: self._procesar(it, usar_ia, zona, f"busqueda:{consulta}", listas))
            for item in candidatos
        ]
        nuevos = self._correr_en_paralelo(tareas, debe_parar=debe_parar)
        return nuevos[:max_nuevos]

    def rastrear_urls(self, urls: list[str], usar_ia: bool = True, zona: str = "") -> list[dict]:
        tareas = [
            (lambda u=url: self._procesar({"url": u}, usar_ia, zona, "manual"))
            for url in urls
        ]
        return self._correr_en_paralelo(tareas)

    # ------------------------------------------------------------------ #
    def _check_una(self, f: dict) -> str | None:
        info = rastreo.rastrear_sitio(
            f["web"],
            timeout=min(self.aj.timeout, 12),
            max_paginas=2,
            user_agent=self.aj.user_agent,
        )
        emails = [e.lower() for e in info.get("emails", [])]
        if f["email"] and f["email"].lower() in emails:
            self.db.actualizar_check(f["id"], "verificado")
            return "verificada"
        if emails:
            nuevo = rastreo.elegir_email(info["emails"], f["dominio"])
            self.db.actualizar_check(f["id"], "verificado", nuevo)
            self.log(f"  [~] {f['nombre'][:40]:40} email actualizado -> {nuevo}")
            return "verificada"
        self.db.actualizar_check(f["id"], "no_encontrada")
        return "sin_email"

    def check(self, limite: int | None = None) -> dict:
        filas = self.db.para_check(limite)
        self.mon.poner(fase="chequeando", consulta="", candidatos=len(filas))
        self.log(f"Chequeando {len(filas)} empresas ({self.hilos} en paralelo)...")
        tareas = [(lambda f=fila: self._check_una(f)) for fila in filas]
        resultados = self._correr_en_paralelo(tareas)
        self.mon.poner(fase="inactivo")
        return {
            "revisadas": len(filas),
            "verificadas": sum(1 for r in resultados if r == "verificada"),
            "sin_email": sum(1 for r in resultados if r == "sin_email"),
        }
