# Prospector IA (Web)

Busca **empresas reales** en la web y les extrae el **contacto verificado**
(nombre, teléfono, WhatsApp, email y dirección) **de su propia web**, sin
inventar datos y sin repetir empresas en la próxima búsqueda.

- **Multi-fuente en paralelo**: DuckDuckGo (+ variante lite), Bing, Yahoo y Mojeek a la vez.
- **Entra a la web de cada empresa** y saca el contacto del HTML: `schema.org` (JSON-LD), microdatos, regex y subpágina de contacto.
- **IA solo como respaldo** (Gemini / OpenRouter / NVIDIA): se usa cuando el sitio no muestra el email. No inventa: solo acepta un email que **aparezca literalmente** en la página.
- **Recuerda los dominios ya escaneados** → no repite empresas.
- **Listas**: cada búsqueda se guarda como lista con su propio Excel; podés sumar resultados a cualquier lista.
- **Exporta**: lotes de emails de a 20, base completa o una lista puntual (CSV + Excel).
- **Valida emails** de verdad: sintaxis + registros **MX** del dominio + score de confianza.
- **Panel de actividad en vivo** y **modo continuo** (no se detiene hasta que le das PARAR).

Stack: **TypeScript + React + Express + Vite**. Interfaz **solo modo oscuro**.
La base de datos es un archivo JSON local (`datos/prospector.json`): no necesita servidor de base de datos.

---

## 1) Encendido rápido

**Opción fácil:** doble clic en el ícono **`Prospector IA (Web)`** del Escritorio
(o en `encender.sh`). Se abre una terminal (dejala abierta: es el motor) y el
navegador en `http://127.0.0.1:3000`.

**Opción manual:**

```bash
cd "Proyecto predeterminado/prospector-ia-web"
npm install --legacy-peer-deps   # solo la primera vez
npm run dev
```

Luego abrí `http://127.0.0.1:3000`. Para apagarlo: `Ctrl+C` en la terminal.

**Requisitos:** Node.js 20 o superior (probado con Node 24).

---

## 2) Cómo funciona (paso a paso)

1. **Búsqueda multi-fuente** — Lanza la consulta en varios buscadores **en paralelo**
   y junta los resultados, descartando portales inmobiliarios, redes sociales,
   marketplaces y buscadores (lista de exclusión en `server/search.ts`).
   *(Opcional: además consulta **Google Maps** abriendo un navegador real — ver más abajo.)*
2. **Cola de candidatos** — Toma los dominios **nuevos** (los ya vistos se saltan,
   así no repetís empresas entre búsquedas).
3. **Rastreo de la web** — Entra a cada sitio (portada, y una subpágina de contacto
   si hace falta) y extrae:
   - `schema.org` / JSON-LD (nombre, email, teléfono, dirección, categoría),
   - microdatos y regex de **email**, **teléfono** (formato Uruguay `+598`) y **WhatsApp**,
   - redes sociales y `meta description`,
   - un **score de confianza** según de dónde salió cada dato.
4. **Respaldo con IA (opcional)** — Si no hubo email, consulta a la IA (ver abajo).
5. **Guarda** en la base local y evita repetir dominios.
6. **Exporta** a CSV/Excel, en lotes de a 20 o la base completa / por lista.

**Modo rápido (por defecto, ON):** todo el rastreo es en paralelo y la IA se usa
**solo** cuando falta el email. Con el modo rápido apagado, la IA se consulta
siempre (más lento, más datos).

### Fuente extra: Google Maps (opción)

Marcá **“Buscar también en Google Maps”** y el motor, además de los buscadores,
**abre Google Maps con un navegador real** (Playwright/Chromium), acepta el aviso de
cookies, hace scroll y lee cada ficha:

- **nombre**, **teléfono** (celular → se marca **WhatsApp**), **dirección** y **categoría**;
- y, abriendo el detalle de cada negocio, **su sitio web** (que en la lista de Maps ya no
  se muestra).

Con ese sitio web, el negocio entra al rastreo normal: se busca el **email** en la web y,
si no aparece, se usa la **IA** de respaldo. **Maps no da el email**; por eso el correo
siempre sale de la web del negocio (o queda vacío).

- Si el negocio **no publica web** en Maps, se guarda igual con **teléfono/WhatsApp y
  dirección** (útil para llamar), y con la IA activada se intenta **descubrir su sitio por
  nombre** para poder rastrear el email.
- Es **más lento** (una consulta a Maps tarda ~30–50 s), por eso viene **desactivado**.
- Para **ver** el navegador mientras busca, en `encender.sh` descomentá
  `export PROSPECTOR_MAPS_HEADLESS=0`.

> ⚠️ El scraping de Google Maps **va contra los Términos de Servicio de Google** y es
> frágil (Google cambia el diseño). Se incluye como fuente de descubrimiento adicional.


---

## 3) ¿Si no hay email lo busca con IA?

**Sí.** El flujo del email es así:

1. **Primero busca sin IA** (rápido y gratis): `schema.org` del sitio, regex sobre el
   HTML y la subpágina de contacto.
2. **Solo si NO encontró email**, llama a la IA. Le pasa:
   - el título y la web,
   - la lista de emails/teléfonos detectados por regex,
   - **hasta 3000 caracteres del texto real** de la página.
3. La IA responde un JSON. Si propone un email, **se acepta únicamente si**:
   - tiene forma de email válida, **y**
   - **aparece literalmente** en el HTML descargado (o en la lista de emails detectados).

   Si no cumple, se descarta y queda **vacío / "No disponible"**. Es decir, la IA
   **ordena y completa**, pero **nunca inventa** un correo que no esté publicado.

Así, cuando una web realmente publica su correo (por ejemplo dentro de una imagen
de texto, un `mailto:` raro o un formato que el regex no pescó), la IA lo puede
recuperar; cuando el correo no existe en la página, **no se lo inventa**.

---

## 4) Proveedores de IA (todos gratis)

En `server/ai.ts` se prueban **en orden** y, si uno falla o se queda sin cupo,
pasa al siguiente automáticamente:

1. `gemini:gemini-2.5-flash` — **Google AI Studio (gratis, sin tarjeta)**
2. `gemini:gemini-2.5-flash-lite`
3. `openrouter:nvidia/nemotron-3.5-super-vl:free`
4. `openrouter:dots-studio/dots-3-note-preview:free`
5. `openrouter:cohere/north-mini-code:free`
6. `openrouter:liquid/lfm-2.5-2.6b:free`
7. `nvidia:openai/gpt-oss-20b`

Las claves se ponen en un archivo `.env` (que **no** se sube al repo):

```env
# Gemini gratis (recomendado): sacá la clave en https://aistudio.google.com/apikey
GEMINI_API_KEY=AIza...

# Opcionales:
OPENROUTER_API_KEY=sk-or-...
NVIDIA_API_KEY=nvapi-...
```

**Sin ninguna clave, el programa funciona igual**: solo se queda con lo que
encuentra el rastreo (sin respaldo de IA). Al arrancar, el servidor te dice qué
proveedores quedaron activos.

¿Querés agregar otro proveedor? Es un endpoint **compatible con OpenAI**: se
agrega una entrada más en `proveedoresIA()` en `server/ai.ts`.

---

## 5) Listas y exportación

- **Listas con nombre**: cada búsqueda se guarda con su nombre (por ejemplo
  "administradoras de edificios Pocitos"). Misma búsqueda ⇒ se agregan solo las
  empresas **nuevas**. Búsquedas distintas ⇒ listas distintas.
- **Sumar a una lista**: podés agregar los resultados de una búsqueda a cualquier
  lista ya existente.
- **Exportar**:
  - **Lotes de 20 emails**,
  - **Base completa** (todas las empresas),
  - **Una lista puntual**,
  - **Todas las listas** (un Excel por lista).
  - Formatos: **CSV + Excel (.xlsx)** en `salida/`.

---

## 6) Actividad en vivo y modo continuo

- **Panel en vivo**: muestra la fase actual (buscando / rastreando / IA),
  la consulta, cuántos candidatos hay, cuántas procesadas, nuevas, con email,
  llamadas a IA, y los tiempos por buscador.
- **Modo continuo**: tocás **▶ INICIAR** y trabaja sin parar (lotes de 20, y sigue
  con la próxima búsqueda). Solo frena con **⏹ PARAR** o **💾 GUARDAR Y PARAR**.

---

## 7) Chequeo y validación de emails

- **Chequear**: vuelve a entrar a las webs guardadas y confirma que el email siga publicado.
- **Verificar email** (`/api/verificar-email`): valida sintaxis, consulta los **registros MX**
  del dominio, detecta cuentas de rol (`info@`, `contacto@`…) y proveedores gratuitos, y
  devuelve un **score 0-100** con un estado ("excelente", "bueno", "sospechoso", …).

---

## 8) Archivos del proyecto

```
prospector-ia-web/
├── server.ts            # servidor Express + Vite (puerto 3000) + endpoints /api/*
├── server/
│   ├── search.ts        # búsqueda multi-fuente en paralelo
│   ├── maps.ts          # fuente Google Maps (navegador Playwright/Chromium)
│   ├── crawler.ts       # rastreo + schema.org + regex + validación de email
│   ├── pipeline.ts      # orquestación, monitor en vivo, modo continuo
│   ├── db.ts            # base de datos (JSON local)
│   ├── exporter.ts      # exportación CSV/Excel y lotes
│   └── ai.ts            # IA multi-proveedor (Gemini / OpenRouter / NVIDIA)
├── src/                 # interfaz React (modo oscuro)
├── datos/               # base de datos local (no se sube)
├── salida/              # exportaciones CSV/Excel (no se sube)
├── encender.sh          # lanzador
├── probar_ia.ts         # prueba rápida de la IA: npx tsx probar_ia.ts
└── probar_maps.ts       # prueba de la fuente Maps: npx tsx probar_maps.ts
```

---

## 9) Límites conocidos (mejoras posibles)

- **Mojeek/Yahoo** a veces bloquean o no devuelven resultados.
- El **nombre** de la empresa depende del `<title>` si no hay `schema.org`.
- Puede colarse alguna página que no sea de una empresa (falta un filtro de relevancia más fino).
- **Google Maps** es más lento (~30–50 s por consulta) y es scraping: Google cambia el DOM
  y puede bloquear. Maps **no da email**; el correo siempre se busca en la web del negocio.
- Los buscadores que usan **imágenes con el correo** no se leen (la IA ayuda en algunos casos).
- La base JSON es simple; con volúmenes muy grandes convendría SQLite/Postgres.
