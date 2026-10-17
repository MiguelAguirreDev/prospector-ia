# Prospector IA

Extrae y **verifica** datos de contacto de empresas (nombre, teléfono, WhatsApp y
**email**) usando **búsqueda web + IA gratis** (OpenRouter, NVIDIA o cualquier API
compatible con OpenAI que agregues a mano).

- **Busca** empresas en la web (Google vía Serper/CSE, o DuckDuckGo gratis).
- **Entra a la web** de cada empresa y **busca el email en la página** (no lo inventa).
- **Usa IA** solo para ordenar lo ya extraído (opcional; sin IA también funciona).
- **Guarda** todo en una base SQLite y **recuerda los dominios ya escaneados** →
  en la próxima búsqueda **no repite** los mismos.
- **Exporta** lo que le pidas: **lotes de emails de a 20**, o la **lista completa**
  con nombre, teléfono, WhatsApp, correo (CSV + Excel).
- **Chequea** las empresas guardadas: re-entra a sus webs y confirma que el email
  siga publicado.
- **Corre solo** (cron local o GitHub Actions en la nube, con la PC apagada).

---

## 0) Encendido rápido (lo más fácil)

Hay un **lanzador con interfaz web**, igual que el de Maps:

- Doble clic en el ícono **`Prospector IA`** del Escritorio (o en
  `Prospector IA.desktop`, o en `encender.sh`).
- Se abre una terminal (no la cierres: es el motor) y **el navegador** con la
  interfaz. Desde ahí: **INICIAR**, **PARAR**, **GUARDAR**, ver empresas,
  **exportar** (lotes de a 20 o lista completa) y **chequear**.
- Para apagarlo: cerrá la terminal o `Ctrl+C`.

### Modo continuo

Tocá **▶ INICIAR** y el programa **trabaja sin parar**: busca, guarda de a lotes
de 20 y sigue con la próxima búsqueda. **No se detiene solo**: solo frena cuando
tocás **⏹ PARAR** (termina y guarda lo hecho) o **💾 GUARDAR Y PARAR** (frena y
exporta además la lista completa CSV + Excel).

- Marcá **"Recorrer todos los barrios"** y usa automáticamente **168 búsquedas**
  (56 barrios de Montevideo + Ciudad de la Costa × 3 rubros).
- **PARAR** responde en ~1 segundo (aunque haya descargas en curso).
- Cada vez que junta 20 emails, **guarda un lote** en `salida/emails/`.

También funciona por terminal, sin interfaz (ver más abajo).

### ⚡ Modo rápido (rápido de verdad)

Marcado por defecto. El cuello de botella siempre fue la **IA** (cada empresa
tardaba 3,5–11 s). Ahora la estrategia cambió:

- **Búsqueda multi-fuente en paralelo**: DuckDuckGo, Bing y Mojeek se consultan
  **a la vez** (y Serper/Google CSE si tenés clave). Sale más resultado y más
  rápido que encadenar fuentes en serie. Los buscadores a sí mismos y los
  directorios quedan excluidos.
  - Se probó **OpenStreetMap (Overpass)** como fuente "tipo mapas" y se descartó:
    Uruguay no tiene negocios de este rubro con página web en OSM (0 resultados,
    aun consultando por la categoría `estate_agent`).
- **Rastreo de solo la portada**: descarga acotada (corta páginas gigantes) y
  abre la página de contacto **solo si la portada no trae email**.
- **La IA es un respaldo, no un paso obligatorio**: se usa **únicamente cuando
  falta el email**, para buscarlo en el texto de la página oficial. Si el email
  ya salió del HTML, **no se gasta ni un llamado de IA**.
- **Anti-inventar**: el email que aporte la IA debe **aparecer literalmente en
  el texto descargado** de la página; si no, se descarta.

Resultado medido: **~0,5 s por empresa** (contra 4–8 s antes), con los nombres
detectados por heurística y sin consumir el cupo diario gratis.

- Con **"⚡ Modo rápido"** desmarcado volvés al modo completo: la IA limpia
  nombres, arma la categoría y rastrea varias páginas siempre.

### 🔴 Actividad en vivo

La sección **Actividad** muestra en tiempo real (se refresca sola cada ~1,2 s):

- **En qué fase está**: buscando en los buscadores → rastreando webs → esperando.
- **Barra de progreso**: sitios rastreados sobre los que había que procesar.
- **Contadores**: rastreadas, nuevas, **con email**, sin email, **IA usada**,
  **IA resolvió** (emails que sólo encontró la IA), descartadas y ya vistas.
- **"Rastreando ahora"**: los dominios que se están descargando en este instante.
- **Buscadores**: cuántos resultados aportó cada uno y si alguno falló
  (ej. `bing:10 · duckduckgo:10 · mojeek:caído`).
- **Tiempos**: total de la corrida, tiempo de búsqueda y **promedio de rastreo
  y de IA por empresa**.
- El **registro de texto** lleva hora (`HH:MM:SS`) en cada línea.

### Listas (un Excel por cada búsqueda)

Podés guardar **en un Excel con nombre propio** para no mezclar temas:

- En el cuadro **"Guardar en el Excel (lista)"** escribís el nombre (ej.
  `Pocitos`, `Clientes`, `General`). Elegís una lista **ya existente** del
  desplegable o **creás una nueva** tipeando.
- Con **"Una lista por cada búsqueda"** marcado, cada búsqueda va a **su propia
  lista** (el nombre usa el texto buscado). Así, **distintas búsquedas quedan en
  Excel distintos** y repetir lo mismo **suma solo lo nuevo**.
- **Sin repetir:** cada empresa aparece **una sola vez** por lista (la base
  recuerda los dominios ya guardados). Y si querés **mandar una búsqueda al
  Excel que quiera**, desmarcás la casilla y ponés el nombre: los resultados
  (aunque ya estuvieran guardados) **se suman a esa lista** sin volver a
  rastrear la web.
- Cada lista se exporta como **`salida/listas/<nombre>.xlsx`** (más `.csv`).
- En la sección **"3 · Listas guardadas"** ves todas las listas con su cantidad
  y podés **Ver**, **Exportar a Excel** o **Quitar** una (quitar solo borra esa
  carpeta, **no** borra las empresas).

> **Velocidad:** las empresas se procesan **en paralelo** (6 a la vez), así que
> una tanda de ~10 empresas tarda **~15-30 s** en vez de minutos.
>
> **Límite gratis de OpenRouter:** la cuenta gratis permite **50 consultas por
> día** a modelos `:free` (se resetea cada día). El programa lo controla solo:
> cuando se agota, **pasa al siguiente proveedor** y sigue sacando emails.
>
> **Respaldo NVIDIA:** si cargás `NVIDIA_API_KEY`, cuando OpenRouter se agota el
> programa **sigue con NVIDIA automáticamente** (cada proveedor se agota por
> separado). En NVIDIA solo funcionan los modelos **habilitados en tu cuenta**:
> el de ejemplo es `openai/gpt-oss-20b`. Verificá con `python3 run.py proveedores`
> y, si un modelo da `404`, probá otro de la lista.
>
> Si no queda ningún proveedor de IA, el programa **igual funciona** (heurística:
> saca los emails de las webs), solo que el nombre queda menos pulido y sin rubro.

---

## 1) Instalación

```bash
cd prospector-ia
pip install -r requirements.txt
```

Si el sistema da el error `externally-managed-environment`, usá una de estas dos:

```bash
# Opción A: instalación de usuario (no toca el sistema)
pip install --user --break-system-packages -r requirements.txt

# Opción B: entorno virtual (si tenés python3-venv)
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
```

Probalo sin internet ni claves:

```bash
python3 autotest.py      # debe terminar con "21 OK, 0 fallos"
```

## 2) Configurar las APIs de IA

Copiá el ejemplo y completá tus claves:

```bash
cp config.example.json config.json
cp .env.example .env
```

En `.env` poné al menos una clave:

```
OPENROUTER_API_KEY=sk-or-...
NVIDIA_API_KEY=nvapi-...
```

**Para agregar una API a mano**: abrí `config.json` y sumá un objeto al arreglo
`proveedores` (cualquier servidor compatible con OpenAI):

```json
{
  "nombre": "mi-api",
  "base_url": "https://mi-servidor/v1",
  "api_key_env": "MI_API_KEY",
  "modelo": "mi-modelo"
}
```

El sistema prueba los proveedores **en orden** y usa el primero que responda
(respaldo automático). Verificá cuáles funcionan:

```bash
python3 run.py proveedores
```

## 3) Uso

```bash
# Buscar y guardar empresas nuevas (máx. 20 por consulta)
python3 run.py buscar "administradoras de edificios Pocitos Montevideo" --max 20 --zona Pocitos

# Varias consultas a la vez
python3 run.py buscar "inmobiliarias Pocitos" "inmobiliarias Cordón" --max 15

# Sin IA (solo heurística de emails)
python3 run.py buscar "inmobiliarias Centro Montevideo" --sin-ia

# Rastrear URLs puntuales
python3 run.py rastrear www.ejemplo.com.uy https://otra.uy

# Ver lo guardado
python3 run.py listar --limite 20

# Exportar emails EN LOTES DE A 20
python3 run.py exportar --tipo emails --lote 20 --salida salida/emails

# Exportar la lista completa (nombre, teléfono, WhatsApp, email) -> CSV + Excel
python3 run.py exportar --tipo full --salida salida/empresas.csv

# Re-verificar empresas guardadas contra su web
python3 run.py check --limite 50
```

## 4) Que corra solo (PC apagada o encendida)

### a) En tu PC (cron) — corre con la PC encendida

```bash
./instalar_cron.sh            # todos los días a las 03:00 (recomendado)
./instalar_cron.sh 30         # cada 30 minutos
./instalar_cron.sh listar     # ver la tarea
./instalar_cron.sh quitar     # eliminarla
```

`run_cron.sh` rota las consultas de `consultas.txt`, busca, chequea y **actualiza
las exportaciones**. Log en `salida/cron.log`.

> **Honesto:** cada 5 minutos es demasiado y es agresivo con los sitios. Con una
> vez por día sobra.

### b) En la nube (GitHub Actions) — corre con la PC APAGADA

1. Subí esta carpeta a un repositorio de GitHub.
2. En *Settings → Secrets and variables → Actions* cargá `OPENROUTER_API_KEY`
   y/o `NVIDIA_API_KEY`.
3. Listo: `.github/workflows/relevar.yml` corre **todos los días** y guarda la
   base (memoria anti-repetición) y las exportaciones en el propio repo.

## 5) Cómo evita repetir y evitar inventar

- **No repite:** la tabla `dominios` guarda cada sitio ya escaneado; si aparece
  otra vez, se saltea.
- **No inventa:** el email se extrae **de la página** de la empresa. La IA, si se
  usa, **solo puede elegir entre los correos ya encontrados**; si no hay ninguno,
  queda vacío (no se completa por lógica).

## 6) Archivos

| Archivo | Para qué |
|---|---|
| `run.py` | Comandos (`buscar`, `listar`, `exportar`, `check`, `proveedores`) |
| `app.py` + `encender.sh` | Interfaz web local (lanzador del Escritorio) |
| `prospector/` | El motor (búsqueda, rastreo, IA, base, exportación) |
| `config.json` | Tus proveedores de IA y ajustes (editable a mano) |
| `consultas.txt` | Búsquedas que rota la tarea automática |
| `run_cron.sh` / `instalar_cron.sh` | Automatización local |
| `.github/workflows/relevar.yml` | Automatización en la nube |
| `datos/prospector.db` | Base SQLite (todo lo guardado) |
| `salida/` | CSV, Excel, lotes de emails y logs |
| `salida/listas/` | Un CSV + Excel por cada **lista** (un tema por archivo) |
| `autotest.py` | Pruebas sin internet |

## 7) Aviso de uso responsable

Usá datos de contacto **comerciales publicados por las propias empresas** y
respetá las leyes de protección de datos y los términos de los sitios que
consultes. No hagas envíos masivos sin consentimiento.
