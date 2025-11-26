// src/app/models/database.model.ts
// Modelos para la base de datos Supabase

export interface DbTestPlan {
  id?: string;
  title: string;
  repository_link?: string;
  out_of_scope?: string;
  strategy?: string;
  limitations?: string;
  assumptions?: string;
  team?: string;
  cell_name?: string;
  created_at?: string;
  updated_at?: string;
  user_id?: string;
  is_deleted?: boolean;
}

export interface DbUserStory {
  id?: string;
  test_plan_id: string;
  custom_id?: string; // ID personalizado de la HU (ej: "HU_5873465", "5873465")
  title: string;
  sprint?: string;
  generation_mode?: 'text' | 'image';
  description?: string;
  acceptance_criteria?: string;
  generated_scope?: string;
  generated_test_case_titles?: string;
  refinement_technique?: string;
  refinement_context?: string;
  position?: number;
  created_at?: string;
  updated_at?: string;
}

export interface DbImage {
  id?: string;
  user_story_id: string;
  image_base64: string;
  position?: number;
  created_at?: string;
}

export interface DbTestCase {
  id?: string;
  user_story_id: string;
  title: string;
  preconditions?: string;
  expected_results?: string;
  position?: number;
  created_at?: string;
  updated_at?: string;
}

export interface DbTestCaseStep {
  id?: string;
  test_case_id: string;
  step_number: number;
  action: string;
  created_at?: string;
}

// Interfaces para consultas con joins
export interface DbTestPlanWithRelations extends DbTestPlan {
  user_stories?: DbUserStoryWithRelations[];
}

export interface DbUserStoryWithRelations extends DbUserStory {
  test_cases?: DbTestCaseWithRelations[];
  images?: DbImage[];
}

export interface DbTestCaseWithRelations extends DbTestCase {
  test_case_steps?: DbTestCaseStep[];
}

// Interface para resumen de test plans
export interface TestPlanSummary {
  id: string;
  title: string;
  repository_link?: string;
  created_at: string;
  updated_at: string;
  user_stories_count: number;
  test_cases_count: number;
}
