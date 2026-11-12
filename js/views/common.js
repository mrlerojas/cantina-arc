// Vistas compartidas por CANTINA y COAL: productos, compras, gastos, inventario, proveedores.
import { q, get, insert, update, can, todayStr, audit, userName, esUnidadNube } from '../store.js';
import * as cloud from '../cloud.js';
import { LECTURA_FACTURAS } from '../config.js';
import {
  precioVigente, historialPrecios, setPrecio, stock, costoPromedio, kardex, crearProducto, ajusteInventario,
  registrarCompra, anularCompra, registrarGasto, anularGasto, comparativoProveedores, productosModulo, validarProducto,
  UNIDADES_MEDIDA, TIPOS_MOV, ORIGENES, valorInventario,
} from '../domain.js';
import {
  esc, money, fdate, fdt, qty, toast, attempt, modal, askMotivo, exportCSV, rangeBar, bindRange, periodo,
  lineEditor, readImage, thumb, emptyRow, estadoBadge, kpi,
} from '../ui.js';

const EMOJIS = ['🥤', '💧', '🧃', '☕', '🍫', '🍪', '🥔', '🍬', '🍞', '🥫', '🧻', '🧼', '🪥', '🔋', '🚬', '🍦', '🥜', '🍎', '📦'];

// ============================ PRODUCTOS ============================
export function productos(_p, el, modulo) {
  const st = { s: '' };
  const opera = can(modulo + '.operar');
  const render = () => {
    const rows = q('productos', p => p.modulo === modulo && p.estado !== 'eliminado')
      .filter(p => !st.s || p.nombre.toLowerCase().includes(st.s) || (p.categoria || '').toLowerCase().includes(st.s))
      .sort((a, b) => (a.estado === 'activo' ? 0 : 1) - (b.estado === 'activo' ? 0 : 1) || a.nombre.localeCompare(b.nombre));
    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <input type="search" id="s" placeholder="Buscar producto o categoría" value="${esc(st.s)}" style="max-width:300px">
          <div class="row"><button id="csv">Exportar Excel</button>${opera ? '<button class="primary" id="nuevo">+ Nuevo producto</button>' : ''}</div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr>${modulo === 'cantina' ? '<th></th>' : ''}<th>Producto</th><th>Categoría</th><th>Unidad</th>
            <th class="num">Stock</th>${modulo === 'coal' ? '<th class="num">Operacional</th>' : ''}
            ${modulo === 'cantina' ? '<th class="num">P. compra</th><th class="num">P. tripulación</th><th class="num">P. externo</th>' : '<th class="num">Costo prom.</th>'}
            <th>Estado</th></tr></thead>
          <tbody>${rows.map(p => {
            const pv = precioVigente(p.id) || {};
            const s = stock(p.id, 'convencional');
            const low = p.stock_min && s <= p.stock_min;
            return `<tr class="clickable" data-id="${p.id}">
              ${modulo === 'cantina' ? `<td style="width:48px"><div style="width:40px;height:40px;border-radius:8px;background:var(--navy-soft);display:grid;place-items:center;font-size:22px;overflow:hidden">${thumb(p).replace('<img', '<img style="width:100%;height:100%;object-fit:cover"')}</div></td>` : ''}
              <td><b>${esc(p.nombre)}</b></td><td>${esc(p.categoria || '')}</td><td>${esc(p.unidad_medida)}</td>
              <td class="num">${low ? `<span class="badge warn">${qty(s)}</span>` : qty(s)}</td>
              ${modulo === 'coal' ? `<td class="num">${qty(stock(p.id, 'operacional'))}</td>` : ''}
              ${modulo === 'cantina' ? `<td class="num">${money(pv.compra)}</td><td class="num">${money(pv.tripulacion)}</td><td class="num">${money(pv.externo)}</td>` : `<td class="num">${money(costoPromedio(p.id))}</td>`}
              <td>${p.estado === 'activo' ? '' : '<span class="badge">Inactivo</span>'}</td>
            </tr>`;
          }).join('') || emptyRow(9)}</tbody>
        </table></div>
      </div>`;
    const s = el.querySelector('#s');
    s.oninput = () => { st.s = s.value.toLowerCase(); render(); const n = el.querySelector('#s'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    el.querySelector('#nuevo')?.addEventListener('click', () => productoForm(null, modulo, render));
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => productoForm(get('productos', tr.dataset.id), modulo, render));
    el.querySelector('#csv').onclick = () => exportCSV(`productos_${modulo}_${todayStr()}`, [
      ['Producto', 'Categoría', 'Unidad', 'Stock', 'Stock mínimo', 'Costo promedio', 'P. compra', 'P. tripulación', 'P. externo', 'Estado'],
      ...rows.map(p => { const pv = precioVigente(p.id) || {}; return [p.nombre, p.categoria, p.unidad_medida, stock(p.id), p.stock_min, costoPromedio(p.id), pv.compra, pv.tripulacion, pv.externo, p.estado]; }),
    ]);
  };
  render();
}

// opts.enCompra: se abre desde el registro de una compra; no pide inventario inicial
// (la cantidad entra con la compra) y devuelve el producto creado.
function productoForm(p, modulo, done, opts = {}) {
  const opera = can(modulo + '.operar');
  const pv = p ? precioVigente(p.id) || {} : {};
  const cats = [...new Set(q('productos', x => x.modulo === modulo).map(x => x.categoria).filter(Boolean))];
  let foto = p?.foto || (modulo === 'cantina' ? '📦' : '');
  const hist = p ? historialPrecios(p.id) : [];
  modal({
    title: p ? esc(p.nombre) : 'Nuevo producto',
    wide: true,
    body: `
      <form id="pf" class="form-grid">
        ${modulo === 'cantina' ? `<div class="full row">
          <div id="foto" style="width:84px;height:84px;border-radius:12px;background:var(--navy-soft);display:grid;place-items:center;font-size:44px;overflow:hidden"></div>
          <div class="stack" style="flex:1">
            <label class="btn" style="width:max-content">📷 Fotografía<input type="file" accept="image/*" capture="environment" id="file" hidden></label>
            <div class="row small">${EMOJIS.map(e => `<button type="button" class="ghost sm" data-emoji="${e}" style="font-size:20px;padding:2px 4px">${e}</button>`).join('')}</div>
          </div></div>` : ''}
        <label class="field"><span>Nombre</span><input name="nombre" required value="${esc(p?.nombre || opts.prefill?.nombre || '')}"></label>
        <label class="field"><span>Categoría</span><input name="categoria" list="cats" value="${esc(p?.categoria || '')}"><datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="field"><span>Unidad de medida</span><input name="unidad_medida" list="ums" required value="${esc(p?.unidad_medida || opts.prefill?.unidad_medida || 'UND')}"><datalist id="ums">${UNIDADES_MEDIDA.map(u => `<option value="${u}">`).join('')}</datalist></label>
        <label class="field"><span>Stock mínimo (alerta)</span><input name="stock_min" type="number" step="any" min="0" value="${p?.stock_min ?? ''}"></label>
        ${modulo === 'cantina' ? `
          <div class="full"><h3 style="margin:6px 0 0">Precios ${p ? '<span class="small muted">(un cambio crea un nuevo registro de vigencia; las ventas anteriores conservan su precio)</span>' : ''}</h3></div>
          <label class="field"><span>Precio de compra</span><input name="compra" type="number" min="0" value="${pv.compra ?? opts.prefill?.compra ?? ''}"></label>
          <label class="field"><span>Vigente desde</span><input name="desde" type="date" value="${todayStr()}"></label>
          <p class="small muted full" style="margin:0">Escriba el <b>% de ganancia</b> sobre el precio de compra y se calcula el precio de venta, o escriba el precio de venta y se calcula el %.</p>
          <label class="field"><span>% ganancia tripulación</span><input name="pct_tripulacion" type="number" step="any" inputmode="decimal" placeholder="Ej.: 30"></label>
          <label class="field"><span>Precio tripulación</span><input name="tripulacion" type="number" min="0" required value="${pv.tripulacion ?? ''}"></label>
          <div class="small full ganancia" data-gan="tripulacion"></div>
          <label class="field"><span>% ganancia externo</span><input name="pct_externo" type="number" step="any" inputmode="decimal" placeholder="Ej.: 50"></label>
          <label class="field"><span>Precio externo</span><input name="externo" type="number" min="0" required value="${pv.externo ?? ''}"></label>
          <div class="small full ganancia" data-gan="externo"></div>` : ''}
        ${opts.enCompra ? '<p class="small muted full" style="margin:0">La cantidad y el costo se indican en la compra; no hace falta inventario inicial.</p>' : ''}
        ${!p && !opts.enCompra ? `
          <div class="full"><h3 style="margin:6px 0 0">Inventario inicial</h3></div>
          <label class="field"><span>Cantidad</span><input name="ini_cant" type="number" step="any" min="0" value=""></label>
          <label class="field"><span>Costo unitario</span><input name="ini_costo" type="number" step="any" min="0" value=""></label>` : ''}
      </form>
      ${hist.length ? `<h3 style="margin:18px 0 6px">Historial de precios</h3>
        <div class="table-wrap"><table><thead><tr><th>Desde</th><th class="num">Compra</th><th class="num">Tripulación</th><th class="num">Externo</th><th>Registró</th></tr></thead>
        <tbody>${hist.map(h => `<tr><td>${fdate(h.desde)}</td><td class="num">${money(h.compra)}</td><td class="num">${money(h.tripulacion)}</td><td class="num">${money(h.externo)}</td><td class="small">${esc(userName(h.creado_por))}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
    foot: opera ? `
      ${p ? `<button class="danger" id="toggle">${p.estado === 'activo' ? 'Desactivar' : 'Activar'}</button><span class="spacer"></span>` : ''}
      <button data-close>Cancelar</button><button class="primary" id="ok">Guardar</button>` : '<button data-close>Cerrar</button>',
    onMount: (m, api) => {
      const fotoEl = m.querySelector('#foto');
      const paint = () => { if (fotoEl) fotoEl.innerHTML = thumb({ foto }).replace('<img', '<img style="width:100%;height:100%;object-fit:cover"'); };
      paint();
      m.querySelectorAll('[data-emoji]').forEach(b => b.onclick = () => { foto = b.dataset.emoji; paint(); });
      m.querySelector('#file')?.addEventListener('change', async e => {
        const f = e.target.files[0]; if (!f) return;
        foto = await readImage(f); paint();
      });
      // % de ganancia <-> precio de venta. El % es sobre el precio de compra:
      // precio de venta = compra × (1 + % / 100). Solo el precio se guarda; el % se calcula.
      if (modulo === 'cantina') {
        const pf = m.querySelector('#pf');
        const r1 = n => Math.round(n * 10) / 10;
        const pares = ['tripulacion', 'externo'].map(k => {
          const pct = pf['pct_' + k], precio = pf[k], info = m.querySelector(`[data-gan="${k}"]`);
          const costo = () => +pf.compra.value || 0;
          const pintar = () => {
            const c = costo(), v = +precio.value || 0;
            if (!(c > 0)) { info.className = 'small full ganancia muted'; info.textContent = precio.value !== '' ? 'Indique el precio de compra para calcular la ganancia.' : ''; return; }
            if (precio.value === '') { info.textContent = ''; return; }
            info.className = 'small full ganancia ' + (v > c ? 'pos' : 'neg');
            info.textContent = v > c
              ? `Ganancia: ${money(v - c)} por unidad · margen ${r1(((v - c) / v) * 100).toLocaleString('es-CO')} % del precio de venta.`
              : v === c ? 'Sin ganancia: se vende al precio de compra.' : `Pérdida: ${money(c - v)} por unidad (se vende por debajo del precio de compra).`;
          };
          const desdePrecio = () => { const c = costo(); pct.value = c > 0 && precio.value !== '' ? String(r1(((+precio.value || 0) / c - 1) * 100)) : ''; pintar(); };
          const desdePct = () => { const c = costo(); if (c > 0 && pct.value !== '') precio.value = String(Math.round(c * (1 + (+pct.value || 0) / 100))); pintar(); };
          pct.addEventListener('input', desdePct);
          precio.addEventListener('input', desdePrecio);
          desdePrecio();
          return { pct, precio, desdePrecio, desdePct };
        });
        // Al cambiar el precio de compra: si ya hay precio de venta se conserva y se recalcula el %;
        // si solo se había escrito el %, se calcula el precio.
        pf.compra.addEventListener('input', () => pares.forEach(x => (x.precio.value === '' && x.pct.value !== '' ? x.desdePct() : x.desdePrecio())));
      }
      if (!opera) m.querySelectorAll('#pf input').forEach(i => i.disabled = true);
      m.querySelector('#toggle')?.addEventListener('click', () => {
        if (!opera) return toast('No tiene permiso para realizar esta acción.', true);
        const next = p.estado === 'activo' ? 'inactivo' : 'activo';
        update('productos', p.id, { estado: next });
        audit(next === 'activo' ? 'Producto activado' : 'Producto desactivado', 'productos', p.id, p.nombre);
        api.close(); done();
      });
      m.querySelector('#ok')?.addEventListener('click', () => {
        const f = m.querySelector('#pf');
        if (!f.reportValidity()) return;
        const data = {
          modulo, nombre: f.nombre.value.trim(), categoria: f.categoria.value.trim(),
          unidad_medida: f.unidad_medida.value.trim().toUpperCase(), stock_min: +f.stock_min.value || 0,
        };
        if (modulo === 'cantina') data.foto = foto;
        const precio = modulo === 'cantina' ? { compra: +f.compra.value || 0, tripulacion: +f.tripulacion.value || 0, externo: +f.externo.value || 0, desde: f.desde.value || todayStr() } : null;
        let creado = null;
        const ok = attempt(() => {
          if (p) {
            if (!opera) throw new Error('No tiene permiso para realizar esta acción.');
            validarProducto(modulo, data.nombre, p.id);
            update('productos', p.id, data);
            audit('Producto modificado', 'productos', p.id, data.nombre);
            if (precio) setPrecio(p.id, precio);
          } else {
            creado = crearProducto({ ...data, _precio: precio }, opts.enCompra ? null : { cantidad: f.ini_cant.value, costo: f.ini_costo.value || precio?.compra || 0 });
          }
          return true;
        });
        if (ok) { api.close(); toast('Producto guardado'); done(creado, precio?.compra || ''); }
      });
    },
  });
}

// ============================ COMPRAS ============================
const comprasSt = {};

export function compras(_p, el, modulo) {
  const st = comprasSt[modulo] ||= { tipo: 'mes', d1: periodo('mes')[0], d2: periodo('mes')[1] };
  const render = () => {
    const rows = q('compras', c => c.modulo === modulo && c.fecha >= st.d1 && c.fecha <= st.d2).sort((a, b) => (b.fecha + b.creado_en).localeCompare(a.fecha + a.creado_en));
    const act = rows.filter(c => c.estado === 'activo');
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px"><div class="row">${rangeBar(st)}<span class="spacer"></span>
        <button id="csv">Exportar Excel</button>${can(modulo + '.operar') ? '<button class="primary" id="nueva">+ Registrar compra</button>' : ''}</div></div>
      <div class="grid grid-3" style="margin-bottom:14px">
        ${kpi('Total compras', money(act.reduce((s, c) => s + c.total, 0)), `${act.length} compras`)}
        ${kpi('Proveedores', String(new Set(act.map(c => c.proveedor_id)).size))}
        ${kpi('Productos comprados', String(new Set(act.flatMap(c => c.items.map(i => i.producto_id))).size))}
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Fecha</th><th>Proveedor</th><th>Documento</th><th>Productos</th><th class="num">Total</th><th>Usuario</th><th>Estado</th><th></th></tr></thead>
        <tbody>${rows.map(c => `<tr class="${c.estado === 'anulado' ? 'anulado' : ''}">
          <td><a href="#" data-ver="${c.id}">${c.numero}</a></td><td>${fdate(c.fecha)}</td>
          <td>${esc(get('proveedores', c.proveedor_id)?.nombre || '—')}</td><td>${esc(c.documento || '')}</td>
          <td class="small">${esc(c.items.map(i => i.nombre).join(', ')).slice(0, 80)}</td>
          <td class="num"><b>${money(c.total)}</b></td><td class="small">${esc(userName(c.creado_por))}</td><td>${estadoBadge(c.estado)}</td>
          <td>${c.estado === 'activo' && can('anular') ? `<button class="sm danger" data-anular="${c.id}">Anular</button>` : ''}</td></tr>`).join('') || emptyRow(9)}</tbody>
      </table></div></div>`;
    bindRange(el, st, render);
    el.querySelector('#nueva')?.addEventListener('click', () => compraForm(modulo, render));
    el.querySelectorAll('[data-ver]').forEach(a => a.onclick = e => { e.preventDefault(); compraDetalle(get('compras', a.dataset.ver)); });
    el.querySelectorAll('[data-anular]').forEach(b => b.onclick = async () => {
      const motivo = await askMotivo('Anular compra');
      if (motivo && attempt(() => (anularCompra(b.dataset.anular, motivo), true))) { toast('Compra anulada'); render(); }
    });
    el.querySelector('#csv').onclick = () => exportCSV(`compras_${modulo}_${st.d1}_${st.d2}`, [
      ['Compra', 'Fecha', 'Proveedor', 'Documento', 'Producto', 'Cantidad', 'Unidad', 'Precio unitario', 'Subtotal', 'Estado', 'Usuario'],
      ...rows.flatMap(c => c.items.map(i => [c.numero, fdate(c.fecha), get('proveedores', c.proveedor_id)?.nombre || '', c.documento, i.nombre, i.cantidad, i.unidad_medida, i.precio, i.cantidad * i.precio, c.estado, userName(c.creado_por)])),
    ]);
  };
  render();
}

function compraDetalle(c) {
  modal({
    title: `Compra #${c.numero}`,
    body: `<p>${fdate(c.fecha)} · ${esc(get('proveedores', c.proveedor_id)?.nombre || 'Sin proveedor')} ${c.documento ? '· Doc. ' + esc(c.documento) : ''}</p>
      <table><thead><tr><th>Producto</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${c.items.map(i => `<tr><td>${esc(i.nombre)}</td><td class="num">${qty(i.cantidad)} ${esc(i.unidad_medida)}</td><td class="num">${money(i.precio)}</td><td class="num">${money(i.cantidad * i.precio)}</td></tr>`).join('')}
      <tr class="total"><td colspan="3">Total</td><td class="num">${money(c.total)}</td></tr></tbody></table>
      <p class="small muted">Registrada por ${esc(userName(c.creado_por))} · ${fdt(c.creado_en)}${c.estado === 'anulado' ? ` · <b class="neg">Anulada: ${esc(c.motivo)}</b>` : ''}</p>`,
  });
}

function ultimoPrecio(producto_id, proveedor_id) {
  const cs = q('compras', c => c.estado === 'activo' && (!proveedor_id || c.proveedor_id === proveedor_id))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  for (const c of cs) { const i = c.items.find(x => x.producto_id === producto_id); if (i) return i.precio; }
  return precioVigente(producto_id)?.compra || costoPromedio(producto_id) || '';
}

function compraForm(modulo, done) {
  const provs = q('proveedores', p => p.estado === 'activo').sort((a, b) => a.nombre.localeCompare(b.nombre));
  let editor;
  modal({
    title: `Registrar compra — ${modulo.toUpperCase()}`,
    wide: true,
    body: `
      <div class="form-grid">
        <label class="field"><span>Fecha</span><input type="date" id="fecha" value="${todayStr()}"></label>
        <label class="field"><span>Proveedor</span><div class="row"><select id="prov" style="flex:1"><option value="">Sin proveedor</option>${provs.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select><button type="button" id="np">+</button></div></label>
        <label class="field full"><span>Factura / documento soporte</span><input id="doc"></label>
      </div>
      ${LECTURA_FACTURAS && cloud.enabled && esUnidadNube() ? `<div class="factura-caja">
        <label class="btn" id="btn-factura">📷 Leer factura con foto<input type="file" accept="image/*" id="foto-factura" hidden></label>
        <span class="small muted" id="cupo-factura"></span></div>
      <div id="lectura"></div>` : ''}
      <h3 style="margin:14px 0 6px">Productos</h3>
      <div id="lines"></div>
      <p class="small muted">La compra genera automáticamente la entrada al inventario (Kardex).</p>`,
    foot: `<button data-close>Cancelar</button><button class="primary" id="ok">Registrar compra</button>`,
    onMount: (m, api) => {
      const prov = m.querySelector('#prov');
      editor = lineEditor(m.querySelector('#lines'), {
        productos: productosModulo(modulo),
        onChange: () => compararTotal(),
        cols: {
          precio: 'Precio unitario', defaultPrecio: pid => ultimoPrecio(pid, prov.value),
          // Producto que aún no existe: se crea aquí mismo y queda agregado a la compra.
          crear: () => productoForm(null, modulo, (np, costo) => { if (np) editor.agregar(np, costo); }, { enCompra: true }),
        },
      });
      const nuevoProveedor = pre => proveedorForm(null, p => { prov.insertAdjacentHTML('beforeend', `<option value="${p.id}">${esc(p.nombre)}</option>`); prov.value = p.id; }, pre);
      m.querySelector('#np').onclick = () => nuevoProveedor();

      // ---- Lectura de la factura con foto: llena el formulario para revisar; no guarda nada ----
      const zona = m.querySelector('#lectura');
      let lectura = null;      // { total, observaciones, proveedor, pendientes: [renglones sin producto] }
      const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      function compararTotal() {
        const el = zona?.querySelector('#lec-total');
        if (!el || !lectura || lectura.total == null) return;
        const dif = Math.round(editor.total() - lectura.total);
        const falta = lectura.pendientes.length;
        el.className = 'small ' + (dif === 0 && !falta ? 'pos' : 'neg');
        el.textContent = dif === 0 && !falta ? '✔ El total del formulario coincide con el de la factura.'
          : `Total del formulario ${money(editor.total())}: ${dif === 0 ? 'coincide, pero faltan renglones por asociar' : (dif > 0 ? 'sobran ' : 'faltan ') + money(Math.abs(dif)) + ' frente a la factura'}.`;
      }
      const pintarCupo = async () => {
        const el = m.querySelector('#cupo-factura');
        if (!el) return;
        const c = await cloud.cupoFacturas();
        if (c && el.isConnected) el.textContent = `Lecturas usadas: ${c.usados} de ${c.tope} en los últimos ${c.dias} días.`;
      };
      const pintarLectura = () => {
        if (!zona || !lectura) return;
        const prods = productosModulo(modulo);
        zona.innerHTML = `<div class="lectura">
          <div class="row"><b>Factura leída: revise antes de registrar</b><span class="spacer"></span><button class="ghost sm" id="lec-cerrar" title="Ocultar">✕</button></div>
          <div class="small">${lectura.total != null ? `Total que dice la factura: <b>${money(lectura.total)}</b>. ` : 'La factura no muestra un total legible. '}<span id="lec-total"></span></div>
          ${lectura.proveedor ? `<div class="small">Proveedor leído: <b>${esc(lectura.proveedor)}</b> — no está en su lista. <button class="sm" id="lec-prov">Crear proveedor</button></div>` : ''}
          ${lectura.observaciones ? `<div class="small muted">Nota de la lectura: ${esc(lectura.observaciones)}</div>` : ''}
          ${lectura.pendientes.length ? `<div class="small" style="margin-top:6px"><b>${lectura.pendientes.length} renglón(es) sin producto asociado.</b> Elija el producto que corresponde o créelo:</div>
            <div class="table-wrap"><table class="lines"><thead><tr><th>En la factura</th><th class="num">Cant.</th><th class="num">Precio unit.</th><th>Producto</th><th></th></tr></thead>
            <tbody>${lectura.pendientes.map((it, i) => `<tr><td>${esc(it.descripcion)}${it.unidad ? ` <span class="small muted">${esc(it.unidad)}</span>` : ''}</td>
              <td class="num">${qty(it.cantidad)}</td><td class="num">${it.precio_unitario != null ? money(it.precio_unitario) : '—'}</td>
              <td><select data-asociar="${i}"><option value="">Elegir…</option>${prods.map(p => `<option value="${p.id}">${esc(p.nombre)} (${esc(p.unidad_medida)})</option>`).join('')}</select></td>
              <td style="white-space:nowrap"><button class="sm" data-crear-lec="${i}">✚ Crear</button> <button class="ghost sm" data-omitir="${i}" title="No incluir este renglón">Omitir</button></td></tr>`).join('')}</tbody></table></div>` : ''}
        </div>`;
        zona.querySelector('#lec-cerrar').onclick = () => { lectura = null; zona.innerHTML = ''; };
        zona.querySelector('#lec-prov')?.addEventListener('click', () => nuevoProveedor({ nombre: lectura.proveedor }));
        const resolver = (i, p) => {
          const it = lectura.pendientes[i];
          editor.agregar(p, it.precio_unitario ?? '', it.cantidad);
          lectura.pendientes.splice(i, 1);
          pintarLectura();
        };
        zona.querySelectorAll('[data-asociar]').forEach(sel => sel.onchange = () => { const p = get('productos', sel.value); if (p) resolver(+sel.dataset.asociar, p); });
        zona.querySelectorAll('[data-crear-lec]').forEach(b => b.onclick = () => {
          const i = +b.dataset.crearLec, it = lectura.pendientes[i];
          productoForm(null, modulo, np => { if (np) resolver(lectura.pendientes.indexOf(it), np); },
            { enCompra: true, prefill: { nombre: it.descripcion, unidad_medida: (it.unidad || '').toUpperCase() || undefined, compra: it.precio_unitario ?? undefined } });
        });
        zona.querySelectorAll('[data-omitir]').forEach(b => b.onclick = () => { lectura.pendientes.splice(+b.dataset.omitir, 1); pintarLectura(); });
        compararTotal();
      };
      const aplicarLectura = r => {
        const f = r.factura;
        if (!f.es_factura || !f.items.length) {
          lectura = null;
          zona.innerHTML = `<div class="lectura"><b>No se reconoció una factura en la foto.</b><div class="small muted">${esc(f.observaciones || 'Pruebe con una foto más clara, completa y bien iluminada, o registre la compra a mano.')}</div></div>`;
          return;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(f.fecha || '') && f.fecha <= todayStr()) m.querySelector('#fecha').value = f.fecha;
        if (f.numero) m.querySelector('#doc').value = f.numero;
        let provNuevo = null;
        if (f.proveedor) {
          const n = norm(f.proveedor);
          const hit = provs.find(p => norm(p.nombre) === n) || provs.find(p => n && (norm(p.nombre).includes(n) || n.includes(norm(p.nombre))));
          if (hit) prov.value = hit.id; else provNuevo = f.proveedor;
        }
        const asociados = f.items.filter(i => i.producto_id && get('productos', i.producto_id));
        const filas = asociados.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad, precio: i.precio_unitario ?? '', origen: 'convencional' }));
        editor.set([...editor.get(), ...filas].length ? [...editor.get(), ...filas] : [{ producto_id: '', cantidad: '', precio: '', origen: 'convencional' }]);
        lectura = { total: f.total, observaciones: f.observaciones, proveedor: provNuevo, pendientes: f.items.filter(i => !asociados.includes(i)) };
        pintarLectura();
        toast(`Factura leída: ${asociados.length} renglón(es) asociados${lectura.pendientes.length ? ` y ${lectura.pendientes.length} por revisar` : ''}.`);
      };
      const foto = m.querySelector('#foto-factura');
      if (foto) {
        pintarCupo();
        const boton = m.querySelector('#btn-factura');
        foto.onchange = async e => {
          const file = e.target.files[0];
          e.target.value = '';
          if (!file || boton.classList.contains('ocupado')) return;
          boton.classList.add('ocupado');
          const texto = boton.firstChild; const antes = texto.textContent; texto.textContent = '⏳ Leyendo la factura… ';
          try {
            const dataUrl = await readImage(file, 1600);
            const r = await cloud.leerFactura({
              modulo, tipo: 'image/jpeg', imagen: dataUrl.split(',')[1],
              productos: productosModulo(modulo).map(p => ({ id: p.id, nombre: p.nombre, unidad: p.unidad_medida })),
            });
            aplicarLectura(r);
          } catch (err) { console.error(err); toast(err.message || 'No se pudo leer la factura.', true); }
          finally { texto.textContent = antes; boton.classList.remove('ocupado'); pintarCupo(); }
        };
      }
      m.querySelector('#ok').onclick = () => {
        const c = attempt(() => registrarCompra({ modulo, proveedor_id: prov.value || null, fecha: m.querySelector('#fecha').value, documento: m.querySelector('#doc').value, items: editor.get() }));
        if (c) { api.close(); toast(`Compra #${c.numero} registrada; inventario actualizado`); done(); }
      };
    },
  });
}

// ============================ GASTOS ============================
const gastosSt = {};

export function gastos(_p, el, modulo) {
  const st = gastosSt[modulo] ||= { tipo: 'mes', d1: periodo('mes')[0], d2: periodo('mes')[1] };
  const render = () => {
    const rows = q('gastos', g => g.modulo === modulo && g.fecha >= st.d1 && g.fecha <= st.d2).sort((a, b) => b.fecha.localeCompare(a.fecha));
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px"><div class="row">${rangeBar(st)}<span class="spacer"></span>
        <button id="csv">Exportar Excel</button>${can(modulo + '.operar') ? '<button class="primary" id="nuevo">+ Registrar gasto</button>' : ''}</div></div>
      <div class="card">
        <div class="card-head"><h3>Total: ${money(rows.filter(g => g.estado === 'activo').reduce((s, g) => s + g.valor, 0))}</h3></div>
        <div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th class="num">Valor</th><th>Usuario</th><th>Estado</th><th></th></tr></thead>
        <tbody>${rows.map(g => `<tr class="${g.estado === 'anulado' ? 'anulado' : ''}"><td>${fdate(g.fecha)}</td><td>${esc(g.concepto)}</td><td>${esc(g.categoria || '')}</td>
          <td class="num">${money(g.valor)}</td><td class="small">${esc(userName(g.creado_por))}</td><td>${estadoBadge(g.estado)}</td>
          <td>${g.estado === 'activo' && can('anular') ? `<button class="sm danger" data-anular="${g.id}">Anular</button>` : ''}</td></tr>`).join('') || emptyRow(7)}</tbody>
      </table></div></div>`;
    bindRange(el, st, render);
    el.querySelector('#nuevo')?.addEventListener('click', () => modal({
      title: 'Registrar gasto',
      body: `<form id="gf" class="form-grid">
        <label class="field"><span>Fecha</span><input type="date" name="fecha" value="${todayStr()}"></label>
        <label class="field"><span>Valor</span><input type="number" name="valor" min="1" required inputmode="numeric"></label>
        <label class="field full"><span>Concepto</span><input name="concepto" required></label>
        <label class="field full"><span>Categoría</span><input name="categoria" list="gcats"><datalist id="gcats">${['Transporte', 'Gas', 'Aseo', 'Mantenimiento', 'Empaques', 'Otros'].map(c => `<option value="${c}">`).join('')}</datalist></label>
      </form>`,
      foot: `<button data-close>Cancelar</button><button class="primary" id="ok">Guardar</button>`,
      onMount: (m, api) => m.querySelector('#ok').onclick = () => {
        const f = m.querySelector('#gf'); if (!f.reportValidity()) return;
        if (attempt(() => registrarGasto({ modulo, fecha: f.fecha.value, concepto: f.concepto.value.trim(), categoria: f.categoria.value.trim(), valor: f.valor.value }))) { api.close(); toast('Gasto registrado'); render(); }
      },
    }));
    el.querySelectorAll('[data-anular]').forEach(b => b.onclick = async () => {
      const motivo = await askMotivo('Anular gasto');
      if (motivo && attempt(() => (anularGasto(b.dataset.anular, motivo), true))) { toast('Gasto anulado'); render(); }
    });
    el.querySelector('#csv').onclick = () => exportCSV(`gastos_${modulo}_${st.d1}_${st.d2}`, [['Fecha', 'Concepto', 'Categoría', 'Valor', 'Estado', 'Usuario'], ...rows.map(g => [fdate(g.fecha), g.concepto, g.categoria, g.valor, g.estado, userName(g.creado_por)])]);
  };
  render();
}

// ============================ INVENTARIO / KARDEX ============================
export function inventario(_p, el, modulo) {
  const st = { s: '' };
  const render = () => {
    const rows = productosModulo(modulo).filter(p => !st.s || p.nombre.toLowerCase().includes(st.s)).map(p => {
      const conv = stock(p.id, 'convencional'), oper = stock(p.id, 'operacional');
      const cc = costoPromedio(p.id, 'convencional'), co = costoPromedio(p.id, 'operacional');
      return { p, conv, oper, cc, co, valor: conv * cc + oper * co };
    });
    el.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:14px">
        ${kpi('Valor del inventario', money(valorInventario(modulo)), modulo === 'coal' ? `Conv. ${money(valorInventario(modulo, undefined, 'convencional'))} · Oper. ${money(valorInventario(modulo, undefined, 'operacional'))}` : 'A costo de adquisición')}
        ${kpi('Productos', String(rows.length))}
        ${kpi('Bajo mínimo', String(rows.filter(r => r.p.stock_min && r.conv <= r.p.stock_min).length))}
      </div>
      <div class="card">
        <div class="card-head"><input type="search" id="s" placeholder="Buscar" value="${esc(st.s)}" style="max-width:280px">
          <div class="row"><button id="csv">Exportar Excel</button></div></div>
        <p class="small muted" style="margin-top:0">Toque un producto para ver su Kardex${can('ajustes') ? ' o registrar un ajuste autorizado' : ''}.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th>Unidad</th><th class="num">${modulo === 'coal' ? 'Convencional' : 'Existencia'}</th>${modulo === 'coal' ? '<th class="num">Operacional</th>' : ''}<th class="num">Costo prom.</th><th class="num">Valor</th><th class="num">Mínimo</th></tr></thead>
          <tbody>${rows.map(r => `<tr class="clickable" data-id="${r.p.id}"><td><b>${esc(r.p.nombre)}</b></td><td>${esc(r.p.unidad_medida)}</td>
            <td class="num">${r.p.stock_min && r.conv <= r.p.stock_min ? `<span class="badge warn">${qty(r.conv)}</span>` : qty(r.conv)}</td>
            ${modulo === 'coal' ? `<td class="num">${qty(r.oper)}</td>` : ''}
            <td class="num">${money(r.cc)}</td><td class="num">${money(r.valor)}</td><td class="num muted">${r.p.stock_min || ''}</td></tr>`).join('') || emptyRow(7)}
            <tr class="total"><td colspan="${modulo === 'coal' ? 5 : 4}">Total</td><td class="num">${money(rows.reduce((s, r) => s + r.valor, 0))}</td><td></td></tr></tbody>
        </table></div>
      </div>`;
    const s = el.querySelector('#s');
    s.oninput = () => { st.s = s.value.toLowerCase(); render(); const n = el.querySelector('#s'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => kardexModal(tr.dataset.id, modulo, render));
    el.querySelector('#csv').onclick = () => exportCSV(`inventario_${modulo}_${todayStr()}`, [
      ['Producto', 'Unidad', 'Convencional', 'Operacional', 'Costo promedio', 'Valor', 'Mínimo'],
      ...rows.map(r => [r.p.nombre, r.p.unidad_medida, r.conv, r.oper, r.cc, r.valor, r.p.stock_min]),
    ]);
  };
  render();
}

function kardexModal(pid, modulo, done) {
  const p = get('productos', pid);
  let origen = 'convencional';
  modal({
    title: `Kardex — ${esc(p.nombre)}`,
    wide: true,
    body: `
      ${modulo === 'coal' ? `<div class="seg" style="margin-bottom:10px">${Object.entries(ORIGENES).map(([k, v]) => `<button data-o="${k}" class="${k === origen ? 'on' : ''}">${v}</button>`).join('')}</div>` : ''}
      <div id="kx"></div>`,
    foot: `<button id="csv">Exportar Excel</button>${can('ajustes') ? '<button class="primary" id="ajuste">Ajuste de inventario</button>' : ''}`,
    onMount: (m, api) => {
      const paint = () => {
        const rows = kardex(pid, origen);
        m.querySelector('#kx').innerHTML = `<div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Movimiento</th><th>Detalle</th><th class="num">Entrada</th><th class="num">Salida</th><th class="num">Saldo</th><th class="num">Costo unit.</th><th>Usuario</th></tr></thead>
          <tbody>${rows.map(r => `<tr class="${r.estado === 'anulado' ? 'anulado' : ''}"><td>${fdate(r.fecha)}</td><td>${TIPOS_MOV[r.tipo] || r.tipo}</td><td class="small">${esc(r.detalle || '')}</td>
            <td class="num">${r.entrada ? qty(r.entrada) : '—'}</td><td class="num">${r.salida ? qty(r.salida) : '—'}</td><td class="num"><b>${qty(r.saldo)} ${esc(p.unidad_medida)}</b></td>
            <td class="num">${money(r.costo_unit)}</td><td class="small">${esc(userName(r.creado_por))}${r.estado === 'anulado' ? ' · anulado' : ''}</td></tr>`).reverse().join('') || emptyRow(8)}</tbody></table></div>`;
        m.querySelectorAll('[data-o]').forEach(b => b.classList.toggle('on', b.dataset.o === origen));
      };
      paint();
      m.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { origen = b.dataset.o; paint(); });
      m.querySelector('#csv').onclick = () => exportCSV(`kardex_${p.nombre}_${origen}`, [['Fecha', 'Movimiento', 'Detalle', 'Entrada', 'Salida', 'Saldo', 'Costo unitario', 'Estado', 'Usuario'],
        ...kardex(pid, origen).map(r => [fdate(r.fecha), TIPOS_MOV[r.tipo] || r.tipo, r.detalle, r.entrada, r.salida, r.saldo, r.costo_unit, r.estado, userName(r.creado_por)])]);
      m.querySelector('#ajuste')?.addEventListener('click', () => modal({
        title: `Ajuste — ${esc(p.nombre)}`,
        body: `<p>Existencia ${ORIGENES[origen].toLowerCase()}: <b>${qty(stock(pid, origen))} ${esc(p.unidad_medida)}</b></p>
          <div class="form-grid">
            <label class="field"><span>Existencia física contada</span><input type="number" step="any" min="0" id="fis" value="${stock(pid, origen)}"></label>
            <label class="field"><span>Diferencia</span><input id="dif" readonly></label>
            <label class="field full"><span>Motivo (obligatorio)</span><textarea id="mot" placeholder="Conteo físico, producto vencido, daño…"></textarea></label>
          </div>`,
        foot: `<button data-close>Cancelar</button><button class="primary" id="ok">Aplicar ajuste</button>`,
        onMount: (m2, api2) => {
          const fis = m2.querySelector('#fis');
          const upd = () => { m2.querySelector('#dif').value = qty(Math.round(((+fis.value || 0) - stock(pid, origen)) * 1000) / 1000); };
          fis.oninput = upd; upd();
          m2.querySelector('#ok').onclick = () => {
            const dif = (+fis.value || 0) - stock(pid, origen);
            if (attempt(() => ajusteInventario({ producto_id: pid, cantidad: dif, motivo: m2.querySelector('#mot').value.trim(), origen }))) {
              api2.close(); toast('Ajuste aplicado'); paint(); done();
            }
          };
        },
      }));
    },
  });
}

// ============================ PROVEEDORES ============================
// pre: valores sugeridos para un proveedor nuevo (por ejemplo, el nombre leído de una factura).
export function proveedorForm(p, done, pre = {}) {
  modal({
    title: p ? 'Editar proveedor' : 'Nuevo proveedor',
    body: `<form id="pf" class="form-grid">
      <label class="field full"><span>Nombre / razón social</span><input name="nombre" required value="${esc(p?.nombre || pre.nombre || '')}"></label>
      <label class="field"><span>Contacto</span><input name="contacto" value="${esc(p?.contacto || '')}"></label>
      <label class="field"><span>Teléfono</span><input name="telefono" type="tel" value="${esc(p?.telefono || '')}"></label>
      <label class="field full"><span>Productos que suministra / notas</span><textarea name="notas">${esc(p?.notas || '')}</textarea></label>
    </form>`,
    foot: `<button data-close>Cancelar</button><button class="primary" id="ok">Guardar</button>`,
    onMount: (m, api) => m.querySelector('#ok').onclick = () => {
      const f = m.querySelector('#pf'); if (!f.reportValidity()) return;
      const data = { nombre: f.nombre.value.trim(), contacto: f.contacto.value.trim(), telefono: f.telefono.value.trim(), notas: f.notas.value.trim() };
      if (!can('cantina.operar') && !can('coal.operar')) return toast('No tiene permiso para realizar esta acción.', true);
      const row = p ? update('proveedores', p.id, data) : insert('proveedores', data);
      audit(p ? 'Proveedor modificado' : 'Proveedor creado', 'proveedores', row.id, row.nombre);
      api.close(); done && done(row);
    },
  });
}

export function proveedores(_p, el) {
  const st = { tab: 'lista', producto: '' };
  const render = () => {
    const provs = q('proveedores', p => p.estado === 'activo').sort((a, b) => a.nombre.localeCompare(b.nombre));
    const compras = q('compras', c => c.estado === 'activo');
    const productosComprados = [...new Set(compras.flatMap(c => c.items.map(i => i.producto_id)))].map(id => get('productos', id)).filter(Boolean).sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (!st.producto && productosComprados.length) st.producto = productosComprados[0].id;
    let body = '';
    if (st.tab === 'lista') {
      body = `<div class="card"><div class="card-head"><h3>${provs.length} proveedores</h3>${can('cantina.operar') || can('coal.operar') ? '<button class="primary" id="nuevo">+ Nuevo proveedor</button>' : ''}</div>
        <div class="table-wrap"><table><thead><tr><th>Proveedor</th><th>Contacto</th><th>Teléfono</th><th class="num">Compras</th><th class="num">Total comprado</th><th>Última compra</th></tr></thead>
        <tbody>${provs.map(p => {
          const cs = compras.filter(c => c.proveedor_id === p.id);
          const last = cs.map(c => c.fecha).sort().pop();
          return `<tr class="clickable" data-id="${p.id}"><td><b>${esc(p.nombre)}</b><div class="small muted">${esc(p.notas || '')}</div></td><td>${esc(p.contacto || '')}</td><td>${esc(p.telefono || '')}</td>
            <td class="num">${cs.length}</td><td class="num">${money(cs.reduce((s, c) => s + c.total, 0))}</td><td>${fdate(last || '')}</td></tr>`;
        }).join('') || emptyRow(6)}</tbody></table></div></div>`;
    } else {
      const comp = st.producto ? comparativoProveedores(st.producto) : [];
      const p = get('productos', st.producto);
      const hist = st.producto ? compras.filter(c => c.items.some(i => i.producto_id === st.producto)).sort((a, b) => b.fecha.localeCompare(a.fecha))
        .map(c => ({ c, i: c.items.find(i => i.producto_id === st.producto) })) : [];
      const best = comp[0];
      body = `<div class="card">
        <div class="card-head"><label class="field" style="min-width:260px"><span>Producto</span><select id="prod">${productosComprados.map(x => `<option value="${x.id}" ${x.id === st.producto ? 'selected' : ''}>${esc(x.nombre)} (${x.modulo.toUpperCase()})</option>`).join('')}</select></label>
          ${best ? `<div class="badge ok" style="font-size:13px;padding:6px 10px">Mejor último precio: ${esc(get('proveedores', best.proveedor_id)?.nombre || 'Sin proveedor')} ${money(best.ultimo)}</div>` : ''}</div>
        <div class="table-wrap"><table><thead><tr><th>Proveedor</th><th class="num">Último precio</th><th class="num">Promedio</th><th class="num">Mínimo</th><th class="num">Compras</th><th>Fecha último</th></tr></thead>
          <tbody>${comp.map(r => `<tr><td><b>${esc(get('proveedores', r.proveedor_id)?.nombre || 'Sin proveedor')}</b></td><td class="num">${money(r.ultimo)}</td><td class="num">${money(r.promedio)}</td><td class="num">${money(r.minimo)}</td><td class="num">${r.compras}</td><td>${fdate(r.fecha)}</td></tr>`).join('') || emptyRow(6, 'Sin compras registradas')}</tbody></table></div>
        <h3 style="margin:18px 0 6px">Evolución del precio${p ? ` (por ${esc(p.unidad_medida)})` : ''}</h3>
        <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Variación</th></tr></thead>
          <tbody>${hist.map((h, k) => {
            const prev = hist[k + 1]?.i.precio;
            const v = prev ? ((h.i.precio - prev) / prev) * 100 : null;
            return `<tr><td>${fdate(h.c.fecha)}</td><td>${esc(get('proveedores', h.c.proveedor_id)?.nombre || '—')}</td><td class="num">${qty(h.i.cantidad)}</td><td class="num">${money(h.i.precio)}</td>
              <td class="num ${v > 0 ? 'neg' : v < 0 ? 'pos' : ''}">${v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'}</td></tr>`;
          }).join('') || emptyRow(5)}</tbody></table></div></div>`;
    }
    el.innerHTML = `<div class="seg" style="margin-bottom:14px"><button data-tab="lista" class="${st.tab === 'lista' ? 'on' : ''}">Proveedores</button><button data-tab="comp" class="${st.tab === 'comp' ? 'on' : ''}">Comparar precios</button></div>${body}`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; render(); });
    el.querySelector('#nuevo')?.addEventListener('click', () => proveedorForm(null, render));
    el.querySelector('#prod')?.addEventListener('change', e => { st.producto = e.target.value; render(); });
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => {
      const p = get('proveedores', tr.dataset.id);
      const cs = compras.filter(c => c.proveedor_id === p.id).sort((a, b) => b.fecha.localeCompare(a.fecha));
      modal({
        title: esc(p.nombre), wide: true,
        body: `<p>${esc(p.contacto || '')} ${esc(p.telefono || '')}</p><p class="small muted">${esc(p.notas || '')}</p>
          <h3 style="margin:12px 0 6px">Historial de compras</h3>
          <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Módulo</th><th>Productos</th><th class="num">Total</th></tr></thead>
          <tbody>${cs.map(c => `<tr><td>${fdate(c.fecha)}</td><td>${c.modulo.toUpperCase()}</td><td class="small">${esc(c.items.map(i => `${qty(i.cantidad)} ${i.unidad_medida} ${i.nombre} @ ${money(i.precio)}`).join('; '))}</td><td class="num">${money(c.total)}</td></tr>`).join('') || emptyRow(4)}</tbody></table></div>`,
        foot: can('cantina.operar') || can('coal.operar') ? `<button class="danger" id="del">Desactivar</button><span class="spacer"></span><button class="primary" id="ed">Editar</button>` : '',
        onMount: (m, api) => {
          m.querySelector('#ed')?.addEventListener('click', () => { api.close(); proveedorForm(p, render); });
          m.querySelector('#del')?.addEventListener('click', () => {
            if (!confirm('¿Desactivar este proveedor? Su historial se conserva.')) return;
            update('proveedores', p.id, { estado: 'inactivo' }); audit('Proveedor desactivado', 'proveedores', p.id, p.nombre); api.close(); render();
          });
        },
      });
    });
  };
  render();
}
