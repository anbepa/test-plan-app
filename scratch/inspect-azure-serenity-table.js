/**
 * Inspecciona las columnas reales de azure_serenity_connections.
 * Uso: node scratch/inspect-azure-serenity-table.js
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

(async () => {
  // Traer una fila (o cero) para que PostgREST revele las columnas via error/keys
  const { data, error } = await admin
    .from('azure_serenity_connections')
    .select('*')
    .limit(1);

  if (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }

  if (data.length) {
    console.log('\nCOLUMNAS (desde fila existente):');
    Object.keys(data[0]).forEach((k) => console.log('  - ' + k));
    console.log('\nFILA:', JSON.stringify(data[0], null, 2));
  } else {
    // Sin filas: forzar error de PostgREST pidiendo una columna inexistente
    const probe = await admin
      .from('azure_serenity_connections')
      .select('__columna_inexistente__')
      .limit(1);
    console.log('\nTabla vacia. Mensaje de PostgREST:');
    console.log(probe.error ? probe.error.message : '(sin error)');
    console.log(
      '\nSugerencia: revisa el esquema en Supabase Studio > Table Editor.'
    );
  }
})();
