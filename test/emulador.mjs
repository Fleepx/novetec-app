import fs from 'fs';
import path from 'path';
import {spawn, spawnSync} from 'child_process';
import {fileURLToPath} from 'url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATOS = path.resolve(process.argv[2] || path.join(APP, '..', 'novetec-datos'));
const FBSYNC = path.join(APP, '..', 'novetec-datos', 'migracion', 'fbsync.mjs');
const PROYECTO = 'demo-novetec';
const TMP = path.join(APP, '_tmpdata', 'emulador');
const USUARIOS = JSON.parse(fs.readFileSync(path.join(APP, 'test', 'emulador-usuarios.json'), 'utf8'));

function java() {
  const raices = ['C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Java', 'C:/Program Files/Microsoft'];
  const jdks = raices.filter(r => fs.existsSync(r)).flatMap(r => fs.readdirSync(r).map(d => path.join(r, d)))
    .filter(d => fs.existsSync(path.join(d, 'bin', 'java.exe')))
    .map(d => ({d, v: +((/(?:jdk-?)(\d+)/i.exec(path.basename(d)) || [])[1] || 0)}))
    .filter(x => x.v >= 11).sort((a, b) => b.v - a.v);
  if (!jdks.length) throw new Error('No hay un JDK 11 o superior instalado. Instala Eclipse Temurin 21.');
  return jdks[0];
}

const entorno = {...process.env};
delete entorno.GOOGLE_APPLICATION_CREDENTIALS;
const jdk = java();
entorno.JAVA_HOME = jdk.d;
entorno.PATH = path.join(jdk.d, 'bin') + path.delimiter + entorno.PATH;
console.log(`Java ${jdk.v} (${jdk.d})`);

fs.rmSync(TMP, {recursive: true, force: true});
fs.mkdirSync(path.join(TMP, 'data'), {recursive: true});
for (const f of fs.readdirSync(path.join(DATOS, 'data')).filter(f => f.endsWith('.json') && !f.startsWith('.')))
  fs.copyFileSync(path.join(DATOS, 'data', f), path.join(TMP, 'data', f));
fs.symlinkSync(path.join(DATOS, 'documentos'), path.join(TMP, 'documentos'), 'junction');

const emu = spawn('firebase.cmd', ['emulators:start', '--only', 'auth,firestore', '--project', PROYECTO],
  {cwd: APP, env: entorno, shell: true, stdio: ['ignore', 'pipe', 'pipe']});
emu.stdout.on('data', d => process.stdout.write(d));
emu.stderr.on('data', d => process.stderr.write(d));
const cerrar = () => { try { spawnSync('taskkill', ['/pid', String(emu.pid), '/T', '/F']); } catch (_) {} process.exit(0); };
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);

const listo = async () => {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch('http://127.0.0.1:8080/'); if (r.ok || r.status) return true; } catch (_) {}
    try { await fetch('http://127.0.0.1:9099/'); } catch (_) {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
};
if (!await listo()) { console.error('El emulador no arrancó.'); cerrar(); }

const sync = (...a) => {
  const r = spawnSync(process.execPath, [FBSYNC, ...a], {cwd: path.dirname(FBSYNC), stdio: 'inherit',
    env: {...entorno, FIREBASE_PROJECT: PROYECTO, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}});
  if (r.status) { console.error('Falló: fbsync ' + a.join(' ')); cerrar(); }
};
sync('importar', path.join(TMP, 'data'), 'Carga local para pruebas', '--documentos', '--ejecutar');
for (const u of USUARIOS) {
  sync('usuario', u.correo, u.rol, u.nombre);
  const token = JSON.stringify({sub: 'prueba-' + u.rol, email: u.correo, email_verified: true, name: u.nombre});
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({postBody: 'providerId=google.com&id_token=' + encodeURIComponent(token), requestUri: 'http://localhost', returnSecureToken: true})
  });
  if (!r.ok) console.error(`No se pudo crear la cuenta ${u.correo} en el emulador: ${await r.text()}`);
}

console.log(`\nEmulador listo con los datos de ${DATOS}.`);
console.log('App: http://localhost:4180/?emulador');
console.log('Usuarios: ' + USUARIOS.map(u => `${u.correo} (${u.rol})`).join(' · '));
