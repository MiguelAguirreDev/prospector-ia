"""Base SQLite: guarda empresas y recuerda los dominios ya escaneados.

Es segura para usarse desde varios hilos (búsquedas en paralelo): la conexión
se abre con check_same_thread=False y cada método se serializa con un cerrojo.
"""

from __future__ import annotations

import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ESQUEMA = """
CREATE TABLE IF NOT EXISTS empresas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT DEFAULT '',
    web TEXT DEFAULT '',
    dominio TEXT UNIQUE,
    telefono TEXT DEFAULT '',
    whatsapp TEXT DEFAULT '',
    email TEXT DEFAULT '',
    categoria TEXT DEFAULT '',
    zona TEXT DEFAULT '',
    estado_email TEXT DEFAULT '',
    es_objetivo INTEGER DEFAULT 1,
    fuente TEXT DEFAULT '',
    notas TEXT DEFAULT '',
    fecha_alta TEXT DEFAULT '',
    fecha_check TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS dominios (
    dominio TEXT PRIMARY KEY,
    primer_visto TEXT DEFAULT '',
    ultimo_intento TEXT DEFAULT '',
    resultado TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_empresas_email ON empresas(email);
CREATE TABLE IF NOT EXISTS uso_ia (
    fecha TEXT PRIMARY KEY,
    n INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS listas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE,
    creada TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS empresa_lista (
    empresa_id INTEGER,
    lista_id INTEGER,
    fecha TEXT DEFAULT '',
    PRIMARY KEY (empresa_id, lista_id)
);
CREATE INDEX IF NOT EXISTS idx_empresa_lista ON empresa_lista(lista_id);
"""


def ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalizar_dominio(url: str) -> str:
    if not url:
        return ""
    if "://" not in url:
        url = "http://" + url
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def normalizar_telefono(valor: str) -> str:
    """Normaliza un teléfono uruguayo a formato +598XXXXXXXX."""
    if not valor:
        return ""
    d = re.sub(r"\D", "", str(valor))
    if not d:
        return ""
    if d.startswith("00"):
        d = d[2:]
    if d.startswith("598"):
        d = d[3:]
    d = d.lstrip("0")
    return f"+598{d}" if d else ""


class BaseDatos:
    def __init__(self, ruta: str | Path):
        Path(ruta).parent.mkdir(parents=True, exist_ok=True)
        self.con = sqlite3.connect(str(ruta), check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self.con.executescript(ESQUEMA)
            self.con.commit()

    # -- memoria anti-repetición ------------------------------------------- #
    def dominio_visto(self, dominio: str) -> bool:
        with self._lock:
            cur = self.con.execute("SELECT 1 FROM dominios WHERE dominio = ?", (dominio,))
            return cur.fetchone() is not None

    def reservar_dominio(self, dominio: str) -> bool:
        """Reserva un dominio de forma atómica. True si nadie lo había tomado."""
        if not dominio:
            return False
        with self._lock:
            t = ahora()
            cur = self.con.execute(
                """INSERT OR IGNORE INTO dominios(dominio, primer_visto, ultimo_intento, resultado)
                   VALUES(?, ?, ?, ?)""",
                (dominio, t, t, "en_proceso"),
            )
            self.con.commit()
            return cur.rowcount > 0

    def marcar_dominio(self, dominio: str, resultado: str = "ok") -> None:
        if not dominio:
            return
        with self._lock:
            t = ahora()
            self.con.execute(
                """INSERT INTO dominios(dominio, primer_visto, ultimo_intento, resultado)
                   VALUES(?, ?, ?, ?)
                   ON CONFLICT(dominio) DO UPDATE SET
                     ultimo_intento=excluded.ultimo_intento,
                     resultado=excluded.resultado""",
                (dominio, t, t, resultado),
            )
            self.con.commit()

    def guardar_empresa(self, datos: dict) -> bool:
        """Devuelve True si era nueva (por dominio)."""
        dominio = datos.get("dominio") or normalizar_dominio(datos.get("web", ""))
        if not dominio:
            return False
        t = ahora()
        with self._lock:
            cur = self.con.execute(
                """INSERT OR IGNORE INTO empresas
                   (nombre, web, dominio, telefono, whatsapp, email, categoria, zona,
                    estado_email, es_objetivo, fuente, notas, fecha_alta, fecha_check)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    datos.get("nombre", ""),
                    datos.get("web", ""),
                    dominio,
                    datos.get("telefono", ""),
                    datos.get("whatsapp", ""),
                    datos.get("email", ""),
                    datos.get("categoria", ""),
                    datos.get("zona", ""),
                    datos.get("estado_email", ""),
                    1 if datos.get("es_objetivo", 1) else 0,
                    datos.get("fuente", ""),
                    datos.get("notas", ""),
                    t,
                    "",
                ),
            )
            nueva = cur.rowcount > 0
            # Guardar también marca el dominio como visto (memoria anti-repetición).
            self.con.execute(
                """INSERT INTO dominios(dominio, primer_visto, ultimo_intento, resultado)
                   VALUES(?, ?, ?, ?)
                   ON CONFLICT(dominio) DO UPDATE SET
                     ultimo_intento=excluded.ultimo_intento,
                     resultado=excluded.resultado""",
                (dominio, t, t, "ok"),
            )
            self.con.commit()
            return nueva

    # -- consultas --------------------------------------------------------- #
    def listar(self, limite: int | None = None) -> list[dict]:
        sql = "SELECT * FROM empresas ORDER BY id DESC"
        if limite:
            sql += f" LIMIT {int(limite)}"
        with self._lock:
            return [dict(r) for r in self.con.execute(sql).fetchall()]

    def con_email(self, limite: int | None = None) -> list[dict]:
        sql = (
            "SELECT * FROM empresas "
            "WHERE email != '' AND email IS NOT NULL AND estado_email != 'no_encontrada' "
            "ORDER BY id"
        )
        if limite:
            sql += f" LIMIT {int(limite)}"
        with self._lock:
            return [dict(r) for r in self.con.execute(sql).fetchall()]

    # -- listas (grupos / Excel con nombre) -------------------------------- #
    def crear_lista(self, nombre: str) -> int:
        """Crea (si no existe) una lista con ese nombre y devuelve su id."""
        nombre = (nombre or "").strip()
        if not nombre:
            return 0
        with self._lock:
            self.con.execute(
                "INSERT OR IGNORE INTO listas(nombre, creada) VALUES(?, ?)",
                (nombre, ahora()),
            )
            self.con.commit()
            r = self.con.execute("SELECT id FROM listas WHERE nombre = ?", (nombre,)).fetchone()
            return int(r[0]) if r else 0

    def id_empresa_por_dominio(self, dominio: str) -> int | None:
        if not dominio:
            return None
        with self._lock:
            r = self.con.execute("SELECT id FROM empresas WHERE dominio = ?", (dominio,)).fetchone()
            return int(r[0]) if r else None

    def asignar_lista(self, dominio: str, nombre: str) -> bool:
        """Suma la empresa (por dominio) a la lista. True si no estaba ya en ella."""
        eid = self.id_empresa_por_dominio(dominio)
        if not eid:
            return False
        lid = self.crear_lista(nombre)
        if not lid:
            return False
        with self._lock:
            cur = self.con.execute(
                "INSERT OR IGNORE INTO empresa_lista(empresa_id, lista_id, fecha) VALUES(?,?,?)",
                (eid, lid, ahora()),
            )
            self.con.commit()
            return cur.rowcount > 0

    def listar_listas(self) -> list[dict]:
        with self._lock:
            filas = self.con.execute(
                "SELECT l.nombre AS nombre, COUNT(el.empresa_id) AS n, "
                "       SUM(CASE WHEN e.email != '' THEN 1 ELSE 0 END) AS con_email "
                "FROM listas l "
                "LEFT JOIN empresa_lista el ON el.lista_id = l.id "
                "LEFT JOIN empresas e ON e.id = el.empresa_id "
                "GROUP BY l.id ORDER BY l.nombre"
            ).fetchall()
            return [dict(f) for f in filas]

    def empresas_de_lista(self, nombre: str, limite: int | None = None) -> list[dict]:
        sql = (
            "SELECT e.* FROM empresas e "
            "JOIN empresa_lista el ON el.empresa_id = e.id "
            "JOIN listas l ON l.id = el.lista_id "
            "WHERE l.nombre = ? ORDER BY e.id"
        )
        if limite:
            sql += f" LIMIT {int(limite)}"
        with self._lock:
            return [dict(r) for r in self.con.execute(sql, (nombre,)).fetchall()]

    def con_email_de_lista(self, nombre: str, limite: int | None = None) -> list[dict]:
        sql = (
            "SELECT e.* FROM empresas e "
            "JOIN empresa_lista el ON el.empresa_id = e.id "
            "JOIN listas l ON l.id = el.lista_id "
            "WHERE l.nombre = ? AND e.email != '' AND e.email IS NOT NULL "
            "ORDER BY e.id"
        )
        if limite:
            sql += f" LIMIT {int(limite)}"
        with self._lock:
            return [dict(r) for r in self.con.execute(sql, (nombre,)).fetchall()]

    def borrar_lista(self, nombre: str) -> bool:
        with self._lock:
            r = self.con.execute("SELECT id FROM listas WHERE nombre = ?", (nombre,)).fetchone()
            if not r:
                return False
            self.con.execute("DELETE FROM empresa_lista WHERE lista_id = ?", (r[0],))
            self.con.execute("DELETE FROM listas WHERE id = ?", (r[0],))
            self.con.commit()
            return True

    def para_check(self, limite: int | None = None) -> list[dict]:
        sql = "SELECT * FROM empresas WHERE web != '' ORDER BY COALESCE(fecha_check,'') ASC"
        if limite:
            sql += f" LIMIT {int(limite)}"
        with self._lock:
            return [dict(r) for r in self.con.execute(sql).fetchall()]

    def actualizar_check(self, id_empresa: int, estado_email: str, email: str | None = None) -> None:
        campos = "estado_email=?, fecha_check=?"
        params: list = [estado_email, ahora()]
        if email is not None:
            campos += ", email=?"
            params.append(email)
        params.append(id_empresa)
        with self._lock:
            self.con.execute(f"UPDATE empresas SET {campos} WHERE id=?", params)
            self.con.commit()

    # -- uso diario de IA -------------------------------------------------- #
    def sumar_uso_ia(self) -> int:
        """Suma 1 llamada de IA al día de hoy y devuelve el total."""
        fecha = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        with self._lock:
            self.con.execute(
                "INSERT INTO uso_ia(fecha, n) VALUES(?, 0) ON CONFLICT(fecha) DO NOTHING",
                (fecha,),
            )
            self.con.execute("UPDATE uso_ia SET n = n + 1 WHERE fecha = ?", (fecha,))
            self.con.commit()
            return self.con.execute("SELECT n FROM uso_ia WHERE fecha = ?", (fecha,)).fetchone()[0]

    def uso_ia_hoy(self) -> int:
        fecha = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        with self._lock:
            r = self.con.execute("SELECT n FROM uso_ia WHERE fecha = ?", (fecha,)).fetchone()
            return int(r[0]) if r else 0

    def estadisticas(self) -> dict:
        with self._lock:
            total = self.con.execute("SELECT COUNT(*) FROM empresas").fetchone()[0]
            con_email = self.con.execute("SELECT COUNT(*) FROM empresas WHERE email != ''").fetchone()[0]
            verif = self.con.execute(
                "SELECT COUNT(*) FROM empresas WHERE estado_email='verificado'"
            ).fetchone()[0]
            dominios = self.con.execute("SELECT COUNT(*) FROM dominios").fetchone()[0]
        return {
            "empresas": total,
            "con_email": con_email,
            "verificado": verif,
            "dominios_vistos": dominios,
        }
