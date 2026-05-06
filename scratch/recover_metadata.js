
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function recoverMetadata() {
  console.log('🔍 Buscando metadatos de respaldo en user_stories...');
  
  const { data, error } = await supabase
    .from('user_stories')
    .select('id, title, custom_id, generated_scope, generated_test_case_titles')
    .or('custom_id.eq.7367695,custom_id.eq.7367746,title.ilike.%7367695%,title.ilike.%7367746%');

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('⚠️ No se encontró rastro de las historias.');
    return;
  }

  data.forEach(us => {
    console.log(`\n--- HU: ${us.custom_id} - ${us.title} ---`);
    console.log('Alcance respaldado:', us.generated_scope ? 'SÍ' : 'NO');
    if (us.generated_test_case_titles) {
      console.log('Títulos encontrados:', us.generated_test_case_titles);
    }
  });
}

recoverMetadata();
