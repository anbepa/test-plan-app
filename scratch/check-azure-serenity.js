/**
 * Verifica los prerequisitos de la integracion Azure DevOps + Serenity.
 *
 * Uso:  node scratch/check-azure-serenity.js
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const FAKE_USER = '00000000-0000-0000-0000-000000000001';

(async () => {
  const lines = [];

  // 1. RPC get_connection_secret (hotfix aplicado?)
  const rpc = await admin.rpc('azure_serenity_get_connection_secret', {
    p_user_id: FAKE_USER,
  });
  lines.push(
    rpc.error
      ? `RPC get_connection_secret : FALLA -> ${rpc.error.message}`
      : 'RPC get_connection_secret : OK (hotfix aplicado)'
  );

  // 2. Tabla + conexiones reales guardadas
  const conns = await admin
    .from('azure_serenity_connections')
    .select('user_id, azure_organization, azure_project, release_definition_id, status');

  if (conns.error) {
    lines.push(`TABLA azure_serenity_connections : FALLA -> ${conns.error.message}`);
  } else if (!conns.data.length) {
    lines.push('CONEXIONES guardadas : NINGUNA (configura Serenity Azure en la app)');
  } else {
    lines.push(`CONEXIONES guardadas : ${conns.data.length}`);
    conns.data.forEach((c) => {
      lines.push(
        `   - ${c.azure_organization}/${c.azure_project} ` +
          `defId=${c.release_definition_id} status=${c.status}`
      );
    });
  }

  // 3. Endpoint local levantado
  try {
    const res = await fetch('http://localhost:3000/api/serenity-report-azure', {
      method: 'GET',
    });
    lines.push(
      res.status === 404
        ? 'ENDPOINT local /api/serenity-report-azure : NO REGISTRADO (reinicia npm start)'
        : `ENDPOINT local /api/serenity-report-azure : OK (responde ${res.status})`
    );
  } catch (e) {
    lines.push('ENDPOINT local : servidor apagado en :3000 (ejecuta npm start)');
  }

  console.log('\n' + lines.join('\n') + '\n');
})();
