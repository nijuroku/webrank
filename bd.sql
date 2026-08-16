-- Habilitar extensión para gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ELIMINAR TABLAS (cuidado: borra datos)
DROP TABLE IF EXISTS public.resultados_finales CASCADE;
DROP TABLE IF EXISTS public.partidos CASCADE;
DROP TABLE IF EXISTS public.arbitros CASCADE;
DROP TABLE IF EXISTS public.participantes CASCADE;
DROP TABLE IF EXISTS public.torneos CASCADE;

-- TABLA: torneos
CREATE TABLE public.torneos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  codigo text NOT NULL,
  estado text NOT NULL DEFAULT 'activo',
  fase_actual integer NOT NULL DEFAULT 1,
  ronda_grupo integer NOT NULL DEFAULT 0,
  ronda_eliminatoria integer NOT NULL DEFAULT 0,
  finalizado boolean NOT NULL DEFAULT false,
  configuracion jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado_completo jsonb,
  creado_por text,
  fecha_creacion timestamptz NOT NULL DEFAULT now(),
  fecha_actualizacion timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX torneos_codigo_idx ON public.torneos (codigo);
CREATE INDEX torneos_fecha_actualizacion_idx ON public.torneos (fecha_actualizacion DESC);

-- TABLA: participantes
CREATE TABLE public.participantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  torneo_id uuid NOT NULL REFERENCES public.torneos(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  puntos_acumulados integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- evitar duplicados por nombre en mismo torneo (case-insensitive)
CREATE UNIQUE INDEX participantes_torneo_nombre_uniq ON public.participantes (torneo_id, lower(nombre));

-- TABLA: arbitros
CREATE TABLE public.arbitros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  torneo_id uuid NOT NULL REFERENCES public.torneos(id) ON DELETE CASCADE,
  usuario_id text NOT NULL,  -- auth.uid()
  nombre_arbitro text,
  rol text NOT NULL DEFAULT 'arbitro', -- 'arbitro', 'admin'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX arbitros_torneo_usuario_uniq ON public.arbitros (torneo_id, usuario_id);

-- TABLA: partidos
CREATE TABLE public.partidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  torneo_id uuid NOT NULL REFERENCES public.torneos(id) ON DELETE CASCADE,
  jugador_a_id uuid REFERENCES public.participantes(id) ON DELETE SET NULL,
  jugador_b_id uuid REFERENCES public.participantes(id) ON DELETE SET NULL,
  fase text NOT NULL DEFAULT 'grupos',
  ronda integer NOT NULL DEFAULT 0,
  score_a integer NOT NULL DEFAULT 0,
  score_b integer NOT NULL DEFAULT 0,
  jugado boolean NOT NULL DEFAULT false,
  ganador_id uuid REFERENCES public.participantes(id) ON DELETE SET NULL,
  fecha_partido timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índice único para evitar duplicados de enfrentamientos independientemente del orden de A/B
-- (usamos casting a text para LEAST/GREATEST)
CREATE UNIQUE INDEX partidos_unique_match ON public.partidos (
  torneo_id,
  (LEAST(jugador_a_id::text, jugador_b_id::text)),
  (GREATEST(jugador_a_id::text, jugador_b_id::text)),
  ronda
);

CREATE INDEX partidos_torneo_ronda_idx ON public.partidos (torneo_id, ronda);

-- TABLA: resultados_finales (un registro por torneo cuando finaliza)
CREATE TABLE public.resultados_finales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  torneo_id uuid NOT NULL UNIQUE REFERENCES public.torneos(id) ON DELETE CASCADE,
  campeon_id uuid REFERENCES public.participantes(id),
  subcampeon_id uuid REFERENCES public.participantes(id),
  tercer_id uuid REFERENCES public.participantes(id),
  cuarto_id uuid REFERENCES public.participantes(id),
  fecha_finalizacion timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- FUNCION AUXILIAR: comprobar si el usuario actual es árbitro
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_arbitro(tid uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.arbitros a
    WHERE a.torneo_id = tid
      AND a.usuario_id = auth.uid()
  );
$$;

-- ------------------------------------------------------------
-- HABILITAR RLS y POLÍTICAS (Row Level Security)
-- ------------------------------------------------------------

-- 1) torneos
ALTER TABLE public.torneos ENABLE ROW LEVEL SECURITY;

-- SELECT: permitir ver si eres árbitro del torneo o si fuiste el creador
CREATE POLICY torneos_select_arbitro_o_creador ON public.torneos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.torneos.id AND a.usuario_id = auth.uid()
    ) OR (public.torneos.creado_por = auth.uid())
  );

-- INSERT: permitir crear torneos si creado_por == auth.uid()
CREATE POLICY torneos_insert_creador ON public.torneos
  FOR INSERT
  WITH CHECK (created_by_or_auth_check(public.torneos, auth.uid()) IS NOT NULL); -- placeholder: we'll add a simpler policy below

-- (Supabase SQL editor no permite referencing auth.uid() inside WITH CHECK with custom placeholders; usar política explícita siguiente)
DROP POLICY IF EXISTS torneos_insert_creador ON public.torneos;
CREATE POLICY torneos_insert_creador ON public.torneos
  FOR INSERT
  WITH CHECK (creado_por = auth.uid());

-- UPDATE: permitir actualizaciones solo si eres árbitro del torneo
CREATE POLICY torneos_update_arbitro ON public.torneos
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.torneos.id AND a.usuario_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.torneos.id AND a.usuario_id = auth.uid())
  );

-- DELETE: permitir eliminar solo a árbitros con rol = 'admin'
CREATE POLICY torneos_delete_admin ON public.torneos
  FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.torneos.id AND a.usuario_id = auth.uid() AND a.rol = 'admin')
  );

-- 2) participantes
ALTER TABLE public.participantes ENABLE ROW LEVEL SECURITY;

-- SELECT/INSERT/UPDATE/DELETE para participantes: solo árbitros del torneo
CREATE POLICY participantes_manage_by_arbitro ON public.participantes
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.participantes.torneo_id AND a.usuario_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.participantes.torneo_id AND a.usuario_id = auth.uid())
  );

-- 3) partidos
ALTER TABLE public.partidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY partidos_manage_by_arbitro ON public.partidos
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.partidos.torneo_id AND a.usuario_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.partidos.torneo_id AND a.usuario_id = auth.uid())
  );

-- 4) arbitros
ALTER TABLE public.arbitros ENABLE ROW LEVEL SECURITY;

-- SELECT: permitir que un usuario vea los árbitros de torneos en los que participa (o si es admin)
CREATE POLICY arbitros_select ON public.arbitros
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.arbitros a2 WHERE a2.torneo_id = public.arbitros.torneo_id AND a2.usuario_id = auth.uid())
  );

-- INSERT: permitir añadir un arbitro si:
-- - el usuario insertado es el propio auth.uid() (se auto-une), OR
-- - el usuario actual es admin de ese torneo
CREATE POLICY arbitros_insert_self_or_admin ON public.arbitros
  FOR INSERT
  WITH CHECK (
    usuario_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.arbitros.torneo_id AND a.usuario_id = auth.uid() AND a.rol = 'admin')
  );

-- UPDATE: permitir modificar solo si eres admin del torneo
CREATE POLICY arbitros_update_admin ON public.arbitros
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.arbitros.torneo_id AND a.usuario_id = auth.uid() AND a.rol = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.arbitros.torneo_id AND a.usuario_id = auth.uid() AND a.rol = 'admin')
  );

-- DELETE: permitir eliminar árbitros solo a admin del torneo
CREATE POLICY arbitros_delete_admin ON public.arbitros
  FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.arbitros.torneo_id AND a.usuario_id = auth.uid() AND a.rol = 'admin')
  );

-- 5) resultados_finales
ALTER TABLE public.resultados_finales ENABLE ROW LEVEL SECURITY;

CREATE POLICY resultados_manage_by_arbitro ON public.resultados_finales
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.resultados_finales.torneo_id AND a.usuario_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.arbitros a WHERE a.torneo_id = public.resultados_finales.torneo_id AND a.usuario_id = auth.uid())
  );

-- ------------------------------------------------------------
-- NOTAS / Consideraciones finales
-- ------------------------------------------------------------
-- 1) Las políticas usan auth.uid(). Si tu aplicación inicializa sesiones anónimas,
--    el usuario anónimo seguirá teniendo un uid y estas políticas funcionarán.
-- 2) Si al insertar desde el backend se usan service_role keys (clave admin),
--    las políticas no se aplican porque la service_role bypassa RLS; cuidado con
--    exponer service_role desde el frontend (no hacerlo).
-- 3) Si necesitas que ciertos endpoints sean públicos (por ejemplo, ver torneos
--    listados por código), puedes crear políticas SELECT adicionales que permitan
--    acceso público en condiciones concretas (ej: estado = 'activo' y codigo = '...').
-- 4) Si quieres que usuarios no autenticados puedan unirse por código, entonces
--    ajusta la política de arbitros_insert_self_or_admin para permitir INSERT aunque auth.uid() = NULL,
--    pero eso reduce trazabilidad.
-- 5) Recomendación: después de ejecutar, probar flujos clave:
--    - Crear torneo (INSERT a torneos)
--    - Crear arbitro administrador (INSERT a arbitros)
--    - Añadir participantes (INSERT a participantes)
--    - Crear/actualizar partidos (INSERT/UPDATE a partidos)
--    - Marcar torneo finalizado y hacer UPSERT a resultados_finales

-- FIN DEL SCRIPT