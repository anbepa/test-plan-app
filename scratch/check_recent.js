
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRecent() {
  console.log('🔍 Listando las últimas 5 historias modificadas...');
  
  const { data, error } = await supabase
    .from('user_stories')
    .select('id, custom_id, title, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  data.forEach(us => {
    console.log(`- ID: ${us.id} | Custom: ${us.custom_id} | Título: ${us.title} | Creado: ${us.created_at}`);
  });
}

checkRecent();
