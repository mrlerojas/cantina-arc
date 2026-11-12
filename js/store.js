// Capa de datos del prototipo.
// Persiste en el dispositivo (localStorage). Todas las tablas llevan unidad_id y
// todas las consultas pasan por q(), que filtra por la unidad de la sesión:
// es el mismo contrato que aplicará Row Level Security en Supabase (ver /supabase).

const KEY = 'navlog_db_v1';
const SKEY = 'navlog_session_v1';

export const TABLES = [
  'unidades', 'usuarios', 'productos', 'precios', 'movimientos', 'proveedores',
  'compras', 'clientes', 'ventas', 'pagos', 'gastos', 'coal_tarifas', 'coal_dias',
  'recetas', 'menus', 'consumos', 'operacionales', 'auditoria', 'secuencias'
];

export const ROLES = {
  admin: 'Administrador / Comandante',
  supervisor: 'Supervisor / Segundo Comandante',
  cantina: 'Operador CANTINA',
  coal: 'Operador COAL',
};

const ROLE_PERMS = {
  admin: ['*'],
  supervisor: ['cantina.ver', 'coal.ver', 'balances', 'auditoria'],
  cantina: ['cantina.ver', 'cantina.operar'],
  coal: ['coal.ver', 'coal.operar'],
};

// Permisos adicionales asignables a cualquier usuario desde Administración.
export const EXTRA_PERMS = {
  balances: 'Ver balances y reportes',
  anular: 'Anular / corregir movimientos',
  auditoria: 'Consultar auditoría',
  ajustes: 'Ajustes de inventario',
};

export const MAX_ADICIONALES = 5;

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const nowISO = () => new Date().toISOString();

export function todayStr(d = new Date()) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  return todayStr(new Date(y, m - 1, d + n));
}

function emptyDB() {
  const db = {};
  TABLES.forEach(t => (db[t] = []));
  return db;
}

// ---------- Almacenamiento en el dispositivo ----------
// Los datos viven en memoria (db) y se guardan en IndexedDB, un registro por fila.
// IndexedDB admite cientos de MB (antes se usaba localStorage, limitado a unos 5 MB).
// En cada save() se compara cada fila con su última versión conocida ("sombra") y solo se
// escriben en disco las que cambiaron. Si el navegador no ofrece IndexedDB se sigue usando
// localStorage. Sesión, estado de sincronización y accesos siguen en localStorage (son pequeños).
const YKEY = 'navlog_sync_v1';
const IDB_NOMBRE = 'cantina';
const IDB_FILAS = 'filas';
export const SYNC_TABLES = TABLES.filter(t => t !== 'unidades' && t !== 'usuarios');
let seguimiento = false; // true cuando la app está conectada a la nube (cloud.js)
let sync = loadSync(); // { dirty: { tabla: { id: 1 } }, cursor: { unidadId: { tabla: fecha } } }
const sombra = {};
TABLES.forEach(t => { sombra[t] = new Map(); });
const alGuardarFns = [];
let idb = null;          // conexión a IndexedDB (null = se usa localStorage)
const cola = new Map();  // filas por escribir en disco: "tabla\u0000id" -> [tabla, id]
let escribiendo = null;  // promesa de la escritura en curso
let avisoLleno = false;

function loadSync() {
  try {
    const s = JSON.parse(localStorage.getItem(YKEY));
    if (s && s.dirty && s.cursor) return s;
  } catch { /* estado nuevo */ }
  return { dirty: {}, cursor: {} };
}

function loadLocalStorage() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      TABLES.forEach(t => (parsed[t] ||= []));
      return parsed;
    }
  } catch (e) { console.error('No se pudo leer la base local', e); }
  return null;
}

const pedido = req => new Promise((ok, mal) => { req.onsuccess = () => ok(req.result); req.onerror = () => mal(req.error); });

function abrirIDB() {
  return new Promise((ok, mal) => {
    if (!('indexedDB' in globalThis)) return mal(new Error('IndexedDB no disponible'));
    const req = indexedDB.open(IDB_NOMBRE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_FILAS);
    req.onsuccess = () => {
      // Si otra pestaña necesita actualizar o borrar el almacenamiento, esta suelta su conexión
      // y se recarga para volver a leer los datos.
      req.result.onversionchange = () => { req.result.close(); location.reload(); };
      ok(req.result);
    };
    req.onerror = () => mal(req.error);
    req.onblocked = () => mal(new Error('IndexedDB bloqueada'));
  });
}

async function cargar() {
  let base = null;
  try {
    idb = await abrirIDB();
    const st = idb.transaction(IDB_FILAS, 'readonly').objectStore(IDB_FILAS);
    const [claves, filas] = await Promise.all([pedido(st.getAllKeys()), pedido(st.getAll())]);
    if (claves.length) {
      base = emptyDB();
      claves.forEach(([t], i) => { if (base[t]) base[t].push(filas[i]); });
      TABLES.forEach(t => base[t].forEach(r => sombra[t].set(r.id, JSON.stringify(r))));
      localStorage.removeItem(KEY); // por si quedó una copia de la versión anterior
      return base;
    }
  } catch (e) {
    console.warn('Se usará el almacenamiento básico del navegador:', e);
    idb = null;
  }
  // Primera vez con IndexedDB: se migran los datos que hubiera en localStorage.
  base = loadLocalStorage();
  if (!base) return emptyDB();
  if (idb) {
    TABLES.forEach(t => base[t].forEach(r => { if (r && r.id) { sombra[t].set(r.id, JSON.stringify(r)); cola.set(t + '\u0000' + r.id, [t, r.id]); } }));
    db = base;
    try { await vaciarCola(); localStorage.removeItem(KEY); }
    catch (e) { console.error('No se pudo migrar a IndexedDB; se sigue con localStorage', e); idb = null; cola.clear(); }
  } else {
    TABLES.forEach(t => base[t].forEach(r => { if (r && r.id) sombra[t].set(r.id, JSON.stringify(r)); }));
  }
  return base;
}

// Escribe en IndexedDB las filas en cola (una sola transacción). Devuelve cuando quedó en disco.
function vaciarCola() {
  if (!idb || !cola.size) return Promise.resolve();
  const lote = [...cola.values()];
  cola.clear();
  const porTabla = {};
  return new Promise((ok, mal) => {
    const tx = idb.transaction(IDB_FILAS, 'readwrite');
    const st = tx.objectStore(IDB_FILAS);
    for (const [t, id] of lote) {
      porTabla[t] ||= new Map(db[t].map(r => [r.id, r]));
      const fila = porTabla[t].get(id);
      if (fila) st.put(fila, [t, id]); else st.delete([t, id]);
    }
    tx.oncomplete = () => ok();
    tx.onerror = tx.onabort = () => { lote.forEach(([t, id]) => cola.set(t + '\u0000' + id, [t, id])); mal(tx.error); };
  });
}

function escribir() {
  if (escribiendo || !cola.size) return;
  escribiendo = vaciarCola()
    .catch(e => {
      console.error('No se pudo guardar en el dispositivo', e);
      if (!avisoLleno) {
        avisoLleno = true;
        alert('No se pudo guardar en el dispositivo: puede estar lleno. Libere espacio y exporte un respaldo desde Administración → Respaldo.');
      }
    })
    .finally(() => { escribiendo = null; if (cola.size && !avisoLleno) escribir(); });
}

// Promesa que se cumple cuando todo lo guardado hasta ahora está en disco.
export async function guardadoEnDisco() {
  while (escribiendo || (idb && cola.size && !avisoLleno)) { escribir(); await escribiendo; }
}

export let db = emptyDB();
db = await cargar();
let session = loadSession();
// Pide al navegador no borrar estos datos si el dispositivo se queda sin espacio.
try { navigator.storage?.persist?.(); } catch { /* opcional */ }

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SKEY)) || null; } catch { return null; }
}

export function save() {
  rastrear();
  try {
    if (idb) escribir(); else localStorage.setItem(KEY, JSON.stringify(db));
    if (seguimiento) localStorage.setItem(YKEY, JSON.stringify(sync));
  } catch (e) {
    console.error(e);
    alert('No se pudo guardar: el almacenamiento del dispositivo está lleno. Reduzca fotografías o exporte un respaldo.');
  }
  alGuardarFns.forEach(fn => fn());
}

// Espacio usado en el dispositivo (para la pantalla de Respaldo).
export async function espacio() {
  const filas = TABLES.reduce((s, t) => s + db[t].length, 0);
  let usado = null, disponible = null;
  try { const e = await navigator.storage.estimate(); usado = e.usage ?? null; disponible = e.quota ?? null; } catch { /* no disponible */ }
  return { filas, usado, disponible, indexedDB: !!idb };
}

// ---------- Sincronización con la nube: cambios pendientes de subir ----------
// cloud.js sube los registros marcados como pendientes y baja los de otros dispositivos.
export function activarSeguimiento() { seguimiento = true; }

export function alGuardar(fn) { alGuardarFns.push(fn); }

// Compara cada fila con su sombra: las que cambiaron (o desaparecieron) van a la cola de disco
// y, si la app está conectada a la nube, quedan pendientes de subir.
function rastrear() {
  for (const t of TABLES) {
    const m = sombra[t];
    const subir = seguimiento && t !== 'unidades' && t !== 'usuarios';
    let vistas = 0;
    for (const r of db[t]) {
      if (!r || !r.id) continue;
      vistas++;
      const s = JSON.stringify(r);
      if (m.get(r.id) !== s) {
        m.set(r.id, s);
        cola.set(t + '\u0000' + r.id, [t, r.id]);
        if (subir) (sync.dirty[t] ||= {})[r.id] = 1;
      }
    }
    if (m.size > vistas) { // se quitaron filas (restaurar respaldo, cambio de perfiles)
      const ids = new Set(db[t].map(r => r && r.id));
      for (const id of [...m.keys()]) if (!ids.has(id)) { m.delete(id); cola.set(t + '\u0000' + id, [t, id]); }
    }
  }
}

// Registros de la unidad pendientes de subir, por tabla.
export function pendientes(un) {
  return SYNC_TABLES
    .map(t => ({ tabla: t, filas: db[t].filter(r => r.unidad_id === un && sync.dirty[t]?.[r.id]) }))
    .filter(x => x.filas.length);
}
export function numPendientes(un) {
  return pendientes(un).reduce((s, x) => s + x.filas.length, 0);
}
// Tras subir: deja de estar pendiente solo si el registro no cambió mientras se enviaba.
export function marcarEnviadas(tabla, enviadas) {
  enviadas.forEach(({ id, json }) => {
    if (sombra[tabla].get(id) === json && sync.dirty[tabla]) delete sync.dirty[tabla][id];
  });
}
export const cursorDe = (un, tabla) => sync.cursor[un]?.[tabla] || null;
export function fijarCursor(un, tabla, fecha) { (sync.cursor[un] ||= {})[tabla] = fecha; }

// Comparación que ignora el orden de las claves (la base de datos las reordena).
const canon = v => JSON.stringify(v, (_k, x) =>
  (x && typeof x === 'object' && !Array.isArray(x))
    ? Object.keys(x).sort().reduce((o, k) => { o[k] = x[k]; return o; }, {})
    : x);

// Aplica registros bajados de la nube. Devuelve cuántos cambiaron algo aquí.
// Un registro con cambios locales pendientes no se pisa: la versión local se subirá después.
export function aplicarRemotas(tabla, filas) {
  let cambios = 0;
  const pos = new Map(db[tabla].map((r, i) => [r.id, i]));
  for (const r of filas) {
    if (!r || !r.id) continue;
    if (sync.dirty[tabla]?.[r.id]) continue;
    const i = pos.get(r.id);
    const local = i === undefined ? null : db[tabla][i];
    if (local && canon(local) === canon(r)) continue;
    // Un consecutivo nunca retrocede: si aquí va más adelante, se conserva y se vuelve a subir.
    if (tabla === 'secuencias' && local && (local.valor || 0) > (r.valor || 0)) {
      (sync.dirty[tabla] ||= {})[r.id] = 1;
      continue;
    }
    if (local) db[tabla][i] = r; else { db[tabla].push(r); pos.set(r.id, db[tabla].length - 1); }
    sombra[tabla].set(r.id, JSON.stringify(r));
    cola.set(tabla + '\u0000' + r.id, [tabla, r.id]); // también va a disco
    cambios++;
  }
  return cambios;
}

// Perfiles de la nube: la unidad y sus usuarios (sin contraseñas; las guarda Supabase).
export function fijarPerfiles(unidad, usuarios) {
  const u = {
    id: unidad.id, unidad_id: unidad.id, nombre: unidad.nombre, modulos: unidad.modulos, creado_en: unidad.creado_en, nube: true,
    licencia: { modulos: unidad.licencia_modulos || { cantina: true, coal: true }, vence: unidad.licencia_vence || null, estado: unidad.licencia_estado || 'activa' },
  };
  const i = db.unidades.findIndex(x => x.id === unidad.id);
  if (i < 0) db.unidades.push(u); else db.unidades[i] = u;
  db.usuarios = db.usuarios.filter(x => x.unidad_id !== unidad.id).concat(usuarios.map(x => ({
    id: x.id, unidad_id: x.unidad_id, grado: x.grado, nombre: x.nombre, telefono: x.telefono,
    roles: x.roles, permisos: x.permisos, activo: x.activo, creado_en: x.creado_en,
  })));
  save();
}
export const esUnidadNube = () => !!currentUnit()?.nube;

export function isEmpty() { return db.unidades.length === 0; }

export function replaceDB(next) {
  TABLES.forEach(t => (next[t] ||= []));
  db = next;
  save();
}

// ---------- Sesión ----------
export function login(telefono, pin) {
  const tel = String(telefono).replace(/\D/g, '');
  const u = db.usuarios.find(x => x.telefono === tel && x.activo !== false);
  if (!u || u.pin !== String(pin)) return null;
  session = { userId: u.id, unidadId: u.unidad_id, at: nowISO() };
  localStorage.setItem(SKEY, JSON.stringify(session));
  audit('Inicio de sesión', 'usuarios', u.id, u.nombre);
  return u;
}

export function logout() {
  session = null;
  localStorage.removeItem(SKEY);
}

export function currentUser() {
  if (!session) return null;
  const u = db.usuarios.find(x => x.id === session.userId);
  if (!u || u.activo === false) return null;
  return u;
}

export function currentUnit() {
  const u = currentUser();
  return u ? db.unidades.find(x => x.id === u.unidad_id) : null;
}

export function setSessionUser(u) {
  session = { userId: u.id, unidadId: u.unidad_id, at: nowISO() };
  localStorage.setItem(SKEY, JSON.stringify(session));
}

// ---------- Permisos ----------
export function perms(u = currentUser()) {
  if (!u) return new Set();
  const s = new Set();
  (u.roles || []).forEach(r => (ROLE_PERMS[r] || []).forEach(p => s.add(p)));
  (u.permisos || []).forEach(p => s.add(p));
  return s;
}

// ---------- Licencia de la unidad ----------
// La fija el propietario del sistema en Supabase. Se evalúa también sin conexión, con la fecha
// guardada. Vencida o suspendida, la unidad queda en solo consulta. Las unidades que no están
// en la nube (modo demostración) no tienen licencia.
export function licencia() {
  const l = currentUnit()?.licencia;
  if (!l) return { aplica: false, vigente: true, modulos: { cantina: true, coal: true }, vence: null, estado: 'activa', dias: null };
  const hoy = todayStr();
  const dias = l.vence ? Math.round((new Date(l.vence + 'T00:00:00') - new Date(hoy + 'T00:00:00')) / 86400000) : null;
  const vigente = l.estado === 'activa' && (dias === null || dias >= 0);
  return { aplica: true, vigente, modulos: l.modulos || {}, vence: l.vence, estado: l.estado, dias };
}
const PERMISOS_DE_ESCRITURA = new Set(['cantina.operar', 'coal.operar', 'anular', 'ajustes']);

export function can(p, u = currentUser()) {
  if (PERMISOS_DE_ESCRITURA.has(p) && !licencia().vigente) return false; // solo consulta
  const s = perms(u);
  if (s.has('*')) return true;
  if (s.has(p)) return true;
  // Quien opera un módulo también lo puede ver.
  if (p.endsWith('.ver') && s.has(p.replace('.ver', '.operar'))) return true;
  return false;
}

export function moduleOn(m) {
  const un = currentUnit();
  return !!(un && un.modulos && un.modulos[m] && licencia().modulos[m]);
}

// ---------- Acceso a datos (siempre filtrado por unidad) ----------
function unitId() {
  const u = currentUser();
  if (!u) throw new Error('Sin sesión');
  return u.unidad_id;
}

export function q(table, pred) {
  const un = unitId();
  const rows = db[table].filter(r => r.unidad_id === un);
  return pred ? rows.filter(pred) : rows;
}

export function get(table, id) {
  if (!id) return null;
  const un = unitId();
  return db[table].find(r => r.id === id && r.unidad_id === un) || null;
}

export function insert(table, obj, { silent = false } = {}) {
  const u = currentUser();
  const row = {
    id: uid(),
    unidad_id: u.unidad_id,
    creado_en: nowISO(),
    creado_por: u.id,
    estado: 'activo',
    ...obj,
  };
  db[table].push(row);
  if (!silent) save();
  return row;
}

export function update(table, id, patch) {
  const row = get(table, id);
  if (!row) throw new Error('Registro no encontrado');
  const u = currentUser();
  Object.assign(row, patch, { modificado_en: nowISO(), modificado_por: u.id });
  save();
  return row;
}

export function nextSeq(nombre) {
  const un = unitId();
  let s = db.secuencias.find(x => x.unidad_id === un && x.nombre === nombre);
  if (!s) { s = { id: `${un}:seq:${nombre}`, unidad_id: un, nombre, valor: 0 }; db.secuencias.push(s); }
  s.valor += 1;
  return s.valor;
}

export function audit(accion, entidad, entidad_id, detalle = '', motivo = '') {
  const u = currentUser();
  if (!u) return;
  db.auditoria.push({
    id: uid(), unidad_id: u.unidad_id, fecha: nowISO(), usuario_id: u.id,
    usuario: u.nombre, accion, entidad, entidad_id, detalle, motivo,
  });
  save();
}

// ---------- Administración (solo el administrador de la unidad) ----------
function exigirAdmin() {
  if (!can('admin')) throw new Error('Solo el administrador de la unidad puede realizar esta acción.');
}

const usuariosUnidad = un => db.usuarios.filter(x => x.unidad_id === un);
const adicionalesActivos = (un, exceptoId) =>
  usuariosUnidad(un).filter(x => x.id !== exceptoId && x.activo !== false && !x.roles.includes('admin')).length;
const hayOtroAdmin = (un, exceptoId) =>
  usuariosUnidad(un).some(x => x.id !== exceptoId && x.activo !== false && x.roles.includes('admin'));

// Crea (id = null) o modifica un usuario de la unidad aplicando todas las reglas.
export function guardarUsuario(id, data) {
  exigirAdmin();
  const me = currentUser(), un = me.unidad_id;
  const u = id ? usuariosUnidad(un).find(x => x.id === id) : null;
  if (id && !u) throw new Error('Usuario no encontrado.');
  const nombre = String(data.nombre || '').trim();
  if (!nombre) throw new Error('Indique el nombre del usuario.');
  const telefono = String(data.telefono || '').replace(/\D/g, '');
  if (!telefono) throw new Error('Indique el teléfono del usuario.');
  if (db.usuarios.some(x => x.telefono === telefono && x.id !== id)) throw new Error('Ese teléfono ya está registrado.');
  const roles = [...new Set(data.roles || [])];
  if (!roles.length) throw new Error('Asigne al menos un rol.');
  if (roles.some(r => !ROLES[r])) throw new Error('Rol no válido.');
  const permisos = [...new Set(data.permisos || [])];
  if (permisos.some(p => !EXTRA_PERMS[p])) throw new Error('Permiso no válido.');
  if (u && u.id === me.id && !roles.includes('admin')) throw new Error('No puede quitarse a sí mismo el rol de administrador.');
  if (roles.includes('admin') && hayOtroAdmin(un, id)) throw new Error('La unidad ya tiene un administrador.');
  const activo = u ? u.activo !== false : true;
  if (activo && !roles.includes('admin') && adicionalesActivos(un, id) >= MAX_ADICIONALES) {
    throw new Error(`La unidad ya tiene ${MAX_ADICIONALES} cuentas adicionales activas.`);
  }
  const pin = data.pin ? String(data.pin) : '';
  if (!u && !pin) throw new Error('Indique el PIN inicial.');
  if (pin && pin.length < 4) throw new Error('El PIN debe tener al menos 4 dígitos.');
  const campos = { grado: String(data.grado || '').trim(), nombre, telefono, roles, permisos };
  if (pin) campos.pin = pin;
  let row;
  if (u) { row = Object.assign(u, campos, { modificado_en: nowISO(), modificado_por: me.id }); }
  else { row = { id: uid(), unidad_id: un, activo: true, creado_en: nowISO(), creado_por: me.id, ...campos }; db.usuarios.push(row); }
  save();
  audit(u ? 'Usuario modificado' : 'Usuario creado', 'usuarios', row.id, `${row.nombre}: ${roles.join(', ')}`);
  return row;
}

// Activa o desactiva un usuario de la unidad.
export function cambiarEstadoUsuario(id) {
  exigirAdmin();
  const me = currentUser(), un = me.unidad_id;
  const u = usuariosUnidad(un).find(x => x.id === id);
  if (!u) throw new Error('Usuario no encontrado.');
  if (u.id === me.id) throw new Error('No puede desactivarse a sí mismo.');
  if (u.activo === false) {
    if (u.roles.includes('admin')) {
      if (hayOtroAdmin(un, u.id)) throw new Error('La unidad ya tiene un administrador.');
    } else if (adicionalesActivos(un, u.id) >= MAX_ADICIONALES) {
      throw new Error(`Ya hay ${MAX_ADICIONALES} cuentas adicionales activas. Desactive otra antes de reactivar esta.`);
    }
  }
  u.activo = u.activo === false;
  Object.assign(u, { modificado_en: nowISO(), modificado_por: me.id });
  save();
  audit(u.activo ? 'Usuario activado' : 'Usuario desactivado', 'usuarios', u.id, u.nombre);
  return u;
}

// Nombre de la unidad y módulos habilitados.
export function guardarUnidad({ nombre, modulos }) {
  exigirAdmin();
  const un = currentUnit();
  const n = String(nombre || '').trim();
  if (!n) throw new Error('Indique el nombre de la unidad.');
  un.nombre = n;
  un.modulos = { cantina: !!modulos?.cantina, coal: !!modulos?.coal };
  save();
  audit('Configuración de unidad', 'unidades', un.id, `${un.nombre} — CANTINA ${un.modulos.cantina ? 'ON' : 'OFF'}, COAL ${un.modulos.coal ? 'ON' : 'OFF'}`);
  return un;
}

export function userName(id) {
  const u = db.usuarios.find(x => x.id === id);
  return u ? u.nombre : '—';
}

// Datos de la unidad actual (para respaldo). Nunca exporta otras unidades.
export function exportUnit() {
  exigirAdmin();
  const un = unitId();
  const out = { version: 1, exportado: nowISO(), unidad_id: un };
  TABLES.forEach(t => {
    out[t] = db[t].filter(r => (t === 'unidades' ? r.id === un : r.unidad_id === un));
  });
  return out;
}

export function importUnit(data) {
  exigirAdmin();
  const un = unitId();
  if (!data || data.unidad_id !== un) throw new Error('El respaldo pertenece a otra unidad.');
  const nube = esUnidadNube();
  TABLES.forEach(t => {
    if (!Array.isArray(data[t])) return;
    if (nube && (t === 'unidades' || t === 'usuarios')) return; // los administra Supabase
    db[t] = db[t].filter(r => (t === 'unidades' ? r.id !== un : r.unidad_id !== un)).concat(data[t]);
  });
  save();
}
