import 'dotenv/config';
import { consultarIA, nombresProveedoresIA } from './server/ai.js';

const provs = nombresProveedoresIA();
console.log(`Proveedores configurados: ${provs.length} -> ${provs.join(', ')}\n`);

const t0 = Date.now();
const r = await consultarIA(
  {
    titulo: 'Inmobiliaria Prueba',
    web: 'https://ejemplo.com.uy',
    snippet: 'Venta y alquiler de propiedades en Montevideo',
    emailsEncontrados: [],
    telefonosEncontrados: [],
    textoWeb:
      'Bienvenidos a Inmobiliaria Prueba. Escribinos a ventas@ejemploprueba.com.uy o llamá al 2400 1234. Estamos en Av. 18 de Julio 1234, Montevideo.',
  },
  25000
);

console.log(`Tiempo total: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
console.log(JSON.stringify(r, null, 2));
console.log(
  r.resuelto && r.email === 'ventas@ejemploprueba.com.uy'
    ? '\n✅ OK: la IA encontró el email real del texto (y usó: ' + r.proveedor + ')'
    : '\n⚠️ NO resolvió (ver arriba)'
);
