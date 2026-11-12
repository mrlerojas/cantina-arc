// Utilidades de interfaz compartidas.
import { todayStr, addDays } from './store.js';
import { fmtQty, ORIGENES } from './domain.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(Number(n) || 0)).toLocaleString('es-CO');
export const fdate = s => (s ? s.split('-').reverse().join('/') : '');
export const fdt = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
};
export const qty = fmtQty;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.getElementById('toast-root').appendChild(t);
  setTimeout(() => t.remove(), bad ? 4500 : 2600);
}

export function clearToasts() {
  document.getElementById('toast-root').innerHTML = '';
}

// Ejecuta una acción mostrando el error como aviso en lugar de romper la vista.
export function attempt(fn) {
  try { return fn(); } catch (e) { console.error(e); toast(e.message || String(e), true); return undefined; }
}

export function modal({ title, body, foot = '', wide = false, onMount }) {
  const root = document.getElementById('modal-root');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${title}</h2><button class="ghost icon-btn" data-close aria-label="Cerrar">✕</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  root.appendChild(back);
  const el = back.querySelector('.modal');
  const api = { el, close };
  onMount && onMount(el, api);
  const first = el.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
  if (first && window.matchMedia('(min-width: 700px)').matches) first.focus();
  return api;
}

export function askMotivo(titulo = 'Motivo de la anulación') {
  return new Promise(resolve => {
    modal({
      title: titulo,
      body: `<label class="field"><span>Motivo (queda registrado en auditoría)</span><textarea id="motivo" required></textarea></label>`,
      foot: `<button data-close>Cancelar</button><button class="primary danger-fill" id="ok">Confirmar</button>`,
      onMount: (el, m) => {
        el.querySelector('#ok').onclick = () => {
          const v = el.querySelector('#motivo').value.trim();
          if (!v) return toast('Debe indicar un motivo.', true);
          m.close(); resolve(v);
        };
        el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => resolve(null)));
      },
    });
  });
}

export function printDoc(html) {
  const area = document.getElementById('print-area');
  area.innerHTML = `<div class="doc">${html}</div>`;
  setTimeout(() => window.print(), 50);
}

// CSV con separador ';' y BOM para que Excel en español lo abra correctamente.
export function exportCSV(filename, rows) {
  const cell = v => {
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000).replace('.', ',');
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  download(filename.endsWith('.csv') ? filename : filename + '.csv', csv, 'text/csv;charset=utf-8');
}

export function download(filename, content, type = 'application/octet-stream') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------- Selector de periodo ----------
export function periodo(tipo, base = todayStr()) {
  const [y, m, d] = base.split('-').map(Number);
  if (tipo === 'hoy') return [base, base];
  if (tipo === 'semana') {
    const w = (new Date(y, m - 1, d).getDay() + 6) % 7; // lunes = 0
    return [addDays(base, -w), addDays(base, 6 - w)];
  }
  if (tipo === 'mes') {
    const last = new Date(y, m, 0).getDate();
    return [`${y}-${String(m).padStart(2, '0')}-01`, `${y}-${String(m).padStart(2, '0')}-${last}`];
  }
  return [base, base];
}

export function rangeBar(st) {
  const b = (k, l) => `<button class="${st.tipo === k ? 'on' : ''}" data-rango="${k}">${l}</button>`;
  return `
    <div class="row">
      <div class="seg">${b('hoy', 'Día')}${b('semana', 'Semana')}${b('mes', 'Mes')}${b('rango', 'Rango')}</div>
      <input type="date" id="rg-d1" value="${st.d1}" style="width:auto">
      <span class="muted">a</span>
      <input type="date" id="rg-d2" value="${st.d2}" style="width:auto">
    </div>`;
}

export function bindRange(root, st, rerender) {
  root.querySelectorAll('[data-rango]').forEach(btn => btn.onclick = () => {
    st.tipo = btn.dataset.rango;
    if (st.tipo !== 'rango') [st.d1, st.d2] = periodo(st.tipo, todayStr());
    rerender();
  });
  const d1 = root.querySelector('#rg-d1'), d2 = root.querySelector('#rg-d2');
  const ch = () => {
    st.tipo = 'rango'; st.d1 = d1.value || st.d1; st.d2 = d2.value || st.d2;
    if (st.d2 < st.d1) st.d2 = st.d1;
    rerender();
  };
  d1.onchange = ch; d2.onchange = ch;
}

// ---------- Editor de líneas (compras, recetas, consumos, operacionales) ----------
// cols: { precio: 'Precio unitario', origen: true, stock: 'convencional' }
export function lineEditor(container, { productos, rows = [], cols = {}, onChange }) {
  const state = rows.length ? rows.map(r => ({ ...r })) : [{ producto_id: '', cantidad: '', precio: '', origen: 'convencional' }];
  const opts = sel => `<option value="">Seleccione…</option>` + productos.map(p =>
    `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.nombre)} (${esc(p.unidad_medida)})</option>`).join('');
  const render = () => {
    container.innerHTML = `
      <div class="table-wrap"><table class="lines">
        <thead><tr><th>Producto</th><th style="width:110px">Cantidad</th>
          ${cols.precio ? `<th style="width:130px">${cols.precio}</th>` : ''}
          ${cols.origen ? '<th style="width:140px">Origen</th>' : ''}
          ${cols.precio ? '<th class="num">Subtotal</th>' : ''}
          ${cols.info ? '<th class="num">Disponible</th>' : ''}
          <th></th></tr></thead>
        <tbody>${state.map((r, i) => `
          <tr data-i="${i}">
            <td><select data-k="producto_id">${opts(r.producto_id)}</select></td>
            <td><input type="number" step="any" min="0" inputmode="decimal" data-k="cantidad" value="${r.cantidad}"></td>
            ${cols.precio ? `<td><input type="number" step="any" min="0" inputmode="decimal" data-k="precio" value="${r.precio}"></td>` : ''}
            ${cols.origen ? `<td><select data-k="origen">${Object.entries(ORIGENES).map(([k, v]) => `<option value="${k}" ${r.origen === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>` : ''}
            ${cols.precio ? `<td class="num" data-sub>${money((+r.cantidad || 0) * (+r.precio || 0))}</td>` : ''}
            ${cols.info ? `<td class="num small muted" data-info>${r.producto_id ? cols.info(r) : ''}</td>` : ''}
            <td><button class="ghost sm" data-del title="Quitar">✕</button></td>
          </tr>`).join('')}</tbody>
        ${cols.precio ? `<tfoot><tr class="total"><td colspan="${2 + (cols.precio ? 1 : 0) + (cols.origen ? 1 : 0)}">Total</td><td class="num" data-total>${money(total())}</td><td></td></tr></tfoot>` : ''}
      </table></div>
      <div class="row" style="margin-top:8px"><button class="sm" data-add>+ Agregar producto</button>
        ${cols.crear ? '<button class="sm" data-crear>✚ Crear producto nuevo</button>' : ''}</div>`;
    container.querySelector('[data-crear]')?.addEventListener('click', () => cols.crear());
    container.querySelector('[data-add]').onclick = () => { state.push({ producto_id: '', cantidad: '', precio: '', origen: 'convencional' }); render(); };
    container.querySelectorAll('tr[data-i]').forEach(tr => {
      const i = +tr.dataset.i;
      tr.querySelector('[data-del]').onclick = () => { state.splice(i, 1); if (!state.length) state.push({ producto_id: '', cantidad: '', precio: '', origen: 'convencional' }); render(); };
      tr.querySelectorAll('[data-k]').forEach(inp => {
        const ev = inp.tagName === 'SELECT' ? 'change' : 'input';
        inp.addEventListener(ev, () => {
          state[i][inp.dataset.k] = inp.value;
          if (inp.dataset.k === 'producto_id' && cols.defaultPrecio && !state[i].precio) {
            state[i].precio = cols.defaultPrecio(inp.value) || '';
            const pi = tr.querySelector('[data-k=precio]'); if (pi) pi.value = state[i].precio;
          }
          const sub = tr.querySelector('[data-sub]');
          if (sub) sub.textContent = money((+state[i].cantidad || 0) * (+state[i].precio || 0));
          const inf = tr.querySelector('[data-info]');
          if (inf) inf.textContent = state[i].producto_id ? cols.info(state[i]) : '';
          const t = container.querySelector('[data-total]');
          if (t) t.textContent = money(total());
          onChange && onChange(state);
        });
      });
    });
  };
  const total = () => state.reduce((s, r) => s + (+r.cantidad || 0) * (+r.precio || 0), 0);
  render();
  // Añade a la lista un producto recién creado y lo deja seleccionado en una fila
  // (la primera que esté vacía, o una nueva).
  const agregar = (p, precio = '', cantidad = '') => {
    if (!productos.some(x => x.id === p.id)) { productos.push(p); productos.sort((a, b) => a.nombre.localeCompare(b.nombre)); }
    let fila = state.find(r => !r.producto_id);
    if (!fila) { fila = { producto_id: '', cantidad: '', precio: '', origen: 'convencional' }; state.push(fila); }
    fila.producto_id = p.id;
    if (precio) fila.precio = precio;
    if (cantidad) fila.cantidad = cantidad;
    render();
    onChange && onChange(state);
    const tr = container.querySelector(`tr[data-i="${state.indexOf(fila)}"]`);
    tr?.querySelector('[data-k=cantidad]')?.focus();
  };
  return { get: () => state.filter(r => r.producto_id), total, agregar, set: rows => { state.splice(0, state.length, ...rows); render(); onChange && onChange(state); } };
}

// Redimensiona una foto a JPEG de 320px para no llenar el almacenamiento local.
export function readImage(file, size = 320) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, size / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function thumb(p) {
  if (p?.foto && p.foto.startsWith('data:')) return `<img src="${p.foto}" alt="">`;
  return esc(p?.foto || '📦');
}

export function emptyRow(cols, msg = 'Sin registros') {
  return `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`;
}

export function estadoBadge(e) {
  if (e === 'activo') return '<span class="badge ok">Activo</span>';
  if (e === 'anulado') return '<span class="badge bad">Anulado</span>';
  if (e === 'historico') return '<span class="badge">Histórico</span>';
  return `<span class="badge">${esc(e)}</span>`;
}

export function kpi(label, value, sub = '') {
  return `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}
