// Configuración de la aplicación.
// DEMO = true: datos de demostración (usuarios con PIN 1234) guardados solo en este dispositivo,
//              sin conexión a Supabase. Es el modo de desarrollo.
// DEMO = false: ingreso y sincronización con Supabase. publicar.sh genera así la versión publicada.
export const DEMO = false; // versión publicada 20261112-1544

// Proyecto de Supabase. La clave "publishable" es pública por diseño:
// la seguridad la aplican las políticas (RLS) de la base de datos.
export const SUPABASE = {
  url: 'https://ptdegcbaouuhacpgdhyu.supabase.co',
  key: 'sb_publishable_Vkwb6CToN2QwsVyWUYaktQ_6EViSJmO',
};

// Lectura de facturas con foto (usa la Edge Function "factura" y una clave de Anthropic, de pago
// por uso). Apagada por ahora: con false el botón no aparece en el formulario de compra.
// Para encenderla: poner true, configurar el secreto ANTHROPIC_API_KEY en Supabase y publicar.
export const LECTURA_FACTURAS = false;
