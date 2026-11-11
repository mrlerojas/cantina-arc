import { q, can, moduleOn, currentUnit, todayStr, addDays } from '../store.js';
import { saldoCliente, valorInventario, stockBajo, resumenCoalDia, balanceCoal, stock } from '../domain.js';
import { money, kpi, esc, fdate, periodo, qty } from '../ui.js';

export function renderDashboard(_p, el) {
  const hoy = todayStr();
  const un = currentUnit();
  let html = `<div class="row" style="margin-bottom:14px"><div><h2>${esc(un.nombre)}</h2><div class="muted small">${new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div></div></div>`;

  if (moduleOn('cantina') && can('cantina.ver')) {
    const vHoy = q('ventas', v => v.estado === 'activo' && v.fecha === hoy);
    const credito = q('clientes').reduce((s, c) => s + Math.max(0, saldoCliente(c.id)), 0);
    const bajos = stockBajo('cantina');
    const dias = [...Array(7)].map((_, i) => addDays(hoy, i - 6));
    const porDia = dias.map(d => q('ventas', v => v.estado === 'activo' && v.fecha === d).reduce((s, v) => s + v.total, 0));
    const max = Math.max(1, ...porDia);
    html += `
      <div class="module-head"><span class="tag">CANTINA</span></div>
      <div class="grid grid-4">
        ${kpi('Ventas hoy', money(vHoy.reduce((s, v) => s + v.total, 0)), `${vHoy.length} ventas`)}
        ${kpi('Créditos por cobrar', money(credito), `${q('clientes').filter(c => saldoCliente(c.id) > 0).length} clientes con saldo`)}
        ${kpi('Inventario (costo)', money(valorInventario('cantina')), `${q('productos', p => p.modulo === 'cantina' && p.estado === 'activo').length} productos`)}
        ${kpi('Stock bajo', String(bajos.length), bajos.length ? esc(bajos.slice(0, 3).map(p => p.nombre).join(', ')) : 'Sin alertas')}
      </div>
      <div class="grid grid-2" style="margin-top:14px">
        <div class="card"><div class="card-head"><h3>Ventas últimos 7 días</h3><span class="muted small">${money(porDia.reduce((a, b) => a + b, 0))}</span></div>
          <div class="bars">${porDia.map((v, i) => `<div class="b" title="${fdate(dias[i])}: ${money(v)}"><i style="height:${(v / max) * 100}%"></i><span>${dias[i].slice(8)}</span></div>`).join('')}</div>
        </div>
        <div class="card"><div class="card-head"><h3>Alertas de inventario</h3><a href="#/cantina/inventario" class="small">Ver inventario</a></div>
          ${bajos.length ? `<table><tbody>${bajos.slice(0, 6).map(p => `<tr><td>${esc(p.nombre)}</td><td class="num"><span class="badge warn">${qty(stock(p.id))} ${esc(p.unidad_medida)}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Todo el inventario está sobre el mínimo.</div>'}
        </div>
      </div>`;
  }

  if (moduleOn('coal') && can('coal.ver')) {
    const r = resumenCoalDia(hoy);
    const [m1, m2] = periodo('mes');
    const bm = balanceCoal(m1, hoy < m2 ? hoy : m2);
    html += `
      <div class="module-head" style="margin-top:22px"><span class="tag">COAL</span><span class="muted small">Hoy ${fdate(hoy)}${r.dia ? '' : ' — sin registro de personal'}</span></div>
      <div class="grid grid-4">
        ${kpi('Costo alimentación hoy', money(r.total), `Conv. ${money(r.conv)} · Oper. ${money(r.oper)}`)}
        ${kpi('Personas alimentadas', String(r.personas), r.dia ? (r.dia.situacion === 'navegando' ? 'Navegando' : 'En puerto') : '—')}
        ${kpi('Costo / persona', money(r.costoPersona), `Mes: ${money(bm.costos.porPersona)}`)}
        ${kpi('Resultado del mes', `<span class="${bm.resultado.diferencia >= 0 ? 'pos' : 'neg'}">${money(bm.resultado.diferencia)}</span>`, `Aportes ${money(bm.aportes.total)}`)}
      </div>`;
  }

  const quick = [];
  if (moduleOn('cantina') && can('cantina.operar')) quick.push(['cantina/pos', '🛒', 'Nueva venta']);
  if (moduleOn('cantina') && can('cantina.ver')) quick.push(['cantina/clientes', '👥', 'Clientes']);
  if (moduleOn('coal') && can('coal.ver')) quick.push(['coal/dia', '🍽️', 'Registro COAL']);
  if (moduleOn('coal') && can('coal.ver')) quick.push(['coal/parte', '📄', 'Parte diario']);
  if (can('balances')) {
    if (moduleOn('cantina') && can('cantina.ver')) quick.push(['cantina/balance', '📊', 'Balance CANTINA']);
    if (moduleOn('coal') && can('coal.ver')) quick.push(['coal/balance', '📊', 'Balance COAL']);
  }
  html += `<div class="card" style="margin-top:22px"><h3 style="margin-bottom:12px">Accesos rápidos</h3>
    <div class="quick">${quick.map(([p, i, l]) => `<a href="#/${p}"><span class="ic">${i}</span>${l}</a>`).join('')}</div></div>`;

  el.innerHTML = html;
}
