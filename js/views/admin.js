import {
  q, db, currentUser, currentUnit, audit, ROLES, EXTRA_PERMS, MAX_ADICIONALES, exportUnit, importUnit, todayStr,
  guardarUsuario, cambiarEstadoUsuario, guardarUnidad, esUnidadNube, licencia,
} from '../store.js';
import { esc, fdt, toast, modal, exportCSV, download, emptyRow, rangeBar, bindRange, periodo, attempt } from '../ui.js';
import * as cloud from '../cloud.js';

// En una unidad conectada a Supabase, usuarios y unidad se guardan en la nube (requiere conexión).
const enNube = () => cloud.enabled && esUnidadNube();
async function intentar(fn) {
  try { return (await fn()) ?? true; } catch (e) { console.error(e); toast(e.message || String(e), true); return undefined; }
}

// ============================ USUARIOS ============================
export function usuarios(_p, el) {
  const render = () => {
    const un = currentUnit();
    const us = db.usuarios.filter(u => u.unidad_id === un.id);
    const adicionales = us.filter(u => u.activo !== false && !u.roles.includes('admin')).length;
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><div><h2>Usuarios de la unidad</h2><div class="small muted">1 administrador y hasta ${MAX_ADICIONALES} cuentas adicionales (${adicionales}/${MAX_ADICIONALES} en uso). Una persona puede tener varios roles.</div></div>
          <button class="primary" id="nuevo" ${adicionales >= MAX_ADICIONALES ? 'disabled' : ''}>+ Nuevo usuario</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Usuario</th><th>Teléfono</th><th>Roles</th><th>Permisos adicionales</th><th>Estado</th></tr></thead>
          <tbody>${us.map(u => `<tr class="clickable" data-id="${u.id}"><td><b>${esc([u.grado, u.nombre].filter(Boolean).join(' '))}</b></td><td>${esc(u.telefono)}</td>
            <td>${u.roles.map(r => `<span class="badge">${ROLES[r]}</span>`).join(' ')}</td>
            <td class="small">${(u.permisos || []).map(p => EXTRA_PERMS[p]).join(', ')}</td>
            <td>${u.activo === false ? '<span class="badge bad">Inactivo</span>' : '<span class="badge ok">Activo</span>'}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card"><h3 style="margin-bottom:8px">Matriz de roles</h3><div class="table-wrap"><table>
        <thead><tr><th>Rol</th><th>CANTINA</th><th>COAL</th><th>Balances</th><th>Anular</th><th>Auditoría</th><th>Usuarios</th></tr></thead>
        <tbody>
          <tr><td>Administrador / Comandante</td><td>Operar</td><td>Operar</td><td>✔</td><td>✔</td><td>✔</td><td>✔</td></tr>
          <tr><td>Supervisor / Segundo Comandante</td><td>Consultar</td><td>Consultar</td><td>✔</td><td>Configurable</td><td>✔</td><td>—</td></tr>
          <tr><td>Operador CANTINA</td><td>Operar</td><td>—</td><td>Configurable</td><td>Configurable</td><td>Configurable</td><td>—</td></tr>
          <tr><td>Operador COAL</td><td>—</td><td>Operar</td><td>Configurable</td><td>Configurable</td><td>Configurable</td><td>—</td></tr>
        </tbody></table></div></div>`;
    el.querySelector('#nuevo').onclick = () => userForm(null, render);
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => userForm(db.usuarios.find(u => u.id === tr.dataset.id), render));
  };
  render();
}

function userForm(u, done) {
  const me = currentUser();
  const un = currentUnit();
  modal({
    title: u ? 'Editar usuario' : 'Nuevo usuario',
    body: `<form id="uf" class="form-grid">
      <label class="field"><span>Grado</span><input name="grado" value="${esc(u?.grado || '')}"></label>
      <label class="field"><span>Nombre</span><input name="nombre" required value="${esc(u?.nombre || '')}"></label>
      <label class="field"><span>Teléfono (usuario de acceso)</span><input name="telefono" type="tel" inputmode="numeric" required value="${esc(u?.telefono || '')}"></label>
      <label class="field"><span>${enNube() ? (u ? 'Nueva contraseña (vacío = conservar)' : 'Contraseña inicial (mín. 6)') : (u ? 'Nuevo PIN (dejar vacío para conservar)' : 'PIN inicial')}</span><input name="pin" type="password" autocomplete="new-password" minlength="${enNube() ? 6 : 4}" ${u ? '' : 'required'}></label>
      <div class="full"><b class="small">Roles</b><div class="stack" style="margin-top:6px">
        ${Object.entries(ROLES).map(([k, l]) => `<label class="check"><input type="checkbox" name="rol" value="${k}" ${u?.roles.includes(k) ? 'checked' : ''} ${k === 'admin' && u?.id !== me.id && db.usuarios.some(x => x.unidad_id === un.id && x.roles.includes('admin') && x.id !== u?.id && x.activo !== false) ? 'disabled' : ''}> ${l}</label>`).join('')}
      </div></div>
      <div class="full"><b class="small">Permisos adicionales</b><div class="stack" style="margin-top:6px">
        ${Object.entries(EXTRA_PERMS).map(([k, l]) => `<label class="check"><input type="checkbox" name="perm" value="${k}" ${u?.permisos?.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}
      </div></div>
    </form>`,
    foot: `${u && u.id !== me.id ? `<button class="danger" id="toggle">${u.activo === false ? 'Activar' : 'Desactivar'}</button><span class="spacer"></span>` : ''}
      <button data-close>Cancelar</button><button class="primary" id="ok">Guardar</button>`,
    onMount: (m, api) => {
      let ocupado = false;
      m.querySelector('#toggle')?.addEventListener('click', async () => {
        if (ocupado) return; ocupado = true;
        const ok = enNube() ? await intentar(() => cloud.cambiarEstadoUsuarioNube(u.id)) : attempt(() => cambiarEstadoUsuario(u.id));
        ocupado = false;
        if (!ok) return;
        api.close(); done();
      });
      m.querySelector('#ok').onclick = async () => {
        const f = m.querySelector('#uf');
        if (!f.reportValidity() || ocupado) return;
        const data = {
          grado: f.grado.value, nombre: f.nombre.value, telefono: f.telefono.value,
          roles: [...f.querySelectorAll('[name=rol]:checked')].map(x => x.value),
          permisos: [...f.querySelectorAll('[name=perm]:checked')].map(x => x.value),
        };
        ocupado = true;
        const ok = enNube()
          ? await intentar(() => cloud.guardarUsuarioNube(u?.id || null, { ...data, password: f.pin.value }))
          : attempt(() => guardarUsuario(u?.id || null, { ...data, pin: f.pin.value }));
        ocupado = false;
        if (!ok) return;
        api.close(); toast('Usuario guardado'); done();
      };
    },
  });
}

// ============================ UNIDAD ============================
export function unidad(_p, el) {
  const un = currentUnit();
  const lic = licencia();
  const noLic = m => lic.aplica && !lic.modulos[m];
  const licTxt = !lic.aplica ? '' : `<div class="card" style="max-width:640px"><h3>Licencia</h3>
    <p class="small">Módulos contratados: <b>${['cantina', 'coal'].filter(m => lic.modulos[m]).map(m => m.toUpperCase()).join(' y ') || 'ninguno'}</b><br>
    Estado: <b>${lic.estado !== 'activa' ? 'Suspendida' : lic.vigente ? 'Activa' : 'Vencida'}</b>${lic.vence ? ` · Vence el <b>${lic.vence.split('-').reverse().join('/')}</b>` : ' · Sin fecha de vencimiento'}</p>
    <p class="small muted">Para contratar otro módulo o renovar, comuníquese con el proveedor del sistema.</p></div>`;
  el.innerHTML = `
    <form id="f" class="card stack" style="max-width:640px">
      <label class="field"><span>Nombre de la unidad (aparece en recibos y documentos)</span><input name="nombre" required value="${esc(un.nombre)}"></label>
      <div><b class="small">Módulos habilitados</b><div class="stack" style="margin-top:6px">
        <label class="check"><input type="checkbox" name="cantina" ${un.modulos?.cantina && !noLic('cantina') ? 'checked' : ''} ${noLic('cantina') ? 'disabled' : ''}> CANTINA — POS, inventario, clientes, créditos, balance${noLic('cantina') ? ' <span class="badge">No contratado</span>' : ''}</label>
        <label class="check"><input type="checkbox" name="coal" ${un.modulos?.coal && !noLic('coal') ? 'checked' : ''} ${noLic('coal') ? 'disabled' : ''}> COAL — alimentación, recetas, víveres, parte diario, balance${noLic('coal') ? ' <span class="badge">No contratado</span>' : ''}</label>
      </div><p class="small muted">Desactivar un módulo lo oculta; la información se conserva.</p></div>
      <div class="row end"><button class="primary">Guardar</button></div>
    </form>
    ${licTxt}
    <div class="card" style="max-width:640px"><h3>Aislamiento de información</h3>
      <p class="small muted">Cada registro está asociado a la unidad (<code>unidad_id</code>) y los usuarios solo consultan los datos de su unidad. En la versión en la nube esta regla se aplica también en la base de datos (Row Level Security).</p></div>`;
  el.querySelector('#f').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const datos = { nombre: f.nombre.value, modulos: { cantina: f.cantina.checked, coal: f.coal.checked } };
    const ok = enNube() ? await intentar(() => cloud.guardarUnidadNube(datos)) : attempt(() => guardarUnidad(datos));
    if (!ok) return;
    toast('Unidad actualizada');
    location.reload();
  };
}

// ============================ AUDITORÍA ============================
const audSt = { tipo: 'mes', d1: periodo('mes')[0], d2: periodo('mes')[1], s: '' };

export function auditoria(_p, el) {
  const st = audSt;
  const render = () => {
    const dia = a => todayStr(new Date(a.fecha)); // día local: la fecha se guarda en hora universal
    const rows = q('auditoria', a => dia(a) >= st.d1 && dia(a) <= st.d2)
      .filter(a => !st.s || [a.accion, a.usuario, a.detalle, a.motivo].join(' ').toLowerCase().includes(st.s))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px"><div class="row">${rangeBar(st)}
        <input type="search" id="s" placeholder="Filtrar (acción, usuario, anulación…)" value="${esc(st.s)}" style="max-width:280px">
        <span class="spacer"></span><button id="csv">Exportar Excel</button></div></div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th><th>Motivo</th></tr></thead>
        <tbody>${rows.slice(0, 500).map(a => `<tr><td class="small" style="white-space:nowrap">${fdt(a.fecha)}</td><td>${esc(a.usuario)}</td>
          <td>${/Anulaci|Ajuste|desactiv/i.test(a.accion) ? `<span class="badge warn">${esc(a.accion)}</span>` : esc(a.accion)}</td>
          <td class="small">${esc(a.detalle)}</td><td class="small">${esc(a.motivo || '')}</td></tr>`).join('') || emptyRow(5)}</tbody>
      </table></div>${rows.length > 500 ? `<p class="small muted">Mostrando 500 de ${rows.length}. Exporte para ver todo.</p>` : ''}</div>`;
    bindRange(el, st, render);
    const s = el.querySelector('#s');
    s.oninput = () => { st.s = s.value.toLowerCase(); render(); const n = el.querySelector('#s'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    el.querySelector('#csv').onclick = () => exportCSV(`auditoria_${st.d1}_${st.d2}`, [['Fecha', 'Usuario', 'Acción', 'Entidad', 'Detalle', 'Motivo'], ...rows.map(a => [fdt(a.fecha), a.usuario, a.accion, a.entidad, a.detalle, a.motivo])]);
  };
  render();
}

// ============================ RESPALDO ============================
export function respaldo(_p, el) {
  el.innerHTML = `
    <div class="card" style="max-width:680px">
      <h2>Respaldo de la unidad</h2>
      <p class="muted">En este prototipo la información se guarda en este dispositivo. Descargue un respaldo con frecuencia y guárdelo en un lugar seguro. El respaldo contiene únicamente los datos de su unidad.</p>
      <div class="row"><button class="primary" id="exp">Descargar respaldo</button>
        <label class="btn">Restaurar respaldo<input type="file" accept="application/json,.json" id="imp" hidden></label></div>
    </div>`;
  el.querySelector('#exp').onclick = () => {
    const data = attempt(() => exportUnit());
    if (!data) return;
    download(`cantina_respaldo_${currentUnit().nombre.replace(/\W+/g, '_')}_${todayStr()}.json`, JSON.stringify(data), 'application/json');
    audit('Respaldo descargado', 'unidades', currentUnit().id);
  };
  el.querySelector('#imp').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const text = await f.text();
    if (!confirm('Restaurar reemplazará TODOS los datos actuales de la unidad por los del respaldo. ¿Continuar?')) return;
    const ok = attempt(() => { importUnit(JSON.parse(text)); return true; });
    if (ok) { toast('Respaldo restaurado'); setTimeout(() => location.reload(), 600); }
  };
}
