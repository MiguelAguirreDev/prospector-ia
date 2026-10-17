# Prospector IA — Arquitectura, tiempos y procesos

> Documento pensado para revisarlo con otra IA y decidir mejoras.
> Incluye cómo está implementado, cuánto demora cada etapa medido en la práctica
> y las debilidades conocidas.

## 1) Qué hace

Busca **administradoras de edificios / inmobiliarias** reales, les extrae de **su
propia web** el contacto verificado (nombre, teléfono, WhatsApp, email) y los
guarda sin repetir, exportables en CSV/Excel (global o un Excel por búsqueda).

Reglas duras:

- **Nunca inventa datos.** Un email solo se guarda si aparece en el HTML/texto
  descargado de la página de la empresa.
- **Nunca repite.** La clave de deduplicación es el **dominio normalizado** (sin
  `www.`, minúsculas). Un dominio visto queda registrado y no se vuelve a rastrear.
- **La IA es opcional.** Sin claves funciona con heurística y igual saca emails.

## 2) Archivos y responsabilidades

| Archivo | Qué hace |
|---|---|
| `app.py` | Servidor HTTP local (`http.server`, sin dependencias) + interfaz web de una sola página. Estado global en memoria (`_estado`, `_MON`), tareas en hilos daemon, endpoints `/api/*`. |
| `prospector/busqueda.py` | Fuentes de búsqueda **en paralelo** (hilos): `duckduckgo` (HTML), `bing`, `mojeek`, `ddgs` (lib oficial); si hay clave: `serper` (Google) y `google_cse`. Une y deduplica por dominio. |
| `prospector/rastreo.py` | Descarga la página (streaming, tope 400 KB), extrae emails / teléfonos / WhatsApp por regex, sigue enlaces de "contacto" solo si la portada no trae email, y devuelve el **texto limpio** para la IA de respaldo. |
| `prospector/ia.py` | Cliente multi-proveedor compatible con OpenAI (`/chat/completions`), con respaldo en cadena, límite de tiempo real (wall-clock), semáforo de concurrencia y detección de 429 para agotar solo a ese proveedor. |
| `prospector/pipeline.py` | Orquestación: `buscar -> pre-filtrar -> rastrear (paralelo) -> IA solo si falta email -> guardar`. Incluye `Monitor` (estado en vivo). |
| `prospector/db.py` | SQLite con candado (thread-safe). Tablas `empresas`, `dominios`, `listas`, `empresa_lista`, `uso_ia`. Reserva atómica de dominio. |
| `prospector/exportar.py` | CSV/Excel: global, lotes de a 20, y un archivo por lista. |
| `prospector/config.py` | Proveedores de IA (editables a mano), ajustes y lista de dominios excluidos. |
| `autotest.py` | **54 comprobaciones sin internet** (extracción, dedup, listas, modo rápido, monitor, emails enmascarados, dominios en venta). |

## 3) Flujo de una búsqueda (paso a paso, con tiempos medidos)

### Paso 1 — Búsqueda multi-fuente (paralela)
Se lanzan **4 hilos a la vez** (más 2 si hay claves). Cada fuente tarda
0,4–1,2 s; manda la más lenta.

| Fuente | clave | rendimiento observado |
|---|---|---|
| `ddgs` (librería oficial) | no | **La más confiable**: 7–18 resultados siempre |
| `duckduckgo` (HTML) | no | 0–10 (se corta a veces) |
| `bing` (HTML) | no | 0–10 (rate-limit intermitente) |
| `mojeek` (HTML) | no | **Frecuentemente bloqueado** (0 o caído) |
| `serper` / `google_cse` | sí | No se usan hoy (sin clave) |

**Medido: 2,5 – 3,8 s por consulta.** Salen 7–20 dominios únicos.

Luego un pre-filtro barato (sin red): excluidos por lista negra, ya guardadas
(se suman a la lista destino **sin rastrear**), ya vistas, y las nuevas.

### Paso 2 — Rastreo de cada sitio (20 hilos en paralelo)
Por cada dominio nuevo:

1. `reservar_dominio()` — inserción atómica en SQLite; si otro hilo lo tomó, se saltea.
2. Descarga en streaming con tope de **400 KB** y timeout de **8 s**.
3. Regex de emails / teléfonos / WhatsApp sobre el HTML.
4. Si **no** hay email, abre 1 página de contacto (solo si `modo_rapido` está desmarcado).
5. Extrae el texto visible (sin scripts) para la IA de respaldo.
6. Filtros de calidad: título genérico ("Inicio", "Contacto"), dominio en venta/aparcado.

**Medido: 0,7 – 1,2 s por sitio** (`t_rastreo_prom` en el panel en vivo).

### Paso 3 — IA **solo como respaldo**
Se llama **únicamente si no se encontró email** (`ia_solo_email=True`, por defecto):

- Prompt con título, web, snippet de búsqueda, emails/teléfonos ya extraídos y
  **hasta 4000 caracteres del texto de la página**.
- La IA debe devolver JSON (`es_objetivo`, `nombre`, `categoria`, `email`, `telefono`, `whatsapp`).
- **Control anti-inventar:** el email devuelto debe (a) tener forma real de email
  y (b) aparecer literalmente en el texto descargado. Si no, se descarta.
- Límite de tiempo real de 30 s; proveedores en cadena (OpenRouter → NVIDIA).

**Medido: ~5,9 s por llamado** (`t_ia_prom`). Es el cuello de botella.

### Paso 4 — Guardar y exportar
Se guarda en SQLite, se asigna a la lista destino, y se exportan CSV/Excel al
terminar (o cada 20 emails en modo continuo).

### Rendimiento extremo a extremo (medido)

| Escenario | resultado |
|---|---|
| Sin IA (heurística pura) | 13 empresas en **7,1 s** → **0,54 s/empresa** |
| Con IA de respaldo | 9 empresas en **~5 s**, IA invocada solo 1–2 veces |
| Tanda típica de 10 | **~4–8 s** |

## 4) Modo continuo

Rota las consultas en bucle sin parar. Cada 20 emails nuevos exporta un lote.
Si una vuelta completa no da nada nuevo, espera 60 s. **PARAR** responde en
~1 s (hay `wait(timeout=1.0)` en el pool y se dejan de lanzar tareas nuevas;
las descargas en vuelo terminan solas).

"Recorrer todos los barrios" = 168 consultas (56 barrios × 3 rubros).

## 5) Interfaz y observabilidad

- **Panel en vivo** (`/api/progreso`, se refresca cada 1,2–2 s): fase actual,
  barra de progreso, contadores (rastreadas, nuevas, con email, **IA usada**,
  **IA resolvió**, descartadas, ya vistas), **dominios que se rastrean ahora**,
  cuántos resultados aportó cada buscador, y tiempos (total, búsqueda, promedio
  de rastreo y de IA).
- **Registro de texto** con hora `HH:MM:SS` en cada línea.
- Clase `Monitor` (hilo-seguro) en `pipeline.py` es la fuente del panel.

## 6) Debilidades conocidas (honestas)

1. **La IA sigue siendo el cuello de botella** (~5,9 s cuando se invoca).
2. **`mojeek` casi nunca responde** y `bing` se corta a veces → un hilo desperdiciado.
3. **La calidad del nombre depende del `<title>`**: salen "Buceo", "Jacinto Vera",
   "Inmobiliarias" cuando la página no se titula con el nombre real. La IA
   podría resolverlo, pero está desactivada en modo rápido.
4. **Se cuelan páginas que no son empresas** (artículos de blog, portales,
   manuales de usuario). Hay lista negra y filtro de "dominio en venta", pero
   falta un filtro de *relevancia* (¿esto es una administradora/inmobiliaria?).
5. **Sin fuente "tipo mapas".** Se probó OpenStreetMap/Overpass (con espejos,
   porque `overpass-api.de` está bloqueado desde la red) y Uruguay tiene **0**
   negocios de este rubro con web taggeada, ni siquiera por categoría
   `estate_agent`. Queda descartado.
6. **Las claves gratis limitan**: OpenRouter 50/día; NVIDIA free con rate-limit
   (se ve "nvidia superó 30s" en el log).
7. **SQLite con candado global**: funciona bien a 20 hilos, pero si se sube mucho
   la concurrencia el candado pasa a ser cuello de botella (mejor `WAL`).

## 7) Ideas de mejora (para discutir)

**Prioridad A — calidad (lo que más falta hace):**
- Filtro de relevancia con IA **por lote y barato**: mandar de a 15 títulos+días
  en un solo llamado y clasificar cuáles son realmente administradoras/inmobiliarias.
- Extraer el nombre del sitio desde `<h1>`, el `og:title` o el `<title>`, no solo
  del título de búsqueda; usar la IA solo para eso cuando el título es genérico.
- Detectar y descartar agregadores/portales por patrón de URL (no solo dominio).

**Prioridad B — velocidad:**
- Sacar `mojeek` de la cadena (o darle timeout de 2 s) y sumar fuentes que sí
  respondan (p. ej. `search.marginalia`, instancias SearX públicas, `startpage`).
- Prefetch de DNS / `requests.Session` con keep-alive para reusar conexiones.
- Bajar el timeout de descarga a 5 s con reintento rápido solo en portada.
- Si hay clave: Serper devuelve **tarjetas de Google** (nombre, dirección,
  teléfono) sin abrir la web → descubrimiento casi instantáneo.

**Prioridad C — robustez:**
- Reintentos con backoff para las fuentes que se cortan.
- `PRAGMA journal_mode=WAL` + `busy_timeout` en SQLite.
- Persistir el estado de "agotado" por proveedor entre reinicios.

---

## Cómo reproducir las mediciones

```bash
# Autotest offline (54 comprobaciones)
python3 autotest.py

# Interfaz
python3 app.py                 # http://127.0.0.1:8765/

# Panel en vivo desde la terminal
curl -s http://127.0.0.1:8765/api/progreso | python3 -m json.tool

# Consola de una corrida
python3 run.py buscar "administradoras de edificios Pocitos" --max 10 --sin-ia
```
