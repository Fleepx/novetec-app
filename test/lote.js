const fs = require('fs');
const path = require('path');
const fb = require('../lib/fbdatos.js');

const DATOS = process.argv[2] || path.join(__dirname, '..', '..', 'novetec-datos', 'data');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

const nodo = () => ({ value: '', innerHTML: '', textContent: '', style: { setProperty() {} }, dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, querySelector: () => nodo(), querySelectorAll: () => [], addEventListener() {}, setAttribute() {}, insertAdjacentHTML() {}, focus() {}, scrollIntoView() {}, dispatchEvent() {}, closest: () => null, remove() {}, appendChild() {} });
global.document = { getElementById: () => nodo(), querySelector: () => nodo(), querySelectorAll: () => [], addEventListener() {}, createElement: () => nodo(), body: nodo(), documentElement: { setAttribute() {}, style: { setProperty() {} } } };
global.window = {}; global.localStorage = { getItem: () => null, setItem() {} }; global.fetch = () => Promise.reject(new Error('sin red'));
global.setTimeout = () => 0; global.matchMedia = () => ({ matches: false });
Object.assign(global, fb);

function memoria() {
  const cols = new Map(); let seq = 0, reloj = 0;
  const col = c => { if (!cols.has(c)) cols.set(c, new Map()); return cols.get(c); };
  const copia = x => x == null ? null : JSON.parse(JSON.stringify(x));
  const AHORA = { ahora: true };
  const marcar = d => { const x = { ...d }; for (const k in x) if (x[k] === AHORA) x[k] = ++reloj; return x; };
  const filas = c => [...col(c)].map(([id, data]) => ({ id, data: copia(data) }));
  return {
    cols, sync: null,
    nuevoId: () => 'id' + (++seq), ahora: () => AHORA,
    serial: t => typeof t === 'number' ? String(t).padStart(12, '0') : null,
    async cacheColeccion(c) { return filas(c); }, async servidorColeccion(c) { return filas(c); },
    async servidorDesde(c, s) { return filas(c).filter(d => typeof d.data._t === 'number' && String(d.data._t).padStart(12, '0') > (s || '')); },
    async servidorDoc(c, id) { return copia(col(c).get(id)); },
    async leerDoc(c, id) { return copia(col(c).get(id)); }, async leerColeccion(c) { return filas(c); },
    async transaccion(fn) {
      const pend = [];
      await fn({ leer: async (c, id) => copia(col(c).get(id)), escribir: (c, id, d) => pend.push([c, id, marcar(copia(d))]), borrar: (c, id) => pend.push([c, id, null]) });
      pend.forEach(([c, id, d]) => d ? col(c).set(id, d) : col(c).delete(id));
    }
  };
}

let fallas = 0;
const ok = (c, m) => { console.log((c ? '  OK    ' : '  FALLA ') + m); if (!c) fallas++; };

(async () => {
  const store = memoria();
  for (const f of fs.readdirSync(DATOS).filter(x => x.endsWith('.json')))
    await fb.fbGuardar(store, 'data/' + f, JSON.parse(fs.readFileSync(path.join(DATOS, f), 'utf8')), fb.baseVacia(), {});
  const app = (0, eval)('(function(){' + js + '\nreturn {DB,ARCH,cargarTodo,guardarArchivo,abrirLote,cerrarLote,setFBS:v=>{FBS=v}};})')();
  app.setFBS({ store, usuario: { email: 'prueba@novetec.cl', uid: 'u1' }, rol: 'admin', au: {}, auth: {} });
  await app.cargarTodo();
  const { DB, ARCH } = app;
  const histAntes = store.cols.get(fb.FB_HIST).size;

  DB[ARCH.oc].data.ordenes[0].notas = 'lote app';
  DB[ARCH.inv].data.movimientos.push({ fecha: '2026-10-22', tipo: 'salida', codigo: 'NOV-0001', producto: 'X', cantidad: 1, referencia: 'lote app' });
  app.abrirLote();
  await app.guardarArchivo(ARCH.oc, 'OC de prueba');
  await app.guardarArchivo(ARCH.inv, 'Inventario de prueba');
  const antesDeCerrar = [...store.cols.get('ordenes_compra').values()].some(o => o.notas === 'lote app');
  await app.cerrarLote();
  const oc = [...store.cols.get('ordenes_compra').values()].some(o => o.notas === 'lote app');
  const mv = [...store.cols.get('movimientos').values()].some(m => m.referencia === 'lote app');
  ok(!antesDeCerrar && oc && mv && store.cols.get(fb.FB_HIST).size === histAntes + 1, 'un lote de la app escribe los dos archivos juntos, al cerrar, con una sola entrada en el historial');

  const otro = await fb.fbCargar(store, 'data/inventario.json');
  otro.data.movimientos[0].referencia = 'otro usuario';
  await fb.fbGuardar(store, 'data/inventario.json', otro.data, otro.base, {});
  DB[ARCH.oc].data.ordenes[1].notas = 'no debe quedar';
  DB[ARCH.inv].data.movimientos[0].referencia = 'choca';
  app.abrirLote();
  await app.guardarArchivo(ARCH.oc, 'OC');
  await app.guardarArchivo(ARCH.inv, 'Inventario');
  let err = null; try { await app.cerrarLote(); } catch (e) { err = e; }
  const quedo = [...store.cols.get('ordenes_compra').values()].some(o => o.notas === 'no debe quedar');
  ok(err && err.message === 'conflicto' && !quedo, 'si choca con otro usuario no guarda nada y recarga los datos');
  ok(DB[ARCH.inv].data.movimientos[0].referencia === 'otro usuario', 'tras recargar, la app muestra lo que guardó el otro usuario');

  console.log(fallas ? `\n${fallas} prueba(s) fallaron.` : '\nTodo correcto.');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('FALLA:', e); process.exit(1); });
