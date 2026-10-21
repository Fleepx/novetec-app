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

  console.log(fallas ? `\n${fallas} prueba(s) fallaron.` : '\nTodo correcto.');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('FALLA:', e); process.exit(1); });
