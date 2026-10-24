import fs from 'fs';
import path from 'path';
import {createRequire} from 'module';
import {fileURLToPath, pathToFileURL} from 'url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATOS = process.argv[2] || path.join(APP, '..', 'novetec-datos');
const DOCS = path.join(DATOS, 'documentos');
const require = createRequire(import.meta.url);
const XLSX = require(path.join(APP, 'lib', 'xlsx.full.min.js'));

const js = fs.readFileSync(path.join(APP, 'index.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const nodo = () => ({
  value: '', innerHTML: '', textContent: '', style: {setProperty() {}, removeProperty() {}}, dataset: {},
  classList: {toggle() {}, add() {}, remove() {}, contains: () => false},
  querySelector: () => nodo(), querySelectorAll: () => [], addEventListener() {},
  setAttribute() {}, insertAdjacentHTML() {}, focus() {}, scrollIntoView() {},
  dispatchEvent() {}, closest: () => null, remove() {}, appendChild() {}
});
globalThis.document = {
  getElementById: () => nodo(), querySelector: () => nodo(), querySelectorAll: () => [],
  addEventListener() {}, createElement: () => nodo(), body: nodo(),
  documentElement: {setAttribute() {}, style: {setProperty() {}, removeProperty() {}}}
};
globalThis.window = {};
globalThis.localStorage = {getItem: () => null, setItem() {}};

const ctx = (0, eval)('(function(){' + js + '\nreturn {DB,ARCH,normalizarDatos,fcParsearCotizacion,cxParsearConsolidado,psParsearReporte,xlHojas};})')();
for (const [k, p] of Object.entries(ctx.ARCH)) {
  const f = path.join(DATOS, p);
  if (fs.existsSync(f)) ctx.DB[p] = {data: JSON.parse(fs.readFileSync(f, 'utf8'))};
}
if (ctx.normalizarDatos) ctx.normalizarDatos();

const pdfjs = await import(pathToFileURL(path.join(APP, 'lib', 'pdf.min.mjs')).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(APP, 'lib', 'pdf.worker.min.mjs')).href;
const paginas = async f => {
  const doc = await pdfjs.getDocument({data: new Uint8Array(fs.readFileSync(f)), isEvalSupported: false}).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items);
  return out;
};
const hojas = f => ctx.xlHojas(XLSX.read(fs.readFileSync(f), {type: 'buffer'}), XLSX);
const bolsa = items => items.map(i => `${+i.cantidad}x${+i.precio_unitario}`).sort().join(' ');
const suma = items => {
  const m = {};
  items.forEach(i => { const k = (i.codigo_sap || '') + '@' + i.precio_unitario; m[k] = (m[k] || 0) + +i.cantidad; });
  return Object.entries(m).map(([k, v]) => k + '=' + v).sort().join(' ');
};
const neto = items => items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
const notas = [];

const cots = ctx.DB[ctx.ARCH.cot].data.cotizaciones;
const fallas = [];
let n = 0;

const dirCot = path.join(DOCS, 'cotizaciones');
for (const f of fs.readdirSync(dirCot).filter(x => /^COT_\d+\.pdf$/i.test(x)).sort()) {
  n++;
  const c = ctx.fcParsearCotizacion(await paginas(path.join(dirCot, f)));
  const reg = cots.find(x => x.archivo === 'documentos/cotizaciones/' + f);
  const p = [];
  if (c.errores.length) p.push(c.errores.join(' | '));
  if (reg) {
    if (String(reg.folio) !== String(c.folio)) p.push(`folio ${c.folio} y el sistema dice ${reg.folio}`);
    if (bolsa(reg.items) !== bolsa(c.items) && !c.errores.length && neto(reg.items) === c.neto)
      notas.push(`${f}: ${c.items.length} líneas; el sistema las tiene agrupadas en ${reg.items.length} con el mismo neto`);
    else if (bolsa(reg.items) !== bolsa(c.items)) p.push(`líneas [${bolsa(c.items)}] y el sistema [${bolsa(reg.items)}]`);
  }
  if (p.length) fallas.push(`${f}: ${p.join(' · ')}`);
}

for (const f of fs.readdirSync(dirCot).filter(x => /^COT_CONSOLIDADO_.*\.xlsx$/i.test(x)).sort()) {
  n++;
  const c = ctx.cxParsearConsolidado(hojas(path.join(dirCot, f)));
  const reg = cots.find(x => x.archivo === 'documentos/cotizaciones/' + f);
  const p = [];
  if (c.errores.length) p.push(c.errores.join(' | '));
  if (reg && suma(reg.items) !== suma(c.items)) p.push(`líneas [${bolsa(c.items)}] y el sistema [${bolsa(reg.items)}]`);
  if (p.length) fallas.push(`${f}: ${p.join(' · ')}`);
}

const reportes = [
  ...fs.readdirSync(path.join(DOCS, 'pendientes_sap')).filter(x => /\.xlsx$/i.test(x)).map(x => path.join(DOCS, 'pendientes_sap', x)),
  ...fs.readdirSync(path.join(DOCS, 'ordenes_compra')).filter(x => /^REPORTE_.*\.xlsx$/i.test(x)).map(x => path.join(DOCS, 'ordenes_compra', x))
].sort();
const psap = ctx.DB[ctx.ARCH.psap].data;
for (const f of reportes) {
  n++;
  const r = ctx.psParsearReporte(hojas(f));
  const p = [];
  if (r.errores.length) p.push(r.errores.join(' | '));
  const ocs = ctx.DB[ctx.ARCH.oc].data.ordenes;
  const sin = r.lineas.filter(l => !l.bodega && !ocs.some(o => o.folio === l.doc_compras && o.destino)).map(l => `"${l.texto}"`);
  if (sin.length) p.push(`centros sin bodega: ${[...new Set(sin)].join(', ')}`);
  if (psap.archivo_origen && f.replace(/\\/g, '/').endsWith(psap.archivo_origen)) {
    const a = r.lineas.map(l => `${l.doc_compras}/${l.codigo_sap}/${l.centro}/${l.por_entregar}`).sort().join(' ');
    const b = psap.registros.map(l => `${l.doc_compras}/${l.codigo_sap}/${l.centro}/${l.por_entregar}`).sort().join(' ');
    if (a !== b) p.push('no coincide con pendientes_sap.json');
  }
  if (p.length) fallas.push(`${path.basename(f)}: ${p.join(' · ')}`);
}

notas.forEach(x => console.log('  nota:', x));
console.log(`\n  ${n} documentos leídos · ${n - fallas.length} sin diferencias`);
if (fallas.length) {
  console.log('\n  Con diferencias:');
  fallas.forEach(x => console.log('   ', x));
  process.exit(1);
}
console.log('\nTodo correcto.');
