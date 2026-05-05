const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
async function run() {
  const { data } = await supabase.from('test_plans').select('*, user_stories(*, test_cases(count))').limit(1);
  console.log(JSON.stringify(data[0].user_stories[0].test_cases, null, 2));
}
run();
