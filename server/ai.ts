import { GoogleGenAI } from '@google/genai';
import { esEmailValido } from './crawler.js';

export interface AIResult {
  es_objetivo: boolean;
  nombre: string;
  categoria: string;
  email: string;
  telefono: string;
  whatsapp: string;
  resuelto: boolean;
  duracionSeg: number;
  proveedor?: string;
}

interface Proveedor {
  nombre: string;
  tipo: 'openai' | 'gemini';
  baseUrl?: string;
  modelo?: string;
  apiKey: string;
}

// Proveedores que ya devolvieron 429 (cupo agotado) en esta corrida: no se
// vuelven a intentar hasta reiniciar el proceso.
const AGOTADOS = new Set<string>();

/**
 * Arma la lista de proveedores de IA a partir de las claves presentes en el
 * entorno. Todos son APIs gratuitas y compatibles con OpenAI, excepto Gemini.
 * Se prueban EN ORDEN hasta que uno responda.
 */
export function proveedoresIA(): Proveedor[] {
  const lista: Proveedor[] = [];

  // 1) Gemini (Google AI Studio, capa GRATIS: sin tarjeta y con cupo diario
  //    amplio). Se prueban dos modelos por si uno está saturado.
  const gem = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (gem && gem !== 'MY_GEMINI_API_KEY') {
    for (const modelo of ['gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
      lista.push({ nombre: `gemini:${modelo}`, tipo: 'gemini', modelo, apiKey: gem });
    }
  }

  // 2) OpenRouter (modelos gratis). Cupo compartido ~50/día.
  const or = process.env.OPENROUTER_API_KEY;
  if (or) {
    const modelosOR = [
      'nvidia/nemotron-3.5-super-vl:free',
      'dots-studio/dots-3-note-preview:free',
      'cohere/north-mini-code:free',
      'liquid/lfm-2.5-2.6b:free',
    ];
    for (const modelo of modelosOR) {
      lista.push({
        nombre: `openrouter:${modelo}`,
        tipo: 'openai',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelo,
        apiKey: or,
      });
    }
  }

  // 3) NVIDIA NIM (endpoint compatible con OpenAI).
  const nv = process.env.NVIDIA_API_KEY;
  if (nv) {
    lista.push({
      nombre: 'nvidia:openai/gpt-oss-20b',
      tipo: 'openai',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      modelo: 'openai/gpt-oss-20b',
      apiKey: nv,
    });
  }

  // 4) (opcional) cualquier otra clave que agregues a mano iría acá.

  return lista;
}

/** Nombres de los proveedores activos (para logs/estado). */
export function nombresProveedoresIA(): string[] {
  return proveedoresIA()
    .filter(p => !AGOTADOS.has(p.nombre))
    .map(p => p.nombre);
}

/** ¿Hay al menos un proveedor de IA configurado? */
export function hayIA(): boolean {
  return proveedoresIA().length > 0;
}

/** Llamada a un proveedor compatible con OpenAI (/chat/completions). */
async function llamarOpenAI(pv: Proveedor, prompt: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pv.apiKey}`,
    };
    // OpenRouter recomienda (opcional) identificar la app.
    if (pv.baseUrl?.includes('openrouter')) {
      headers['HTTP-Referer'] = 'http://localhost:3000';
      headers['X-Title'] = 'Prospector IA';
    }

    const resp = await fetch(`${pv.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: pv.modelo,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 600,
      }),
      signal: ctrl.signal,
    });

    if (resp.status === 429) {
      AGOTADOS.add(pv.nombre);
      throw new Error('429 cupo agotado');
    }
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const data: any = await resp.json();
    return data?.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

/** Llamada a Gemini (capa gratis de Google AI Studio). */
async function llamarGemini(pv: Proveedor, prompt: string, timeoutMs: number): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: pv.apiKey });
  const respPromise = ai.models.generateContent({
    model: pv.modelo || 'gemini-2.5-flash',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout IA')), timeoutMs)
  );
  try {
    const res: any = await Promise.race([respPromise, timeoutPromise]);
    return res?.text || '';
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/\b429\b|quota|RESOURCE_EXHAUSTED|rate limit/i.test(msg)) {
      AGOTADOS.add(pv.nombre); // cupo del día agotado: no reintentar
    }
    throw e;
  }
}

/** Extrae el primer objeto JSON del texto devuelto por el modelo. */
function extraerJSON(texto: string): any {
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export async function consultarIA(
  params: {
    titulo: string;
    web: string;
    snippet: string;
    emailsEncontrados: string[];
    telefonosEncontrados: string[];
    textoWeb: string;
  },
  timeoutMs: number = 20000
): Promise<AIResult> {
  const t0 = Date.now();

  const defaultOut: AIResult = {
    es_objetivo: true,
    nombre: '',
    categoria: '',
    email: '',
    telefono: '',
    whatsapp: '',
    resuelto: false,
    duracionSeg: 0,
  };

  const candidatos = proveedoresIA().filter(p => !AGOTADOS.has(p.nombre));
  if (!candidatos.length) {
    return defaultOut;
  }

  const prompt = `Sos un asistente que ORDENA datos de contacto ya extraídos de la web de una empresa.
REGLAS ESTRICTAS:
1. No inventes nada; usá solo la información recibida.
2. Si vas a sugerir un email, DEBE aparecer literalmente en los emails encontrados o en el texto visible de la web provisto. Si no hay email real, dejá "" (cadena vacía).
4. DESCARTA estrictamente correos técnicos/plataforma: no aceptes correos de dominios como wixpress.com, sentry.io, googleapis.com, mailgun.org, sendgrid.net, cloudflare.com, amazonaws.com, onesignal.com. Tampoco accepts @example.com o placeholder.
3. Devolvé ÚNICAMENTE un objeto JSON válido con este formato:
{
  "es_objetivo": true,
  "nombre": "Nombre comercial real de la empresa",
  "categoria": "Rubro o categoría",
  "email": "correo verificado o vacio",
  "telefono": "telefono o vacio",
  "whatsapp": "whatsapp o vacio"
}

DATOS DE LA EMPRESA:
- Título: ${params.titulo}
- Web: ${params.web}
- Descripción: ${params.snippet}
- Emails extraídos por regex: ${params.emailsEncontrados.join(', ') || 'ninguno'}
- Teléfonos extraídos: ${params.telefonosEncontrados.join(', ') || 'ninguno'}
- Muestra de texto extraído del sitio (hasta 3000 caracteres):
${params.textoWeb.slice(0, 3000)}
`;

  const fin = t0 + timeoutMs;

  for (const pv of candidatos) {
    const restante = fin - Date.now();
    if (restante <= 1500) break; // sin tiempo útil para otro intento

    try {
      const espera = Math.min(restante, 12000);
      const texto =
        pv.tipo === 'gemini'
          ? await llamarGemini(pv, prompt, espera)
          : await llamarOpenAI(pv, prompt, espera);

      const parsed = extraerJSON(texto);
      if (!parsed) continue;

      // Verificación anti-inventar: el email debe ser válido Y aparecer
      // literalmente en el HTML (texto o emails detectados por regex).
      let finalEmail = (parsed.email || '').trim().toLowerCase();
      if (finalEmail) {
        if (!esEmailValido(finalEmail)) {
          finalEmail = '';
        } else {
          const enEmails = params.emailsEncontrados.includes(finalEmail);
          const enTexto = params.textoWeb.toLowerCase().includes(finalEmail);
          if (!enEmails && !enTexto) finalEmail = '';
        }
      }

      return {
        es_objetivo: parsed.es_objetivo !== false,
        nombre: (parsed.nombre || '').trim(),
        categoria: (parsed.categoria || '').trim(),
        email: finalEmail,
        telefono: (parsed.telefono || '').trim(),
        whatsapp: (parsed.whatsapp || '').trim(),
        resuelto: Boolean(finalEmail),
        duracionSeg: Number(((Date.now() - t0) / 1000).toFixed(2)),
        proveedor: pv.nombre,
      };
    } catch {
      // Proveedor caído o timeout: se prueba el siguiente.
      continue;
    }
  }

  defaultOut.duracionSeg = Number(((Date.now() - t0) / 1000).toFixed(2));
  return defaultOut;
}
