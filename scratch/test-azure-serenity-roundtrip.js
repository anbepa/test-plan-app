/**
 * Prueba el ciclo completo: upsert -> get_secret -> disconnect.
 * Valida que el PAT se guarde y se recupere correctamente desde Vault.
 *
 * Uso: node scratch/test-azure-serenity-roundtrip.js
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const PAT_1 = 'pat-original-AAAA';
const PAT_2 = 'pat-rotado-BBBB';

(async () => {
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  const userId = users.users[0].id;
  console.log('Usuario:', users.users[0].email);

  const upsert = (pat) =>
    admin.rpc('azure_serenity_upsert_connection', {
      p_user_id: userId,
      p_azure_organization: 'GrupoBancolombia',
      p_azure_project: 'Vicepresidencia Servicios de Tecnología',
      p_release_definition_id: 42727,
      p_pipeline_name: 'NU0139001_SAF_MR_Test_front_manual_test_DEV',
      p_branch: 'trunk',
      p_personal_access_token: pat,
      p_status: 'connected',
    });

  const read = async () => {
    const { data, error } = await admin.rpc(
      'azure_serenity_get_connection_secret',
      { p_user_id: userId }
    );
    if (error) throw new Error('get_secret: ' + error.message);
    return Array.isArray(data) ? data[0] : data;
  };

  // 1) Crear
  let r = await upsert(PAT_1);
  if (r.error) throw new Error('upsert #1: ' + r.error.message);
  let row = await read();
  console.log(
    '1) CREAR   :',
    row.personal_access_token === PAT_1
      ? 'OK (PAT recuperado correctamente)'
      : `FALLA -> se leyo "${row.personal_access_token}"`
  );

  // 2) Actualizar (rotar PAT) -> ejercita vault.update_secret
  r = await upsert(PAT_2);
  if (r.error) throw new Error('upsert #2: ' + r.error.message);
  row = await read();
  console.log(
    '2) ROTAR   :',
    row.personal_access_token === PAT_2
      ? 'OK (PAT actualizado)'
      : `FALLA -> se leyo "${row.personal_access_token}"`
  );

  // 3) Desconectar
  const d = await admin.rpc('azure_serenity_disconnect_connection', {
    p_user_id: userId,
  });
  console.log(
    '3) BORRAR  :',
    d.error ? 'FALLA -> ' + d.error.message : 'OK'
  );

  // 4) Verificar que no queden restos
  const after = await read();
  console.log('4) LIMPIEZA:', after ? 'FALLA -> queda la fila' : 'OK (sin restos)');

  // 5) El secreto tambien debe desaparecer del Vault
  const { data: leftover } = await admin
    .schema('vault')
    .from('secrets')
    .select('name')
    .eq('name', 'AZ_SERENITY_PAT_' + userId);
  console.log(
    '5) VAULT   :',
    !leftover || leftover.length === 0
      ? 'OK (secreto eliminado)'
      : 'ADVERTENCIA: el secreto sigue en Vault'
  );

  console.log('');
})().catch((e) => {
  console.error('\nERROR:', e.message);
  process.exit(1);
});
