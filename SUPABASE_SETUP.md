# Preparar Supabase para LaMafia

La app ya no usa login ni Userbase. Se conecta desde el navegador con una clave pública de Supabase y usa políticas RLS. Para activar la conexión:

1. En Supabase, abre el proyecto y ejecuta todo el contenido de `supabase/schema.sql` en **SQL Editor**.
2. En Vercel, abre el proyecto conectado a este repositorio y agrega estas variables de entorno para Production (y Preview si usarás esas versiones):
   - `SUPABASE_URL`: URL del proyecto, por ejemplo `https://<project-ref>.supabase.co`.
   - `SUPABASE_ANON_KEY`: clave pública `anon`/`publishable` del proyecto.
3. Redepliega la web en Vercel.

No uses la clave `service_role` en la web ni en estas variables. La app no pide contraseña: cualquier visitante puede consultar las tablas guardadas y crear registros de participantes y resultados. Las tablas finales son de solo lectura para visitantes después de guardarse, pero el acceso es público; no guardes datos sensibles.

Los participantes se registran en `players` al agregarlos a un torneo. La tabla de puntuación completa (clasificación, participantes, partidos e historial) se guarda automáticamente en `finished_tournaments` al finalizar el torneo. La pestaña **Tabla** permite seleccionar y consultar tablas finalizadas.

Mientras falte la configuración de Vercel, la app abre normalmente y sigue guardando el torneo activo en el almacenamiento local del dispositivo; el selector de tablas guardadas indicará que Supabase aún no está conectado.
