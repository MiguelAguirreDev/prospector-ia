# Prompt corto para auditar Prospector IA

> Versión compacta (para pegar en un chat). La versión completa está en
> `PROMPT_PARA_AUDITOR.md`.

---

Sos un auditor sénior de software y arquitecto de sistemas de búsqueda/enriquecimiento
de datos. Auditá y mejorá este proyecto:

**Repo:** https://github.com/MiguelAguirreDev/prospector-ia
```bash
git clone https://github.com/MiguelAguirreDev/prospector-ia.git
cd prospector-ia && python3 autotest.py   # debe dar: 54 OK, 0 fallos
```

**Qué hace:** herramienta local en Python que encuentra administradoras de edificios
e inmobiliarias reales en Uruguay y les extrae de su propia web el contacto verificado
(nombre, teléfono, WhatsApp, email). Búsqueda multi-fuente en paralelo (DuckDuckGo,
Bing, Mojeek, ddgs), rastreo con 20 hilos, y la IA se usa SOLO cuando falta el email.

**Reglas que NO se pueden romper:** nunca inventar datos (todo dato debe salir de una
fuente real), nunca repetir (dedup por dominio), tiene que funcionar sin claves de IA,
costo casi nulo (APIs gratis/free tier), español.

**Tiempos medidos:** búsqueda 2,5–3,8 s · rastreo 0,7–1,2 s/sitio · IA ~5,9 s (único
cuello de botella) · total ~0,5 s/empresa. Base actual: 98 empresas, 77 con email.

**Entregame:**

1. **Auditoría** con hallazgos numerados (`archivo:línea`, severidad, impacto y el diff
   concreto): correctitud, seguridad (es un server local sin auth; ¿SSRF al rastrear?),
   manejo de rate-limit y **riesgo de ToS de cada scraping**, calidad de datos,
   mantenibilidad.

2. **Fuentes nuevas de datos**, en tabla: fuente, tipo, costo (con límites exactos),
   si pide clave, **qué campos aporta**, cobertura real en Uruguay, velocidad, riesgo y
   veredicto. Investigá como mínimo: APIs de buscadores (Serper, Brave, Bing, Google
   CSE, SearXNG), **Google Places y alternativas tipo mapas**, directorios y amarillas
   de Uruguay, **datos del Estado uruguayo (DGI/RUT, Catastro, datos abiertos)**,
   validación de emails (MX/catch-all), redes sociales, Common Crawl/Wayback, y sobre
   todo **JSON-LD / schema.org `RealEstateAgent`** (los sitios ya lo traen y no se usa).

3. **Más datos, mejor ordenados:** esquema ideal del registro (campos obligatorios /
   opcionales), **nivel de confianza por dato**, estructura del CSV/Excel definitivo
   (columnas, una hoja por tipo, scoring de prioridad, agrupación por barrio/rubro) y
   cómo mostrarlo en la interfaz (tabla ordenable/filtrable, ficha de empresa, mapa,
   exportación selectiva).

4. **Plan priorizado** P0 (ya) / P1 (corto) / P2 (mediano), cada ítem con impacto
   estimado, esfuerzo y riesgo. Cerrá con: cuántas empresas/contactos se podrían
   conseguir para Uruguay y en cuánto tiempo, y 3 preguntas para el dueño.

**Reglas:** cero relleno, todo accionable; si algo no sirve, explicá por qué con datos;
distinguí lo probado de las hipótesis; si proponés algo pago, decí el precio y la
alternativa gratis; nunca generes datos con IA sin verificarlos contra una fuente real.
Respondé en español.
