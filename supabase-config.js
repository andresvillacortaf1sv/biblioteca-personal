/* Configuración de Supabase para la sincronización en la nube.
   Rellená url y anonKey con los datos de tu proyecto (Settings → API).
   La anon key es pública (está pensada para el cliente); la seguridad la
   dan las políticas RLS de la tabla. Mientras estén los placeholders,
   la sincronización queda desactivada y la app funciona local como antes. */
window.EC_SUPABASE = {
  url: "__SUPABASE_URL__",
  anonKey: "__SUPABASE_ANON_KEY__",
  ownerEmail: "andresvillacortaf1@gmail.com"
};
