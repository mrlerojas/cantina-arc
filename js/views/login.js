import { login, db, uid, nowISO, save, setSessionUser, audit } from '../store.js';
import { esc, modal, toast, clearToasts } from '../ui.js';

export function renderLogin(root, done) {
  const demo = db.usuarios.filter(u => u.demo).slice(0, 5);
  root.innerHTML = `
    <div class="login">
      <form class="box" id="f" autocomplete="on">
        <div class="logo"><img src="icons/icon-192.png" alt=""><div><b>Cantina ARC</b><div class="small muted">Gestión para Unidades Navales</div></div></div>
        <label class="field"><span>Número telefónico</span>
          <input name="tel" type="tel" inputmode="numeric" autocomplete="username" placeholder="3001234567" required></label>
        <label class="field" style="margin-top:12px"><span>PIN / contraseña</span>
          <input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required></label>
        <button class="primary lg" style="width:100%;margin-top:18px">Ingresar</button>
        <p class="small muted" style="margin-top:12px">La sesión permanece iniciada en este dispositivo hasta que la cierre.</p>
        ${demo.length ? `<div class="demo"><b>Datos de demostración</b> (toque para ingresar)<br>
          ${demo.map(u => `<a href="#" data-tel="${u.telefono}" data-pin="${esc(u.pin)}">${esc(u.nombre)}</a> — <code>${u.telefono}</code> / <code>${esc(u.pin)}</code>`).join('<br>')}
        </div>` : ''}
        <p class="small" style="margin-top:14px;text-align:center"><a href="#" id="nueva">Registrar una nueva unidad</a></p>
      </form>
    </div>`;
  const f = root.querySelector('#f');
  f.onsubmit = e => {
    e.preventDefault();
    const u = login(f.tel.value, f.pin.value);
    if (!u) return toast('Teléfono o PIN incorrectos.', true);
    clearToasts();
    done();
  };
  root.querySelectorAll('[data-tel]').forEach(a => a.onclick = e => {
    e.preventDefault(); f.tel.value = a.dataset.tel; f.pin.value = a.dataset.pin; f.requestSubmit();
  });
  root.querySelector('#nueva').onclick = e => { e.preventDefault(); nuevaUnidad(done); };
}

function nuevaUnidad(done) {
  modal({
    title: 'Registrar nueva unidad',
    body: `
      <form id="nu" class="form-grid">
        <label class="field full"><span>Nombre de la unidad</span><input name="unidad" placeholder="ARC …" required></label>
        <label class="field"><span>Grado del administrador</span><input name="grado" placeholder="TF"></label>
        <label class="field"><span>Nombre del administrador</span><input name="nombre" required></label>
        <label class="field"><span>Teléfono</span><input name="tel" type="tel" inputmode="numeric" required></label>
        <label class="field"><span>PIN (mínimo 4 dígitos)</span><input name="pin" type="password" inputmode="numeric" minlength="4" required></label>
        <label class="check"><input type="checkbox" name="cantina" checked> Módulo CANTINA</label>
        <label class="check"><input type="checkbox" name="coal" checked> Módulo COAL</label>
      </form>`,
    foot: `<button data-close>Cancelar</button><button class="primary" id="ok">Crear unidad</button>`,
    onMount: (el, m) => el.querySelector('#ok').onclick = () => {
      const f = el.querySelector('#nu');
      if (!f.reportValidity()) return;
      const tel = f.tel.value.replace(/\D/g, '');
      if (db.usuarios.some(u => u.telefono === tel)) return toast('Ese teléfono ya está registrado.', true);
      const un = { id: uid(), nombre: f.unidad.value.trim(), modulos: { cantina: f.cantina.checked, coal: f.coal.checked }, creado_en: nowISO() };
      un.unidad_id = un.id;
      const u = { id: uid(), unidad_id: un.id, nombre: f.nombre.value.trim(), grado: f.grado.value.trim(), telefono: tel, pin: f.pin.value, roles: ['admin'], permisos: [], activo: true, creado_en: nowISO() };
      db.unidades.push(un); db.usuarios.push(u); save();
      setSessionUser(u);
      audit('Unidad creada', 'unidades', un.id, un.nombre);
      m.close(); done();
    },
  });
}
