require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const testToken = process.env.GH_DISPATCH_TOKEN || process.env.GH_TOKEN || '';

async function run() {
  // Test 1: tabla existe?
  const t1 = await admin.from('serenity_connections').select('id').limit(1);
  console.log('TABLE:', t1.error ? 'ERROR: ' + t1.error.message : 'OK - tabla existe');

  // Test 2: RPC existe y funciona?
  const t2 = await admin.rpc('serenity_upsert_connection', {
    p_user_id: '00000000-0000-0000-0000-000000000001',
    p_github_username: 'anbepa',
    p_repository_owner: 'anbepa',
    p_repository_name: 'ManualTest',
    p_workflow_file_name: 'serenity-report.yml',
    p_branch: 'main',
    p_repository_url: 'https://github.com/anbepa/ManualTest',
    p_workflow_name: 'Serenity Report',
    p_personal_access_token: testToken,
    p_status: 'connected'
  });
  console.log('RPC upsert:', t2.error ? 'ERROR: ' + t2.error.message : 'OK: ' + JSON.stringify(t2.data));

  // Test 3: RPC get_connection_secret
  const t3 = await admin.rpc('serenity_get_connection_secret', {
    p_user_id: '00000000-0000-0000-0000-000000000001'
  });
  console.log('RPC get_secret:', t3.error ? 'ERROR: ' + t3.error.message : 'OK: ' + JSON.stringify(t3.data));

  // Limpiar fila de prueba
  await admin.from('serenity_connections').delete().eq('user_id', '00000000-0000-0000-0000-000000000001');
  console.log('Limpieza: OK');
}

run().catch(e => console.error('FATAL:', e.message));
