# Arquitectura — Prospector IA (Web)

Documento técnico para revisar con otra IA. Describe cómo está armado, los
tiempos reales medidos, las debilidades conocidas y por dónde seguir.

## 1. Stack

- **Runtime:** Node.js 20+ (probado con Node 24).
- **Servidor:** Express + Vite en modo middleware (`server.ts`), puerto **3000**.
- **Frontend:** React 19 + Tailwind (modo oscuro), build con Vite.
- **Base de datos:** archivo JSON local `datos/prospector.json` (sin servidor de DB).
- **Rastreo/parseo:** `fetch` + `cheerio`.
- **Exportación:** `xlsx` (Excel) + CSV.
- **IA:** cliente propio compatible con OpenAI (`fetch`) + `@google/genai` para Gemini.

## 2. Módulos

| Archivo | Responsabilidad |
|---|---|
| `server.ts` | Servidor HTTP y **API REST** (`/api/estado`, `/api/progreso`, `/api/log`, `/api/listas`, `/api/lista`, `/api/lista_de`, `/api/buscar`, `/api/continua`, `/api/parar`, `/api/check`, `/api/exportar*`, `/api/verificar-email`). |
| `server/search.ts` | Búsqueda **multi-fuente en paralelo** (DuckDuckGo, ddg_lite, Bing, Yahoo, Mojeek) con normalización de URL/dominio y lista de exclusión. |
| `server/crawler.ts` | Descarga y parsea la web: `schema.org`/JSON-LD, microdatos, regex de email/teléfono/WhatsApp, redes, dirección, `score` de confianza, texto limpio. |
| `server/pipeline.ts` | Orquestación: cola de candidatos, deduplicación, monitor en vivo, modo continuo, llamadas a IA. |
| `server/db.ts` | Persistencia JSON: empresas, dominios vistos, listas, relaciones, uso de IA. |
| `server/exporter.ts` | Exportación a CSV/Excel: lotes de 20, base completa, por lista, todas las listas. |
| `server/ai.ts` | Cadena de proveedores de IA con failsafe (Gemini → OpenRouter → NVIDIA) y verificación anti-inventar. |
| `src/App.tsx` | Interfaz React (modo oscuro): configuración, monitor en vivo, empresas, listas, exportaciones. |

## 3. Flujo de datos

```
consulta
  → search.ts   (5 buscadores en paralelo)         ~3 s
  → dedupe por dominio (db.dominios)               instantáneo
  → por cada candidato (hasta N en paralelo):
       crawler.ts  (portada [+ contacto])          ~1.5 s
       schema.org / microdatos / regex
       si falta email → ai.ts (Gemini/OpenRouter/NVIDIA)  ~3-6 s
       verificación anti-inventar del email
  → db.guardarEmpresa + marcar dominio
  → exporter.ts (CSV/Excel por lista / lotes)
```

## 4. Tiempos reales medidos (en esta máquina)

| Etapa | Tiempo |
|---|---|
| Búsqueda multi-fuente (1 consulta, 5 buscadores) | **~3,1 s** |
| Rastreo por sitio (promedio) | **~1,5 s** |
| Llamada a IA (Gemini `2.5-flash`) | **~3,0 s** |
| Llamada a IA (NVIDIA `gpt-oss-20b`) | **~3,8 s** |
| Búsqueda completa de ~10 empresas nuevas (modo rápido) | **~5-6 s** |
| Empresas nuevas por consulta (típico) | **9-11** |

La IA es el cuello de botella cuando se usa (una llamada por sitio **sin** email).

## 5. Decisiones de diseño

- **IA solo de respaldo.** En modo rápido, si el rastreo ya encontró email, **no** se
  llama a la IA (ahorra tiempo y cupo). Solo se llama cuando falta el email.
- **Anti-inventar.** El email que devuelve la IA se acepta **solo si aparece
  literalmente** en el HTML descargado (o en los emails detectados por regex).
- **Deduplicación por dominio** normalizado (se quita `www.`). Un dominio se marca
  al reservarse, así nunca se procesa dos veces.
- **Teléfono uruguayo** normalizado a `+598` + dígitos.
- **Failsafe de IA:** si un proveedor da 429 (cupo agotado) se marca y se saltea
  durante el resto de la corrida; sigue con el próximo.
- **Modo oscuro** fijo (sin toggle de tema).

## 6. Debilidades conocidas

- Sin un **filtro de relevancia** fino: puede colarse alguna página que no sea de una empresa.
- El **nombre** depende del `<title>` cuando no hay `schema.org`.
- **Mojeek/Yahoo** bloquean o devuelven 0 con frecuencia.
- No se leen **correos dentro de imágenes**.
- La base **JSON** es simple: con volúmenes grandes conviene migrar a SQLite/Postgres.
- **Concurrencia** de IA baja (una por sitio) — podría paralelizarse mejor.

## 7. Hoja de ruta sugerida (P0/P1/P2)

**P0 (impacto alto, bajo riesgo)**
- Filtro de relevancia (evitar páginas no-empresa por palabra clave/estructura).
- Reforzar extracción de nombre (og:site_name, `<h1>`, schema.org).
- Detección de "sitio aparcado / en venta" (como en la versión Python).

**P1**
- Leer emails embebidos en `mailto:` ofuscados (`info [arroba] dominio`).
- Cachear resultados de búsqueda por consulta (evitar repetir pedidos a buscadores).
- Paralelizar llamadas de IA con límite.

**P2**
- Migrar a SQLite para escalar.
- OCR opcional de imágenes de contacto.
- Nuevas fuentes de descubrimiento (directorios sectoriales, cámaras empresariales).
