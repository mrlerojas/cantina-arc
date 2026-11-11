import { q, get, can, currentUnit, todayStr, addDays, userName } from '../store.js';
import {
  tarifas, guardarTarifas, diaCoal, guardarDia, aportesDia, personasDia, esFinDeSemana, recetasActivas, guardarReceta,
  costoReceta, guardarMenu, registrarConsumo, anularConsumo, registrarOperacional, anularOperacional, resumenCoalDia,
  balanceCoal, stock, costoPromedio, productosModulo, valorInventario, COMIDAS, ORIGENES, r3,
} from '../domain.js';
import {
  esc, money, fdate, fdt, qty, toast, attempt, modal, askMotivo, exportCSV, printDoc, rangeBar, bindRange, periodo,
  lineEditor, emptyRow, estadoBadge, kpi,
} from '../ui.js';

const n0 = x => +x || 0;
const diaSt = { fecha: todayStr() };

// ============================ REGISTRO DIARIO ============================
export function dia(params, el) {
  if (params.f) diaSt.fecha = params.f;
  const opera = can('coal.operar');
  const render = () => {
    const f = diaSt.fecha;
    const t = tarifas();
    const d = diaCoal(f);
    const prev = !d ? diaCoal(addDays(f, -1)) : null;
    const fds = esFinDeSemana(f);
    const v = d || { situacion: 'puerto', servicio: !(fds && t.reglas.puerto_fds_sin_servicio), militar: {}, civil: {} };
    const r = resumenCoalDia(f, t);
    const menus = q('menus', m => m.fecha === f && m.estado === 'activo');
    const recetas = recetasActivas();
    const num = (name, val) => `<input type="number" min="0" inputmode="numeric" name="${name}" value="${val ?? ''}" ${opera ? '' : 'disabled'}>`;

    el.innerHTML = `
      <div class="card" style="margin-bottom:14px"><div class="row">
        <button id="prev" class="icon-btn">‹</button>
        <input type="date" id="fecha" value="${f}" style="width:auto">
        <button id="next" class="icon-btn">›</button>
        <button id="hoy" class="sm">Hoy</button>
        <span class="muted">${new Date(f + 'T12:00').toLocaleDateString('es-CO', { weekday: 'long' })}${fds ? ' · fin de semana' : ''}</span>
        <span class="spacer"></span>
        <a class="btn" href="#/coal/parte?f=${f}">📄 Parte diario</a>
      </div></div>

      <div class="grid grid-4" style="margin-bottom:14px">
        ${kpi('Personas', String(r.personas), d ? (d.servicio === false ? 'Sin servicio' : d.situacion === 'navegando' ? 'Navegando' : 'En puerto') : 'Sin registro')}
        ${kpi('Aportes', money(r.aportes.total))}
        ${kpi('Costo alimentación', money(r.total), `Conv. ${money(r.conv)} · Oper. ${money(r.oper)}`)}
        ${kpi('Costo / persona', money(r.costoPersona), `Diferencia ${money(r.diferencia)}`)}
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h2>Personal alimentado</h2>${!d && prev && opera ? '<button class="sm" id="copiar">Copiar día anterior</button>' : ''}${d ? `<span class="small muted">Registró ${esc(userName(d.modificado_por || d.creado_por))}</span>` : ''}</div>
          <form id="pf" class="stack">
            <div class="row">
              <div class="seg">
                <button type="button" data-sit="puerto" class="${v.situacion !== 'navegando' ? 'on' : ''}">En puerto</button>
                <button type="button" data-sit="navegando" class="${v.situacion === 'navegando' ? 'on' : ''}">Navegando</button>
              </div>
              <label class="check"><input type="checkbox" name="servicio" ${v.servicio !== false ? 'checked' : ''} ${opera ? '' : 'disabled'}> Se prepara alimentación</label>
            </div>
            ${fds && !d && t.reglas.puerto_fds_sin_servicio ? '<p class="small muted" style="margin:0">Regla: en puerto los fines de semana puede no prepararse comida. Márquelo si hubo servicio.</p>' : ''}
            <div class="form-grid">
              <label class="field"><span>Tripulación — completo (${money(t.completo)})</span>${num('completo', v.completo)}</label>
              <label class="field"><span>Medio arranche (${money(v.situacion === 'navegando' && t.reglas.navegando_cobra_completo ? t.completo : t.medio)})</span>${num('medio', v.medio)}</label>
              <label class="field"><span>Personal de guardia (${money(t.reglas.guardia_completo ? t.completo : t.medio)})</span>${num('guardia', v.guardia)}</label>
              <label class="field"><span>Adicional / comisión (tarifa completa)</span>${num('adicional_completo', v.adicional_completo)}</label>
            </div>
            <div class="table-wrap"><table class="lines">
              <thead><tr><th>Adicionales por comida</th><th>Desayuno</th><th>Almuerzo</th><th>Cena</th></tr></thead>
              <tbody>
                <tr><td>Personal militar</td><td>${num('m_desayuno', v.militar?.desayuno)}</td><td>${num('m_almuerzo', v.militar?.almuerzo)}</td><td>${num('m_cena', v.militar?.cena)}</td></tr>
                <tr><td>Personal civil</td><td>${num('c_desayuno', v.civil?.desayuno)}</td><td>${num('c_almuerzo', v.civil?.almuerzo)}</td><td>${num('c_cena', v.civil?.cena)}</td></tr>
              </tbody></table></div>
            <label class="field"><span>Observaciones</span><textarea name="obs" ${opera ? '' : 'disabled'}>${esc(v.obs || '')}</textarea></label>
            <div class="card" style="background:var(--navy-soft);border:0;box-shadow:none" id="calc"></div>
            ${opera ? '<button class="primary" id="guardar" type="submit">Guardar personal</button>' : ''}
          </form>
        </div>

        <div class="stack">
          ${Object.entries(COMIDAS).map(([k, label]) => {
            const m = menus.find(x => x.comida === k);
            const cons = r.consumos.filter(c => c.comida === k);
            const val = cons.reduce((s, c) => s + c.valor, 0);
            return `<div class="card" data-comida="${k}">
              <div class="card-head"><h2>${label}</h2><span class="badge">${money(val)}</span></div>
              <div class="form-grid">
                <label class="field full"><span>Menú</span><input data-k="descripcion" value="${esc(m?.descripcion || '')}" placeholder="Descripción del menú" ${opera ? '' : 'disabled'}></label>
                <label class="field"><span>Receta</span><select data-k="receta_id" ${opera ? '' : 'disabled'}><option value="">— Ninguna —</option>
                  ${recetas.map(rc => `<option value="${rc.id}" ${m?.receta_id === rc.id ? 'selected' : ''}>${esc(rc.nombre)} v${rc.version}</option>`).join('')}
                  ${m?.receta_id && !recetas.some(x => x.id === m.receta_id) ? `<option value="${m.receta_id}" selected>${esc(get('recetas', m.receta_id)?.nombre)} v${get('recetas', m.receta_id)?.version} (histórica)</option>` : ''}</select></label>
                <label class="field"><span>Porciones</span><input type="number" min="0" data-k="porciones" value="${m?.porciones || (k !== 'otra' ? r.personas || '' : '')}" ${opera ? '' : 'disabled'}></label>
              </div>
              ${opera ? `<div class="row" style="margin-top:10px">
                <button class="sm" data-act="menu">Guardar menú</button>
                <button class="sm primary" data-act="receta">Consumo desde receta</button>
                <button class="sm" data-act="manual">Consumo manual</button></div>` : ''}
              ${cons.length ? `<div class="table-wrap" style="margin-top:10px"><table>
                <thead><tr><th>Producto</th><th class="num">Cant.</th><th>Origen</th><th class="num">Valor</th><th></th></tr></thead>
                <tbody>${cons.map(c => { const p = get('productos', c.producto_id); return `<tr><td>${esc(p?.nombre)}</td><td class="num">${qty(c.cantidad)} ${esc(p?.unidad_medida)}</td><td>${c.origen === 'operacional' ? '<span class="badge warn">Operacional</span>' : 'Conv.'}</td><td class="num">${money(c.valor)}</td>
                  <td>${can('anular') ? `<button class="ghost sm" data-anular="${c.id}" title="Anular">✕</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>`;

    // navegación de fecha
    const setF = nf => { diaSt.fecha = nf; history.replaceState(null, '', `#/coal/dia?f=${nf}`); render(); };
    el.querySelector('#fecha').onchange = e => e.target.value && setF(e.target.value);
    el.querySelector('#prev').onclick = () => setF(addDays(f, -1));
    el.querySelector('#next').onclick = () => setF(addDays(f, 1));
    el.querySelector('#hoy').onclick = () => setF(todayStr());

    // personal
    const form = el.querySelector('#pf');
    let sit = v.situacion || 'puerto';
    const read = () => ({
      fecha: f, situacion: sit, servicio: form.servicio.checked,
      completo: n0(form.completo.value), medio: n0(form.medio.value), guardia: n0(form.guardia.value), adicional_completo: n0(form.adicional_completo.value),
      militar: { desayuno: n0(form.m_desayuno.value), almuerzo: n0(form.m_almuerzo.value), cena: n0(form.m_cena.value) },
      civil: { desayuno: n0(form.c_desayuno.value), almuerzo: n0(form.c_almuerzo.value), cena: n0(form.c_cena.value) },
      obs: form.obs.value.trim(),
    });
    const calc = () => {
      const x = read(); const a = aportesDia(x, t);
      el.querySelector('#calc').innerHTML = `
        <div class="row small"><span>Tripulación</span><span class="spacer"></span>${money(a.tripulacion)}</div>
        <div class="row small"><span>Militares</span><span class="spacer"></span>${money(a.militares)}</div>
        <div class="row small"><span>Civiles</span><span class="spacer"></span>${money(a.civiles)}</div>
        <div class="row"><b>Total aportes · ${personasDia(x)} personas</b><span class="spacer"></span><b>${money(a.total)}</b></div>`;
    };
    form.oninput = calc; calc();
    el.querySelectorAll('[data-sit]').forEach(b => b.onclick = () => {
      if (!opera) return;
      sit = b.dataset.sit;
      el.querySelectorAll('[data-sit]').forEach(x => x.classList.toggle('on', x === b));
      calc();
    });
    form.onsubmit = e => { e.preventDefault(); if (attempt(() => guardarDia(read()))) { toast('Personal alimentado guardado'); render(); } };
    el.querySelector('#copiar')?.addEventListener('click', () => {
      ['completo', 'medio', 'guardia', 'adicional_completo'].forEach(k => form[k].value = prev[k] || '');
      ['desayuno', 'almuerzo', 'cena'].forEach(k => { form['m_' + k].value = prev.militar?.[k] || ''; form['c_' + k].value = prev.civil?.[k] || ''; });
      sit = prev.situacion; el.querySelectorAll('[data-sit]').forEach(x => x.classList.toggle('on', x.dataset.sit === sit));
      calc(); toast('Datos copiados; revise y guarde.');
    });

    // menús y consumos
    el.querySelectorAll('[data-comida]').forEach(card => {
      const comida = card.dataset.comida;
      const val = k => card.querySelector(`[data-k=${k}]`).value;
      card.querySelector('[data-act=menu]')?.addEventListener('click', () => {
        if (attempt(() => guardarMenu({ fecha: f, comida, descripcion: val('descripcion'), receta_id: val('receta_id'), porciones: val('porciones') }))) { toast('Menú guardado'); render(); }
      });
      card.querySelector('[data-act=receta]')?.addEventListener('click', () => {
        const rc = get('recetas', val('receta_id'));
        if (!rc) return toast('Seleccione una receta.', true);
        const porc = n0(val('porciones'));
        if (!porc) return toast('Indique el número de porciones.', true);
        const factor = porc / rc.porciones;
        const lineas = rc.items.map(i => {
          const cant = r3(i.cantidad * factor);
          const origen = stock(i.producto_id, 'convencional') >= cant ? 'convencional' : stock(i.producto_id, 'operacional') >= cant ? 'operacional' : 'convencional';
          return { producto_id: i.producto_id, cantidad: cant, origen };
        });
        const menu = attempt(() => guardarMenu({ fecha: f, comida, descripcion: val('descripcion') || rc.nombre, receta_id: rc.id, porciones: porc }));
        consumoModal(f, comida, lineas, menu?.id, `${rc.nombre} v${rc.version} × ${porc} porciones`, render);
      });
      card.querySelector('[data-act=manual]')?.addEventListener('click', () => consumoModal(f, comida, [], null, '', render));
      card.querySelectorAll('[data-anular]').forEach(b => b.onclick = async () => {
        const motivo = await askMotivo('Anular consumo');
        if (motivo && attempt(() => (anularConsumo(b.dataset.anular, motivo), true))) { toast('Consumo anulado; inventario restituido'); render(); }
      });
    });
  };
  render();
}

function consumoModal(fecha, comida, lineas, menu_id, subtitulo, done) {
  let ed;
  modal({
    title: `Consumo ${COMIDAS[comida]} — ${fdate(fecha)}`,
    wide: true,
    body: `${subtitulo ? `<p class="muted">${esc(subtitulo)}. Ajuste las cantidades realmente utilizadas.</p>` : ''}
      <div id="lines"></div>
      <p class="small muted">Los víveres operacionales se descuentan de su propio inventario y se valorizan con el precio de la planilla.</p>`,
    foot: `<button data-close>Cancelar</button><button class="primary" id="ok">Registrar consumo y descontar inventario</button>`,
    onMount: (m, api) => {
      ed = lineEditor(m.querySelector('#lines'), {
        productos: productosModulo('coal'), rows: lineas,
        cols: { origen: true, info: r => { const p = get('productos', r.producto_id); return `${qty(stock(r.producto_id, r.origen || 'convencional'))} ${p?.unidad_medida || ''} · ${money(costoPromedio(r.producto_id, r.origen || 'convencional'))}`; } },
      });
      m.querySelector('#ok').onclick = () => {
        const out = attempt(() => registrarConsumo({ fecha, comida, lineas: ed.get(), menu_id }));
        if (out) { api.close(); toast(`Consumo registrado: ${money(out.reduce((s, c) => s + c.valor, 0))}`); done(); }
      };
    },
  });
}

// ============================ RECETAS ============================
export function recetas(_p, el) {
  const opera = can('coal.operar');
  const render = () => {
    const rs = recetasActivas();
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><div><h2>Recetas activas</h2><div class="small muted">Al editar una receta se crea una nueva versión; las anteriores se conservan para no alterar balances.</div></div>
          ${opera ? '<button class="primary" id="nueva">+ Nueva receta</button>' : ''}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Receta</th><th>Comida</th><th>Versión</th><th class="num">Porciones</th><th class="num">Costo estimado</th><th class="num">Costo / porción</th><th>Ingredientes</th></tr></thead>
          <tbody>${rs.map(r => { const c = costoReceta(r); return `<tr class="clickable" data-id="${r.id}">
            <td><b>${esc(r.nombre)}</b></td><td>${COMIDAS[r.comida] || ''}</td><td>v${r.version}</td><td class="num">${r.porciones}</td>
            <td class="num">${money(c)}</td><td class="num">${money(c / r.porciones)}</td>
            <td class="small muted">${esc(r.items.map(i => get('productos', i.producto_id)?.nombre).join(', '))}</td></tr>`; }).join('') || emptyRow(7)}</tbody>
        </table></div>
      </div>`;
    el.querySelector('#nueva')?.addEventListener('click', () => recetaForm(null, render));
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => recetaDetalle(get('recetas', tr.dataset.id), render));
  };
  render();
}

function recetaDetalle(r, done) {
  const versiones = q('recetas', x => x.grupo_id === r.grupo_id).sort((a, b) => b.version - a.version);
  modal({
    title: `${esc(r.nombre)} — versión ${r.version}`,
    wide: true,
    body: `<p class="muted">Para ${r.porciones} porciones · ${COMIDAS[r.comida] || ''}</p>
      <table><thead><tr><th>Producto</th><th class="num">Cantidad</th><th class="num">Costo actual</th></tr></thead>
      <tbody>${r.items.map(i => { const p = get('productos', i.producto_id); return `<tr><td>${esc(p?.nombre)}</td><td class="num">${qty(i.cantidad)} ${esc(p?.unidad_medida)}</td><td class="num">${money(i.cantidad * costoPromedio(i.producto_id))}</td></tr>`; }).join('')}
      <tr class="total"><td colspan="2">Total (${money(costoReceta(r) / r.porciones)} por porción)</td><td class="num">${money(costoReceta(r))}</td></tr></tbody></table>
      <h3 style="margin:16px 0 6px">Versiones</h3>
      <table><thead><tr><th>Versión</th><th>Creada</th><th>Por</th><th>Ingredientes</th><th>Estado</th></tr></thead>
      <tbody>${versiones.map(v => `<tr><td>v${v.version}</td><td>${fdt(v.creado_en)}</td><td class="small">${esc(userName(v.creado_por))}</td>
        <td class="small">${esc(v.items.map(i => `${get('productos', i.producto_id)?.nombre} ${qty(i.cantidad)}`).join(', '))}</td><td>${estadoBadge(v.estado)}</td></tr>`).join('')}</tbody></table>`,
    foot: can('coal.operar') ? '<button data-close>Cerrar</button><button class="primary" id="ed">Editar (crear versión nueva)</button>' : '',
    onMount: (m, api) => m.querySelector('#ed')?.addEventListener('click', () => { api.close(); recetaForm(r, done); }),
  });
}

function recetaForm(r, done) {
  let ed;
  modal({
    title: r ? `Nueva versión de ${esc(r.nombre)}` : 'Nueva receta',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Nombre</span><input id="nombre" value="${esc(r?.nombre || '')}"></label>
        <label class="field"><span>Comida</span><select id="comida">${Object.entries(COMIDAS).map(([k, v]) => `<option value="${k}" ${r?.comida === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Rinde (porciones)</span><input type="number" min="1" id="porciones" value="${r?.porciones || 10}"></label>
      </div>
      <h3 style="margin:14px 0 6px">Ingredientes</h3><div id="lines"></div>`,
    foot: `<button data-close>Cancelar</button><button class="primary" id="ok">Guardar</button>`,
    onMount: (m, api) => {
      ed = lineEditor(m.querySelector('#lines'), {
        productos: productosModulo('coal'),
        rows: r ? r.items.map(i => ({ ...i })) : [],
        cols: { info: row => money((+row.cantidad || 0) * costoPromedio(row.producto_id)) },
      });
      m.querySelector('#ok').onclick = () => {
        const x = attempt(() => guardarReceta({ id: r?.id, nombre: m.querySelector('#nombre').value.trim(), comida: m.querySelector('#comida').value, porciones: m.querySelector('#porciones').value, items: ed.get() }));
        if (x) { api.close(); toast(`Receta guardada (v${x.version})`); done(); }
      };
    },
  });
}

// ============================ VÍVERES OPERACIONALES ============================
const opSt = { tipo: 'mes', d1: periodo('mes')[0], d2: periodo('mes')[1] };

export function operacionales(_p, el) {
  const st = opSt;
  const render = () => {
    const rows = q('operacionales', o => o.fecha >= st.d1 && o.fecha <= st.d2).sort((a, b) => b.fecha.localeCompare(a.fecha));
    const cons = q('consumos', c => c.origen === 'operacional' && c.estado === 'activo' && c.fecha >= st.d1 && c.fecha <= st.d2);
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px"><div class="row">${rangeBar(st)}<span class="spacer"></span>
        <button id="csv">Exportar Excel</button>${can('coal.operar') ? '<button class="primary" id="nuevo">+ Registrar planilla</button>' : ''}</div></div>
      <div class="grid grid-3" style="margin-bottom:14px">
        ${kpi('Recibido en el periodo', money(rows.filter(o => o.estado === 'activo').reduce((s, o) => s + o.total, 0)), `${rows.filter(o => o.estado === 'activo').length} planillas`)}
        ${kpi('Consumido en el periodo', money(cons.reduce((s, c) => s + c.valor, 0)))}
        ${kpi('Existencia operacional', money(valorInventario('coal', undefined, 'operacional')))}
      </div>
      <div class="card"><p class="small muted" style="margin-top:0">Víveres asignados por la Fuerza Naval del Pacífico. No se cobran a la tripulación, pero su valor económico se conserva en el costo real de alimentación.</p>
        <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Fecha</th><th>Procedencia</th><th>Planilla / documento</th><th>Productos</th><th class="num">Valor planilla</th><th>Estado</th><th></th></tr></thead>
        <tbody>${rows.map(o => `<tr class="${o.estado === 'anulado' ? 'anulado' : ''}"><td><a href="#" data-ver="${o.id}">${o.numero}</a></td><td>${fdate(o.fecha)}</td><td>${esc(o.procedencia)}</td><td>${esc(o.documento || '')}</td>
          <td class="small">${esc(o.items.map(i => i.nombre).join(', ')).slice(0, 80)}</td><td class="num"><b>${money(o.total)}</b></td><td>${estadoBadge(o.estado)}</td>
          <td>${o.estado === 'activo' && can('anular') ? `<button class="sm danger" data-anular="${o.id}">Anular</button>` : ''}</td></tr>`).join('') || emptyRow(8)}</tbody>
      </table></div></div>`;
    bindRange(el, st, render);
    el.querySelector('#nuevo')?.addEventListener('click', () => {
      let ed;
      modal({
        title: 'Registrar víveres operacionales', wide: true,
        body: `<div class="form-grid">
            <label class="field"><span>Fecha de recibo</span><input type="date" id="fecha" value="${todayStr()}"></label>
            <label class="field"><span>Procedencia</span><input id="proc" value="Fuerza Naval del Pacífico"></label>
            <label class="field"><span>N.º planilla / documento soporte</span><input id="doc"></label>
            <label class="field"><span>Observaciones (días de navegación, personal, operación)</span><input id="nota"></label>
          </div><h3 style="margin:14px 0 6px">Víveres de la planilla</h3><div id="lines"></div>`,
        foot: `<button data-close>Cancelar</button><button class="primary" id="ok">Registrar entrada</button>`,
        onMount: (m, api) => {
          ed = lineEditor(m.querySelector('#lines'), { productos: productosModulo('coal'), cols: { precio: 'Valor unit. planilla' } });
          m.querySelector('#ok').onclick = () => {
            const o = attempt(() => registrarOperacional({ fecha: m.querySelector('#fecha').value, procedencia: m.querySelector('#proc').value.trim(), documento: m.querySelector('#doc').value.trim(), nota: m.querySelector('#nota').value.trim(), items: ed.get() }));
            if (o) { api.close(); toast('Víveres operacionales registrados'); render(); }
          };
        },
      });
    });
    el.querySelectorAll('[data-ver]').forEach(a => a.onclick = e => {
      e.preventDefault();
      const o = get('operacionales', a.dataset.ver);
      modal({
        title: `Planilla ${esc(o.documento || '#' + o.numero)}`,
        body: `<p>${fdate(o.fecha)} · ${esc(o.procedencia)}${o.nota ? ' · ' + esc(o.nota) : ''}</p>
          <table><thead><tr><th>Producto</th><th class="num">Cantidad</th><th class="num">Valor unit.</th><th class="num">Valor</th></tr></thead>
          <tbody>${o.items.map(i => `<tr><td>${esc(i.nombre)}</td><td class="num">${qty(i.cantidad)} ${esc(i.unidad_medida)}</td><td class="num">${money(i.precio)}</td><td class="num">${money(i.cantidad * i.precio)}</td></tr>`).join('')}
          <tr class="total"><td colspan="3">Total</td><td class="num">${money(o.total)}</td></tr></tbody></table>
          <p class="small muted">Registró ${esc(userName(o.creado_por))} · ${fdt(o.creado_en)}</p>`,
      });
    });
    el.querySelectorAll('[data-anular]').forEach(b => b.onclick = async () => {
      const motivo = await askMotivo('Anular planilla');
      if (motivo && attempt(() => (anularOperacional(b.dataset.anular, motivo), true))) { toast('Planilla anulada'); render(); }
    });
    el.querySelector('#csv').onclick = () => exportCSV(`operacionales_${st.d1}_${st.d2}`, [['#', 'Fecha', 'Procedencia', 'Documento', 'Producto', 'Cantidad', 'Unidad', 'Valor unitario', 'Valor', 'Estado'],
      ...rows.flatMap(o => o.items.map(i => [o.numero, fdate(o.fecha), o.procedencia, o.documento, i.nombre, i.cantidad, i.unidad_medida, i.precio, i.cantidad * i.precio, o.estado]))]);
  };
  render();
}

// ============================ TARIFAS ============================
export function tarifasView(_p, el) {
  const t = tarifas();
  const edit = can('coal.operar') || can('admin');
  const inp = (name, v) => `<input type="number" min="0" name="${name}" value="${v}" ${edit ? '' : 'disabled'}>`;
  el.innerHTML = `
    <form id="tf" class="stack">
      <div class="card"><h2 style="margin-bottom:12px">Tripulación</h2>
        <div class="form-grid">
          <label class="field"><span>Completo (desayuno + almuerzo + cena)</span>${inp('completo', t.completo)}</label>
          <label class="field"><span>Medio arranche (desayuno + almuerzo)</span>${inp('medio', t.medio)}</label>
        </div></div>
      <div class="card"><h2 style="margin-bottom:12px">Personal adicional por comida</h2>
        <div class="table-wrap"><table class="lines"><thead><tr><th></th><th>Desayuno</th><th>Almuerzo</th><th>Cena</th></tr></thead><tbody>
          <tr><td>Personal militar</td><td>${inp('m_desayuno', t.militar.desayuno)}</td><td>${inp('m_almuerzo', t.militar.almuerzo)}</td><td>${inp('m_cena', t.militar.cena)}</td></tr>
          <tr><td>Personal civil</td><td>${inp('c_desayuno', t.civil.desayuno)}</td><td>${inp('c_almuerzo', t.civil.almuerzo)}</td><td>${inp('c_cena', t.civil.cena)}</td></tr>
        </tbody></table></div></div>
      <div class="card"><h2 style="margin-bottom:12px">Reglas de alimentación</h2>
        <div class="stack">
          <label class="check"><input type="checkbox" name="navegando_cobra_completo" ${t.reglas.navegando_cobra_completo ? 'checked' : ''} ${edit ? '' : 'disabled'}> Navegando se cobra el esquema completo (el medio arranche paga tarifa completa)</label>
          <label class="check"><input type="checkbox" name="guardia_completo" ${t.reglas.guardia_completo ? 'checked' : ''} ${edit ? '' : 'disabled'}> El personal de guardia se cobra completo</label>
          <label class="check"><input type="checkbox" name="puerto_fds_sin_servicio" ${t.reglas.puerto_fds_sin_servicio ? 'checked' : ''} ${edit ? '' : 'disabled'}> En puerto los fines de semana, por defecto no se prepara comida</label>
        </div></div>
      ${edit ? '<div class="row end"><button class="primary lg">Guardar tarifas</button></div>' : ''}
    </form>`;
  el.querySelector('#tf').onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    guardarTarifas({
      completo: n0(f.completo.value), medio: n0(f.medio.value),
      militar: { desayuno: n0(f.m_desayuno.value), almuerzo: n0(f.m_almuerzo.value), cena: n0(f.m_cena.value) },
      civil: { desayuno: n0(f.c_desayuno.value), almuerzo: n0(f.c_almuerzo.value), cena: n0(f.c_cena.value) },
      reglas: { navegando_cobra_completo: f.navegando_cobra_completo.checked, guardia_completo: f.guardia_completo.checked, puerto_fds_sin_servicio: f.puerto_fds_sin_servicio.checked },
    });
    toast('Tarifas guardadas. Aplican a los cálculos desde ahora.');
  };
}

// ============================ BALANCE COAL ============================
const balSt = { tipo: 'mes', d1: periodo('mes')[0], d2: periodo('mes')[1] };

export function balance(_p, el) {
  const st = balSt;
  const render = () => {
    const b = balanceCoal(st.d1, st.d2);
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px"><div class="row">${rangeBar(st)}<span class="spacer"></span>
        <button id="csv">Exportar Excel</button><button class="primary" id="pdf">Imprimir / PDF</button></div></div>
      <div class="grid grid-4" style="margin-bottom:14px">
        ${kpi('Aportes recibidos', money(b.aportes.total))}
        ${kpi('Costo alimentación', money(b.resultado.costoAlimentacion), 'Víveres convencionales + gastos')}
        ${kpi('Costo / persona', money(b.costos.porPersona), `${b.personasDia} raciones-persona · incl. operacionales`)}
        ${kpi('Resultado', `<span class="${b.resultado.diferencia >= 0 ? 'pos' : 'neg'}">${money(b.resultado.diferencia)}</span>`, `Económico: ${money(b.resultado.diferenciaEconomica)}`)}
      </div>
      ${balanceHTML(b)}`;
    bindRange(el, st, render);
    el.querySelector('#pdf').onclick = () => {
      const un = currentUnit();
      printDoc(`<div class="doc-head"><h1>${esc(un.nombre)}</h1><b>BALANCE COAL — COMISIÓN DE ALIMENTACIÓN</b><br>Periodo: ${fdate(b.d1)} al ${fdate(b.d2)}<br><span class="small">Generado ${fdt(new Date().toISOString())}</span></div>${balanceHTML(b)}`);
    };
    el.querySelector('#csv').onclick = () => exportCSV(`balance_coal_${st.d1}_${st.d2}`, [
      ['BALANCE COAL', `${fdate(b.d1)} - ${fdate(b.d2)}`], [],
      ['APORTES'], ['Tripulación', b.aportes.tripulacion], ['Militares', b.aportes.militares], ['Civiles', b.aportes.civiles], ['Total', b.aportes.total], [],
      ['VÍVERES RECIBIDOS'], ['Comprados', b.viveres.comprados], ['Operacionales', b.viveres.operacionales], [],
      ['CONSUMO', 'Convencional', 'Operacional', 'Total'], ...Object.entries(COMIDAS).map(([k, l]) => [l, b.consumo.porComida[k].conv, b.consumo.porComida[k].oper, b.consumo.porComida[k].conv + b.consumo.porComida[k].oper]),
      ['Total', b.consumo.conv, b.consumo.oper, b.consumo.total], [],
      ['COSTOS'], ['Costo diario promedio', b.costos.diario], ['Costo por persona', b.costos.porPersona], ['Costo por persona (solo convencional)', b.costos.porPersonaConv], ['Valor víveres operacionales consumidos', b.costos.operacional], [],
      ['RESULTADO'], ['Aportes recibidos', b.resultado.aportes], ['Costo de alimentación (conv. + gastos)', b.resultado.costoAlimentacion], ['Diferencia', b.resultado.diferencia], ['Costo económico total (incl. operacionales)', b.resultado.costoEconomico], ['Diferencia económica', b.resultado.diferenciaEconomica], [],
      ['DETALLE DIARIO'], ['Fecha', 'Personas', 'Aportes', 'Convencional', 'Operacional', 'Costo total', 'Costo/persona', 'Diferencia'],
      ...b.dias.map(d => [fdate(d.fecha), d.personas, d.aportes.total, d.conv, d.oper, d.total, d.costoPersona, d.diferencia]),
    ]);
  };
  render();
}

function balanceHTML(b) {
  const tr = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="num">${money(v)}</td></tr>`;
  const sec = (t, rows) => `<div class="card"><h3 style="margin-bottom:8px">${t}</h3><table><tbody>${rows}</tbody></table></div>`;
  return `<div class="grid grid-2">
    <div class="stack">
      ${sec('Ingresos / aportes', tr('Tripulación', b.aportes.tripulacion) + tr('Militares', b.aportes.militares) + tr('Civiles', b.aportes.civiles) + tr('Total aportes', b.aportes.total, 'total'))}
      ${sec('Víveres recibidos', tr('Comprados (convencionales)', b.viveres.comprados) + tr('Operacionales (valor planilla)', b.viveres.operacionales) + tr('Total', b.viveres.comprados + b.viveres.operacionales, 'total'))}
      ${sec('Resultado', tr('Aportes recibidos', b.resultado.aportes) + tr('(−) Víveres convencionales consumidos', b.consumo.conv) + tr('(−) Gastos COAL', b.gastos) + tr('Diferencia', b.resultado.diferencia, 'total')
        + tr('(−) Valor víveres operacionales', b.consumo.oper) + tr('Diferencia económica (costo real)', b.resultado.diferenciaEconomica, 'total'))}
    </div>
    <div class="stack">
      <div class="card"><h3 style="margin-bottom:8px">Consumo por comida</h3><table>
        <thead><tr><th></th><th class="num">Convencional</th><th class="num">Operacional</th><th class="num">Total</th></tr></thead><tbody>
        ${Object.entries(COMIDAS).map(([k, l]) => `<tr><td>${l}</td><td class="num">${money(b.consumo.porComida[k].conv)}</td><td class="num">${money(b.consumo.porComida[k].oper)}</td><td class="num">${money(b.consumo.porComida[k].conv + b.consumo.porComida[k].oper)}</td></tr>`).join('')}
        <tr class="total"><td>Total</td><td class="num">${money(b.consumo.conv)}</td><td class="num">${money(b.consumo.oper)}</td><td class="num">${money(b.consumo.total)}</td></tr></tbody></table></div>
      ${sec('Costos', tr(`Costo diario promedio (${b.diasServicio} días con servicio)`, b.costos.diario) + tr(`Costo por persona (${b.personasDia} raciones)`, b.costos.porPersona) + tr('Costo por persona — solo convencional', b.costos.porPersonaConv) + tr('Costo del periodo', b.consumo.total + b.gastos, 'total'))}
      ${sec('Inventario de víveres (a costo)', tr('Convencional inicial', b.inventario.inicialConv) + tr('Convencional final', b.inventario.finalConv) + tr('Operacional inicial', b.inventario.inicialOper) + tr('Operacional final', b.inventario.finalOper))}
    </div>
  </div>
  <div class="card" style="margin-top:14px"><h3 style="margin-bottom:8px">Detalle diario</h3><div class="table-wrap"><table>
    <thead><tr><th>Fecha</th><th class="num">Personas</th><th class="num">Aportes</th><th class="num">Convencional</th><th class="num">Operacional</th><th class="num">Costo/persona</th><th class="num">Diferencia</th></tr></thead>
    <tbody>${b.dias.filter(d => d.personas || d.total).map(d => `<tr><td><a href="#/coal/dia?f=${d.fecha}">${fdate(d.fecha)}</a></td><td class="num">${d.personas}</td><td class="num">${money(d.aportes.total)}</td><td class="num">${money(d.conv)}</td><td class="num">${money(d.oper)}</td><td class="num">${money(d.costoPersona)}</td><td class="num ${d.diferencia < 0 ? 'neg' : ''}">${money(d.diferencia)}</td></tr>`).join('') || emptyRow(7)}</tbody>
  </table></div></div>`;
}

// ============================ PARTE DIARIO ============================
const parteSt = { d1: todayStr(), d2: todayStr() };

export function parte(params, el) {
  if (params.f) { parteSt.d1 = parteSt.d2 = params.f; }
  const render = () => {
    const html = [];
    for (let f = parteSt.d1; f <= parteSt.d2; f = addDays(f, 1)) html.push(parteHTML(f));
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px"><div class="row">
        <label class="field"><span>Desde</span><input type="date" id="d1" value="${parteSt.d1}"></label>
        <label class="field"><span>Hasta</span><input type="date" id="d2" value="${parteSt.d2}"></label>
        <span class="spacer"></span><button id="csv">Exportar Excel</button><button class="primary" id="pdf">Imprimir / PDF</button></div>
        <p class="small muted" style="margin-bottom:0">Documento independiente del balance de la aplicación. La plantilla puede ajustarse para reproducir exactamente el formato institucional vigente.</p></div>
      <div class="card doc">${html.join('<hr style="margin:30px 0">')}</div>`;
    el.querySelector('#d1').onchange = e => { parteSt.d1 = e.target.value; if (parteSt.d2 < parteSt.d1) parteSt.d2 = parteSt.d1; render(); };
    el.querySelector('#d2').onchange = e => { parteSt.d2 = e.target.value < parteSt.d1 ? parteSt.d1 : e.target.value; render(); };
    el.querySelector('#pdf').onclick = () => printDoc(html.join('<div style="page-break-after:always"></div>'));
    el.querySelector('#csv').onclick = () => {
      const rows = [['Fecha', 'Situación', 'Completo', 'Medio', 'Guardia', 'Adicional', 'Militares D', 'Militares A', 'Militares C', 'Civiles D', 'Civiles A', 'Civiles C', 'Personas', 'Aportes', 'Convencional', 'Operacional', 'Costo total', 'Costo/persona']];
      for (let f = parteSt.d1; f <= parteSt.d2; f = addDays(f, 1)) {
        const r = resumenCoalDia(f); const d = r.dia || { militar: {}, civil: {} };
        rows.push([fdate(f), d.servicio === false ? 'Sin servicio' : d.situacion || '', d.completo || 0, d.medio || 0, d.guardia || 0, d.adicional_completo || 0, d.militar?.desayuno || 0, d.militar?.almuerzo || 0, d.militar?.cena || 0, d.civil?.desayuno || 0, d.civil?.almuerzo || 0, d.civil?.cena || 0, r.personas, r.aportes.total, r.conv, r.oper, r.total, r.costoPersona]);
      }
      exportCSV(`parte_diario_${parteSt.d1}_${parteSt.d2}`, rows);
    };
  };
  render();
}

function parteHTML(f) {
  const un = currentUnit();
  const t = tarifas();
  const r = resumenCoalDia(f, t);
  const d = r.dia || { militar: {}, civil: {} };
  const menus = q('menus', m => m.fecha === f && m.estado === 'activo');
  const navegando = d.situacion === 'navegando';
  const tarMedio = navegando && t.reglas.navegando_cobra_completo ? t.completo : t.medio;
  const tarGuardia = t.reglas.guardia_completo ? t.completo : t.medio;
  const row = (l, n, tar) => `<tr><td>${l}</td><td class="num">${n0(n)}</td><td class="num">${money(tar)}</td><td class="num">${money(n0(n) * tar)}</td></tr>`;
  const sinServ = d.servicio === false;
  return `
    <div class="doc-head"><h1>${esc(un.nombre)}</h1><b>PARTE DIARIO DE ALIMENTACIÓN — COAL</b><br>
      Fecha: ${fdate(f)} · ${new Date(f + 'T12:00').toLocaleDateString('es-CO', { weekday: 'long' }).toUpperCase()} · Situación: ${r.dia ? (sinServ ? 'SIN SERVICIO DE ALIMENTACIÓN' : navegando ? 'NAVEGANDO' : 'EN PUERTO') : 'SIN REGISTRO'}</div>
    <h2>1. Personal alimentado</h2>
    <table><thead><tr><th>Categoría</th><th class="num">Cantidad</th><th class="num">Tarifa</th><th class="num">Valor</th></tr></thead><tbody>
      ${row('Tripulación — completo', sinServ ? 0 : d.completo, t.completo)}
      ${row('Tripulación — medio arranche', sinServ ? 0 : d.medio, tarMedio)}
      ${row('Personal de guardia', sinServ ? 0 : d.guardia, tarGuardia)}
      ${row('Adicional / comisión', sinServ ? 0 : d.adicional_completo, t.completo)}
      ${['desayuno', 'almuerzo', 'cena'].map(k => row(`Militar — ${COMIDAS[k].toLowerCase()}`, sinServ ? 0 : d.militar?.[k], t.militar[k])).join('')}
      ${['desayuno', 'almuerzo', 'cena'].map(k => row(`Civil — ${COMIDAS[k].toLowerCase()}`, sinServ ? 0 : d.civil?.[k], t.civil[k])).join('')}
      <tr class="total"><td>Total personas / aportes</td><td class="num">${r.personas}</td><td></td><td class="num">${money(r.aportes.total)}</td></tr>
    </tbody></table>
    <h2>2. Menú</h2>
    <table><tbody>${Object.entries(COMIDAS).map(([k, l]) => { const m = menus.find(x => x.comida === k); return m || k !== 'otra' ? `<tr><th style="width:120px">${l}</th><td>${esc(m?.descripcion || '—')}${m?.porciones ? ` (${m.porciones} porciones)` : ''}</td></tr>` : ''; }).join('')}</tbody></table>
    <h2>3. Víveres consumidos</h2>
    <table><thead><tr><th>Comida</th><th>Producto</th><th class="num">Cantidad</th><th>Origen</th><th class="num">Costo unit.</th><th class="num">Valor</th></tr></thead><tbody>
      ${r.consumos.map(c => { const p = get('productos', c.producto_id); return `<tr><td>${COMIDAS[c.comida]}</td><td>${esc(p?.nombre)}</td><td class="num">${qty(c.cantidad)} ${esc(p?.unidad_medida)}</td><td>${ORIGENES[c.origen]}</td><td class="num">${money(c.costo_unit)}</td><td class="num">${money(c.valor)}</td></tr>`; }).join('') || '<tr><td colspan="6" style="text-align:center">Sin consumos registrados</td></tr>'}
    </tbody></table>
    <h2>4. Resumen económico</h2>
    <table><tbody>
      <tr><td>Víveres convencionales</td><td class="num">${money(r.conv)}</td></tr>
      <tr><td>Víveres operacionales</td><td class="num">${money(r.oper)}</td></tr>
      <tr class="total"><td>Costo real de alimentación</td><td class="num">${money(r.total)}</td></tr>
      <tr><td>Costo por persona</td><td class="num">${money(r.costoPersona)}</td></tr>
      <tr><td>Aportes del día</td><td class="num">${money(r.aportes.total)}</td></tr>
      <tr class="total"><td>Diferencia (aportes − convencionales)</td><td class="num">${money(r.diferencia)}</td></tr>
    </tbody></table>
    ${d.obs ? `<h2>5. Observaciones</h2><p>${esc(d.obs)}</p>` : ''}
    <div class="firmas"><div>Elaboró<br>Logístico COAL</div><div>Revisó<br>Segundo Comandante</div><div>Aprobó<br>Comandante</div></div>`;
}
