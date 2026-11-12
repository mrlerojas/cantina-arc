// Conexión con Supabase: ingreso, sincronización y administración de usuarios.
// La app sigue guardando en el dispositivo (store.js); este módulo sube los cambios
// pendientes y baja los de otros dispositivos cuando hay conexión.
// Usa la API REST de Supabase directamente (sin librerías externas) para que la app
// siga cargando sin conexión.
import { SUPABASE, DEMO } from './config.js';
import * as S from './store.js';

export const enabled = !!(SUPABASE && SUPABASE.url && SUPABASE.key) && !DEMO;

const CKEY = 'navlog_cloud_v1';
// tokens: sesión de Supabase por usuario. acceso: comprobación de contraseña para entrar sin señal.
let st = cargar();

function cargar() {
  try {
    const s = JSON.parse(localStorage.getItem(CKEY));
    if (s && s.tokens && s.acceso) return s;
  } catch { /* estado nuevo */ }
  return { tokens: {}, acceso: {} };
}
const persistir = () => localStorage.setItem(CKEY, JSON.stringify(st));

const soloDigitos = v => String(v || '').replace(/\D/g, '');
const emailDe = tel => `${tel}@usuarios.cantina-arc.app`;

export class SinConexion extends Error {
  constructor() { super('Sin conexión a internet.'); }
}

async function http(path, { method = 'GET', token, body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(SUPABASE.url + path, {
      method,
      headers: {
        apikey: SUPABASE.key,
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw new SinConexion(); }
  const txt = await res.text();
  let data = null;
  if (txt) { try { data = JSON.parse(txt); } catch { data = txt; } }
  if (!res.ok) {
    const msg = (data && (data.error_description || data.msg || data.message || data.error)) || `Error ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Sesión de Supabase ----------
function guardarTokens(userId, d) {
  st.tokens[userId] = { access: d.access_token, refresh: d.refresh_token, exp: Math.floor(Date.now() / 1000) + (d.expires_in || 3600) };
  persistir();
}

const renovando = {};
async function tokenDe(userId) {
  const t = st.tokens[userId];
  if (!t) return null;
  if (t.exp - 90 > Date.now() / 1000) return t.access;
  renovando[userId] ||= (async () => {
    try {
      const d = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: t.refresh } });
      guardarTokens(userId, d);
      return d.access_token;
    } catch (e) {
      if (e instanceof SinConexion) throw e;
      delete st.tokens[userId]; persistir(); // la sesión venció: hay que ingresar de nuevo con conexión
      return null;
    } finally { delete renovando[userId]; }
  })();
  return renovando[userId];
}

// ---------- Contraseña para entrar sin señal (nunca se guarda en claro) ----------
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function derivar(pass, sal) {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deB64(sal), iterations: 150000 }, clave, 256);
  return b64(bits);
}
async function recordarAcceso(tel, pass, userId) {
  const sal = b64(crypto.getRandomValues(new Uint8Array(16)));
  st.acceso[tel] = { sal, huella: await derivar(pass, sal), userId };
  persistir();
}

// ---------- Perfiles (unidad y usuarios) ----------
async function traerPerfiles(userId, token) {
  token ||= await tokenDe(userId);
  if (!token) throw new Error('La sesión venció. Ingrese de nuevo con conexión.');
  const [usuarios, unidades, propietario] = await Promise.all([
    http('/rest/v1/usuarios?select=*&order=creado_en.asc', { token }),
    http('/rest/v1/unidades?select=*', { token }),
    http('/rest/v1/rpc/soy_propietario', { method: 'POST', token, body: {} }).catch(e => { if (e instanceof SinConexion) throw e; return false; }),
  ]);
  // La base solo devuelve la unidad propia, y nada si el usuario está inactivo.
  if (!unidades.length || !usuarios.some(u => u.id === userId)) {
    const u = S.db.usuarios.find(x => x.id === userId);
    if (u) { u.activo = false; S.save(); }
    throw new Error('Este usuario está inactivo. Consulte al administrador de la unidad.');
  }
  S.fijarPerfiles(unidades[0], usuarios);
  if (!!st.propietario?.[userId] !== !!propietario) { (st.propietario ||= {})[userId] = !!propietario; persistir(); }
}

// ¿Quien ingresó es el propietario del sistema? (ve el panel de licencias)
export const esPropietario = () => enabled && !!st.propietario?.[S.currentUser()?.id];

// Panel del propietario: accion = listar | crear_codigo | anular_codigo | actualizar
export const licencias = (accion, datos = {}) => funcion('licencias', { accion, ...datos });

// ---------- Ingreso ----------
// Devuelve el usuario, null si las credenciales no son válidas, o lanza un error con el motivo.
export async function ingresar(telefono, pass) {
  const tel = soloDigitos(telefono);
  if (!enabled) return S.login(tel, pass);
  let d;
  try {
    d = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: emailDe(tel), password: String(pass) } });
  } catch (e) {
    if (e instanceof SinConexion) return ingresarSinConexion(tel, pass);
    if (e.status === 400 || e.status === 401) return S.login(tel, pass); // unidad guardada solo en este dispositivo
    throw e;
  }
  const uid = d.user.id;
  guardarTokens(uid, d);
  try { await traerPerfiles(uid, d.access_token); }
  catch (e) { delete st.tokens[uid]; persistir(); throw e; }
  const u = S.db.usuarios.find(x => x.id === uid);
  S.setSessionUser(u);
  await recordarAcceso(tel, String(pass), uid);
  await sincronizar();
  S.audit('Inicio de sesión', 'usuarios', u.id, u.nombre);
  return u;
}

async function ingresarSinConexion(tel, pass) {
  const a = st.acceso[tel];
  if (!a) {
    const local = S.login(tel, pass);
    if (local) return local;
    throw new Error('Sin conexión. Para entrar sin señal, el usuario debe haber ingresado antes en este dispositivo.');
  }
  if (await derivar(String(pass), a.sal) !== a.huella) return null;
  const u = S.db.usuarios.find(x => x.id === a.userId && x.activo !== false);
  if (!u) return null;
  S.setSessionUser(u);
  S.audit('Inicio de sesión (sin conexión)', 'usuarios', u.id, u.nombre);
  return u;
}

// ---------- Sincronización ----------
// fase: local | ok | sincronizando | sin-conexion | sin-sesion | rechazos | error
export const estado = { fase: 'local', pendientes: 0, detalle: '', ultima: null };
const avisar = () => window.dispatchEvent(new CustomEvent('navlog:sync'));
let enCurso = null;
let guardandoInterno = false;

export function sincronizar() {
  if (!enabled) return Promise.resolve();
  enCurso ||= correr().finally(() => { enCurso = null; avisar(); });
  return enCurso;
}

async function correr() {
  const u = S.currentUser();
  if (!u) return;
  const un = u.unidad_id;
  if (!S.esUnidadNube()) { estado.fase = 'local'; estado.pendientes = 0; return; }
  let token;
  try { token = await tokenDe(u.id); }
  catch { estado.fase = 'sin-conexion'; estado.pendientes = S.numPendientes(un); return; }
  if (!token) { estado.fase = 'sin-sesion'; estado.pendientes = S.numPendientes(un); return; }

  estado.fase = 'sincronizando'; avisar();
  const rechazos = [];
  let cambios = 0;
  try {
    // Perfiles: usuarios, módulos y licencia de la unidad. Si cambian, se redibuja la pantalla.
    const huella = () => JSON.stringify([S.currentUnit(), S.db.usuarios.filter(x => x.unidad_id === un), esPropietario()]);
    const antes = huella();
    guardandoInterno = true; // guardar los perfiles no debe programar otra sincronización
    try { await traerPerfiles(u.id, token); } finally { guardandoInterno = false; }
    if (huella() !== antes) cambios++;

    // 1. Subir los cambios hechos en este dispositivo
    for (const { tabla, filas } of S.pendientes(un)) {
      for (let i = 0; i < filas.length; i += 200) {
        const lote = filas.slice(i, i + 200);
        const enviadas = lote.map(r => ({ id: r.id, json: JSON.stringify(r) }));
        try {
          await subirLote(tabla, lote, token);
          S.marcarEnviadas(tabla, enviadas);
        } catch (e) {
          if (e instanceof SinConexion) throw e;
          rechazos.push(`${tabla}: ${e.message}`);
        }
      }
    }

    // 2. Bajar lo que cambió en otros dispositivos desde la última vez
    // (todas las tablas a la vez: una sincronización tarda lo que la tabla más lenta)
    await Promise.all(S.SYNC_TABLES.map(async tabla => {
      const desde = S.cursorDe(un, tabla);
      // Margen de 5 s: un cambio confirmado justo durante la descarga anterior no se pierde.
      const filtro = desde ? `&updated_at=gt.${encodeURIComponent(new Date(new Date(desde).getTime() - 5000).toISOString())}` : '';
      let max = desde;
      for (let offset = 0; ; offset += 1000) {
        const filas = await http(
          `/rest/v1/${tabla}?select=data,updated_at&unidad_id=eq.${encodeURIComponent(un)}${filtro}&order=updated_at.asc,id.asc&limit=1000&offset=${offset}`,
          { token });
        cambios += S.aplicarRemotas(tabla, filas.map(f => f.data));
        if (filas.length) {
          const ultima = filas[filas.length - 1].updated_at;
          if (!max || new Date(ultima) > new Date(max)) max = ultima;
        }
        if (filas.length < 1000) break;
      }
      if (max && max !== desde) S.fijarCursor(un, tabla, max);
    }));

    guardandoInterno = true;
    try { S.save(); } finally { guardandoInterno = false; }
    estado.fase = rechazos.length ? 'rechazos' : 'ok';
    estado.detalle = rechazos[0] || '';
    estado.ultima = Date.now();
  } catch (e) {
    estado.fase = e instanceof SinConexion ? 'sin-conexion' : 'error';
    estado.detalle = e.message;
    // Si el administrador desactivó a este usuario, se vuelve a la pantalla de ingreso.
    if (!S.currentUser()) { window.dispatchEvent(new CustomEvent('navlog:datos')); return; }
  }
  estado.pendientes = S.numPendientes(un);
  if (cambios) window.dispatchEvent(new CustomEvent('navlog:datos'));
}

// Sube un lote de registros. La auditoría solo se inserta (nunca se modifica) y quien la escribe
// puede no tener permiso para leerla, así que no se usa "insertar o actualizar": si un registro
// ya estaba arriba (reintento), se toma como subido.
async function subirLote(tabla, lote, token) {
  const cuerpo = filas => filas.map(r => ({ id: r.id, unidad_id: r.unidad_id, data: r }));
  if (tabla !== 'auditoria') {
    return http(`/rest/v1/${tabla}?on_conflict=id`, {
      method: 'POST', token, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: cuerpo(lote),
    });
  }
  try {
    await http('/rest/v1/auditoria', { method: 'POST', token, headers: { Prefer: 'return=minimal' }, body: cuerpo(lote) });
  } catch (e) {
    if (e.status !== 409) throw e;
    for (const r of lote) {
      try { await http('/rest/v1/auditoria', { method: 'POST', token, headers: { Prefer: 'return=minimal' }, body: cuerpo([r]) }); }
      catch (e2) { if (e2.status !== 409) throw e2; }
    }
  }
}

let temporizador = null;
function programar() {
  if (guardandoInterno || !S.currentUser()) return;
  const u = S.currentUser();
  estado.pendientes = S.numPendientes(u.unidad_id);
  avisar();
  if (!estado.pendientes) return; // nada nuevo que subir: no se programa otra sincronización
  clearTimeout(temporizador);
  temporizador = setTimeout(sincronizar, 1500);
}

// Se llama una vez al arrancar la app.
export function iniciar() {
  if (!enabled) return;
  S.activarSeguimiento();
  S.alGuardar(programar);
  window.addEventListener('online', sincronizar);
  window.addEventListener('offline', () => { estado.fase = 'sin-conexion'; avisar(); });
  // Al volver a la app se sincroniza, pero no más de una vez cada 15 s.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - (estado.ultima || 0) > 15000) sincronizar();
  });
  setInterval(sincronizar, 45000);
  if (S.currentUser()) sincronizar();
}

// ---------- Administración (requiere conexión) ----------
async function funcion(nombre, body, conSesion = true) {
  let token = null;
  if (conSesion) {
    token = await tokenDe(S.currentUser().id);
    if (!token) throw new Error('La sesión venció. Ingrese de nuevo con conexión.');
  }
  try { return await http('/functions/v1/' + nombre, { method: 'POST', token, body }); }
  catch (e) {
    if (e instanceof SinConexion) throw new Error('Esta acción necesita conexión a internet.');
    throw e;
  }
}

export async function guardarUsuarioNube(id, data) {
  const r = await funcion('usuarios', { accion: 'guardar', id, ...data });
  await traerPerfiles(S.currentUser().id);
  S.audit(id ? 'Usuario modificado' : 'Usuario creado', 'usuarios', r.usuario.id, `${r.usuario.nombre}: ${r.usuario.roles.join(', ')}`);
  return r.usuario;
}

export async function cambiarEstadoUsuarioNube(id) {
  const r = await funcion('usuarios', { accion: 'estado', id });
  await traerPerfiles(S.currentUser().id);
  S.audit(r.usuario.activo ? 'Usuario activado' : 'Usuario desactivado', 'usuarios', r.usuario.id, r.usuario.nombre);
  return r.usuario;
}

export async function guardarUnidadNube({ nombre, modulos }) {
  const u = S.currentUser();
  const n = String(nombre || '').trim();
  if (!n) throw new Error('Indique el nombre de la unidad.');
  const token = await tokenDe(u.id).catch(() => null);
  if (!token) throw new Error('Esta acción necesita conexión a internet.');
  let filas;
  try {
    filas = await http(`/rest/v1/unidades?id=eq.${encodeURIComponent(u.unidad_id)}`, {
      method: 'PATCH', token, headers: { Prefer: 'return=representation' },
      body: { nombre: n, modulos: { cantina: !!modulos?.cantina, coal: !!modulos?.coal } },
    });
  } catch (e) {
    if (e instanceof SinConexion) throw new Error('Esta acción necesita conexión a internet.');
    throw e;
  }
  if (!filas.length) throw new Error('Solo el administrador de la unidad puede realizar esta acción.');
  await traerPerfiles(u.id, token);
  const un = filas[0];
  S.audit('Configuración de unidad', 'unidades', un.id, `${un.nombre} — CANTINA ${un.modulos.cantina ? 'ON' : 'OFF'}, COAL ${un.modulos.coal ? 'ON' : 'OFF'}`);
  return un;
}

// Crea una unidad nueva con su administrador (exige el código de registro) y entra con él.
export async function registrarUnidadNube({ codigo, unidad, grado, nombre, telefono, password, modulos }) {
  await funcion('registro', { codigo, unidad, grado, nombre, telefono: soloDigitos(telefono), password, modulos }, false);
  return ingresar(telefono, password);
}

// ---------- Lectura de facturas con IA (requiere conexión) ----------
// Envía la foto a la Edge Function "factura". Devuelve { factura, usados, tope, dias }.
export const leerFactura = datos => funcion('factura', datos);

// Cuántas lecturas lleva la unidad en el periodo: { usados, tope, dias } o null si no se pudo consultar.
export async function cupoFacturas() {
  const u = S.currentUser();
  if (!enabled || !u || !S.esUnidadNube()) return null;
  try {
    const token = await tokenDe(u.id);
    if (!token) return null;
    return await http('/rest/v1/rpc/facturas_cupo', { method: 'POST', token, body: {} });
  } catch { return null; }
}
