import { buscarMaps, cerrarMaps } from './server/maps.js';
const t0 = Date.now();
const r = await buscarMaps('inmobiliarias Pocitos Montevideo', 8);
console.log(`\nEncontrados: ${r.length} en ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
for (const b of r) {
  console.log(`- ${b.nombre}`);
  console.log(`    tel: ${b.telefono || '-'} | web: ${b.sitio_web || '-'} | cat: ${b.categoria || '-'} | dir: ${b.direccion || '-'} | rating: ${b.rating || '-'}`);
}
await cerrarMaps();
