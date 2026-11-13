// Importar desde la app Treinta: lee los reportes de Excel (inventario y deudas), busca
// coincidencias con lo que ya existe, deja revisar cada una y solo entonces guarda.
// Solo el administrador de la unidad.
import { q } from '../store.js';
import { importarTreinta, nombreCliente, stock, claveNombre, deudasNuevas } from '../domain.js';
import { esc, money, qty, toast, attempt, emptyRow, kpi } from '../ui.js';
import { leerXlsx } from '../xlsx.js';
import { interpretarInventario, interpretarDeudas, buscarCliente, buscarProducto } from '../treinta.js';

export function importar(_p, el) {
  // elec: lo que el usuario eligió a mano para cada fila ("p:<nombre>" o "c:<nombre>" -> valor del selector)
  const st = { inv: null, deu: null, pctExterno: 0, elec: {}, errores: [], resultado: null };

  const render = () => {
    const existP = q('productos', p => p.modulo === 'cantina' && p.estado !== 'eliminado').sort((a, b) => a.nombre.localeCompare(b.nombre));
    const existC = q('clientes', c => c.estado === 'activo').sort((a, b) => nombreCliente(a).localeCompare(nombreCliente(b)));

    // ---- Productos: acción sugerida para cada uno ----
    const prods = (st.inv?.productos || []).map(p => {
      const k = claveNombre(p.nombre);
      const ya = existP.find(x => (x.treinta || []).includes(k));
      const hit = ya ? null : buscarProducto(p.nombre, existP);
      const sugerida = ya ? 'omitir' : hit ? 'sumar:' + hit.id : 'nuevo';
      const accion = ya ? 'omitir' : st.elec['p:' + k] ?? sugerida;
      const dest = accion.startsWith('sumar:') ? existP.find(x => x.id === accion.slice(6)) : null;
      return { ...p, k, ya, hit, accion, dest, precioExterno: Math.round(p.precio * (1 + st.pctExterno / 100)) };
    });

    // ---- Deudas: a quién va cada una y cuánto falta por pasar ----
    // "ya" = cliente que ya recibió deudas de este contacto en una importación anterior: se le
    // completa lo que falte, comparando compra por compra (sirve para pasar de un reporte parcial al completo).
    const clis = (st.deu?.clientes || []).map(c => {
      const k = claveNombre(c.nombre);
      const ya = existC.find(x => (x.treinta || []).includes(k));
      const hit = ya ? null : buscarCliente(c.nombre, existC);
      const accion = ya ? 'cliente:' + ya.id : st.elec['c:' + k] ?? (hit ? 'cliente:' + hit.id : 'nuevo');
      const dest = accion.startsWith('cliente:') ? existC.find(x => x.id === accion.slice(8)) : null;
      const nuevas = dest ? deudasNuevas(c.detalle, dest.saldo_inicial_detalle) : c.detalle;
      const entra = accion === 'omitir' ? 0 : nuevas.reduce((s, d) => s + d.valor, 0);
      return { ...c, k, ya, hit, accion, dest, entra, nNuevas: accion === 'omitir' ? 0 : nuevas.length, yaTiene: c.saldo - nuevas.reduce((s, d) => s + d.valor, 0) };
    });

    const pNuevos = prods.filter(p => p.accion === 'nuevo'), pSuman = prods.filter(p => p.dest);
    const cAsig = clis.filter(c => c.dest && c.entra > 0), cNuevos = clis.filter(c => c.accion === 'nuevo');
    const cCompletos = clis.filter(c => c.dest && c.entra === 0);
    const valorInv = [...pNuevos, ...pSuman].reduce((s, p) => s + p.cantidad * p.costo, 0);
    const deuda = [...cAsig, ...cNuevos].reduce((s, c) => s + c.entra, 0);
    const deudaFinal = clis.filter(c => c.accion !== 'omitir').reduce((s, c) => s + c.saldo, 0); // lo que quedará importado de este reporte
    const todoP = st.inv && pNuevos.length + pSuman.length === st.inv.productos.length;
    const todoC = st.deu && clis.every(c => c.accion !== 'omitir');
    const cuadra = (leido, declarado, texto = 'coincide con el reporte de Treinta') => declarado == null ? '' :
      Math.abs(leido - declarado) < 1 ? `<span class="pos">✔ ${texto}</span>` : `<span class="neg">el reporte de Treinta dice ${money(declarado)}</span>`;

    // ---- Comprobación de duplicados ----
    const problemas = [];
    const nombresExist = new Set(existP.map(p => claveNombre(p.nombre)));
    pNuevos.filter(p => nombresExist.has(p.k)).forEach(p => problemas.push(`"${p.nombre}" ya existe como producto: elija "Sumar a…" o "No importar".`));
    const nomCli = new Set(existC.map(c => claveNombre(nombreCliente(c))));
    cNuevos.filter(c => nomCli.has(c.k)).forEach(c => problemas.push(`"${c.nombre}" ya existe como cliente: asígnele la deuda en lugar de crearlo.`));
    const porRevisar = prods.filter(p => p.dest && p.hit?.tipo === 'aproximada' && st.elec['p:' + p.k] === undefined).length
      + clis.filter(c => c.dest && !c.ya && c.hit?.tipo === 'aproximada' && st.elec['c:' + c.k] === undefined).length;
    const varios = lista => { const m = {}; lista.forEach(x => { (m[x.dest.id] ||= []).push(x.nombre); }); return Object.values(m).filter(v => v.length > 1); };
    const avisos = [...st.errores, ...(st.inv?.avisos || []), ...(st.deu?.avisos || []),
      ...varios(cAsig).map(v => `Estas deudas quedan sumadas en un mismo cliente: ${v.join(' + ')}.`),
      ...varios(pSuman).map(v => `Estos productos de Treinta suman a un mismo producto: ${v.join(' + ')}.`)];
    const nAcc = pNuevos.length + pSuman.length + cAsig.length + cNuevos.length;

    const insigniaP = x => x.ya ? '<span class="badge">Ya importado</span>'
      : x.accion === 'omitir' ? '<span class="badge">No se importa</span>'
      : x.dest ? (x.hit?.tipo === 'aproximada' && x.hit.id === x.dest.id ? '<span class="badge warn">⚠ Parecido: verifique</span>' : '<span class="badge ok">Coincide</span>')
      : '<span class="badge">Nuevo</span>';
    const insigniaC = x => x.accion === 'omitir' ? '<span class="badge">No se importa</span>'
      : x.dest && x.entra === 0 ? '<span class="badge">Ya importado</span>'
      : x.ya ? '<span class="badge warn">Falta completar</span>'
      : x.dest ? (x.hit?.tipo === 'aproximada' && x.hit.id === x.dest.id ? '<span class="badge warn">⚠ Parecido: verifique</span>' : '<span class="badge ok">Coincide</span>')
      : '<span class="badge">Nuevo</span>';

    el.innerHTML = `
      <div class="card" style="max-width:900px">
        <h2>Importar desde Treinta</h2>
        <p class="muted">Descargue en Treinta los reportes de <b>Inventario</b> y de <b>Deudas</b> en Excel y selecciónelos aquí. Primero verá una vista previa; nada se guarda hasta que confirme.</p>
        <div class="form-grid">
          <label class="field"><span>Reporte de inventario (.xlsx)</span><input type="file" id="f-inv" accept=".xlsx"></label>
          <label class="field"><span>Reporte de deudas (.xlsx)</span><input type="file" id="f-deu" accept=".xlsx"></label>
        </div>
        <p class="small muted">Si un producto <b>ya existe</b> aquí, se le <b>suman</b> las existencias de Treinta y conserva su nombre y sus precios. Si un cliente <b>ya existe</b>, solo se le pasa la deuda como saldo anterior. Las deudas se comparan compra por compra: puede importar el reporte <b>completo</b> aunque antes haya importado uno parcial, y solo entra lo que falte. El historial de ventas de Treinta no se importa.</p>
      </div>
      ${st.resultado ? `<div class="card" style="max-width:900px"><h3 class="pos">✔ Importación terminada</h3>
        <p><b>${st.resultado.productos}</b> productos nuevos y <b>${st.resultado.sumados}</b> existentes con existencias sumadas (${qty(st.resultado.unidadesSumadas)} unidades); inventario traído ${money(st.resultado.valorInventario)}.<br>
        Deudas pasadas o completadas a <b>${st.resultado.asignados}</b> clientes existentes y <b>${st.resultado.clientes}</b> clientes nuevos; entraron ${money(st.resultado.deuda)} por cobrar.</p>
        <div class="row"><a class="btn" href="#/cantina/clientes">Ver clientes</a><a class="btn" href="#/cantina/inventario">Ver inventario</a><a class="btn" href="#/cantina/productos">Ver productos</a></div></div>` : ''}
      ${problemas.length ? `<div class="card" style="max-width:900px"><h3 class="neg">Duplicados por resolver</h3><ul class="small" style="margin:6px 0 0 18px">${problemas.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
      ${avisos.length ? `<div class="card" style="max-width:900px"><h3>Avisos</h3><ul class="small" style="margin:6px 0 0 18px">${avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
      ${st.inv || st.deu ? `
        <div class="grid grid-4" style="margin:14px 0">
          ${kpi('Productos', `${pNuevos.length} nuevos`, `${pSuman.length} suman existencias a uno existente`)}
          ${kpi('Inventario que entra', money(valorInv), todoP ? cuadra(valorInv, st.inv.totalDeclarado) : '')}
          ${kpi('Deudas', `${cAsig.length + cNuevos.length} por pasar`, `${cCompletos.length} ya están completas · ${cNuevos.length} crean cliente nuevo`)}
          ${kpi('Por cobrar que entra', money(deuda), st.deu ? `Quedará en ${money(deudaFinal)}. ${todoC ? cuadra(deudaFinal, st.deu.totalDeclarado, 'igual al reporte de Treinta') : ''}` : '')}
        </div>
        <div class="card">
          <div class="row">
            <label class="field" style="max-width:280px"><span>Precio externo de productos nuevos: % sobre el de Treinta</span><input type="number" id="pct" step="any" min="0" value="${st.pctExterno}"></label>
            ${st.inv ? '<button id="sin-ceros">No importar productos nuevos sin existencias</button>' : ''}
            <span class="spacer"></span>
            <button class="primary lg" id="ok" ${nAcc && !problemas.length ? '' : 'disabled'}>Importar</button>
          </div>
          <p class="small ${porRevisar ? 'neg' : 'muted'}" style="margin-bottom:0">${porRevisar ? `⚠ Hay ${porRevisar} coincidencia(s) parecidas pero no idénticas: revise que sean el mismo producto o la misma persona antes de importar.` : (problemas.length ? 'Resuelva los duplicados para poder importar.' : (nAcc ? '✔ Sin duplicados: nada de lo nuevo coincide con algo que ya exista.' : 'No hay nada nuevo por importar de estos archivos.'))}</p>
        </div>` : ''}
      ${st.deu ? `<div class="card"><div class="card-head"><h3>Deudas (${clis.length})</h3></div>
        <div class="table-wrap"><table><thead><tr><th>En Treinta</th><th class="num">Debe según el reporte</th><th class="num">Ya importado</th><th class="num">Entra ahora</th><th>Pasar la deuda a</th><th></th></tr></thead>
        <tbody>${clis.map(c => `<tr class="${c.accion === 'omitir' || (c.dest && c.entra === 0) ? 'anulado' : ''}"><td>${esc(c.nombre)} <span class="small muted">${c.detalle.length} compra(s)</span></td>
          <td class="num">${money(c.saldo)}</td><td class="num">${c.dest ? money(c.yaTiene) : '—'}</td>
          <td class="num"><b>${money(c.entra)}</b>${c.entra > 0 && c.dest ? ` <span class="small muted">${c.nNuevas} compra(s)</span>` : ''}</td>
          <td>${c.ya ? `<span class="small">${esc(nombreCliente(c.ya))}</span>` : `<select data-c="${esc(c.k)}">
            ${existC.map(x => `<option value="cliente:${x.id}" ${c.accion === 'cliente:' + x.id ? 'selected' : ''}>${esc(nombreCliente(x))}</option>`).join('')}
            <option value="nuevo" ${c.accion === 'nuevo' ? 'selected' : ''}>➕ Crear cliente nuevo</option>
            <option value="omitir" ${c.accion === 'omitir' ? 'selected' : ''}>✕ No importar</option></select>`}</td>
          <td>${insigniaC(c)}</td></tr>`).join('') || emptyRow(6)}</tbody></table></div></div>` : ''}
      ${st.inv ? `<div class="card"><div class="card-head"><h3>Productos (${prods.length})</h3><span class="small muted">${esc(st.inv.negocio)}</span></div>
        <div class="table-wrap"><table><thead><tr><th>En Treinta</th><th class="num">Existencias</th><th class="num">Costo</th><th class="num">Precio</th><th>Qué hacer</th><th class="num">Quedará con</th><th></th></tr></thead>
        <tbody>${prods.map(p => `<tr class="${p.accion === 'omitir' ? 'anulado' : ''}"><td>${esc(p.nombre)}${p.categoria ? ` <span class="small muted">${esc(p.categoria)}</span>` : ''}</td>
          <td class="num">${qty(p.cantidad)}</td><td class="num">${money(p.costo)}</td><td class="num">${money(p.precio)}</td>
          <td>${p.ya ? `<span class="small muted">Ya se trajo a ${esc(p.ya.nombre)}</span>` : `<select data-p="${esc(p.k)}">
            <option value="nuevo" ${p.accion === 'nuevo' ? 'selected' : ''}>➕ Crear producto nuevo</option>
            ${existP.map(x => `<option value="sumar:${x.id}" ${p.accion === 'sumar:' + x.id ? 'selected' : ''}>Sumar a: ${esc(x.nombre)} (tiene ${qty(stock(x.id))})</option>`).join('')}
            <option value="omitir" ${p.accion === 'omitir' ? 'selected' : ''}>✕ No importar</option></select>`}</td>
          <td class="num">${p.dest ? `<b>${qty(stock(p.dest.id) + p.cantidad)}</b>` : p.accion === 'nuevo' ? qty(p.cantidad) : '—'}</td>
          <td>${insigniaP(p)}</td></tr>`).join('') || emptyRow(7)}</tbody></table></div></div>` : ''}`;

    const cargar = (id, interpretar, destino, nombre) => {
      el.querySelector(id).onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        st.resultado = null;
        st.errores = st.errores.filter(x => !x.startsWith(nombre));
        try {
          const r = interpretar(await leerXlsx(file));
          if (!r) throw new Error('no parece ser ese reporte de Treinta (no se encontraron las columnas esperadas).');
          st[destino] = r;
        } catch (err) { st[destino] = null; st.errores.push(`${nombre}: ${err.message}`); }
        render();
      };
    };
    cargar('#f-inv', interpretarInventario, 'inv', 'Inventario');
    cargar('#f-deu', interpretarDeudas, 'deu', 'Deudas');
    el.querySelectorAll('[data-p]').forEach(s => s.onchange = () => { st.elec['p:' + s.dataset.p] = s.value; render(); });
    el.querySelectorAll('[data-c]').forEach(s => s.onchange = () => { st.elec['c:' + s.dataset.c] = s.value; render(); });
    const pct = el.querySelector('#pct');
    if (pct) pct.onchange = () => { st.pctExterno = Math.max(0, +pct.value || 0); render(); };
    const sinCeros = el.querySelector('#sin-ceros');
    if (sinCeros) sinCeros.onclick = () => { pNuevos.filter(p => !(p.cantidad > 0)).forEach(p => { st.elec['p:' + p.k] = 'omitir'; }); render(); };
    const ok = el.querySelector('#ok');
    if (ok) ok.onclick = () => {
      const texto = `Se van a crear ${pNuevos.length} productos, sumar existencias a ${pSuman.length} productos existentes, pasar deudas a ${cAsig.length} clientes existentes (${money(cAsig.reduce((s, c) => s + c.entra, 0))}) y crear ${cNuevos.length} clientes.` +
        (porRevisar ? `\n\nHay ${porRevisar} coincidencia(s) solo parecidas que no ha cambiado. ¿Ya las revisó?` : '') + '\n\n¿Continuar?';
      if (!confirm(texto)) return;
      ok.disabled = true;
      const r = attempt(() => importarTreinta({
        productos: [...pNuevos.map(p => ({ ...p, accion: 'nuevo' })), ...pSuman.map(p => ({ ...p, accion: 'sumar', producto_id: p.dest.id }))],
        clientes: [...cAsig.map(c => ({ ...c, accion: 'asignar', cliente_id: c.dest.id })), ...cNuevos.map(c => ({ ...c, accion: 'nuevo' }))],
      }));
      if (r) { st.resultado = r; st.inv = null; st.deu = null; st.elec = {}; toast('Importación terminada'); }
      render();
    };
  };
  render();
}
