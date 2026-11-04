-- ============================================================================
-- Parámetros globales (Configuración > Parámetros globales)
-- Enlace del repositorio de pruebas y equipo de trabajo que se usan al crear y
-- previsualizar planes. Antes vivían solo en el localStorage del navegador
-- (compartido entre usuarios del mismo navegador y perdido en otro equipo).
-- Una fila por usuario; cada usuario solo ve y modifica la suya (RLS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_general_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repository_link TEXT NOT NULL DEFAULT '',
  -- Una línea por integrante, formato "Rol: Nombre"
  team_content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE OR REPLACE FUNCTION public.user_general_sections_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_general_sections_updated_at
  ON public.user_general_sections;

CREATE TRIGGER trg_user_general_sections_updated_at
  BEFORE UPDATE ON public.user_general_sections
  FOR EACH ROW EXECUTE FUNCTION public.user_general_sections_set_updated_at();

ALTER TABLE public.user_general_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios gestionan solo sus parametros globales"
  ON public.user_general_sections;

CREATE POLICY "Usuarios gestionan solo sus parametros globales"
  ON public.user_general_sections
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Plantilla del nombre del test plan. Marcadores: {HU} (ID de la HU) y
-- {SPRINT} (número del sprint, sin repetir la palabra "Sprint").
-- Vacío = se usa la plantilla por defecto de la app.
ALTER TABLE public.user_general_sections
  ADD COLUMN IF NOT EXISTS plan_title_template TEXT NOT NULL DEFAULT '';
