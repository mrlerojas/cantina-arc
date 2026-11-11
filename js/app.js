// Arranque, enrutador por hash y estructura de navegación.
import { currentUser, currentUnit, can, moduleOn, logout, isEmpty, ROLES } from './store.js';
import { esc } from './ui.js';
import { DEMO } from './config.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import * as cantina from './views/cantina.js';
import * as common from './views/common.js';
import * as coal from './views/coal.js';
import * as admin from './views/admin.js';

// Los datos de demostración solo se cargan en desarrollo (ver config.js y publicar.sh).
if (DEMO && isEmpty()) (await import('./seed.js')).seed();

// ruta -> { título, vista, permiso, módulo }
const ROUTES = {
  '': { t: 'Inicio', v: renderDashboard },
  'cantina/pos': { t: 'Registrar venta', v: cantina.pos, p: 'cantina.operar', m: 'cantina' },
  'cantina/ventas': { t: 'Ventas', v: cantina.ventas, p: 'cantina.ver', m: 'cantina' },
  'cantina/clientes': { t: 'Clientes y créditos', v: cantina.clientes, p: 'cantina.ver', m: 'cantina' },
  'cantina/productos': { t: 'Productos y precios — CANTINA', v: (p, el) => common.productos(p, el, 'cantina'), p: 'cantina.ver', m: 'cantina' },
  'cantina/compras': { t: 'Compras — CANTINA', v: (p, el) => common.compras(p, el, 'cantina'), p: 'cantina.ver', m: 'cantina' },
  'cantina/gastos': { t: 'Gastos — CANTINA', v: (p, el) => common.gastos(p, el, 'cantina'), p: 'cantina.ver', m: 'cantina' },
  'cantina/inventario': { t: 'Inventario y Kardex — CANTINA', v: (p, el) => common.inventario(p, el, 'cantina'), p: 'cantina.ver', m: 'cantina' },
  'cantina/balance': { t: 'Balance CANTINA', v: cantina.balance, p: 'balances', m: 'cantina' },
  'coal/dia': { t: 'Registro diario — COAL', v: coal.dia, p: 'coal.ver', m: 'coal' },
  'coal/recetas': { t: 'Recetas', v: coal.recetas, p: 'coal.ver', m: 'coal' },
  'coal/operacionales': { t: 'Víveres operacionales', v: coal.operacionales, p: 'coal.ver', m: 'coal' },
  'coal/compras': { t: 'Compras — COAL', v: (p, el) => common.compras(p, el, 'coal'), p: 'coal.ver', m: 'coal' },
  'coal/gastos': { t: 'Gastos — COAL', v: (p, el) => common.gastos(p, el, 'coal'), p: 'coal.ver', m: 'coal' },
  'coal/productos': { t: 'Víveres — COAL', v: (p, el) => common.productos(p, el, 'coal'), p: 'coal.ver', m: 'coal' },
  'coal/inventario': { t: 'Inventario y Kardex — COAL', v: (p, el) => common.inventario(p, el, 'coal'), p: 'coal.ver', m: 'coal' },
  'coal/tarifas': { t: 'Tarifas y reglas — COAL', v: coal.tarifasView, p: 'coal.ver', m: 'coal' },
  'coal/balance': { t: 'Balance COAL', v: coal.balance, p: 'balances', m: 'coal' },
  'coal/parte': { t: 'Parte diario', v: coal.parte, p: 'coal.ver', m: 'coal' },
  'proveedores': { t: 'Proveedores', v: common.proveedores, p: 'any.operar' },
  'admin/usuarios': { t: 'Usuarios y permisos', v: admin.usuarios, p: 'admin' },
  'admin/unidad': { t: 'Unidad y módulos', v: admin.unidad, p: 'admin' },
  'admin/auditoria': { t: 'Auditoría', v: admin.auditoria, p: 'auditoria' },
  'admin/respaldo': { t: 'Respaldo de datos', v: admin.respaldo, p: 'admin' },
};

const NAV = [
  { g: null, items: [['', '⌂', 'Inicio']] },
  { g: 'CANTINA', m: 'cantina', items: [
    ['cantina/pos', '🛒', 'Registrar venta'], ['cantina/ventas', '🧾', 'Ventas'], ['cantina/clientes', '👥', 'Clientes y créditos'],
    ['cantina/productos', '🏷️', 'Productos y precios'], ['cantina/compras', '📥', 'Compras'], ['cantina/gastos', '💸', 'Gastos'],
    ['cantina/inventario', '📦', 'Inventario / Kardex'], ['cantina/balance', '📊', 'Balance'],
  ] },
  { g: 'COAL', m: 'coal', items: [
    ['coal/dia', '🍽️', 'Registro diario'], ['coal/recetas', '📖', 'Recetas'], ['coal/productos', '🥫', 'Víveres'],
    ['coal/compras', '📥', 'Compras'], ['coal/operacionales', '⚓', 'Víveres operacionales'], ['coal/gastos', '💸', 'Gastos'],
    ['coal/inventario', '📦', 'Inventario / Kardex'], ['coal/tarifas', '⚙️', 'Tarifas y reglas'],
    ['coal/parte', '📄', 'Parte diario'], ['coal/balance', '📊', 'Balance'],
  ] },
  { g: 'GENERAL', items: [['proveedores', '🚚', 'Proveedores']] },
  { g: 'ADMINISTRACIÓN', items: [
    ['admin/usuarios', '🔐', 'Usuarios y permisos'], ['admin/unidad', '🚢', 'Unidad y módulos'],
    ['admin/auditoria', '🕵️', 'Auditoría'], ['admin/respaldo', '💾', 'Respaldo'],
  ] },
];

function allowed(r) {
  if (!r) return false;
  if (r.m && !moduleOn(r.m)) return false;
  if (!r.p) return true;
  // Los balances de un módulo solo los ve quien tiene acceso a ese módulo.
  if (r.p === 'balances' && r.m && !can(r.m + '.ver')) return false;
  if (r.p === 'any.operar') return can('cantina.operar') || can('coal.operar') || can('balances');
  return can(r.p);
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { path, params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function go(path, params) {
  const qs = params ? '?' + new URLSearchParams(params) : '';
  location.hash = '#/' + path + qs;
}

function renderShell() {
  const u = currentUser(), un = currentUnit();
  const { path } = parseHash();
  const nav = NAV.map(sec => {
    if (sec.m && !moduleOn(sec.m)) return '';
    const items = sec.items.filter(([p]) => allowed(ROUTES[p]));
    if (!items.length) return '';
    return `<div class="nav-group">${sec.g ? `<span>${sec.g}</span>` : ''}${items.map(([p, ic, l]) =>
      `<a href="#/${p}" class="${p === path ? 'active' : ''}"><span class="ic">${ic}</span>${l}</a>`).join('')}</div>`;
  }).join('');
  document.getElementById('app').innerHTML = `
    <div class="shell" id="shell">
      <aside class="sidebar">
        <div class="brand"><img src="icons/icon-192.png" alt=""><div><b>Cantina ARC</b><small>Gestión para Unidades Navales</small></div></div>
        <div class="unit-pill">🚢 ${esc(un.nombre)}</div>
        ${nav}
        <div class="sidebar-foot">
          <div><b>${esc(u.grado ? u.grado + ' ' : '')}${esc(u.nombre)}</b></div>
          <div class="small" style="opacity:.7">${u.roles.map(r => ROLES[r]).join(', ')}</div>
          <button class="sm" id="logout">Cerrar sesión</button>
        </div>
      </aside>
      <div class="scrim" id="scrim"></div>
      <main class="main">
        <header class="topbar">
          <button class="menu-btn icon-btn" id="menu" aria-label="Menú">☰</button>
          <h1 id="page-title"></h1>
        </header>
        <div class="content" id="view"></div>
      </main>
    </div>`;
  document.getElementById('logout').onclick = () => { logout(); location.hash = '#/'; route(); };
  const shell = document.getElementById('shell');
  document.getElementById('menu').onclick = () => shell.classList.add('nav-open');
  document.getElementById('scrim').onclick = () => shell.classList.remove('nav-open');
}

export function route() {
  document.getElementById('modal-root').innerHTML = '';
  if (!currentUser()) { renderLogin(document.getElementById('app'), route); return; }
  const { path, params } = parseHash();
  let r = ROUTES[path];
  renderShell();
  const view = document.getElementById('view');
  if (!allowed(r)) r = ROUTES[''];
  document.getElementById('page-title').textContent = r.t;
  document.title = r.t === 'Inicio' ? 'Cantina ARC' : `${r.t} · Cantina ARC`;
  r.v(params, view);
  window.scrollTo(0, 0);
}

// Todas las vistas tienen la firma (params, el[, modulo]).
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
