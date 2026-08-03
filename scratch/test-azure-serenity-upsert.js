/**
 * Prueba directa de azure_serenity_upsert_connection para ver el error real
 * que devuelve Postgres (el API solo muestra un mensaje generico).
 *
 * Uso: node scratch/test-azure-serenity-upsert.js
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

(async () => {
  // Usar un user_id real para no violar el FK contra auth.users
  const { data: users, error: uErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });

  if (uErr || !users?.users?.length) {
    console.error('No se pudo obtener un usuario:', uErr?.message);
    process.exit(1);
  }

  const userId = users.users[0].id;
  console.log('Usuario de prueba:', users.users[0].email, userId);

  const { data, error } = await admin.rpc('azure_serenity_upsert_connection', {
    p_user_id: userId,
    p_azure_organization: 'GrupoBancolombia',
    p_azure_project: 'Vicepresidencia Servicios de Tecnología',
    p_release_definition_id: 42727,
    p_pipeline_name: 'NU0139001_SAF_MR_Test_front_manual_test_DEV',
    p_branch: 'trunk',
    p_personal_access_token: 'pat-de-prueba-1234',
    p_status: 'connected',
  });

  if (error) {
    console.error('\n=== ERROR RPC ===');
    console.error('code   :', error.code);
    console.error('message:', error.message);
    console.error('details:', error.details);
    console.error('hint   :', error.hint);
    process.exit(1);
  }

  console.log('\n=== OK ===');
  console.log(JSON.stringify(data, null, 2));

  // Limpieza
  await admin.rpc('azure_serenity_disconnect_connection', { p_user_id: userId });
  console.log('\n(fila de prueba eliminada)');
})();
