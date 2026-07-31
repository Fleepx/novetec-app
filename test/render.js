/* Prueba de integridad de la app.  Uso:  node test/render.js [ruta-al-repo-de-datos]
 *
 * Valida la sintaxis Y EJECUTA de verdad cada vista contra los datos reales. Existe porque
 * validar solo la sintaxis no detecta variables o funciones que quedaron sin declarar al
 * borrar bloques de código: eso rompe la pestaña en el navegador pero pasa `node --check`.
 * (22-07-2026: así se detectó que la pestaña de Órdenes de compra estaba caída por
 *  `ocFiltro is not defined`, más borrarCot y rechazarCot eliminadas por error.)
 *
 * Comprueba:
 *   1. Que el script cargue.
 *   2. Que las 6 vistas rendericen sin lanzar excepción.
 *   3. Que toda función invocada desde onclick/oninput del HTML generado exista.
 *   4. Que todo id pedido por getElementById exista en alguna parte del HTML.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'index.html');
const DATOS = process.argv[2] || path.join(__dirname, '..', '..', 'repo', 'data');

const html = fs.readFileSync(APP, 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

/* ---- DOM mínimo: solo lo que las vistas tocan al renderizar ---- */
const nodo = () => ({
  value: '', innerHTML: '', textContent: '', style: { setProperty() {} }, dataset: {},
  classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  querySelector: () => nodo(), querySelectorAll: () => [], addEventListener() {},
  setAttribute() {}, insertAdjacentHTML() {}, focus() {}, scrollIntoView() {},
  dispatchEvent() {}, closest: () => null, remove() {}, appendChild() {}
});
global.document = {
  getElementById: () => nodo(), querySelector: () => nodo(), querySelectorAll: () => [],
  addEventListener() {}, createElement: () => nodo(), body: nodo(),
  documentElement: { setAttribute() {}, style: { setProperty() {} } }
};
global.window = {};
global.localStorage = { getItem: () => null, setItem() {} };
global.fetch = () => Promise.reject(new Error('sin red en la prueba'));
global.alert = () => {}; global.confirm = () => false; global.prompt = () => null;
global.setTimeout = () => 0;

let ctx;
try {
  ctx = (0, eval)('(function(){' + js +
    '\nreturn {DB,ARCH,normalizarDatos,rPanel,rCot,rOC,rGuias,rPrecios,rInv,' +
    'existe:function(n){try{return eval("typeof "+n)!=="undefined"}catch(e){return false}}};})')();
} catch (e) {
  console.error('FALLA: el script no carga ->', e.message);
  process.exit(1);
}

const ARCHIVOS = { cot: 'cotizaciones', oc: 'ordenes_compra', guias: 'guias_despacho',
  inv: 'inventario', conf: 'config', pend: 'pendientes', hr: 'hojas_ruta',
  prod: 'productos', sin: 'sinonimos', psap: 'pendientes_sap', hprec: 'historial_precios', adj: 'adjudicaciones', bod: 'bodegas' };
for (const k in ARCHIVOS) {
  const f = path.join(DATOS, ARCHIVOS[k] + '.json');
  if (!fs.existsSync(f)) { console.error('FALTA el archivo de datos:', f); process.exit(1); }
  // Igual que la app: normalizar al cargar
  ctx.DB[ctx.ARCH[k]] = { data: ctx.normalizarDatos(ctx.ARCH[k], JSON.parse(fs.readFileSync(f, 'utf8'))), sha: 'prueba' };
}

const VISTAS = { Panel: ctx.rPanel, Cotizaciones: ctx.rCot, 'Órdenes de compra': ctx.rOC,
  'Guías de despacho': ctx.rGuias, 'Lista de precios': ctx.rPrecios, Inventario: ctx.rInv };

let fallos = 0;
const salidas = [];
for (const [nombre, fn] of Object.entries(VISTAS)) {
  try {
    const h = fn(); salidas.push(h);
    console.log(`  OK    ${nombre.padEnd(20)} ${String(h.length).padStart(6)} caracteres`);
  } catch (e) {
    fallos++;
    console.log(`  FALLA ${nombre.padEnd(20)} ${e.constructor.name}: ${e.message}`);
    console.log('        ' + (e.stack.split('\n')[1] || '').trim());
  }
}

const todo = salidas.join('');
const NATIVAS = new Set(['if','for','while','return','typeof','function','Event','Date','Number',
  'String','Array','Object','JSON','decodeURIComponent','encodeURIComponent','parseInt',
  'parseFloat','confirm','alert','prompt']);
const invocadas = new Set();
for (const m of todo.matchAll(/(?:onclick|oninput|onchange)="([^"]*)"/g))
  for (const c of m[1].matchAll(/(^|[^.\w$])([a-zA-Z_$][\w$]*)\s*\(/g)) invocadas.add(c[2]);
const sinDefinir = [...invocadas].filter(n => !NATIVAS.has(n) && !ctx.existe(n));

const idsPedidos = new Set([...todo.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]));
const idsPresentes = new Set([...todo.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const idsEstaticos = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const idsRotos = [...idsPedidos].filter(i => !idsPresentes.has(i) && !idsEstaticos.has(i));

console.log('\n  Funciones invocadas desde el HTML que no existen:', sinDefinir.length ? sinDefinir : 'ninguna');
console.log('  IDs pedidos por getElementById que no existen:   ', idsRotos.length ? idsRotos : 'ninguno');

// Prueba de resistencia: las vistas deben sobrevivir a registros incompletos (sin items,
// sin folio_oc, etc.), que es exactamente lo que tumbó la pestaña de guías el 24-07-2026.
let fallosRotos = 0;
const rotos = {
  guias: { guias: [{ numero: 'X1', fecha: '2026-01-01', destino: 'Rancagua' }] },
  oc: { ordenes: [{ folio: '4500900000' }] },
  cot: { cotizaciones: [{ id: 'CX', folio: 'X', estado: 'enviada' }] },
  hr: { hojas: [{ numero: 99 }] },
};
for (const [k, data] of Object.entries(rotos)) {
  const respaldo = ctx.DB[ctx.ARCH[k]].data;
  ctx.DB[ctx.ARCH[k]] = { data: ctx.normalizarDatos(ctx.ARCH[k], JSON.parse(JSON.stringify(data))), sha: 'x' };
  for (const [nombre, fn] of Object.entries(VISTAS)) {
    try { fn(); } catch (e) { fallosRotos++; console.log(`  FRAGIL ${nombre} con ${k} incompleto -> ${e.message}`); }
  }
  ctx.DB[ctx.ARCH[k]] = { data: respaldo, sha: 'prueba' };
}
console.log('  Resistencia a registros incompletos:', fallosRotos ? fallosRotos + ' vista(s) caen' : 'todas las vistas sobreviven');

const total = fallos + sinDefinir.length + idsRotos.length + fallosRotos;
console.log(total ? `\n${total} problema(s) detectado(s).` : '\nTodo correcto.');
process.exit(total ? 1 : 0);
