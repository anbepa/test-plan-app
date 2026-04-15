require('dotenv').config({path: '.env'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
async function query() {
  const { data, error } = await supabase.from('plan_executions').select('*').limit(1);
  console.log("plan_executions:", data, error);
}
query();
