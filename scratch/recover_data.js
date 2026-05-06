
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function recover() {
  console.log('🔍 Iniciando búsqueda de emergencia en plan_executions...');
  
  // Buscar ejecuciones relacionadas con las HUs afectadas
  // HU3: 7367695, HU4: 7367746
  const { data, error } = await supabase
    .from('plan_executions')
    .select('*')
    .or('hu_id.eq.7367695,hu_id.eq.7367746,hu_title.ilike.%7367695%,hu_title.ilike.%7367746%');

  if (error) {
    console.error('❌ Error al buscar:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('⚠️ No se encontraron ejecuciones previas para estas HUs.');
    return;
  }

  console.log(`✅ ¡Encontradas ${data.length} ejecuciones con posible data!`);
  
  data.forEach((exec, i) => {
    console.log(`\n--- [EJECUCIÓN ${i+1}] HU: ${exec.hu_id} - ${exec.hu_title} ---`);
    console.log('Fecha:', exec.updated_at);
    
    // El execution_data contiene los test cases con sus resultados
    if (exec.execution_data && exec.execution_data.testCases) {
      console.log(`Casos encontrados: ${exec.execution_data.testCases.length}`);
      exec.execution_data.testCases.forEach((tc, j) => {
        console.log(`\nCaso ${j+1}: ${tc.title}`);
        console.log(`Precondiciones: ${tc.preconditions}`);
        console.log(`Resultados esperados: ${tc.expectedResults}`);
        if (tc.steps) {
          console.log(`Pasos: ${tc.steps.length}`);
          tc.steps.forEach(s => console.log(`  - ${s.accion}`));
        }
      });
    }
  });
}

recover();
