// Panel del propietario del sistema: licencias de las unidades y códigos de registro.
// Solo lo ve quien registró su unidad con el código de propietario. Requiere conexión.
import { todayStr, addDays } from '../store.js';
import { esc, fdate, fdt, toast, modal, emptyRow, kpi } from '../ui.js';
import * as cloud from '../cloud.js';

const MODS = { cantina: 'CANTINA', coal: 'COAL' };
const modsTxt = m => Object.keys(MODS).filter(k => m?.[k]).map(k => MODS[k]).join(' + ') || '—';

function estadoLic(u) {
  if (u.licencia_estado !== 'activa') return ['Suspendida', 'bad'];
  if (!u.licencia_vence) return ['Activa', 'ok'];
  const dias = Math.round((new Date(u.licencia_vence + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);
  if (dias < 0) return ['Vencida', 'bad'];
  if (dias <= 15) return [`Vence en ${dias} d`, 'warn'];
  return ['Activa', 'ok'];
}

export function licencias(_p, el) {
  let datos = null;

  const pedir = async (accion, cuerpo) => {
    try { datos = await cloud.licencias(accion, cuerpo); return datos; }
    catch (e) { toast(e.message || String(e), true); return null; }
  };

  const render = () => {
    if (!datos) { el.innerHTML = '<div class="card"><div class="empty">Cargando licencias…</div></div>'; return; }
    const us = datos.unidades, cs = datos.codigos;
    const libres = cs.filter(c => !c.usado_en);
    const alDia = us.filter(u => ['ok', 'warn'].includes(estadoLic(u)[1])).length;
    el.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:14px">
        ${kpi('Unidades', String(us.length), `${alDia} con licencia vigente`)}
        ${kpi('Por renovar o vencidas', String(us.filter(u => ['warn', 'bad'].includes(estadoLic(u)[1])).length), 'Vencen en 15 días o menos, vencidas o suspendidas')}
        ${kpi('Códigos sin usar', String(libres.length), 'Cada código registra una sola unidad')}
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Unidades</h2><div class="small muted">Toque una unidad para cambiar su licencia.</div></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Unidad</th><th>Cliente</th><th>Módulos contratados</th><th>Vence</th><th>Estado</th><th class="num">Usuarios</th><th class="num">Ventas</th><th>Última actividad</th></tr></thead>
          <tbody>${us.map(u => {
            const [txt, cls] = estadoLic(u);
            return `<tr class="clickable" data-un="${esc(u.id)}"><td><b>${esc(u.nombre)}</b></td><td>${esc(u.cliente || '—')}</td>
              <td>${modsTxt(u.licencia_modulos)}</td><td>${u.licencia_vence ? fdate(u.licencia_vence) : 'Sin vencimiento'}</td>
              <td><span class="badge ${cls}">${txt}</span></td><td class="num">${u.usuarios}</td><td class="num">${u.ventas}</td>
              <td class="small">${u.ultima_actividad ? fdt(u.ultima_actividad) : '—'}</td></tr>`;
          }).join('') || emptyRow(8)}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Códigos de registro</h2><div class="small muted">Entregue un código a cada cliente nuevo: con él registra su unidad y queda con la licencia indicada.</div></div>
          <button class="primary" id="nuevo">+ Nuevo código</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Código</th><th>Cliente</th><th>Módulos</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
          <tbody>${cs.map(c => {
            const un = c.unidad_id ? us.find(u => u.id === c.unidad_id) : null;
            return `<tr><td><code>${c.usado_en ? '••••••' + esc(c.codigo.slice(-4)) : esc(c.codigo)}</code></td>
              <td>${esc(c.cliente || '—')}${c.propietario ? ' <span class="badge">Propietario</span>' : ''}</td>
              <td>${modsTxt(c.modulos)}</td><td>${c.vence ? fdate(c.vence) : 'Sin vencimiento'}</td>
              <td>${c.usado_en ? `<span class="badge">Usado</span> <span class="small muted">${esc(un?.nombre || '')} · ${fdt(c.usado_en)}</span>` : '<span class="badge ok">Disponible</span>'}</td>
              <td>${!c.usado_en && !c.propietario ? `<button class="sm danger" data-anular="${esc(c.codigo)}">Anular</button>` : ''}</td></tr>`;
          }).join('') || emptyRow(6)}</tbody>
        </table></div>
      </div>`;
    el.querySelector('#nuevo').onclick = nuevoCodigo;
    el.querySelectorAll('tr[data-un]').forEach(tr => tr.onclick = () => editar(us.find(u => u.id === tr.dataset.un)));
    el.querySelectorAll('[data-anular]').forEach(b => b.onclick = async () => {
      if (!confirm('¿Anular este código? Ya no servirá para registrar una unidad.')) return;
      if (await pedir('anular_codigo', { codigo: b.dataset.anular })) { toast('Código anulado'); render(); }
    });
  };

  // Campos comunes de una licencia: módulos y vencimiento con atajos.
  const camposLic = (m, vence) => `
    <div class="full"><b class="small">Módulos contratados</b><div class="stack" style="margin-top:6px">
      <label class="check"><input type="checkbox" name="cantina" ${m?.cantina ? 'checked' : ''}> CANTINA</label>
      <label class="check"><input type="checkbox" name="coal" ${m?.coal ? 'checked' : ''}> COAL</label></div></div>
    <label class="field full"><span>Vence (vacío = sin vencimiento)</span><input type="date" name="vence" value="${vence || ''}"></label>
    <div class="full row"><button type="button" class="sm" data-mas="30">+1 mes</button><button type="button" class="sm" data-mas="90">+3 meses</button>
      <button type="button" class="sm" data-mas="365">+1 año</button><button type="button" class="sm" data-mas="0">Sin vencimiento</button></div>`;
  const atajos = f => f.querySelectorAll('[data-mas]').forEach(b => b.onclick = () => {
    const dias = +b.dataset.mas;
    if (!dias) { f.vence.value = ''; return; }
    const base = f.vence.value && f.vence.value > todayStr() ? f.vence.value : todayStr();
    f.vence.value = addDays(base, dias);
  });

  function nuevoCodigo() {
    modal({
      title: 'Nuevo código de registro',
      body: `<form id="cf" class="form-grid">
        <label class="field full"><span>Cliente (unidad o persona que lo recibe)</span><input name="cliente" required placeholder="Ej.: ARC … — TN Pérez"></label>
        ${camposLic({ cantina: true, coal: false }, addDays(todayStr(), 30))}
      </form>`,
      foot: '<button data-close>Cancelar</button><button class="primary" id="ok">Crear código</button>',
      onMount: (m, api) => {
        const f = m.querySelector('#cf');
        atajos(f);
        m.querySelector('#ok').onclick = async e => {
          if (!f.reportValidity() || e.target.disabled) return;
          e.target.disabled = true;
          const r = await pedir('crear_codigo', { cliente: f.cliente.value, modulos: { cantina: f.cantina.checked, coal: f.coal.checked }, vence: f.vence.value });
          e.target.disabled = false;
          if (!r) return;
          api.close(); render();
          modal({
            title: 'Código creado',
            body: `<p>Entregue este código a <b>${esc(f.cliente.value)}</b>. Lo escribe en <b>Registrar una nueva unidad</b> y sirve una sola vez.</p>
              <div class="codigo-grande">${esc(r.codigo)}</div>
              <p class="small muted" style="margin-top:10px">Módulos: ${modsTxt({ cantina: f.cantina.checked, coal: f.coal.checked })} · ${f.vence.value ? 'Vence el ' + fdate(f.vence.value) : 'Sin vencimiento'}</p>`,
            foot: '<button id="copiar">Copiar</button><button class="primary" data-close>Listo</button>',
            onMount: m2 => m2.querySelector('#copiar').onclick = () => navigator.clipboard?.writeText(r.codigo).then(() => toast('Código copiado'), () => toast('No se pudo copiar; selecciónelo a mano.', true)),
          });
        };
      },
    });
  }

  function editar(u) {
    modal({
      title: `Licencia — ${esc(u.nombre)}`,
      body: `<form id="lf" class="form-grid">
        <label class="field full"><span>Cliente</span><input name="cliente" value="${esc(u.cliente || '')}"></label>
        ${camposLic(u.licencia_modulos, u.licencia_vence)}
        <label class="field full"><span>Estado</span><select name="estado">
          <option value="activa" ${u.licencia_estado === 'activa' ? 'selected' : ''}>Activa</option>
          <option value="suspendida" ${u.licencia_estado !== 'activa' ? 'selected' : ''}>Suspendida (solo consulta)</option></select></label>
        <p class="small muted full">Vencida o suspendida, la unidad puede consultar y exportar sus datos, pero no registrar. Un módulo no contratado desaparece del menú de la unidad; sus datos se conservan.</p>
      </form>`,
      foot: '<button data-close>Cancelar</button><button class="primary" id="ok">Guardar licencia</button>',
      onMount: (m, api) => {
        const f = m.querySelector('#lf');
        atajos(f);
        m.querySelector('#ok').onclick = async e => {
          if (e.target.disabled) return;
          e.target.disabled = true;
          const r = await pedir('actualizar', {
            unidad_id: u.id, cliente: f.cliente.value, modulos: { cantina: f.cantina.checked, coal: f.coal.checked },
            vence: f.vence.value, estado: f.estado.value,
          });
          e.target.disabled = false;
          if (!r) return;
          api.close(); toast('Licencia actualizada'); render();
          cloud.sincronizar(); // por si se cambió la licencia de la unidad propia
        };
      },
    });
  }

  render();
  pedir('listar').then(render);
}
