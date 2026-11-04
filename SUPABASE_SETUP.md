# Preparar Supabase para LaMafia

La app ya no usa login ni Userbase. Se conecta desde el navegador con una clave pública de Supabase y usa políticas RLS. Para activar la conexión:

1. En Supabase, abre el proyecto y ejecuta todo el contenido de `supabase/schema.sql` en **SQL Editor**.
2. En Vercel, abre el proyecto conectado a este repositorio y agrega estas variables de entorno para Production (y Preview si usarás esas versiones):
   - `SUPABASE_URL`: URL del proyecto, por ejemplo `https://<project-ref>.supabase.co`.
   - `SUPABASE_ANON_KEY`: clave pública `anon`/`publishable` del proyecto.
3. Redepliega la web en Vercel.

No uses la clave `service_role` en la web ni en estas variables. La app no pide contraseña: cualquier visitante puede consultar las tablas guardadas y crear registros de participantes y resultados. Las tablas finales son de solo lectura para visitantes después de guardarse, pero el acceso es público; no guardes datos sensibles.

Los participantes se registran en `players` al agregarlos a un torneo. La tabla de puntuación completa (clasificación, participantes, partidos e historial) se guarda automáticamente en `finished_tournaments` al finalizar el torneo. La pestaña **Tabla** permite seleccionar y consultar tablas finalizadas.

Los alias de jugadores se guardan en `player_aliases`. La app crea esta tabla al configurar un proyecto nuevo con `supabase/schema.sql`; en proyectos existentes aplica `supabase/migrations/20261104191054_player_aliases.sql`.

## Panel privado de administración

El panel está en `/admin` y no tiene un enlace desde la interfaz pública. La ruta oculta el acceso, pero la protección real está en Supabase Auth y en las políticas RLS. El panel permite vincular/desvincular alias, convertir un alias en nombre principal y eliminar torneos finalizados.

En proyectos existentes aplica, en orden, `supabase/migrations/20261104192008_admin_controls.sql`, `supabase/migrations/20261104192302_admin_privilege_tightening.sql` y `supabase/migrations/20261104194103_promote_alias_to_canonical.sql`. En proyectos nuevos, ejecuta el `schema.sql` completo. Después, en Supabase **Authentication → Settings**, desactiva **Allow new users to sign up**. La app de torneos sigue siendo pública y no requiere iniciar sesión.

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

La página `/view/` muestra una copia pública de solo lectura del torneo. En una base ya creada, aplica también `supabase/migrations/20261103_shared_tournaments.sql` y `supabase/migrations/20261103_restrict_shared_tournament_writer.sql`. Los visitantes solo pueden leer la tabla compartida; las actualizaciones pasan por una función con un token de escritura aleatorio que se conserva en el almacenamiento local del organizador y no se incluye en el enlace.
