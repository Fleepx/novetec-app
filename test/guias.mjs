import fs from 'fs';
import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATOS = process.argv[2] || path.join(APP, '..', 'novetec-datos');
const GUIAS = path.join(DATOS, 'documentos', 'guias_despacho');

const js = fs.readFileSync(path.join(APP, 'index.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const nodo = () => ({
  value: '', innerHTML: '', textContent: '', style: {setProperty() {}}, dataset: {},
  classList: {toggle() {}, add() {}, remove() {}, contains: () => false},
  querySelector: () => nodo(), querySelectorAll: () => [], addEventListener() {},
  setAttribute() {}, insertAdjacentHTML() {}, focus() {}, scrollIntoView() {},
  dispatchEvent() {}, closest: () => null, remove() {}, appendChild() {}
});
globalThis.document = {
  getElementById: () => nodo(), querySelector: () => nodo(), querySelectorAll: () => [],
  addEventListener() {}, createElement: () => nodo(), body: nodo(),
  documentElement: {setAttribute() {}, style: {setProperty() {}}}
};
globalThis.window = {};
globalThis.localStorage = {getItem: () => null, setItem() {}};

const ctx = (0, eval)('(function(){' + js + '\nreturn {hgLineasDePagina,hgParsearGuia};})')();
const pdfjs = await import(pathToFileURL(path.join(APP, 'lib', 'pdf.min.mjs')).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(APP, 'lib', 'pdf.worker.min.mjs')).href;

if (!fs.existsSync(GUIAS)) {
  console.error('No se encontró la carpeta de guías:', GUIAS);
  process.exit(1);
}
const archivos = fs.readdirSync(GUIAS).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
const fallas = [];
for (const f of archivos) {
  const doc = await pdfjs.getDocument({data: new Uint8Array(fs.readFileSync(path.join(GUIAS, f)))}).promise;
  let lineas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    lineas = lineas.concat(ctx.hgLineasDePagina(c.items));
  }
  const g = ctx.hgParsearGuia(lineas);
  const suma = g.items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
  const problemas = [];
  if (!g.numero) problemas.push('sin número');
  if (!g.items.length) problemas.push('sin líneas');
  if (!g.neto || Math.abs(suma - g.neto) > 1) problemas.push(`las líneas suman ${suma} y el neto es ${g.neto}`);
  if (problemas.length) fallas.push(`${f}: ${problemas.join(' · ')}`);
}

console.log(`\n  ${archivos.length} guías leídas · ${archivos.length - fallas.length} cuadran con su neto`);
if (fallas.length) {
  console.log('\n  No cuadran:');
  fallas.forEach(x => console.log('   ', x));
  console.log('\nHay guías mal leídas.');
  process.exit(1);
}
console.log('\nTodo correcto.');
