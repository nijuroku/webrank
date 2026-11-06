# Preparar Supabase para LaMafia

La gestión de torneos es pública y no requiere login. Las cuentas de jugador usan Supabase Auth solo para reclamar y personalizar un perfil. La app se conecta desde el navegador con una clave pública de Supabase y usa políticas RLS. Para activar la conexión:

1. En Supabase, abre el proyecto y ejecuta todo el contenido de `supabase/schema.sql` en **SQL Editor**.
2. En Vercel, abre el proyecto conectado a este repositorio y agrega estas variables de entorno para Production (y Preview si usarás esas versiones):
   - `SUPABASE_URL`: URL del proyecto, por ejemplo `https://<project-ref>.supabase.co`.
   - `SUPABASE_ANON_KEY`: clave pública `anon`/`publishable` del proyecto.
3. Redepliega la web en Vercel.

No uses la clave `service_role` en la web ni en estas variables. Cualquier visitante puede consultar tablas guardadas y agregar jugadores. Las tablas finales publicadas son de solo lectura para visitantes; no guardes datos sensibles.

Los participantes se registran en `players` al agregarlos a un torneo. Al finalizar, una cuenta identificada publica la tabla completa en `finished_tournaments`; si el torneo lo organizó una persona anónima, la tabla queda pendiente de aprobación del administrador. La pestaña **Tabla** permite seleccionar y consultar tablas publicadas.

Los alias de jugadores se guardan en `player_aliases`. La app crea esta tabla al configurar un proyecto nuevo con `supabase/schema.sql`; en proyectos existentes aplica `supabase/migrations/20261104191054_player_aliases.sql`.

## Panel privado de administración

El panel está en `/admin` y no tiene un enlace desde la interfaz pública. La ruta oculta el acceso, pero la protección real está en Supabase Auth y en las políticas RLS. El panel permite vincular/desvincular alias, convertir un alias en nombre principal, revisar tablas finales pendientes de usuarios anónimos, cerrar torneos activos, eliminar torneos finalizados y consultar el registro de actividad.

En proyectos existentes aplica, en orden, `supabase/migrations/20261104192008_admin_controls.sql`, `supabase/migrations/20261104192302_admin_privilege_tightening.sql`, `supabase/migrations/20261104194103_promote_alias_to_canonical.sql`, `supabase/migrations/20261106173409_player_profiles_and_share_expiry.sql`, `supabase/migrations/20261106174235_profile_images_use_external_urls.sql`, `supabase/migrations/20261106181135_admin_close_active_shared_tournaments.sql`, `supabase/migrations/20261106185446_tournament_moderation_and_activity_log.sql` y `supabase/migrations/20261106190335_log_tournament_state_changes.sql`. En proyectos nuevos, ejecuta el `schema.sql` completo.

Los perfiles públicos ahora permiten crear una cuenta con nickname, correo y contraseña para solicitar la vinculación a un jugador. En **Authentication → Settings**, activa **Allow new users to sign up** y configura la confirmación por correo según prefieras. Crear una cuenta no concede acceso de administrador. Cada cuenta solo puede tener una solicitud y una vinculación de jugador; las vinculaciones de alias siguen siendo manuales desde `/admin`.

La foto y el banner se configuran pegando enlaces HTTPS públicos a imágenes alojadas en otro servicio. La app guarda solo esos enlaces en el perfil y no sube archivos a Supabase Storage.

Al finalizar un torneo, una persona sin sesión de perfil envía su tabla a una lista de espera del panel `/admin`; solo después de aprobarla se guarda como tabla final. Una persona con sesión activa de perfil publica la tabla automáticamente y queda identificada en los campos `created_by` y `created_by_user_id`. Los enlaces en vivo siguen publicándose al compartirlos. Los visitantes pueden consultar y agregar jugadores, pero no modificar los registros existentes.

Para habilitar al administrador:

1. En **Authentication → Users**, crea una cuenta con correo y contraseña. Supabase Auth admite inicio de sesión con correo y contraseña; no ofrece nombre de usuario y contraseña como identificador nativo.
2. En el **SQL Editor**, asigna el rol solo a esa cuenta, reemplazando el correo:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'admin@tudominio.cl';
   ```

3. Cierra y vuelve a iniciar sesión en `/admin` para recibir un token con el rol actualizado.

El rol se guarda en `app_metadata`, que el usuario no puede cambiar desde el cliente. El panel verifica la cuenta al iniciar sesión y RLS vuelve a comprobar el rol en cada operación; los usuarios normales no pueden modificar alias ni borrar torneos aunque llamen directamente a la API.

Mientras falte la configuración de Vercel, la app abre normalmente y sigue guardando el torneo activo en el almacenamiento local del dispositivo; el selector de tablas guardadas indicará que Supabase aún no está conectado.

La página `/view/` muestra una copia pública de solo lectura del torneo. En una base ya creada, aplica también `supabase/migrations/20261103_shared_tournaments.sql` y `supabase/migrations/20261103_restrict_shared_tournament_writer.sql`. Los visitantes solo pueden leer la tabla compartida; las actualizaciones pasan por una función con un token de escritura aleatorio que se conserva en el almacenamiento local del organizador y no se incluye en el enlace. Cada enlace vence tras siete días sin actualizaciones; al publicar una ronda nueva el plazo se renueva. Supabase Cron elimina periódicamente los enlaces vencidos y sus tokens.
