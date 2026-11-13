// Lector mínimo de archivos .xlsx (sin librerías externas, para que la app siga funcionando
// sin conexión). Un .xlsx es un ZIP con XML dentro: se descomprime con DecompressionStream
// y se leen las hojas como matrices de texto. Solo lectura de valores; no fórmulas ni formatos.

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

async function inflar(bytes) {
  const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

// Devuelve { nombreDeArchivo: texto } con los XML del ZIP.
async function leerZip(buffer) {
  const v = new DataView(buffer);
  let fin = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 66000); i--) {
    if (u32(v, i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('El archivo no es un Excel (.xlsx) válido.');
  const total = u16(v, fin + 10);
  let pos = u32(v, fin + 16);
  const dec = new TextDecoder();
  const archivos = {};
  for (let n = 0; n < total; n++) {
    if (u32(v, pos) !== 0x02014b50) throw new Error('El archivo Excel está dañado.');
    const metodo = u16(v, pos + 10), comprimido = u32(v, pos + 20);
    const lNombre = u16(v, pos + 28), lExtra = u16(v, pos + 30), lComent = u16(v, pos + 32), local = u32(v, pos + 42);
    const nombre = dec.decode(new Uint8Array(buffer, pos + 46, lNombre));
    pos += 46 + lNombre + lExtra + lComent;
    if (!/\.(xml|rels)$/.test(nombre)) continue;
    const inicio = local + 30 + u16(v, local + 26) + u16(v, local + 28);
    const datos = new Uint8Array(buffer, inicio, comprimido);
    if (metodo !== 0 && metodo !== 8) throw new Error('El archivo Excel usa una compresión no soportada.');
    archivos[nombre] = dec.decode(metodo === 8 ? await inflar(datos) : datos);
  }
  return archivos;
}

const xml = t => new DOMParser().parseFromString(t, 'application/xml');
const hijos = (el, nombre) => [...el.getElementsByTagName(nombre)];

function columna(ref) {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

// Lee un File/Blob .xlsx y devuelve [{ nombre, filas }] con cada hoja como matriz de textos.
export async function leerXlsx(file) {
  if (!('DecompressionStream' in globalThis)) throw new Error('Este navegador no puede leer archivos de Excel. Use Chrome o actualice el navegador.');
  const z = await leerZip(await file.arrayBuffer());
  if (!z['xl/workbook.xml']) throw new Error('El archivo no es un Excel (.xlsx) válido.');
  const compartidas = z['xl/sharedStrings.xml']
    ? hijos(xml(z['xl/sharedStrings.xml']), 'si').map(si => hijos(si, 't').map(t => t.textContent).join(''))
    : [];
  const rels = {};
  hijos(xml(z['xl/_rels/workbook.xml.rels'] || '<x/>'), 'Relationship').forEach(r => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });
  return hijos(xml(z['xl/workbook.xml']), 'sheet').map(sh => {
    const destino = (rels[sh.getAttribute('r:id')] || '').replace(/^\//, '');
    const ruta = destino.startsWith('xl/') ? destino : 'xl/' + destino;
    const filas = [];
    if (z[ruta]) {
      hijos(xml(z[ruta]), 'row').forEach(row => {
        const fila = [];
        hijos(row, 'c').forEach(c => {
          const tipo = c.getAttribute('t');
          const v = c.getElementsByTagName('v')[0];
          let valor = '';
          if (tipo === 's') valor = v ? compartidas[+v.textContent] ?? '' : '';
          else if (tipo === 'inlineStr') valor = hijos(c, 't').map(t => t.textContent).join('');
          else valor = v ? v.textContent : '';
          fila[columna(c.getAttribute('r'))] = valor;
        });
        if (fila.length) filas.push(Array.from(fila, x => x ?? ''));
      });
    }
    return { nombre: sh.getAttribute('name'), filas };
  });
}
