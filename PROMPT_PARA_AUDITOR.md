# Prompt para que otra IA audite y mejore Prospector IA

> Copiá todo lo que está entre las líneas de abajo y pegáselo a la IA.
> Funciona igual con ChatGPT, Claude, Gemini o un modelo con acceso a internet.

---

## ROL

Sos un **auditor sénior de software + arquitecto de sistemas de búsqueda de datos
(lead generation / data enrichment)**. Tenés acceso a internet y a `git`.
Trabajás con criterio: no propongas humo, proponé cambios concretos con código.

## REPOSITORIO

```
https://github.com/MiguelAguirreDev/prospector-ia
```

Cloneo el proyecto y lea **todo** el código antes de opinar:

```bash
git clone https://github.com/MiguelAguirreDev/prospector-ia.git
cd prospector-ia
```

**Orden de lectura sugerido:** `ARQUITECTURA.md` (mapa general y tiempos
medidos) → `README.md` → `prospector/pipeline.py` (orquestación) →
`prospector/busqueda.py` (fuentes) → `prospector/rastreo.py` (extracción) →
`prospector/ia.py` (cliente de IA) → `prospector/db.py` (dedup) → `app.py`
(interfaz) → `autotest.py` (las reglas que hay que respetar).

Para verificar que entendió el sistema antes de proponer cambios, corrá:

```bash
python3 autotest.py     # debe dar: 54 OK, 0 fallos
```

## CONTEXTO: QUÉ HACE EL PROGRAMA

Herramienta local (Python 3, sin frameworks) que encuentra **administradoras de
edificios e inmobiliarias reales en Uruguay** y les extrae el contacto
verificado **de su propia web**: nombre, teléfono, WhatsApp y email.

Pipeline actual (ya funcionando):

1. **Búsqueda multi-fuente EN PARALELO** (4 hilos): DuckDuckGo HTML, Bing HTML,
   Mojeek y la librería oficial `ddgs`. Se unen y se deduplican **por dominio**.
   Medido: **2,5–3,8 s por consulta**.
2. **Rastreo de cada sitio** (20 hilos): descarga en streaming con tope de
   400 KB, timeout 8 s, extracción por regex de email/teléfono/WhatsApp, y
   texto limpio para la IA. Medido: **0,7–1,2 s por sitio**.
3. **IA SOLO como respaldo**: se invoca **únicamente cuando no se encontró
   email**, con deadline de 30 s y proveedores en cadena (OpenRouter → NVIDIA).
   Medido: **~5,9 s por llamado**.
4. **Guardado** en SQLite con dedup atómico por dominio y exportación
   CSV/Excel (global, lotes de a 20, o un Excel por búsqueda/lista).

Rendimiento extremo a extremo: **~0,5 s por empresa sin IA**, ~1–2 s con IA.

### Reglas duras del sistema (NO se pueden romper)

- **Nunca inventar datos.** Un email solo se guarda si aparece literalmente en
  el texto descargado de la página y tiene forma real de correo (hay filtro
  contra correos enmascarados).
- **Nunca repetir.** La clave de dedup es el dominio normalizado.
- **Sin claves la herramienta tiene que seguir funcionando** (heurística pura).
- **Costo casi nulo**: APIs gratuitas o de capa free.
- Documentación y interfaz **en español rioplatense**.

### Estado actual de datos

Base de prueba: 98 empresas, 77 con email verificado, 133 dominios registrados.
Cuello de botella actual confirmado: **la IA (~5,9 s por llamado)**.

### Debilidades que ya detecté (para que no las repita, sino que las resuelva)

1. La calidad del **nombre** depende del `<title>` de la página; a veces salen
   nombres de barrios ("Buceo") en vez del nombre real de la empresa.
2. **Se cuelan páginas que no son empresas** (artículos de blog, portales
   agregadores, manuales de usuario). Hay lista negra + filtro de "dominio en
   venta", pero falta un filtro de **relevancia**.
3. `mojeek` casi nunca responde y `bing` se corta a veces → hilo desperdiciado.
4. **Sin fuente tipo mapas**. Se probó OpenStreetMap/Overpass (con espejos, ya
   que `overpass-api.de` está bloqueado desde la red) y Uruguay tiene **0**
   negocios de este rubro con web taggeada, ni siquiera por la categoría
   `estate_agent`. Quedó descartado.
5. SQLite usa candado global (funciona a 20 hilos, pero no escala).

---

## TAREA 1 — AUDITORÍA (primero, antes de proponer nada)

Audite el código y entregue un informe con hallazgos numerados, cada uno con
**archivo:línea**, **severidad** (crítico / alto / medio / bajo), **impacto**
concreto y **parche sugerido en código** (diff real, no descripción vaga).

Cubrá específicamente:

- **Correctitud**: fugas de recursos (`requests`, hilos, `ThreadPoolExecutor`),
  manejo de excepciones que tragan errores, carreras en la base, dedup roto.
- **Seguridad**: es un servidor HTTP local **sin autenticación** que dispara
  crawls y lee/escribe disco. ¿Qué puede hacer alguien en `127.0.0.1`?
  ¿Hay riesgo de SSRF al rastrear URLs arbitrarias? ¿Se filtra algo?
  ¿Están seguras las claves en disco?
- **Robustez de red**: timeouts, reintentos, rate-limit, bloqueos, User-Agent,
  `robots.txt` / Términos de Servicio de cada fuente (esto es importante:
  quiero saber qué riesgo legal/ToS asume el scraping de cada buscador y qué
  alternativas legales y de API oficial existen).
- **Calidad de datos**: cómo se evita el ruido hoy, qué falta, cómo validar un
  email de verdad (MX, catch-all, cuentas de rol tipo `info@`/`ventas@`).
- **Mantenibilidad**: tipos, tests, errores, logging, configuración.

## TAREA 2 — INVESTIGUE FUENTES NUEVAS DE DATOS (esta es la más importante)

El objetivo del dueño es: **conseguir TODOS los datos posibles de cada empresa,
lo más completo y rápido que se pueda**, sin gastar plata si se puede.

Investigue en internet y evalúe **fuente por fuente**. Para cada una entregue:

| Columna | Qué poner |
|---|---|
| Fuente | nombre + URL oficial |
| Tipo | API oficial / scraping / dataset abierto / directorio |
| Costo | gratis, free tier (con límites exactos), de pago (precio) |
| Clave | ¿hace falta registrarse? ¿tarjeta? |
| Datos que aporta | exactamente qué campos (nombre, persona de contacto, cargo, teléfonos, WhatsApp, email, dirección, barrio, CUIT/RUT, horarios, redes, reseñas, fotos, cantidad de unidades administradas, servicios, precios…) |
| Cobertura Uruguay | estimación real, no suposición |
| Velocidad | latencia aproximada |
| Riesgo | bloqueo, ToS, calidad |
| Veredicto | integrar ya / probar / descartar (y por qué) |

Cubrá, como mínimo, estas líneas de investigación (agregue las que encuentre):

- **Buscadores con API oficial**: Serper, Google Programmable Search, Bing Web
  Search API, Brave Search API, Yandex, Qwant, SearXNG (instancias públicas),
  Marginalia, Mojeek API.
- **Google Maps / Places**: Google Places API (y su costo real por llamado),
  la capa `places` de Serper, Google Maps Platform "Places - Nearby Search",
  y alternativas: Foursquare Places, TomTom, HERE, Geoapify, Positionstack.
- **Directorios y amarillas de Uruguay**: Guía Amarilla Uruguay, Páginas
  Amarillas, Guía Comercial, El Directorio, Guía Empresas, Empresite, Axesor,
  Mercado Libre (fichas de servicio), 1122, directorios municipales.
  *(Idea clave: usarlos SOLO como "tarjeta" para hallar la web oficial y el
  teléfono, e ir después a la web de la empresa por el email.)*
- **Datos oficiales del Estado uruguayo**: DGI / Dirección General Impositiva
  (razón social y RUT/CUIT), Dirección de Catastro, registros de propiedad
  horizontal, Oficina de Planificación y Vivienda, datos abiertos
  (`gub.uy/abiertos`), DGSI. Esto puede dar **razón social + domicilio legal**
  verificados y gratis.
- **Validación de emails**: consulta MX/SMTP, Hunter.io, ZeroBounce, NeverBounce,
  EmailListVerify (free tiers), detección de catch-all, verificación de
  dominio configurado.
- **Enriquecimiento social**: LinkedIn (Empresa/Página), Instagram, Facebook
  (ya excluidos hoy, ¿vale la pena usarlos como fuente de datos, no como
  destino?), Google Business Profile / fichas de negocio.
- **Archivos históricos**: Common Crawl, Wayback Machine (para rescatar emails
  de sitios que hoy están caídos).
- **Vías técnicas nuevas**: registros DNS/MX/SPF del dominio (barato y muy
  informativo), búsqueda en el sitio con `site:` + `inurl:contacto`,
  `mailto:` en el HTML, JSON-LD / microdatos `LocalBusiness`/`RealEstateAgent`
  (¡muy prometedor: el estándar schema.org lo tienen muchos sitios!),
  `og:title`/`og:site_name`, `favicon` inverso, WHOIS.

Además investigue: **cómo lo hacen los competidores** (hunter.io, Apollo,
Lusha, Phantombuster, Outscraper, Apify actors de Google Maps) y qué se les
puede copiar de la arquitectura sin pagar.

## TAREA 3 — MÁS DATOS, MEJOR ORDENADOS

Proponga:

1. **Esquema de datos completo**: el registro ideal de una empresa (todos los
   campos posibles), con prioridad obligatorio / opcional / nice-to-have.
2. **Cómo obtener cada campo** (de qué fuente, con qué técnica, con qué
   confianza). Incluya un campo de **confianza/verificación por dato** (no solo
   por empresa).
3. **Salida ordenada**: estructura del CSV/Excel definitivo (columnas en orden,
   una hoja por tipo de dato, scoring de prioridad de contacto, agrupación por
   barrio/rubro), y si conviene exportar también a formato CRM/JSON.
4. **Presentación en la interfaz**: tabla ordenable/filtrable, búsqueda
   instantánea, ficha de empresa con todo el detalle y el link a la fuente,
   mapa con las ubicaciones, y exportación selectiva (elegir qué empresas
   exportar).
5. **Relevancia**: cómo detectar con certeza que una página SÍ es una
   administradora/inmobiliaria (clasificador por lote con IA, reglas,
   schema.org, palabras clave en el HTML).

## TAREA 4 — PLAN DE MEJORA PRIORIZADO

Entregue un plan con:

- **P0 — ya**: arreglos de bugs/seguridad y ganancias grandes de datos con
  poco esfuerzo.
- **P1 — a corto**: fuentes nuevas y campos nuevos.
- **P2 — a mediano**: escala, calidad, interfaz.

Para cada ítem: **qué cambia**, **archivo tocado**, **código concreto**,
**impacto estimado** (cuántos datos más / cuántos segundos menos),
**esfuerzo** (chico/medio/grande) y **riesgo**.

Termine con: **(a)** el parche mínimo recomendado ya, **(b)** una estimación
honest de cuántas empresas/contactos se podrían conseguir para Uruguay y en
cuánto tiempo, y **(c)** las 3 preguntas que le haría al dueño del proyecto.

## REGLAS PARA SUS RESPUESTAS

- Cero relleno. Nada de "en el mundo ideal…". Todo accionable.
- Si dice que algo no sirve, **explique por qué con datos** (no opiniones).
- Distinga siempre entre **lo que ya está probado** y **lo que es una hipótesis**.
- Si propone una fuente de pago, diga el precio real y la alternativa gratis.
- Nunca proponga generar datos por IA sin verificarlos contra una fuente real:
  el valor del proyecto es que **nada esté inventado**.
- Responda **en español**.

---

*Nota final: el repositorio es público y el dueño va a comparar su propuesta
con la de otras IAs. Priorice impacto real sobre volumen de texto.*
