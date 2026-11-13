// Interpreta los reportes de Excel que exporta la app Treinta (inventario y deudas), los convierte
// en datos listos para importar a CANTINA y busca coincidencias con lo que ya existe. No guarda nada.

const limpio = s => String(s ?? '').replace(/\s+/g, ' ').trim();
export const clave = s => limpio(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const num = v => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const palabras = s => clave(s).replace(/[^a-z0-9ñ ]+/g, ' ').split(' ').filter(Boolean);

// Busca la fila de encabezados (la que contiene todas las columnas pedidas) y devuelve
// los registros que le siguen como objetos { encabezado: valor }.
function tabla(filas, requeridas) {
  const quitar = s => clave(s).replace(/[:.]/g, '').trim();
  const i = filas.findIndex(f => requeridas.every(r => f.some(c => quitar(c) === quitar(r))));
  if (i < 0) return null;
  const cab = filas[i].map(quitar);
  return filas.slice(i + 1)
    .filter(f => f.some(c => limpio(c)))
    .map(f => Object.fromEntries(cab.map((c, j) => [c, f[j] ?? '']).filter(([c]) => c)));
}

// Dato suelto del encabezado del reporte, p. ej. "Costo total de inventario:" -> valor de la celda siguiente.
function dato(filas, etiqueta) {
  for (const f of filas.slice(0, 12)) {
    const j = f.findIndex(c => clave(c).startsWith(clave(etiqueta)));
    if (j >= 0) return limpio(f[j + 1]);
  }
  return '';
}

// Reporte de inventario -> { negocio, productos: [{ nombre, categoria, codigo, cantidad, costo, precio }], totalDeclarado, avisos }
export function interpretarInventario(hojas) {
  for (const h of hojas) {
    const filas = tabla(h.filas, ['Nombre', 'Cant', 'Costo unitario', 'Precio unitario']);
    if (!filas) continue;
    const avisos = [];
    const vistos = new Set();
    const productos = [];
    filas.forEach(f => {
      const nombre = limpio(f['nombre']);
      if (!nombre) return;
      if (vistos.has(clave(nombre))) { avisos.push(`"${nombre}" aparece dos veces en el archivo; se toma solo la primera.`); return; }
      vistos.add(clave(nombre));
      const cantidad = num(f['cant']) ?? 0, costo = num(f['costo unitario']) ?? 0, precio = num(f['precio unitario']) ?? 0;
      if (cantidad < 0) avisos.push(`"${nombre}" tiene existencias negativas (${cantidad}); entra con 0.`);
      if (!(precio > 0)) avisos.push(`"${nombre}" no tiene precio de venta; revíselo después de importar.`);
      if (precio > 0 && costo > precio) avisos.push(`"${nombre}" se vende por debajo del costo.`);
      productos.push({
        nombre, categoria: limpio(f['categoria']), codigo: limpio(f['codigo del producto']),
        cantidad: Math.max(0, cantidad), costo: Math.max(0, costo), precio: Math.max(0, Math.round(precio)),
      });
    });
    return {
      negocio: limpio(h.filas[0]?.find(c => limpio(c)) || ''),
      productos, avisos,
      totalDeclarado: num(dato(h.filas, 'Costo total de inventario')),
    };
  }
  return null;
}

// Reporte de deudas -> { clientes: [{ nombre, saldo, detalle: [{ fecha, descripcion, valor }] }], totalDeclarado, avisos }
export function interpretarDeudas(hojas) {
  for (const h of hojas) {
    const filas = tabla(h.filas, ['Fecha', 'Tipo', 'Contacto', 'Valor']);
    if (!filas) continue;
    const avisos = [];
    const mapa = new Map();
    let sinContacto = 0, otrosTipos = 0;
    filas.forEach(f => {
      const valor = num(f['valor']);
      if (valor === null || valor === 0) return;
      // En el reporte de deudas "Venta" es lo que nos deben; otros tipos (gastos/por pagar) no se importan.
      if (clave(f['tipo']) !== 'venta') { otrosTipos++; return; }
      const nombre = limpio(f['contacto']);
      if (!nombre) { sinContacto++; return; }
      const k = clave(nombre);
      if (!mapa.has(k)) mapa.set(k, { nombre, saldo: 0, detalle: [] });
      const c = mapa.get(k);
      c.saldo += valor;
      c.detalle.push({ fecha: limpio(f['fecha']), descripcion: limpio(f['descripcion']), valor: Math.round(valor) });
    });
    if (sinContacto) avisos.push(`${sinContacto} deuda(s) sin nombre de contacto no se pueden importar.`);
    if (otrosTipos) avisos.push(`${otrosTipos} movimiento(s) que no son ventas fiadas (por pagar) no se importan.`);
    const clientes = [...mapa.values()].map(c => ({ ...c, saldo: Math.round(c.saldo) })).filter(c => c.saldo > 0)
      .sort((a, b) => b.saldo - a.saldo);
    let declarado = null;
    for (const f of h.filas.slice(0, 12)) {
      const j = f.findIndex(c => clave(c) === 'por cobrar');
      if (j >= 0) declarado = num(f[j + 1]);
    }
    return { clientes, avisos, totalDeclarado: declarado };
  }
  return null;
}

// ---------- Coincidencias con lo que ya existe en CANTINA ----------
// Distancia de edición (para tolerar una o dos letras distintas: "Roger" / "Royer").
function distancia(a, b) {
  if (a === b) return 0;
  const fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let ant = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, ant + (a[i - 1] === b[j - 1] ? 0 : 1));
      ant = tmp;
    }
  }
  return fila[b.length];
}
const parecida = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && distancia(a, b) <= (Math.max(a.length, b.length) >= 7 ? 2 : 1));

// Cliente: el nombre de Treinta viene en un solo campo y en cualquier orden; en CANTINA hay
// grado, apellido y nombre. Se comparan las palabras de apellido + nombre, sin el grado.
// Devuelve { id, tipo: 'exacta' | 'aproximada' } o null. Solo si hay un único candidato.
export function buscarCliente(nombreTreinta, clientes) {
  const t = palabras(nombreTreinta);
  if (!t.length) return null;
  const cand = clientes.map(c => {
    const w = palabras(`${c.apellido || ''} ${c.nombre || ''}`);
    const exactas = t.filter(x => w.includes(x)).length;
    const cercanas = t.filter(x => !w.includes(x) && w.some(y => parecida(x, y))).length;
    return { id: c.id, exactas, cercanas, total: w.length };
  }).filter(c => c.exactas + c.cercanas === t.length && c.exactas >= 1);
  const exactas = cand.filter(c => c.cercanas === 0 && c.total === t.length);
  if (exactas.length === 1) return { id: exactas[0].id, tipo: 'exacta' };
  if (exactas.length > 1) return null;
  return cand.length === 1 ? { id: cand[0].id, tipo: 'aproximada' } : null;
}

// Producto: exacta si el nombre es el mismo sin contar mayúsculas, tildes ni espacios
// ("Choco Cono" = "CHOCOCONO"); aproximada si todas las palabras del nombre más corto
// están en el más largo ("POLET" dentro de "Paleta Polet"). Solo si hay un único candidato.
export function buscarProducto(nombreTreinta, productos) {
  const junto = s => palabras(s).join('');
  const t = palabras(nombreTreinta), tj = junto(nombreTreinta);
  if (!tj) return null;
  const exactas = productos.filter(p => junto(p.nombre) === tj);
  if (exactas.length === 1) return { id: exactas[0].id, tipo: 'exacta' };
  if (exactas.length > 1) return null;
  const cand = productos.filter(p => {
    const w = palabras(p.nombre);
    const [corto, largo] = w.length <= t.length ? [w, t] : [t, w];
    return corto.length >= 1 && corto.every(x => largo.some(y => parecida(x, y))) && corto.join('').length >= 4;
  });
  return cand.length === 1 ? { id: cand[0].id, tipo: 'aproximada' } : null;
}
