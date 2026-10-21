(function(raiz){
const FB_ESQUEMA={
  'data/ordenes_compra.json':{ordenes:{col:'ordenes_compra',clave:'folio'}},
  'data/guias_despacho.json':{guias:{col:'guias_despacho',clave:'numero'}},
  'data/cotizaciones.json':{cotizaciones:{col:'cotizaciones',clave:'id'}},
  'data/inventario.json':{productos:{col:'inventario',clave:'codigo'},movimientos:{col:'movimientos'}},
  'data/productos.json':{productos:{col:'productos',clave:'codigo'}},
  'data/historial_precios.json':{cotizaciones:{col:'precios_cotizados'},observaciones:{col:'precios_observados'}},
  'data/archivos.json':{archivos:{col:'archivos'}},
  'data/adjudicaciones.json':{registros:{col:'adjudicaciones'}},
  'data/hojas_ruta.json':{hojas:{col:'hojas_ruta'}}
};
const FB_META='meta',FB_HIST='historial',FB_LOTE=400;
const INTERNOS=['_id','_o','_v','_json','_claves'];
const nombreMeta=p=>p.replace(/^data\//,'').replace(/\.json$/,'');

function canon(x){
  if(Array.isArray(x))return '['+x.map(canon).join(',')+']';
  if(x&&typeof x==='object')return '{'+Object.keys(x).filter(k=>x[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}';
  return JSON.stringify(x===undefined?null:x);
}
function incompatible(x,enLista){
  if(Array.isArray(x))return enLista||x.some(i=>incompatible(i,true));
  if(x&&typeof x==='object')return Object.keys(x).some(k=>!k||/^__.*__$/.test(k)||INTERNOS.includes(k))||Object.values(x).some(v=>incompatible(v,false));
  return false;
}
function codificar(obj){
  const limpio=JSON.parse(JSON.stringify(obj));
  return incompatible(limpio,false)?{_json:JSON.stringify(limpio)}:limpio;
}
function decodificar(doc){
  if(!doc)return null;
  if(typeof doc._json==='string')return JSON.parse(doc._json);
  const o={};
  Object.keys(doc).forEach(k=>{if(!INTERNOS.includes(k))o[k]=doc[k]});
  return o;
}
function fijarId(item,id){
  if(item&&typeof item==='object')Object.defineProperty(item,'_id',{value:id,enumerable:false,writable:true,configurable:true});
  return item;
}
const idSeguro=s=>{const t=String(s??'').trim().replace(/\//g,'_');return t&&t!=='.'&&t!=='..'&&!/^__.*__$/.test(t)?t:null};

function baseVacia(){return {meta:{v:null,j:null},cols:{}}}

async function fbCargar(store,p){
  const esq=FB_ESQUEMA[p]||{};
  const base=baseVacia();
  const mdoc=await store.leerDoc(FB_META,nombreMeta(p));
  const resto=mdoc?decodificar(mdoc):null;
  const claves=mdoc&&Array.isArray(mdoc._claves)?mdoc._claves:null;
  base.meta={v:mdoc?mdoc._v:null,j:resto?canon(resto):null};
  const listas={};let hay=!!mdoc;
  for(const lk of Object.keys(esq)){
    const col=esq[lk].col;
    const docs=await store.leerColeccion(col);
    if(docs.length)hay=true;
    docs.sort((a,b)=>(a.data._o??0)-(b.data._o??0)||(a.id<b.id?-1:a.id>b.id?1:0));
    base.cols[col]={};
    listas[lk]=docs.map(d=>{
      const item=decodificar(d.data);
      base.cols[col][d.id]={v:d.data._v??null,o:d.data._o??0,j:canon(item)};
      return fijarId(item,d.id);
    });
  }
  if(!hay)return {data:null,base};
  const data={};
  const orden=claves||[...Object.keys(resto||{}),...Object.keys(esq)];
  orden.forEach(k=>{if(k in listas)data[k]=listas[k];else if(resto&&k in resto)data[k]=resto[k]});
  Object.keys(resto||{}).forEach(k=>{if(!(k in data))data[k]=resto[k]});
  Object.keys(listas).forEach(k=>{if(!(k in data))data[k]=listas[k]});
  return {data,base};
}

function lisIndices(vals){
  const n=vals.length,cola=[],prev=new Array(n).fill(-1),pos=[];
  for(let i=0;i<n;i++){
    let lo=0,hi=cola.length;
    while(lo<hi){const m=(lo+hi)>>1;if(vals[cola[m]]<vals[i])lo=m+1;else hi=m}
    if(lo>0)prev[i]=cola[lo-1];
    cola[lo]=i;pos[lo]=i;
  }
  const r=new Set();let k=cola.length?cola[cola.length-1]:-1;
  while(k>=0){r.add(k);k=prev[k]}
  return r;
}
function asignarOrden(filas,baseCol){
  const conBase=filas.map((f,i)=>({i,o:baseCol[f.id]&&!f.nuevo?baseCol[f.id].o:null})).filter(x=>x.o!==null);
  const lis=lisIndices(conBase.map(x=>x.o));
  const fijo=new Map();conBase.forEach((x,k)=>{if(lis.has(k))fijo.set(x.i,x.o)});
  let i=0;
  while(i<filas.length){
    if(fijo.has(i)){filas[i].o=fijo.get(i);i++;continue}
    let j=i;while(j<filas.length&&!fijo.has(j))j++;
    const lo=i>0?filas[i-1].o:null,hi=j<filas.length?fijo.get(j):null,n=j-i;
    for(let k=1;k<=n;k++){
      filas[i+k-1].o=lo===null&&hi===null?k:lo===null?hi-(n+1-k):hi===null?lo+k:lo+(hi-lo)*k/(n+1);
    }
    i=j;
  }
}
function fbPlan(p,data,base,nuevoId){
  const esq=FB_ESQUEMA[p]||{};
  const ops=[];
  const resto={};
  Object.keys(data||{}).forEach(k=>{if(!(k in esq))resto[k]=data[k]});
  const jm=canon(resto);
  const claves=Object.keys(data||{});
  if(jm!==base.meta.j||base.meta.v===null){
    const doc=codificar(resto);doc._claves=claves;
    ops.push({col:FB_META,id:nombreMeta(p),doc,v:base.meta.v,j:jm});
  }
  for(const lk of Object.keys(esq)){
    const {col,clave}=esq[lk];
    const baseCol=base.cols[col]||{};
    const items=Array.isArray(data[lk])?data[lk]:[];
    const usados=new Set();
    const filas=items.map(it=>{
      const id=it&&it._id;
      if(id&&!usados.has(id)&&baseCol[id]){usados.add(id);return {it,id,nuevo:false}}
      return {it,id:null,nuevo:true};
    });
    filas.filter(f=>f.nuevo).forEach(f=>{
      const pref=clave?idSeguro(f.it&&f.it[clave]):null;
      let id=null;
      if(pref&&!usados.has(pref)&&!filas.some(g=>!g.nuevo&&g.id===pref))id=pref;
      if(!id){do{id=nuevoId()}while(usados.has(id)||baseCol[id])}
      usados.add(id);f.id=id;f.nuevo=!baseCol[id];
      fijarId(f.it,id);
    });
    asignarOrden(filas,baseCol);
    filas.forEach(f=>{
      const j=canon(f.it);const b=baseCol[f.id];
      if(!b||b.j!==j||b.o!==f.o){
        const doc=codificar(f.it);doc._id=f.id;doc._o=f.o;
        ops.push({col,id:f.id,doc,v:b?b.v:null,j,o:f.o});
      }
    });
    Object.keys(baseCol).forEach(id=>{if(!usados.has(id))ops.push({col,id,doc:null,v:baseCol[id].v})});
  }
  return ops;
}
function errorConflicto(det){const e=new Error('conflicto');e.status=409;e.detalle=det;return e}
async function fbGuardar(store,p,data,base,info){
  const ops=fbPlan(p,data,base,()=>store.nuevoId());
  if(!ops.length)return 0;
  for(let a=0;a<ops.length;a+=FB_LOTE){
    const lote=ops.slice(a,a+FB_LOTE);
    await store.transaccion(async tx=>{
      const actuales=await Promise.all(lote.map(op=>tx.leer(op.col,op.id)));
      actuales.forEach((cur,k)=>{
        const v=cur?(cur._v??0):null;
        if(v!==lote[k].v)throw errorConflicto(`${lote[k].col}/${lote[k].id}`);
      });
      lote.forEach(op=>{
        if(op.doc)tx.escribir(op.col,op.id,{...op.doc,_v:(op.v??0)+1});
        else tx.borrar(op.col,op.id);
      });
      if(a===0)tx.escribir(FB_HIST,store.nuevoId(),{fecha:new Date().toISOString(),usuario:(info&&info.usuario)||null,
        archivo:p,mensaje:(info&&info.mensaje)||'',cambios:ops.length});
    });
    lote.forEach(op=>{
      if(op.col===FB_META){base.meta={v:(op.v??0)+1,j:op.j};return}
      const bc=base.cols[op.col]=base.cols[op.col]||{};
      if(op.doc)bc[op.id]={v:(op.v??0)+1,o:op.o,j:op.j};else delete bc[op.id];
    });
  }
  return ops.length;
}
function asignarIdsPorContenido(itemsBase,items){
  const libres=new Map();
  itemsBase.forEach((b,i)=>{const j=canon(b);if(!libres.has(j))libres.set(j,[]);libres.get(j).push(i)});
  const tomado=new Array(itemsBase.length).fill(false);
  const sinPar=[];
  items.forEach((it,i)=>{
    const l=libres.get(canon(it));
    if(l&&l.length){const k=l.shift();tomado[k]=true;fijarId(it,itemsBase[k]._id)}else sinPar.push(i);
  });
  sinPar.forEach(i=>{if(i<itemsBase.length&&!tomado[i]){tomado[i]=true;fijarId(items[i],itemsBase[i]._id)}});
}

const api={FB_ESQUEMA,FB_META,FB_HIST,nombreMeta,canon,codificar,decodificar,fbCargar,fbPlan,fbGuardar,baseVacia,asignarIdsPorContenido,fijarId};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else Object.assign(raiz,api);
})(typeof window!=='undefined'?window:globalThis);
