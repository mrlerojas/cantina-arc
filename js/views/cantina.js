import { q, get, insert, update, can, currentUnit, todayStr, audit, userName } from '../store.js';
import {
  precioVigente, stock, registrarVenta, anularVenta, saldoCliente, registrarPago, anularPago, nombreCliente,
  reciboTexto, estadoCuentaTexto, waLink, balanceCantina, METODOS_PAGO, pad, productosModulo, ajustarSaldoAnterior,
} from '../domain.js';
import {
  esc, money, fdate, fdt, qty, toast, attempt, modal, askMotivo, exportCSV, printDoc, rangeBar, bindRange,
  periodo, thumb, emptyRow, estadoBadge, kpi,
} from '../ui.js';

// ============================ POS ============================
const cart = { tipo: 'tripulacion', items: {}, cat: 'Todas', search: '', cliente_id: '' };

export function pos(_p, el) {
  const productos = productosModulo('cantina');
  const cats = ['Todas', ...new Set(productos.map(p => p.categoria || 'General'))];
  const precio = p => (precioVigente(p.id) || {})[cart.tipo] || 0;

  const render = () => {
    const s = cart.search.toLowerCase();
    const list = productos.filter(p => (cart.cat === 'Todas' || (p.categoria || 'General') === cart.cat) && (!s || p.nombre.toLowerCase().includes(s)));
    const n = Object.values(cart.items).reduce((a, b) => a + b, 0);
    el.innerHTML = `
      <div class="pos-layout">
        <div>
          <div class="pos-tools">
            <div class="seg">
              <button data-tipo="tripulacion" class="${cart.tipo === 'tripulacion' ? 'on' : ''}">Tripulación</button>
              <button data-tipo="externo" class="${cart.tipo === 'externo' ? 'on' : ''}">Externo</button>
            </div>
            <input type="search" id="buscar" placeholder="Buscar producto…" value="${esc(cart.search)}">
          </div>
          <div class="chips">${cats.map(c => `<button class="chip ${c === cart.cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
          <div class="products">
            ${list.map(p => {
              const st = stock(p.id);
              const inCart = cart.items[p.id] || 0;
              return `<button class="pcard ${st <= 0 ? 'out' : ''}" data-add="${p.id}" aria-label="${esc(p.nombre)}, ${money(precio(p))}, ${st <= 0 ? 'agotado' : `stock ${qty(st)} ${esc(p.unidad_medida)}`}" ${st <= 0 ? 'disabled' : ''}>
                ${inCart ? `<span class="incart">${qty(inCart)}</span>` : ''}
                <div class="ph">${thumb(p)}</div>
                <div class="pb"><div class="pn">${esc(p.nombre)}</div><div class="pp">${money(precio(p))}</div>
                <div class="ps">${st <= 0 ? 'Agotado' : `Stock: ${qty(st)} ${esc(p.unidad_medida)}`}</div></div>
              </button>`;
            }).join('') || '<div class="empty">No hay productos. Créelos en Productos y precios.</div>'}
          </div>
        </div>
        <aside class="card cart" id="cart">${cartHTML(productos, precio)}</aside>
      </div>
      <button class="cart-bar" id="cartbar" ${n ? '' : 'hidden'}>🛒 Ver pedido (<span id="cartn">${qty(n)}</span>)<b id="cartt">${money(total(precio))}</b></button>`;
    bind();
  };

  const total = precio => Object.entries(cart.items).reduce((s, [id, c]) => s + c * precio(get('productos', id)), 0);

  const cartHTML = () => {
    const lines = Object.entries(cart.items);
    return `
      <div class="card-head"><h2>Pedido</h2><span class="badge">${cart.tipo === 'tripulacion' ? 'Tripulación' : 'Externo'}</span></div>
      ${lines.length ? lines.map(([id, c]) => {
        const p = get('productos', id);
        return `<div class="cart-line">
          <div><b>${esc(p.nombre)}</b><div class="small muted">${money(precio(p))} / ${esc(p.unidad_medida)}</div></div>
          <div class="num"><b>${money(c * precio(p))}</b></div>
          <div class="qty"><button data-dec="${id}">−</button>
            <input type="number" step="any" min="0" inputmode="decimal" value="${c}" data-set="${id}" style="width:70px;min-height:30px;padding:4px 6px;text-align:center">
            <button data-inc="${id}">+</button></div>
          <div class="num"><button class="ghost sm" data-rm="${id}">Quitar</button></div>
        </div>`;
      }).join('') : '<div class="empty">Toque los productos para agregarlos.</div>'}
      <div class="cart-total"><span>Total</span><span>${money(total(precio))}</span></div>
      <div class="row">
        <button ${lines.length ? '' : 'disabled'} data-clear>Vaciar</button>
        <button class="primary lg spacer" ${lines.length ? '' : 'disabled'} data-cobrar>Cobrar</button>
      </div>`;
  };

  const changeQty = (id, v) => {
    const p = get('productos', id);
    const st = stock(id);
    v = Math.max(0, Math.round(v * 1000) / 1000);
    if (v > st) { toast(`Solo hay ${qty(st)} ${p.unidad_medida} de ${p.nombre}.`, true); v = st; }
    if (v <= 0) delete cart.items[id]; else cart.items[id] = v;
  };

  const bindCart = root => {
    root.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { changeQty(b.dataset.inc, (cart.items[b.dataset.inc] || 0) + 1); refresh(root); });
    root.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => { changeQty(b.dataset.dec, (cart.items[b.dataset.dec] || 0) - 1); refresh(root); });
    root.querySelectorAll('[data-set]').forEach(i => i.onchange = () => { changeQty(i.dataset.set, +i.value || 0); refresh(root); });
    root.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { delete cart.items[b.dataset.rm]; refresh(root); });
    root.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => { cart.items = {}; refresh(root); });
    root.querySelectorAll('[data-cobrar]').forEach(b => b.onclick = () => checkout());
  };

  let cartModal = null;
  const refresh = root => {
    if (cartModal && root === cartModal.el.querySelector('.modal-body')) {
      root.innerHTML = cartHTML(); bindCart(root);
      if (!Object.keys(cart.items).length) cartModal.close();
    }
    render();
  };

  const bind = () => {
    el.querySelectorAll('[data-tipo]').forEach(b => b.onclick = () => { cart.tipo = b.dataset.tipo; render(); });
    el.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { cart.cat = b.dataset.cat; render(); });
    const s = el.querySelector('#buscar');
    s.oninput = () => { cart.search = s.value; render(); const n = el.querySelector('#buscar'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    // Agregar actualiza solo la tarjeta y el pedido: la cuadrícula no se redibuja ni se desplaza.
    el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
      const id = b.dataset.add;
      changeQty(id, (cart.items[id] || 0) + 1);
      let badge = b.querySelector('.incart');
      if (cart.items[id]) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'incart'; b.prepend(badge); }
        badge.textContent = qty(cart.items[id]);
      } else if (badge) badge.remove();
      const aside = el.querySelector('#cart');
      aside.innerHTML = cartHTML(); bindCart(aside);
      const n = Object.values(cart.items).reduce((a, c) => a + c, 0);
      const bar = el.querySelector('#cartbar');
      bar.hidden = !n;
      bar.querySelector('#cartn').textContent = qty(n);
      bar.querySelector('#cartt').textContent = money(total(precio));
    });
    bindCart(el.querySelector('#cart'));
    const bar = el.querySelector('#cartbar');
    bar.onclick = () => {
      cartModal = modal({ title: 'Pedido', body: cartHTML(), onMount: m => bindCart(m.querySelector('.modal-body')) });
    };
  };

  function checkout() {
    if (cartModal) { cartModal.close(); cartModal = null; }
    const tot = total(precio);
    const clientes = q('clientes', c => c.estado === 'activo').sort((a, b) => nombreCliente(a).localeCompare(nombreCliente(b)));
    const st = { forma: 'contado' };
    modal({
      title: `Cobrar ${money(tot)}`,
      body: `
        <div class="stack">
          <label class="field"><span>Cliente</span>
            <div class="row"><select id="cli" style="flex:1"><option value="">Consumidor general (sin cuenta)</option>
              ${clientes.map(c => `<option value="${c.id}" ${c.id === cart.cliente_id ? 'selected' : ''}>${esc(nombreCliente(c))}${c.tipo === 'externo' ? ' (externo)' : ''}</option>`).join('')}
            </select><button type="button" id="nuevo-cli">+ Nuevo</button></div></label>
          <div><div class="seg" id="forma"><button class="on" data-f="contado">Contado</button><button data-f="credito">Crédito</button></div></div>
          <label class="field"><span>Método de pago</span><select id="metodo">${METODOS_PAGO.map(m => `<option>${m}</option>`).join('')}</select></label>
          <label class="field hidden" id="abono-wrap"><span>Abono inicial (opcional)</span><input type="number" id="abono" min="0" inputmode="numeric" value="0"></label>
          <div class="card" style="background:var(--navy-soft);border:0" id="resumen"></div>
        </div>`,
      foot: `<button data-close>Cancelar</button><button class="primary lg" id="confirmar">Confirmar venta</button>`,
      onMount: (m, api) => {
        const cli = m.querySelector('#cli');
        const resumen = () => {
          const saldo = cli.value ? saldoCliente(cli.value) : 0;
          const ab = st.forma === 'credito' ? (+m.querySelector('#abono').value || 0) : tot;
          m.querySelector('#resumen').innerHTML = `
            <div class="row"><span>Total venta</span><span class="spacer"></span><b>${money(tot)}</b></div>
            ${cli.value ? `<div class="row small"><span>Saldo anterior</span><span class="spacer"></span>${money(saldo)}</div>` : ''}
            ${st.forma === 'credito' ? `<div class="row small"><span>Abono</span><span class="spacer"></span>${money(ab)}</div>
              <div class="row"><span>Saldo resultante</span><span class="spacer"></span><b>${money(saldo + tot - ab)}</b></div>` : ''}`;
        };
        m.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
          st.forma = b.dataset.f;
          m.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x === b));
          m.querySelector('#abono-wrap').classList.toggle('hidden', st.forma !== 'credito');
          resumen();
        });
        cli.onchange = resumen;
        m.querySelector('#abono').oninput = resumen;
        m.querySelector('#nuevo-cli').onclick = () => clienteForm(null, c => {
          cli.insertAdjacentHTML('beforeend', `<option value="${c.id}">${esc(nombreCliente(c))}</option>`);
          cli.value = c.id; resumen();
        }, cart.tipo);
        resumen();
        m.querySelector('#confirmar').onclick = () => {
          const v = attempt(() => registrarVenta({
            tipo_precio: cart.tipo,
            cliente_id: cli.value || null,
            items: Object.entries(cart.items).map(([producto_id, cantidad]) => ({ producto_id, cantidad })),
            forma: st.forma,
            metodo: m.querySelector('#metodo').value,
            pagado: +m.querySelector('#abono').value || 0,
          }));
          if (!v) return;
          cart.items = {}; cart.cliente_id = '';
          api.close(); render();
          toast(`Venta #${pad(v.numero)} registrada`);
          showRecibo(v, true);
        };
      },
    });
  }

  render();
}

export function showRecibo(v, nueva = false) {
  const c = v.cliente_id ? get('clientes', v.cliente_id) : null;
  const texto = reciboTexto(v);
  modal({
    title: `Recibo #${pad(v.numero)}`,
    body: `
      <div class="receipt">${esc(texto.replace(/\*/g, ''))}</div>
      <label class="field" style="margin-top:12px"><span>Enviar a WhatsApp</span>
        <input id="tel" type="tel" inputmode="numeric" placeholder="Número de celular" value="${esc(c?.telefono || '')}"></label>
      <p class="small muted">Registrada por ${esc(userName(v.creado_por))} · ${fdt(v.creado_en)}${v.estado === 'anulado' ? ` · <b class="neg">Anulada: ${esc(v.motivo)}</b>` : ''}</p>`,
    foot: `<button id="imp">Imprimir</button><button class="primary" id="wa">Enviar por WhatsApp</button>${nueva ? '<button data-close>Nueva venta</button>' : ''}`,
    onMount: m => {
      m.querySelector('#wa').onclick = () => {
        const tel = m.querySelector('#tel').value;
        if (!tel.replace(/\D/g, '')) return toast('Ingrese el número de celular.', true);
        window.open(waLink(tel, texto), '_blank');
      };
      m.querySelector('#imp').onclick = () => printDoc(`<pre style="font-family:monospace;font-size:13px">${esc(texto.replace(/\*/g, ''))}</pre>`);
    },
  });
}

// ============================ CLIENTES ============================
export function clienteForm(c, onSave, tipoDefault = 'tripulacion') {
  modal({
    title: c ? 'Editar cliente' : 'Nuevo cliente',
    body: `
      <form id="cf" class="form-grid">
        <label class="field"><span>Tipo</span><select name="tipo">
          <option value="tripulacion" ${(c?.tipo || tipoDefault) === 'tripulacion' ? 'selected' : ''}>Tripulación</option>
          <option value="externo" ${(c?.tipo || tipoDefault) === 'externo' ? 'selected' : ''}>Externo</option></select></label>
        <label class="field"><span>Grado</span><input name="grado" value="${esc(c?.grado || '')}" placeholder="MA, S2, C3, TK…"></label>
        <label class="field"><span>Apellido</span><input name="apellido" value="${esc(c?.apellido || '')}" required></label>
        <label class="field"><span>Nombre</span><input name="nombre" value="${esc(c?.nombre || '')}"></label>
        <label class="field full"><span>Teléfono (WhatsApp)</span><input name="telefono" type="tel" inputmode="numeric" value="${esc(c?.telefono || '')}"></label>
        ${c && can('admin') ? `<div class="full"><h3 style="margin:6px 0 0">Saldo anterior <span class="small muted">(deuda traída de otro sistema; solo el administrador)</span></h3></div>
          <label class="field"><span>Saldo anterior</span><input name="saldo_inicial" type="number" min="0" inputmode="numeric" value="${c.saldo_inicial || 0}"></label>
          <label class="field"><span>Motivo si lo cambia</span><input name="motivo_saldo" placeholder="Ej.: abonó $20.000 en Treinta"></label>` : ''}
      </form>`,
    foot: `<button data-close>Cancelar</button><button class="primary" id="ok">Guardar</button>`,
    onMount: (m, api) => m.querySelector('#ok').onclick = () => {
      const f = m.querySelector('#cf');
      if (!f.reportValidity()) return;
      const data = { tipo: f.tipo.value, grado: f.grado.value.trim(), apellido: f.apellido.value.trim(), nombre: f.nombre.value.trim(), telefono: f.telefono.value.replace(/\D/g, '') };
      if (!can('cantina.operar')) return toast('No tiene permiso para realizar esta acción.', true);
      if (f.saldo_inicial && (+f.saldo_inicial.value || 0) !== (c.saldo_inicial || 0)) {
        if (!attempt(() => ajustarSaldoAnterior(c.id, f.saldo_inicial.value, f.motivo_saldo.value))) return;
      }
      const row = c ? update('clientes', c.id, data) : insert('clientes', data);
      audit(c ? 'Cliente modificado' : 'Cliente creado', 'clientes', row.id, nombreCliente(row));
      api.close(); onSave && onSave(row);
    },
  });
}

export function clientes(_p, el) {
  const st = { s: '', saldo: false };
  const render = () => {
    const rows = q('clientes', c => c.estado === 'activo')
      .map(c => ({ c, saldo: saldoCliente(c.id) }))
      .filter(({ c, saldo }) => (!st.s || nombreCliente(c).toLowerCase().includes(st.s) || (c.telefono || '').includes(st.s)) && (!st.saldo || saldo > 0))
      .sort((a, b) => b.saldo - a.saldo || nombreCliente(a.c).localeCompare(nombreCliente(b.c)));
    const totalCxC = rows.reduce((s, r) => s + Math.max(0, r.saldo), 0);
    el.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:14px">
        ${kpi('Total por cobrar', money(totalCxC))}
        ${kpi('Clientes con saldo', String(rows.filter(r => r.saldo > 0).length))}
        ${kpi('Clientes registrados', String(q('clientes', c => c.estado === 'activo').length))}
      </div>
      <div class="card">
        <div class="card-head">
          <div class="row"><input type="search" id="s" placeholder="Buscar por nombre o teléfono" value="${esc(st.s)}" style="width:260px">
          <label class="check"><input type="checkbox" id="saldo" ${st.saldo ? 'checked' : ''}> Solo con saldo</label></div>
          <div class="row">
            <button id="csv">Exportar Excel</button>
            ${can('cantina.operar') ? '<button class="primary" id="nuevo">+ Nuevo cliente</button>' : ''}
          </div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Cliente</th><th>Tipo</th><th>Teléfono</th><th class="num">Saldo</th></tr></thead>
          <tbody>${rows.map(({ c, saldo }) => `<tr class="clickable" data-id="${c.id}">
            <td><b>${esc(nombreCliente(c))}</b></td><td>${c.tipo === 'externo' ? 'Externo' : 'Tripulación'}</td>
            <td>${esc(c.telefono || '—')}</td><td class="num ${saldo > 0 ? 'neg' : ''}"><b>${money(saldo)}</b></td></tr>`).join('') || emptyRow(4)}</tbody>
        </table></div>
      </div>`;
    const s = el.querySelector('#s');
    s.oninput = () => { st.s = s.value.toLowerCase(); render(); const n = el.querySelector('#s'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    el.querySelector('#saldo').onchange = e => { st.saldo = e.target.checked; render(); };
    el.querySelector('#nuevo')?.addEventListener('click', () => clienteForm(null, render));
    el.querySelector('#csv').onclick = () => exportCSV(`clientes_${todayStr()}`, [['Grado', 'Apellido', 'Nombre', 'Tipo', 'Teléfono', 'Saldo'],
      ...rows.map(({ c, saldo }) => [c.grado, c.apellido, c.nombre, c.tipo, c.telefono, saldo])]);
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => clienteDetalle(tr.dataset.id, render));
  };
  render();
}

function clienteDetalle(id, onChange) {
  const c = get('clientes', id);
  const saldo = saldoCliente(id);
  const ventas = q('ventas', v => v.cliente_id === id).sort((a, b) => b.creado_en.localeCompare(a.creado_en));
  const pagos = q('pagos', p => p.cliente_id === id).sort((a, b) => b.creado_en.localeCompare(a.creado_en));
  const movs = [
    ...ventas.map(v => ({ f: v.fecha, k: v.creado_en, html: `<tr class="${v.estado === 'anulado' ? 'anulado' : ''}"><td>${fdate(v.fecha)}</td><td><a href="#" data-venta="${v.id}">Venta #${pad(v.numero)}</a> <span class="small muted">${v.forma === 'credito' ? 'Crédito' : 'Contado'}</span></td><td class="num">${money(v.total)}</td><td class="num">${v.forma === 'credito' ? money(v.total - (v.pagado || 0)) : '—'}</td><td>${v.estado === 'anulado' ? estadoBadge('anulado') : ''}</td></tr>` })),
    ...pagos.map(p => ({ f: p.fecha, k: p.creado_en, html: `<tr class="${p.estado === 'anulado' ? 'anulado' : ''}"><td>${fdate(p.fecha)}</td><td>Pago ${esc(p.metodo || '')}${p.nota ? ` <span class="small muted">${esc(p.nota)}</span>` : ''}</td><td class="num"></td><td class="num pos">-${money(p.valor)}</td><td>${p.estado === 'activo' && can('anular') ? `<button class="sm danger" data-anpago="${p.id}">Anular</button>` : p.estado === 'anulado' ? estadoBadge('anulado') : ''}</td></tr>` })),
  ].sort((a, b) => (b.f + b.k).localeCompare(a.f + a.k));
  // Deuda que el cliente traía al migrar (queda al final del historial, con su detalle).
  if (c.saldo_inicial) {
    const det = c.saldo_inicial_detalle || [];
    movs.push({ html: `<tr><td>${fdate(c.saldo_inicial_fecha || '')}</td><td><b>Saldo anterior${c.saldo_inicial_origen ? ' (' + esc(c.saldo_inicial_origen) + ')' : ''}</b>
      ${det.length ? `<details class="small muted"><summary>${det.length} compra(s) fiadas</summary>${det.map(d => `${esc(d.fecha)} · ${esc(d.descripcion)} · ${money(d.valor)}`).join('<br>')}</details>` : ''}</td>
      <td class="num">${money(c.saldo_inicial)}</td><td class="num">${money(c.saldo_inicial)}</td><td></td></tr>` });
  }
  const api = modal({
    title: esc(nombreCliente(c)),
    wide: true,
    body: `
      <div class="grid grid-3">
        ${kpi('Saldo pendiente', `<span class="${saldo > 0 ? 'neg' : ''}">${money(saldo)}</span>`)}
        ${kpi('Compras', String(ventas.filter(v => v.estado === 'activo').length), money(ventas.filter(v => v.estado === 'activo').reduce((s, v) => s + v.total, 0)))}
        ${kpi('Teléfono', esc(c.telefono || '—'), c.tipo === 'externo' ? 'Externo' : 'Tripulación')}
      </div>
      <h3 style="margin:16px 0 6px">Historial</h3>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th class="num">Valor</th><th class="num">Efecto en saldo</th><th></th></tr></thead>
      <tbody>${movs.map(m => m.html).join('') || emptyRow(5)}</tbody></table></div>`,
    foot: `
      ${can('cantina.operar') ? '<button id="editar">Editar</button>' : ''}
      <button id="recordar" ${saldo > 0 && c.telefono ? '' : 'disabled'}>Recordatorio WhatsApp</button>
      <button id="estado" ${c.telefono ? '' : 'disabled'}>Estado de cuenta WhatsApp</button>
      ${can('cantina.operar') ? `<button class="primary" id="pagar" ${saldo > 0 ? '' : 'disabled'}>Registrar pago</button>` : ''}`,
    onMount: (m, api) => {
      m.querySelector('#editar')?.addEventListener('click', () => { api.close(); clienteForm(c, () => { onChange(); clienteDetalle(id, onChange); }); });
      m.querySelector('#recordar').onclick = () => window.open(waLink(c.telefono, estadoCuentaTexto(id, true)), '_blank');
      m.querySelector('#estado').onclick = () => window.open(waLink(c.telefono, estadoCuentaTexto(id)), '_blank');
      m.querySelector('#pagar')?.addEventListener('click', () => pagoForm(c, () => { api.close(); onChange(); clienteDetalle(id, onChange); }));
      m.querySelectorAll('[data-venta]').forEach(a => a.onclick = e => { e.preventDefault(); showRecibo(get('ventas', a.dataset.venta)); });
      m.querySelectorAll('[data-anpago]').forEach(b => b.onclick = async () => {
        const motivo = await askMotivo('Anular pago');
        if (motivo && attempt(() => (anularPago(b.dataset.anpago, motivo), true))) { toast('Pago anulado'); api.close(); onChange(); clienteDetalle(id, onChange); }
      });
    },
  });
  return api;
}

function pagoForm(c, done) {
  const saldo = saldoCliente(c.id);
  modal({
    title: `Pago — ${esc(nombreCliente(c))}`,
    body: `
      <p>Saldo actual: <b>${money(saldo)}</b></p>
      <div class="form-grid">
        <label class="field"><span>Valor</span><input type="number" id="valor" min="1" max="${saldo}" inputmode="numeric" value="${saldo}"></label>
        <label class="field"><span>Método</span><select id="metodo">${METODOS_PAGO.map(m => `<option>${m}</option>`).join('')}</select></label>
        <label class="field"><span>Fecha</span><input type="date" id="fecha" value="${todayStr()}"></label>
        <label class="field"><span>Nota</span><input id="nota"></label>
      </div>
      <p class="small muted" id="nuevo-saldo"></p>`,
    foot: `<button data-close>Cancelar</button><button class="primary" id="ok">Registrar pago</button>`,
    onMount: (m, api) => {
      const upd = () => m.querySelector('#nuevo-saldo').textContent = `Saldo después del pago: ${money(saldo - (+m.querySelector('#valor').value || 0))}`;
      m.querySelector('#valor').oninput = upd; upd();
      m.querySelector('#ok').onclick = () => {
        const p = attempt(() => registrarPago({ cliente_id: c.id, valor: m.querySelector('#valor').value, metodo: m.querySelector('#metodo').value, fecha: m.querySelector('#fecha').value, nota: m.querySelector('#nota').value }));
        if (!p) return;
        api.close(); toast('Pago registrado');
        if (c.telefono && confirm('¿Enviar comprobante de pago por WhatsApp?')) {
          const un = currentUnit();
          window.open(waLink(c.telefono, `*CANTINA ${un.nombre.toUpperCase()}*\n\nPago recibido: ${money(p.valor)} (${p.metodo})\nFecha: ${fdate(p.fecha)}\n*Saldo actual: ${money(saldoCliente(c.id))}*\n\n¡Gracias!`), '_blank');
        }
        done();
      };
    },
  });
}

// ============================ VENTAS ============================
const ventasSt = { tipo: 'hoy', d1: todayStr(), d2: todayStr(), forma: '' };

export function ventas(_p, el) {
  const st = ventasSt;
  const render = () => {
    const rows = q('ventas', v => v.fecha >= st.d1 && v.fecha <= st.d2 && (!st.forma || v.forma === st.forma))
      .sort((a, b) => b.numero - a.numero);
    const act = rows.filter(v => v.estado === 'activo');
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px">${rangeBar(st)}</div>
      <div class="grid grid-4" style="margin-bottom:14px">
        ${kpi('Total vendido', money(act.reduce((s, v) => s + v.total, 0)), `${act.length} ventas`)}
        ${kpi('Contado', money(act.filter(v => v.forma === 'contado').reduce((s, v) => s + v.total, 0)))}
        ${kpi('Crédito', money(act.filter(v => v.forma === 'credito').reduce((s, v) => s + v.total, 0)))}
        ${kpi('Anuladas', String(rows.length - act.length))}
      </div>
      <div class="card">
        <div class="card-head">
          <div class="seg">${[['', 'Todas'], ['contado', 'Contado'], ['credito', 'Crédito']].map(([k, l]) => `<button data-forma="${k}" class="${st.forma === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <button id="csv">Exportar Excel</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Precio</th><th>Pago</th><th class="num">Total</th><th>Usuario</th><th>Estado</th><th></th></tr></thead>
          <tbody>${rows.map(v => `<tr class="${v.estado === 'anulado' ? 'anulado' : ''}">
            <td><a href="#" data-ver="${v.id}">${pad(v.numero)}</a></td>
            <td>${fdate(v.fecha)} <span class="small muted">${v.hora || ''}</span></td>
            <td>${esc(nombreCliente(get('clientes', v.cliente_id)))}</td>
            <td>${v.tipo_precio === 'externo' ? 'Externo' : 'Tripulación'}</td>
            <td>${v.forma === 'credito' ? 'Crédito' : 'Contado'} <span class="small muted">${esc(v.forma !== 'credito' || v.pagado > 0 ? v.metodo || '' : '')}</span></td>
            <td class="num"><b>${money(v.total)}</b></td>
            <td class="small">${esc(userName(v.creado_por))}</td>
            <td>${estadoBadge(v.estado)}</td>
            <td>${v.estado === 'activo' && can('anular') ? `<button class="sm danger" data-anular="${v.id}">Anular</button>` : ''}</td>
          </tr>`).join('') || emptyRow(9)}</tbody>
        </table></div>
      </div>`;
    bindRange(el, st, render);
    el.querySelectorAll('[data-forma]').forEach(b => b.onclick = () => { st.forma = b.dataset.forma; render(); });
    el.querySelectorAll('[data-ver]').forEach(a => a.onclick = e => { e.preventDefault(); showRecibo(get('ventas', a.dataset.ver)); });
    el.querySelectorAll('[data-anular]').forEach(b => b.onclick = async () => {
      const motivo = await askMotivo('Anular venta');
      if (motivo && attempt(() => (anularVenta(b.dataset.anular, motivo), true))) { toast('Venta anulada; inventario restituido'); render(); }
    });
    el.querySelector('#csv').onclick = () => exportCSV(`ventas_${st.d1}_${st.d2}`, [
      ['Venta', 'Fecha', 'Hora', 'Cliente', 'Tipo precio', 'Forma', 'Método', 'Producto', 'Cantidad', 'Unidad', 'Precio', 'Subtotal', 'Estado', 'Usuario'],
      ...rows.flatMap(v => v.items.map(i => [pad(v.numero), fdate(v.fecha), v.hora, nombreCliente(get('clientes', v.cliente_id)), v.tipo_precio, v.forma, v.metodo, i.nombre, i.cantidad, i.unidad_medida, i.precio, i.cantidad * i.precio, v.estado, userName(v.creado_por)])),
    ]);
  };
  render();
}

// ============================ BALANCE ============================
const balSt = { tipo: 'mes', d1: periodo('mes')[0], d2: periodo('mes')[1] };

export function balance(_p, el) {
  const st = balSt;
  const render = () => {
    const b = balanceCantina(st.d1, st.d2);
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px"><div class="row">${rangeBar(st)}<span class="spacer"></span>
        <button id="csv">Exportar Excel</button><button class="primary" id="pdf">Imprimir / PDF</button></div></div>
      <div class="grid grid-4" style="margin-bottom:14px">
        ${kpi('Ventas', money(b.ingresos.total), `${b.numVentas} ventas`)}
        ${kpi('Costo mercancía', money(b.resultado.costo))}
        ${kpi('Gastos', money(b.resultado.gastos))}
        ${kpi('Ganancia', `<span class="${b.resultado.ganancia >= 0 ? 'pos' : 'neg'}">${money(b.resultado.ganancia)}</span>`, b.ingresos.total ? `Margen ${Math.round((b.resultado.ganancia / b.ingresos.total) * 100)}%` : '')}
      </div>
      <div id="doc">${balanceHTML(b)}</div>`;
    bindRange(el, st, render);
    el.querySelector('#pdf').onclick = () => printDoc(docHead('BALANCE CANTINA', b) + balanceHTML(b));
    el.querySelector('#csv').onclick = () => exportCSV(`balance_cantina_${st.d1}_${st.d2}`, balanceRows(b));
  };
  render();
}

function docHead(titulo, b) {
  const un = currentUnit();
  return `<div class="doc-head"><h1>${esc(un.nombre)}</h1><b>${titulo}</b><br>Periodo: ${fdate(b.d1)} al ${fdate(b.d2)}<br><span class="small">Generado ${fdt(new Date().toISOString())}</span></div>`;
}

function balanceRows(b) {
  return [
    ['BALANCE CANTINA', `${fdate(b.d1)} - ${fdate(b.d2)}`],
    [], ['INGRESOS'], ['Ventas tripulación', b.ingresos.tripulacion], ['Ventas externos', b.ingresos.externos], ['Total ventas', b.ingresos.total],
    [], ['EGRESOS'], ['Compras', b.egresos.compras], ['Gastos', b.egresos.gastos], ['Total egresos', b.egresos.total],
    [], ['INVENTARIO (a costo)'], ['Inventario inicial', b.inventario.inicial], ['Entradas', b.inventario.entradas], ['Salidas', b.inventario.salidas], ['Inventario final', b.inventario.final],
    [], ['CUENTAS POR COBRAR'], ['Saldo inicial', b.cxc.inicial], ['Nuevos créditos', b.cxc.nuevos], ['Pagos recibidos', b.cxc.pagos], ['Saldo final', b.cxc.final],
    [], ['RESULTADO'], ['Ventas', b.resultado.ventas], ['Costo de mercancía', b.resultado.costo], ['Utilidad bruta', b.resultado.utilidadBruta], ['Gastos', b.resultado.gastos], ['Ganancia', b.resultado.ganancia],
    [], ['FLUJO DE CAJA'], ['Recaudo de ventas', b.caja.recaudoVentas], ['Pagos de créditos', b.caja.pagos], ...Object.entries(b.caja.porMetodo).map(([k, v]) => ['  ' + k, v]), ['Compras y gastos', -b.caja.egresos], ['Neto', b.caja.neto],
  ];
}

function balanceHTML(b) {
  const tr = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="num">${money(v)}</td></tr>`;
  const sec = (t, rows) => `<div class="card"><h3 style="margin-bottom:8px">${t}</h3><table><tbody>${rows}</tbody></table></div>`;
  return `<div class="grid grid-2">
    <div class="stack">
      ${sec('Ingresos', tr('Ventas tripulación', b.ingresos.tripulacion) + tr('Ventas externos', b.ingresos.externos) + tr('Total ingresos', b.ingresos.total, 'total'))}
      ${sec('Egresos', tr('Compras', b.egresos.compras) + tr('Gastos', b.egresos.gastos) + tr('Total egresos', b.egresos.total, 'total'))}
      ${sec('Resultado', tr('Ventas', b.resultado.ventas) + tr('(−) Costo de mercancía vendida', b.resultado.costo) + tr('Utilidad bruta', b.resultado.utilidadBruta) + tr('(−) Gastos', b.resultado.gastos) + tr('Ganancia', b.resultado.ganancia, 'total'))}
    </div>
    <div class="stack">
      ${sec('Inventario (valorizado a costo)', tr('Inventario inicial', b.inventario.inicial) + tr('(+) Entradas', b.inventario.entradas) + tr('(−) Salidas', b.inventario.salidas) + tr('Inventario final', b.inventario.final, 'total'))}
      ${sec('Cuentas por cobrar', tr('Saldo inicial', b.cxc.inicial) + tr('(+) Nuevos créditos', b.cxc.nuevos) + tr('(−) Pagos', b.cxc.pagos) + tr('Saldo final', b.cxc.final, 'total'))}
      ${sec('Flujo de caja', tr('Recaudo de ventas', b.caja.recaudoVentas) + tr('Pagos de créditos', b.caja.pagos) + Object.entries(b.caja.porMetodo).map(([k, v]) => `<tr><td class="small muted" style="padding-left:20px">${esc(k)}</td><td class="num small muted">${money(v)}</td></tr>`).join('') + tr('(−) Compras y gastos', b.caja.egresos) + tr('Neto de caja', b.caja.neto, 'total'))}
    </div>
  </div>`;
}
