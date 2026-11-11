// Reglas de negocio: inventario (Kardex), CANTINA y COAL.
import {
  q, get, insert, update, save, audit, nextSeq, currentUser, currentUnit, todayStr, addDays, can, moduleOn,
} from './store.js';

// Las reglas validan permisos por sí mismas (no dependen de que la pantalla oculte el botón).
// Es el mismo contrato que deberán aplicar las políticas de Supabase.
function exigir(permiso, modulo) {
  if (modulo && !moduleOn(modulo)) throw new Error(`El módulo ${modulo.toUpperCase()} no está habilitado en esta unidad.`);
  if (!can(permiso)) throw new Error('No tiene permiso para realizar esta acción.');
}

// Un registro solo se puede anular una vez.
function exigirActivo(row, nombre) {
  if (!row) throw new Error('Registro no encontrado.');
  if (row.estado !== 'activo') throw new Error(`${nombre} ya fue anulad${nombre.startsWith('La') ? 'a' : 'o'}.`);
  return row;
}

// Nombre obligatorio y único entre los productos del módulo (sin distinguir mayúsculas).
export function validarProducto(modulo, nombre, exceptoId = null) {
  const n = String(nombre || '').trim().toLowerCase();
  if (!n) throw new Error('Indique el nombre del producto.');
  const dup = q('productos', p => p.modulo === modulo && p.estado !== 'eliminado' && p.id !== exceptoId && p.nombre.trim().toLowerCase() === n)[0];
  if (dup) throw new Error(`Ya existe un producto llamado "${dup.nombre}"${dup.estado === 'activo' ? '' : ' (inactivo)'}.`);
}

export const r3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
export const r0 = n => Math.round(Number(n) || 0);

export const UNIDADES_MEDIDA = ['UND', 'KG', 'G', 'L', 'ML', 'LB', 'PAQ', 'CAJA', 'BOLSA', 'KL'];
export const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Nequi', 'Daviplata', 'Descuento nómina', 'Otro'];
export const COMIDAS = { desayuno: 'Desayuno', almuerzo: 'Almuerzo', cena: 'Cena', otra: 'Otra' };
export const ORIGENES = { convencional: 'Convencional', operacional: 'Operacional' };

// ======================= PRECIOS =======================
export function precioVigente(producto_id, fecha = todayStr()) {
  const rows = q('precios', p => p.producto_id === producto_id && p.desde <= fecha)
    .sort((a, b) => (a.desde + a.creado_en).localeCompare(b.desde + b.creado_en));
  return rows[rows.length - 1] || null;
}

export function historialPrecios(producto_id) {
  return q('precios', p => p.producto_id === producto_id)
    .sort((a, b) => (b.desde + b.creado_en).localeCompare(a.desde + a.creado_en));
}

export function setPrecio(producto_id, { compra = 0, tripulacion = 0, externo = 0, desde = todayStr() }) {
  exigir(get('productos', producto_id)?.modulo + '.operar');
  const prev = precioVigente(producto_id, desde);
  if (prev && prev.compra === +compra && prev.tripulacion === +tripulacion && prev.externo === +externo) return prev;
  const row = insert('precios', { producto_id, desde, compra: +compra, tripulacion: +tripulacion, externo: +externo });
  const p = get('productos', producto_id);
  audit('Cambio de precio', 'productos', producto_id,
    `${p?.nombre}: trip. $${tripulacion} / ext. $${externo} / compra $${compra} desde ${desde}`);
  return row;
}

// ======================= INVENTARIO =======================
function activeMovs(producto_id, origen) {
  return q('movimientos', m => m.producto_id === producto_id && m.estado === 'activo' && (!origen || m.origen === origen));
}

export function stock(producto_id, origen) {
  return r3(activeMovs(producto_id, origen).reduce((s, m) => s + (m.entrada || 0) - (m.salida || 0), 0));
}

export function costoPromedio(producto_id, origen = 'convencional') {
  const ent = activeMovs(producto_id, origen).filter(m => m.entrada > 0 && m.costo_unit > 0);
  const qty = ent.reduce((s, m) => s + m.entrada, 0);
  if (qty > 0) return ent.reduce((s, m) => s + m.entrada * m.costo_unit, 0) / qty;
  const pv = precioVigente(producto_id);
  return pv ? pv.compra : 0;
}

export function addMov(m) {
  const p = get('productos', m.producto_id);
  return insert('movimientos', {
    modulo: p?.modulo, origen: 'convencional', fecha: todayStr(), entrada: 0, salida: 0, costo_unit: 0, ...m,
  }, { silent: true });
}

function anularMovsRef(ref_tipo, ref_id) {
  q('movimientos', m => m.ref_tipo === ref_tipo && m.ref_id === ref_id && m.estado === 'activo')
    .forEach(m => { m.estado = 'anulado'; m.modificado_en = new Date().toISOString(); m.modificado_por = currentUser().id; });
}

export const TIPOS_MOV = {
  inicial: 'Inventario inicial', compra: 'Compra', venta: 'Venta', consumo: 'Consumo COAL',
  operacional: 'Víveres operacionales', ajuste: 'Ajuste autorizado',
};

export function kardex(producto_id, origen) {
  const rows = q('movimientos', m => m.producto_id === producto_id && (!origen || m.origen === origen))
    .sort((a, b) => (a.fecha + a.creado_en).localeCompare(b.fecha + b.creado_en));
  let saldo = 0;
  return rows.map(m => {
    if (m.estado === 'activo') saldo = r3(saldo + (m.entrada || 0) - (m.salida || 0));
    return { ...m, saldo };
  });
}

// Valor del inventario (a costo) con movimientos hasta la fecha indicada (inclusive).
export function valorInventario(modulo, hasta = '9999-12-31', origen) {
  return q('movimientos', m => m.modulo === modulo && m.estado === 'activo' && m.fecha <= hasta && (!origen || m.origen === origen))
    .reduce((s, m) => s + ((m.entrada || 0) - (m.salida || 0)) * (m.costo_unit || 0), 0);
}

function movsRango(modulo, d1, d2, origen) {
  return q('movimientos', m => m.modulo === modulo && m.estado === 'activo' && m.fecha >= d1 && m.fecha <= d2 && (!origen || m.origen === origen));
}

export function ajusteInventario({ producto_id, cantidad, motivo, origen = 'convencional', costo_unit }) {
  exigir('ajustes');
  const c = r3(cantidad);
  if (!c) throw new Error('La cantidad del ajuste no puede ser cero.');
  if (!motivo) throw new Error('Indique el motivo del ajuste.');
  if (c < 0 && stock(producto_id, origen) + c < 0) throw new Error('El ajuste deja el inventario en negativo.');
  const cu = costo_unit || costoPromedio(producto_id, origen);
  const m = addMov({
    producto_id, origen, tipo: 'ajuste', entrada: c > 0 ? c : 0, salida: c < 0 ? -c : 0, costo_unit: cu, detalle: motivo,
  });
  save();
  const p = get('productos', producto_id);
  audit('Ajuste de inventario', 'movimientos', m.id, `${p.nombre}: ${c > 0 ? '+' : ''}${c} ${p.unidad_medida}`, motivo);
  return m;
}

export function crearProducto(data, inicial) {
  exigir(data.modulo + '.operar', data.modulo);
  validarProducto(data.modulo, data.nombre);
  const p = insert('productos', data);
  if (data.modulo === 'cantina') setPrecio(p.id, data._precio || {});
  delete p._precio;
  if (inicial && +inicial.cantidad > 0) {
    addMov({ producto_id: p.id, tipo: 'inicial', entrada: r3(inicial.cantidad), costo_unit: +inicial.costo || 0, detalle: 'Inventario inicial' });
  }
  save();
  audit('Creación de producto', 'productos', p.id, `${p.nombre} (${p.modulo})`);
  return p;
}

export function stockBajo(modulo) {
  return q('productos', p => p.modulo === modulo && p.estado === 'activo')
    .filter(p => (p.stock_min || 0) > 0 && stock(p.id) <= p.stock_min);
}

// ======================= CLIENTES Y CUENTAS =======================
export function nombreCliente(c) {
  if (!c) return 'Consumidor general';
  return [c.grado, c.apellido, c.nombre].filter(Boolean).join(' ');
}

export function saldoCliente(cliente_id, hasta = '9999-12-31') {
  const deuda = q('ventas', v => v.cliente_id === cliente_id && v.estado === 'activo' && v.fecha <= hasta)
    .reduce((s, v) => s + (v.total - (v.pagado || 0)), 0);
  const pagos = q('pagos', p => p.cliente_id === cliente_id && p.estado === 'activo' && p.fecha <= hasta)
    .reduce((s, p) => s + p.valor, 0);
  return r0(deuda - pagos);
}

export function registrarPago({ cliente_id, valor, metodo, fecha = todayStr(), nota = '' }) {
  exigir('cantina.operar', 'cantina');
  const v = r0(valor);
  if (v <= 0) throw new Error('El valor del pago debe ser mayor que cero.');
  const saldo = saldoCliente(cliente_id);
  if (v > saldo) throw new Error(`El pago supera el saldo pendiente ($${saldo.toLocaleString('es-CO')}).`);
  const p = insert('pagos', { cliente_id, valor: v, metodo, fecha, nota, numero: nextSeq('pago') });
  const c = get('clientes', cliente_id);
  audit('Pago registrado', 'pagos', p.id, `${nombreCliente(c)}: $${v}`);
  return p;
}

export function anularPago(id, motivo) {
  exigir('anular');
  if (!motivo) throw new Error('Indique el motivo de la anulación.');
  exigirActivo(get('pagos', id), 'El pago');
  const p = update('pagos', id, { estado: 'anulado', motivo });
  audit('Anulación de pago', 'pagos', id, `Pago #${p.numero} $${p.valor}`, motivo);
}

// ======================= VENTAS (CANTINA) =======================
export function registrarVenta({ tipo_precio, cliente_id = null, items, forma, metodo, pagado, fecha = todayStr() }) {
  exigir('cantina.operar', 'cantina');
  if (!items.length) throw new Error('Agregue productos a la venta.');
  if (items.some(it => !(r3(it.cantidad) > 0))) throw new Error('Las cantidades deben ser mayores que cero.');
  if (forma === 'credito' && !cliente_id) throw new Error('Una venta a crédito requiere un cliente.');
  if (forma === 'credito' && +pagado < 0) throw new Error('El abono no puede ser negativo.');
  const lines = items.map(it => {
    const p = get('productos', it.producto_id);
    const pv = precioVigente(p.id, fecha);
    const precio = pv ? pv[tipo_precio] : 0;
    const disp = stock(p.id, 'convencional');
    if (r3(it.cantidad) > disp) throw new Error(`Inventario insuficiente de ${p.nombre}: disponible ${disp} ${p.unidad_medida}.`);
    return {
      producto_id: p.id, nombre: p.nombre, unidad_medida: p.unidad_medida,
      cantidad: r3(it.cantidad), precio, costo: costoPromedio(p.id, 'convencional'),
    };
  });
  const total = r0(lines.reduce((s, l) => s + l.cantidad * l.precio, 0));
  const pag = forma === 'contado' ? total : Math.min(r0(pagado || 0), total);
  const saldo_anterior = cliente_id ? saldoCliente(cliente_id) : 0;
  const venta = insert('ventas', {
    numero: nextSeq('venta'), fecha, hora: new Date().toTimeString().slice(0, 5),
    tipo_precio, cliente_id, items: lines, total, forma, metodo, pagado: pag, saldo_anterior,
  }, { silent: true });
  lines.forEach(l => addMov({
    producto_id: l.producto_id, modulo: 'cantina', fecha, tipo: 'venta', salida: l.cantidad, costo_unit: l.costo,
    ref_tipo: 'venta', ref_id: venta.id, detalle: `Venta #${pad(venta.numero)}`,
  }));
  save();
  audit('Venta registrada', 'ventas', venta.id, `Venta #${pad(venta.numero)} $${total} (${forma})`);
  return venta;
}

export function anularVenta(id, motivo) {
  if (!motivo) throw new Error('Indique el motivo de la anulación.');
  exigir('anular');
  const v = exigirActivo(get('ventas', id), 'La venta');
  anularMovsRef('venta', id);
  update('ventas', id, { estado: 'anulado', motivo });
  audit('Anulación de venta', 'ventas', id, `Venta #${pad(v.numero)} $${v.total}`, motivo);
}

export const pad = n => String(n).padStart(6, '0');

// ======================= PROVEEDORES, COMPRAS, GASTOS =======================
export function registrarCompra({ modulo, proveedor_id, fecha = todayStr(), documento = '', items }) {
  exigir(modulo + '.operar', modulo);
  const lines = items.filter(i => i.producto_id && +i.cantidad > 0);
  if (!lines.length) throw new Error('Agregue al menos un producto con cantidad.');
  const clean = lines.map(i => {
    const p = get('productos', i.producto_id);
    return { producto_id: p.id, nombre: p.nombre, unidad_medida: p.unidad_medida, cantidad: r3(i.cantidad), precio: +i.precio || 0 };
  });
  const neg = clean.find(l => l.precio < 0);
  if (neg) throw new Error(`El precio de ${neg.nombre} no puede ser negativo.`);
  const total = r0(clean.reduce((s, l) => s + l.cantidad * l.precio, 0));
  const c = insert('compras', { numero: nextSeq('compra'), modulo, proveedor_id, fecha, documento, items: clean, total }, { silent: true });
  clean.forEach(l => addMov({
    producto_id: l.producto_id, modulo, fecha, tipo: 'compra', entrada: l.cantidad, costo_unit: l.precio,
    ref_tipo: 'compra', ref_id: c.id, detalle: `Compra #${c.numero}`,
  }));
  save();
  const pr = get('proveedores', proveedor_id);
  audit('Compra registrada', 'compras', c.id, `Compra #${c.numero} ${modulo.toUpperCase()} — ${pr?.nombre || 'Sin proveedor'} $${total}`);
  return c;
}

export function anularCompra(id, motivo) {
  if (!motivo) throw new Error('Indique el motivo de la anulación.');
  exigir('anular');
  const c = exigirActivo(get('compras', id), 'La compra');
  for (const l of c.items) {
    const origen = 'convencional';
    if (stock(l.producto_id, origen) - l.cantidad < 0) {
      throw new Error(`No se puede anular: ${l.nombre} ya fue consumido/vendido y el inventario quedaría negativo. Use un ajuste.`);
    }
  }
  anularMovsRef('compra', id);
  update('compras', id, { estado: 'anulado', motivo });
  audit('Anulación de compra', 'compras', id, `Compra #${c.numero} $${c.total}`, motivo);
}

export function registrarGasto({ modulo, fecha = todayStr(), concepto, categoria = '', valor }) {
  exigir(modulo + '.operar', modulo);
  if (!concepto) throw new Error('Indique el concepto del gasto.');
  if (!(+valor > 0)) throw new Error('El valor debe ser mayor que cero.');
  const g = insert('gastos', { modulo, fecha, concepto, categoria, valor: r0(valor) });
  audit('Gasto registrado', 'gastos', g.id, `${concepto} $${g.valor}`);
  return g;
}

export function anularGasto(id, motivo) {
  if (!motivo) throw new Error('Indique el motivo de la anulación.');
  exigir('anular');
  exigirActivo(get('gastos', id), 'El gasto');
  const g = update('gastos', id, { estado: 'anulado', motivo });
  audit('Anulación de gasto', 'gastos', id, `${g.concepto} $${g.valor}`, motivo);
}

// Comparativo por producto: último precio, promedio, mínimo por proveedor.
export function comparativoProveedores(producto_id) {
  const map = new Map();
  q('compras', c => c.estado === 'activo')
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .forEach(c => c.items.filter(i => i.producto_id === producto_id).forEach(i => {
      const k = c.proveedor_id || '_';
      const e = map.get(k) || { proveedor_id: c.proveedor_id, precios: [], ultimo: 0, fecha: '' };
      e.precios.push(i.precio); e.ultimo = i.precio; e.fecha = c.fecha;
      map.set(k, e);
    }));
  return [...map.values()].map(e => ({
    ...e,
    promedio: e.precios.reduce((s, x) => s + x, 0) / e.precios.length,
    minimo: Math.min(...e.precios),
    compras: e.precios.length,
  })).sort((a, b) => a.ultimo - b.ultimo);
}

// ======================= RECIBOS / WHATSAPP =======================
const money = n => (r0(n) < 0 ? '-$' : '$') + Math.abs(r0(n)).toLocaleString('es-CO');
const fdate = s => s.split('-').reverse().join('/');

export function reciboTexto(v) {
  const un = currentUnit();
  const c = v.cliente_id ? get('clientes', v.cliente_id) : null;
  const L = [];
  L.push(`*CANTINA ${un.nombre.toUpperCase()}*`);
  L.push(`Recibo #${pad(v.numero)}`);
  L.push(`Fecha: ${fdate(v.fecha)} ${v.hora || ''}`);
  if (c) L.push(`Cliente: ${nombreCliente(c)}`);
  L.push('');
  v.items.forEach(i => L.push(`${fmtQty(i.cantidad)} x ${i.nombre}  ${money(i.cantidad * i.precio)}`));
  L.push('');
  L.push(`*TOTAL: ${money(v.total)}*`);
  const conMetodo = v.metodo && (v.forma !== 'credito' || v.pagado > 0);
  L.push(`Forma de pago: ${v.forma === 'credito' ? 'Crédito' : 'Contado'}${conMetodo ? ' — ' + v.metodo : ''}`);
  if (v.forma === 'credito') {
    if (v.pagado) L.push(`Abono: ${money(v.pagado)}`);
    L.push(`Saldo acumulado: ${money(v.saldo_anterior + v.total - (v.pagado || 0))}`);
  }
  if (v.estado === 'anulado') L.push('', '*** VENTA ANULADA ***');
  return L.join('\n');
}

export function estadoCuentaTexto(cliente_id, recordatorio = false) {
  const un = currentUnit();
  const c = get('clientes', cliente_id);
  const saldo = saldoCliente(cliente_id);
  const L = [`*CANTINA ${un.nombre.toUpperCase()}*`, ''];
  if (recordatorio) {
    L.push(`Buen día ${nombreCliente(c)}.`, `Le recordamos que tiene un saldo pendiente en la cantina de *${money(saldo)}*.`, 'Agradecemos su pago. ¡Gracias!');
    return L.join('\n');
  }
  L.push(`Estado de cuenta — ${nombreCliente(c)}`, `Corte: ${fdate(todayStr())}`, '');
  const movs = [
    ...q('ventas', v => v.cliente_id === cliente_id && v.estado === 'activo' && v.forma === 'credito')
      .map(v => ({ f: v.fecha, t: `Compra #${pad(v.numero)}`, d: v.total - (v.pagado || 0) })),
    ...q('pagos', p => p.cliente_id === cliente_id && p.estado === 'activo')
      .map(p => ({ f: p.fecha, t: 'Pago', d: -p.valor })),
  ].sort((a, b) => a.f.localeCompare(b.f)).slice(-12);
  movs.forEach(m => L.push(`${fdate(m.f)} ${m.t}  ${m.d < 0 ? '-' : ''}${money(Math.abs(m.d))}`));
  L.push('', `*SALDO ACTUAL: ${money(saldo)}*`);
  return L.join('\n');
}

export function waLink(telefono, texto) {
  let tel = String(telefono || '').replace(/\D/g, '');
  if (tel.length === 10) tel = '57' + tel; // Colombia por defecto
  return `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
}

export const fmtQty = n => (Number.isInteger(+n) ? String(n) : (+n).toLocaleString('es-CO', { maximumFractionDigits: 3 }));

// ======================= BALANCE CANTINA =======================
export function balanceCantina(d1, d2) {
  const ventas = q('ventas', v => v.estado === 'activo' && v.fecha >= d1 && v.fecha <= d2);
  const vt = ventas.filter(v => v.tipo_precio === 'tripulacion').reduce((s, v) => s + v.total, 0);
  const ve = ventas.filter(v => v.tipo_precio === 'externo').reduce((s, v) => s + v.total, 0);
  const costoVentas = ventas.reduce((s, v) => s + v.items.reduce((a, i) => a + i.cantidad * i.costo, 0), 0);
  const compras = q('compras', c => c.modulo === 'cantina' && c.estado === 'activo' && c.fecha >= d1 && c.fecha <= d2);
  const gastos = q('gastos', g => g.modulo === 'cantina' && g.estado === 'activo' && g.fecha >= d1 && g.fecha <= d2);
  const totalCompras = compras.reduce((s, c) => s + c.total, 0);
  const totalGastos = gastos.reduce((s, g) => s + g.valor, 0);

  const movs = movsRango('cantina', d1, d2);
  const entradas = movs.reduce((s, m) => s + (m.entrada || 0) * m.costo_unit, 0);
  const salidas = movs.reduce((s, m) => s + (m.salida || 0) * m.costo_unit, 0);
  const invIni = valorInventario('cantina', addDays(d1, -1));
  const invFin = valorInventario('cantina', d2);

  const clientes = q('clientes');
  const cxcIni = clientes.reduce((s, c) => s + saldoCliente(c.id, addDays(d1, -1)), 0);
  const nuevosCreditos = ventas.filter(v => v.forma === 'credito').reduce((s, v) => s + v.total - (v.pagado || 0), 0);
  const pagos = q('pagos', p => p.estado === 'activo' && p.fecha >= d1 && p.fecha <= d2).reduce((s, p) => s + p.valor, 0);
  const cxcFin = clientes.reduce((s, c) => s + saldoCliente(c.id, d2), 0);

  const recaudoVentas = ventas.reduce((s, v) => s + (v.pagado || 0), 0);
  const porMetodo = {};
  ventas.forEach(v => { if (v.pagado) porMetodo[v.metodo || 'Otro'] = (porMetodo[v.metodo || 'Otro'] || 0) + v.pagado; });
  q('pagos', p => p.estado === 'activo' && p.fecha >= d1 && p.fecha <= d2)
    .forEach(p => { porMetodo[p.metodo || 'Otro'] = (porMetodo[p.metodo || 'Otro'] || 0) + p.valor; });

  const ventasTot = vt + ve;
  const utilidadBruta = ventasTot - costoVentas;
  return {
    d1, d2, numVentas: ventas.length,
    ingresos: { tripulacion: vt, externos: ve, total: ventasTot },
    egresos: { compras: totalCompras, gastos: totalGastos, total: totalCompras + totalGastos },
    inventario: { inicial: invIni, entradas, salidas, final: invFin },
    cxc: { inicial: cxcIni, nuevos: nuevosCreditos, pagos, final: cxcFin },
    resultado: { ventas: ventasTot, costo: costoVentas, utilidadBruta, gastos: totalGastos, ganancia: utilidadBruta - totalGastos },
    caja: { recaudoVentas, pagos, total: recaudoVentas + pagos, porMetodo, egresos: totalCompras + totalGastos, neto: recaudoVentas + pagos - totalCompras - totalGastos },
    gastosDetalle: gastos, compras,
  };
}

// ======================= COAL =======================
export const TARIFAS_DEFAULT = {
  completo: 15000, medio: 11000,
  militar: { desayuno: 5000, almuerzo: 12000, cena: 8000 },
  civil: { desayuno: 6000, almuerzo: 15000, cena: 9000 },
  reglas: { navegando_cobra_completo: true, guardia_completo: true, puerto_fds_sin_servicio: true },
};

export function tarifas() {
  const t = q('coal_tarifas')[0];
  return t ? { ...TARIFAS_DEFAULT, ...t, reglas: { ...TARIFAS_DEFAULT.reglas, ...(t.reglas || {}) } } : structuredClone(TARIFAS_DEFAULT);
}

export function guardarTarifas(t) {
  exigir('coal.operar', 'coal');
  const cur = q('coal_tarifas')[0];
  if (cur) update('coal_tarifas', cur.id, t); else insert('coal_tarifas', t);
  audit('Cambio de tarifas COAL', 'coal_tarifas', cur?.id || '', JSON.stringify({ completo: t.completo, medio: t.medio, militar: t.militar, civil: t.civil }));
}

export const diaCoal = fecha => q('coal_dias', d => d.fecha === fecha && d.estado === 'activo')[0] || null;

export function esFinDeSemana(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  const w = new Date(y, m - 1, d).getDay();
  return w === 0 || w === 6;
}

export function guardarDia(data) {
  exigir('coal.operar', 'coal');
  const cur = diaCoal(data.fecha);
  const row = cur ? update('coal_dias', cur.id, data) : insert('coal_dias', data);
  audit(cur ? 'Modificación personal alimentado' : 'Registro personal alimentado', 'coal_dias', row.id,
    `${data.fecha}: ${personasDia(row)} personas`);
  return row;
}

const n0 = x => +x || 0;
const maxMeal = o => Math.max(n0(o?.desayuno), n0(o?.almuerzo), n0(o?.cena));
export const personasDia = d => !d || d.servicio === false ? 0
  : n0(d.completo) + n0(d.medio) + n0(d.guardia) + n0(d.adicional_completo) + maxMeal(d.militar) + maxMeal(d.civil);

export function aportesDia(d, t = tarifas()) {
  const z = { tripulacion: 0, militares: 0, civiles: 0, total: 0, personas: 0 };
  if (!d || d.servicio === false) return z;
  const navegando = d.situacion === 'navegando';
  const tarMedio = navegando && t.reglas.navegando_cobra_completo ? t.completo : t.medio;
  const tarGuardia = t.reglas.guardia_completo ? t.completo : t.medio;
  z.tripulacion = n0(d.completo) * t.completo + n0(d.medio) * tarMedio + n0(d.guardia) * tarGuardia + n0(d.adicional_completo) * t.completo;
  const meals = (o, tt) => ['desayuno', 'almuerzo', 'cena'].reduce((s, k) => s + n0(o?.[k]) * tt[k], 0);
  z.militares = meals(d.militar, t.militar);
  z.civiles = meals(d.civil, t.civil);
  z.total = z.tripulacion + z.militares + z.civiles;
  z.personas = personasDia(d);
  return z;
}

// ---- Recetas (versionadas) ----
export function recetasActivas() {
  return q('recetas', r => r.estado === 'activo').sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export function guardarReceta({ id, nombre, porciones, comida, items }) {
  exigir('coal.operar', 'coal');
  const clean = items.filter(i => i.producto_id && +i.cantidad > 0).map(i => ({ producto_id: i.producto_id, cantidad: r3(i.cantidad) }));
  if (!nombre) throw new Error('Indique el nombre de la receta.');
  if (!clean.length) throw new Error('Agregue ingredientes.');
  if (!(+porciones > 0)) throw new Error('Indique para cuántas porciones es la receta.');
  let grupo_id, version = 1;
  if (id) {
    const prev = get('recetas', id);
    grupo_id = prev.grupo_id; version = Math.max(...q('recetas', r => r.grupo_id === grupo_id).map(r => r.version)) + 1;
    update('recetas', id, { estado: 'historico' });
  }
  const r = insert('recetas', { grupo_id: grupo_id || null, nombre, porciones: +porciones, comida, items: clean, version });
  if (!r.grupo_id) { r.grupo_id = r.id; save(); }
  audit(id ? 'Nueva versión de receta' : 'Receta creada', 'recetas', r.id, `${nombre} v${version}`);
  return r;
}

export function costoReceta(r) {
  return r.items.reduce((s, i) => s + i.cantidad * costoPromedio(i.producto_id, 'convencional'), 0);
}

export function guardarMenu({ fecha, comida, descripcion, receta_id, porciones }) {
  exigir('coal.operar', 'coal');
  const cur = q('menus', m => m.fecha === fecha && m.comida === comida && m.estado === 'activo')[0];
  const data = { fecha, comida, descripcion, receta_id: receta_id || null, porciones: +porciones || 0 };
  const row = cur ? update('menus', cur.id, data) : insert('menus', data);
  audit('Menú registrado', 'menus', row.id, `${fecha} ${COMIDAS[comida]}: ${descripcion}`);
  return row;
}

// ---- Consumo diario ----
export function registrarConsumo({ fecha, comida, lineas, menu_id = null, nota = '' }) {
  exigir('coal.operar', 'coal');
  const clean = lineas.filter(l => l.producto_id && +l.cantidad > 0);
  if (!clean.length) throw new Error('Agregue productos consumidos.');
  // Validar inventario agrupando por producto+origen
  const need = {};
  clean.forEach(l => { const k = l.producto_id + '|' + (l.origen || 'convencional'); need[k] = r3((need[k] || 0) + +l.cantidad); });
  for (const k in need) {
    const [pid, origen] = k.split('|');
    const disp = stock(pid, origen);
    if (need[k] > disp) {
      const p = get('productos', pid);
      throw new Error(`Inventario ${ORIGENES[origen].toLowerCase()} insuficiente de ${p.nombre}: disponible ${disp} ${p.unidad_medida}.`);
    }
  }
  const out = clean.map(l => {
    const origen = l.origen || 'convencional';
    const costo_unit = costoPromedio(l.producto_id, origen);
    const c = insert('consumos', {
      fecha, comida, producto_id: l.producto_id, cantidad: r3(l.cantidad), origen, costo_unit,
      valor: r0(r3(l.cantidad) * costo_unit), menu_id, nota,
    }, { silent: true });
    addMov({
      producto_id: l.producto_id, modulo: 'coal', origen, fecha, tipo: 'consumo', salida: r3(l.cantidad), costo_unit,
      ref_tipo: 'consumo', ref_id: c.id, detalle: `Consumo ${COMIDAS[comida]}`,
    });
    return c;
  });
  save();
  audit('Consumo registrado', 'consumos', out[0].id, `${fecha} ${COMIDAS[comida]}: ${out.length} productos, $${out.reduce((s, c) => s + c.valor, 0)}`);
  return out;
}

export function anularConsumo(id, motivo) {
  if (!motivo) throw new Error('Indique el motivo de la anulación.');
  exigir('anular');
  const c = exigirActivo(get('consumos', id), 'El consumo');
  anularMovsRef('consumo', id);
  update('consumos', id, { estado: 'anulado', motivo });
  const p = get('productos', c.producto_id);
  audit('Anulación de consumo', 'consumos', id, `${c.fecha} ${p?.nombre} ${c.cantidad}`, motivo);
}

// ---- Víveres operacionales ----
export function registrarOperacional({ fecha, procedencia, documento, items, nota = '' }) {
  exigir('coal.operar', 'coal');
  const clean = items.filter(i => i.producto_id && +i.cantidad > 0).map(i => {
    const p = get('productos', i.producto_id);
    return { producto_id: p.id, nombre: p.nombre, unidad_medida: p.unidad_medida, cantidad: r3(i.cantidad), precio: +i.precio || 0 };
  });
  if (!clean.length) throw new Error('Agregue los víveres recibidos.');
  const neg = clean.find(l => l.precio < 0);
  if (neg) throw new Error(`El precio de ${neg.nombre} no puede ser negativo.`);
  const total = r0(clean.reduce((s, l) => s + l.cantidad * l.precio, 0));
  const o = insert('operacionales', { numero: nextSeq('operacional'), fecha, procedencia, documento, items: clean, total, nota }, { silent: true });
  clean.forEach(l => addMov({
    producto_id: l.producto_id, modulo: 'coal', origen: 'operacional', fecha, tipo: 'operacional', entrada: l.cantidad,
    costo_unit: l.precio, ref_tipo: 'operacional', ref_id: o.id, detalle: `Planilla ${documento || '#' + o.numero}`,
  }));
  save();
  audit('Víveres operacionales recibidos', 'operacionales', o.id, `${procedencia} — ${documento} $${total}`);
  return o;
}

export function anularOperacional(id, motivo) {
  if (!motivo) throw new Error('Indique el motivo de la anulación.');
  exigir('anular');
  const o = exigirActivo(get('operacionales', id), 'La planilla');
  for (const l of o.items) {
    if (stock(l.producto_id, 'operacional') - l.cantidad < 0) throw new Error(`No se puede anular: ${l.nombre} operacional ya fue consumido.`);
  }
  anularMovsRef('operacional', id);
  update('operacionales', id, { estado: 'anulado', motivo });
  audit('Anulación víveres operacionales', 'operacionales', id, `${o.documento} $${o.total}`, motivo);
}

// ---- Resúmenes COAL ----
export function resumenCoalDia(fecha, t = tarifas()) {
  const dia = diaCoal(fecha);
  const ap = aportesDia(dia, t);
  const cons = q('consumos', c => c.fecha === fecha && c.estado === 'activo');
  const conv = cons.filter(c => c.origen === 'convencional').reduce((s, c) => s + c.valor, 0);
  const oper = cons.filter(c => c.origen === 'operacional').reduce((s, c) => s + c.valor, 0);
  const porComida = {};
  Object.keys(COMIDAS).forEach(k => {
    const cc = cons.filter(c => c.comida === k);
    porComida[k] = { conv: cc.filter(c => c.origen === 'convencional').reduce((s, c) => s + c.valor, 0), oper: cc.filter(c => c.origen === 'operacional').reduce((s, c) => s + c.valor, 0) };
  });
  const total = conv + oper;
  return {
    fecha, dia, aportes: ap, personas: ap.personas, consumos: cons, conv, oper, total, porComida,
    costoPersona: ap.personas ? total / ap.personas : 0,
    costoPersonaConv: ap.personas ? conv / ap.personas : 0,
    diferencia: ap.total - conv,
  };
}

export function balanceCoal(d1, d2) {
  const t = tarifas();
  const dias = [];
  for (let f = d1; f <= d2; f = addDays(f, 1)) dias.push(resumenCoalDia(f, t));
  const sum = k => dias.reduce((s, d) => s + d[k], 0);
  const aportes = { tripulacion: 0, militares: 0, civiles: 0, total: 0 };
  dias.forEach(d => { aportes.tripulacion += d.aportes.tripulacion; aportes.militares += d.aportes.militares; aportes.civiles += d.aportes.civiles; aportes.total += d.aportes.total; });
  const porComida = {};
  Object.keys(COMIDAS).forEach(k => {
    porComida[k] = { conv: dias.reduce((s, d) => s + d.porComida[k].conv, 0), oper: dias.reduce((s, d) => s + d.porComida[k].oper, 0) };
  });
  const compras = q('compras', c => c.modulo === 'coal' && c.estado === 'activo' && c.fecha >= d1 && c.fecha <= d2);
  const ops = q('operacionales', o => o.estado === 'activo' && o.fecha >= d1 && o.fecha <= d2);
  const gastos = q('gastos', g => g.modulo === 'coal' && g.estado === 'activo' && g.fecha >= d1 && g.fecha <= d2);
  const personasDia = sum('personas');
  const conv = sum('conv'), oper = sum('oper');
  const diasServicio = dias.filter(d => d.personas > 0).length;
  const totalGastos = gastos.reduce((s, g) => s + g.valor, 0);
  return {
    d1, d2, dias, diasServicio, personasDia,
    promedioPersonas: diasServicio ? personasDia / diasServicio : 0,
    aportes,
    viveres: {
      comprados: compras.reduce((s, c) => s + c.total, 0),
      operacionales: ops.reduce((s, o) => s + o.total, 0),
    },
    consumo: { conv, oper, total: conv + oper, porComida },
    costos: {
      diario: diasServicio ? (conv + oper) / diasServicio : 0,
      porPersona: personasDia ? (conv + oper) / personasDia : 0,
      porPersonaConv: personasDia ? conv / personasDia : 0,
      operacional: oper,
    },
    gastos: totalGastos,
    inventario: {
      inicialConv: valorInventario('coal', addDays(d1, -1), 'convencional'),
      finalConv: valorInventario('coal', d2, 'convencional'),
      inicialOper: valorInventario('coal', addDays(d1, -1), 'operacional'),
      finalOper: valorInventario('coal', d2, 'operacional'),
    },
    resultado: {
      aportes: aportes.total,
      costoAlimentacion: conv + totalGastos,
      diferencia: aportes.total - conv - totalGastos,
      costoEconomico: conv + oper + totalGastos,
      diferenciaEconomica: aportes.total - conv - oper - totalGastos,
    },
  };
}

// Productos visibles para un módulo
export const productosModulo = modulo =>
  q('productos', p => p.modulo === modulo && p.estado === 'activo').sort((a, b) => a.nombre.localeCompare(b.nombre));

