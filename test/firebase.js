const fs = require('fs');
const path = require('path');
const fb = require('../lib/fbdatos.js');

const DATOS = process.argv[2] || path.join(__dirname, '..', '..', 'novetec-datos', 'data');

function memoria() {
  const cols = new Map();
  let seq = 0, escrituras = 0;
  const col = c => { if (!cols.has(c)) cols.set(c, new Map()); return cols.get(c); };
  const copia = x => x == null ? null : JSON.parse(JSON.stringify(x));
  return {
    cols, get escrituras() { return escrituras; },
    nuevoId: () => 'id' + String(++seq).padStart(6, '0'),
    async leerDoc(c, id) { return copia(col(c).get(id)); },
    async leerColeccion(c) { return [...col(c)].map(([id, data]) => ({ id, data: copia(data) })); },
    async transaccion(fn) {
      const pend = [];
      await fn({
        leer: async (c, id) => copia(col(c).get(id)),
        escribir: (c, id, d) => pend.push([c, id, copia(d)]),
        borrar: (c, id) => pend.push([c, id, null])
      });
      pend.forEach(([c, id, d]) => { escrituras++; if (d) col(c).set(id, d); else col(c).delete(id); });
    }
  };
}

let fallas = 0;
const ok = (cond, msg) => { console.log((cond ? '  OK    ' : '  FALLA ') + msg); if (!cond) fallas++; };

(async () => {
  const archivos = fs.readdirSync(DATOS).filter(f => f.endsWith('.json'));
  const store = memoria();
  const original = {};
  for (const f of archivos) {
    const p = 'data/' + f;
    original[p] = JSON.parse(fs.readFileSync(path.join(DATOS, f), 'utf8'));
    await fb.fbGuardar(store, p, JSON.parse(JSON.stringify(original[p])), fb.baseVacia(), { usuario: 'prueba', mensaje: 'migración' });
  }
  const docs = [...store.cols].reduce((s, [c, m]) => s + (c === fb.FB_HIST ? 0 : m.size), 0);
  console.log(`Migrados ${archivos.length} archivos a ${docs} documentos`);

  for (const p in original) {
    const { data } = await fb.fbCargar(store, p);
    const exacto = JSON.stringify(data, null, 2) === JSON.stringify(original[p], null, 2);
    ok(exacto || fb.canon(data) === fb.canon(original[p]), `${p} vuelve igual${exacto ? ' (mismo orden de campos)' : ' (mismo contenido, otro orden de campos)'}`);
  }

  const P = 'data/ordenes_compra.json';
  const a = await fb.fbCargar(store, P), b = await fb.fbCargar(store, P);
  const n0 = store.escrituras;
  ok(await fb.fbGuardar(store, P, a.data, a.base, {}) === 0, 'guardar sin cambios no escribe nada');
  a.data.ordenes[0].notas = 'cambio A';
  const nA = await fb.fbGuardar(store, P, a.data, a.base, {});
  ok(nA === 1 && store.escrituras - n0 === 2, 'un cambio en una OC escribe solo ese documento (+ historial)');
  b.data.ordenes[1].notas = 'cambio B';
  let err = null; try { await fb.fbGuardar(store, P, b.data, b.base, {}); } catch (e) { err = e; }
  ok(!err, 'dos usuarios editando OC distintas no chocan');
  b.data.ordenes[0].notas = 'pisa A';
  err = null; try { await fb.fbGuardar(store, P, b.data, b.base, {}); } catch (e) { err = e; }
  ok(err && err.status === 409, 'editar la misma OC con datos viejos da conflicto (409) en vez de pisar');
  const c = await fb.fbCargar(store, P);
  ok(c.data.ordenes[0].notas === 'cambio A' && c.data.ordenes[1].notas === 'cambio B', 'el conflicto no pisó nada');

  const I = 'data/inventario.json';
  const inv = await fb.fbCargar(store, I);
  const nMov = inv.data.movimientos.length;
  inv.data.movimientos.push({ fecha: '2026-10-21', tipo: 'ingreso', codigo: 'NOV-0001', producto: 'X', cantidad: 1, referencia: 'prueba' });
  inv.data.movimientos.unshift({ fecha: '2020-01-01', tipo: 'ingreso', codigo: 'NOV-0001', producto: 'X', cantidad: 1, referencia: 'al inicio' });
  ok(await fb.fbGuardar(store, I, inv.data, inv.base, {}) === 2, 'agregar movimientos al final y al inicio escribe solo esos 2');
  const inv2 = await fb.fbCargar(store, I);
  ok(inv2.data.movimientos.length === nMov + 2 && inv2.data.movimientos[0].referencia === 'al inicio'
    && inv2.data.movimientos[nMov + 1].referencia === 'prueba', 'el orden de la lista se conserva');
  inv2.data.movimientos.splice(1, 1);
  ok(await fb.fbGuardar(store, I, inv2.data, inv2.base, {}) === 1, 'borrar un movimiento borra solo ese documento');

  const G = 'data/guias_despacho.json';
  const g = await fb.fbCargar(store, G);
  g.data.guias[3] = { ...g.data.guias[3], notas: 'reemplazada' };
  ok(await fb.fbGuardar(store, G, g.data, g.base, {}) === 1, 'reemplazar el objeto de una guía actualiza el mismo documento (por número)');
  g.data.guias.sort((x, y) => String(y.numero).localeCompare(String(x.numero)));
  const nOrd = await fb.fbGuardar(store, G, g.data, g.base, {});
  const g2 = await fb.fbCargar(store, G);
  ok(g2.data.guias.map(x => x.numero).join() === g.data.guias.map(x => x.numero).join(), `reordenar la lista en el lugar se conserva (${nOrd} escrituras)`);

  const S = 'data/sinonimos.json';
  const s = await fb.fbCargar(store, S);
  ok(Array.isArray(s.data.grupos[0]), 'listas dentro de listas (sinónimos) sobreviven');

  const pr = await fb.fbCargar(store, 'data/productos.json');
  const copia = { ...pr.data.productos[0] };
  ok(copia._id === undefined && !JSON.stringify(pr.data).includes('"_id"'), 'el id interno no aparece en el JSON ni se copia con {...}');

  const base = (await fb.fbCargar(store, 'data/archivos.json')).data.archivos;
  const editado = JSON.parse(JSON.stringify(base));
  editado[5].estado = 'descartado';
  editado.push({ hash: 'nuevo', nombre: 'n.pdf' });
  fb.asignarIdsPorContenido(base, editado);
  const ar = await fb.fbCargar(store, 'data/archivos.json');
  ar.data.archivos = editado;
  ok(await fb.fbGuardar(store, 'data/archivos.json', ar.data, ar.base, {}) === 2, 'importar un JSON editado fuera de la app reconoce los registros sin id (1 cambio + 1 nuevo)');

  {
    console.log('\nGuardar varios archivos en una sola operación:');
    const st = memoria();
    for (const f of archivos) await fb.fbGuardar(st, 'data/' + f, JSON.parse(JSON.stringify(original['data/' + f])), fb.baseVacia(), {});
    const O = await fb.fbCargar(st, 'data/ordenes_compra.json'), I = await fb.fbCargar(st, 'data/inventario.json'), Gd = await fb.fbCargar(st, 'data/guias_despacho.json');
    O.data.ordenes[0].notas = 'lote'; I.data.movimientos.push({ fecha: '2026-10-22', tipo: 'salida', codigo: 'NOV-0001', producto: 'X', cantidad: 1, referencia: 'lote' }); Gd.data.guias[0].notas = 'lote';
    const n = await fb.fbGuardarVarios(st, [{ p: 'data/ordenes_compra.json', ...O }, { p: 'data/inventario.json', ...I }, { p: 'data/guias_despacho.json', ...Gd }], { usuario: 'prueba', mensaje: 'tres archivos' });
    const hist = (await st.leerColeccion(fb.FB_HIST)).filter(h => h.data.mensaje === 'tres archivos');
    ok(n === 3 && hist.length === 1, `tres archivos, ${n} registros, un solo registro en el historial`);
    const O2 = await fb.fbCargar(st, 'data/ordenes_compra.json'), I2 = await fb.fbCargar(st, 'data/inventario.json');
    const otro = await fb.fbCargar(st, 'data/inventario.json'); otro.data.movimientos[0].referencia = 'cambio del otro usuario';
    await fb.fbGuardar(st, 'data/inventario.json', otro.data, otro.base, {});
    O2.data.ordenes[1].notas = 'no debe quedar'; I2.data.movimientos[0].referencia = 'choca';
    let err = null; try { await fb.fbGuardarVarios(st, [{ p: 'data/ordenes_compra.json', ...O2 }, { p: 'data/inventario.json', ...I2 }], {}); } catch (e) { err = e; }
    const O3 = await fb.fbCargar(st, 'data/ordenes_compra.json');
    ok(err && err.status === 409 && O3.data.ordenes[1].notas !== 'no debe quedar', 'si un archivo choca con otro usuario, no se guarda ninguno (antes quedaba la OC guardada sin el inventario)');
  }
  console.log('\nSincronización incremental (dos navegadores):');
  {
    const viejo = memoria(); for (const f of archivos) await fb.fbGuardar(viejo, 'data/' + f, JSON.parse(JSON.stringify(original['data/' + f])), fb.baseVacia(), {});
    let n = 0; const cli = { serial: t => typeof t === 'number' ? String(t).padStart(12, '0') : null,
      async cacheColeccion(c) { return viejo.leerColeccion(c); },
      async servidorColeccion(c) { const r = await viejo.leerColeccion(c); n += r.length; return r; },
      async servidorDesde(c, serial) { n++; return (await viejo.leerColeccion(c)).filter(d => typeof d.data._t === 'number' && String(d.data._t).padStart(12, '0') > (serial || '')); },
      async servidorDoc(c, id) { n++; return viejo.leerDoc(c, id); } };
    const e1 = await fb.fbSincronizar(cli, null, fb.FB_COLECCIONES); const tras1 = n;
    await fb.fbSincronizar(cli, e1.estado, fb.FB_COLECCIONES);
    ok(n - tras1 <= fb.FB_COLECCIONES.length + 1, `datos sin hora anotada (anteriores al cambio): la segunda apertura ya es incremental (${n - tras1} lecturas)`);
  }
  const servidor = memoria();
  let reloj = 1000;
  const AHORA = { ahora: true };
  const conMarca = d => d && d._t === AHORA ? { ...d, _t: ++reloj } : d;
  const tx0 = servidor.transaccion;
  servidor.ahora = () => AHORA;
  servidor.transaccion = fn => tx0(t => fn({ ...t, escribir: (c, id, d) => t.escribir(c, id, conMarca(d)) }));
  const cliente = () => {
    const cache = new Map(); let leidas = 0;
    const guardar = (c, id, d) => { if (!cache.has(c)) cache.set(c, new Map()); d ? cache.get(c).set(id, d) : cache.get(c).delete(id); };
    return {
      get leidas() { return leidas; }, cache,
      serial: t => typeof t === 'number' ? String(t).padStart(12, '0') : null,
      async cacheColeccion(c) { return [...(cache.get(c) || new Map())].map(([id, data]) => ({ id, data })); },
      async servidorColeccion(c) { const r = await servidor.leerColeccion(c); leidas += Math.max(1, r.length); r.forEach(d => guardar(c, d.id, d.data)); return r; },
      async servidorDesde(c, serial) { const r = (await servidor.leerColeccion(c)).filter(d => typeof d.data._t === 'number' && String(d.data._t).padStart(12, '0') > serial); leidas += Math.max(1, r.length); r.forEach(d => guardar(c, d.id, d.data)); return r; },
      async servidorDoc(c, id) { leidas++; const d = await servidor.leerDoc(c, id); guardar(c, id, d); return d; }
    };
  };
  for (const f of archivos) await fb.fbGuardar(servidor, 'data/' + f, JSON.parse(JSON.stringify(original['data/' + f])), fb.baseVacia(), {});
  const A = cliente();
  const s1 = await fb.fbSincronizar(A, null, fb.FB_COLECCIONES);
  ok(s1.completas === fb.FB_COLECCIONES.length && A.leidas > 1500, `primera apertura lee todo (${A.leidas} lecturas)`);
  let antes = A.leidas; const s2 = await fb.fbSincronizar(A, s1.estado, fb.FB_COLECCIONES);
  ok(A.leidas - antes <= fb.FB_COLECCIONES.length + 1 && s2.completas === 0, `reabrir sin cambios: ${A.leidas - antes} lecturas`);
  const ocB = await fb.fbCargar(servidor, 'data/ordenes_compra.json'); ocB.data.ordenes[2].notas = 'cambio desde B';
  await fb.fbGuardar(servidor, 'data/ordenes_compra.json', ocB.data, ocB.base, {});
  const mv = await fb.fbCargar(servidor, 'data/inventario.json'); const borrado = mv.data.movimientos[5]._id; mv.data.movimientos.splice(5, 1);
  await fb.fbGuardar(servidor, 'data/inventario.json', mv.data, mv.base, {});
  antes = A.leidas; const s3 = await fb.fbSincronizar(A, s2.estado, fb.FB_COLECCIONES);
  const ocs = [...s3.mapa.ordenes_compra.values()];
  ok(ocs.some(o => o.notas === 'cambio desde B') && !s3.mapa.movimientos.has(borrado), `ve el cambio y el borrado hechos en el otro navegador (${A.leidas - antes} lecturas)`);
  ok(s3.mapa.movimientos.size === (await servidor.leerColeccion('movimientos')).length, 'la colección queda igual que en el servidor');
  A.cache.get('ordenes_compra').clear();
  antes = A.leidas; const s4 = await fb.fbSincronizar(A, s3.estado, fb.FB_COLECCIONES);
  ok(s4.mapa.ordenes_compra.size === (await servidor.leerColeccion('ordenes_compra')).length && s4.completas === 1, `caché borrada de una colección: se relee completa y no se da por vacía (${A.leidas - antes} lecturas)`);
  console.log(fallas ? `\n${fallas} prueba(s) fallaron.` : '\nTodo correcto.');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('FALLA:', e); process.exit(1); });
