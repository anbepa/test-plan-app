
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
  console.log('🔍 Verificando si hay casos en la tabla test_cases...');
  
  const { data, count, error } = await supabase
    .from('test_cases')
    .select('id, title, user_story_id', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`📊 Total de casos encontrados: ${count}`);
  data.forEach(tc => {
    console.log(`- Caso: ${tc.title} | HU UUID: ${tc.user_story_id}`);
  });
}

checkData();
