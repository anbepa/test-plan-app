/**
 * Prueba columnas candidatas en azure_serenity_connections para descubrir
 * el esquema real (la tabla esta vacia y PostgREST no lista columnas).
 *
 * Uso: node scratch/probe-azure-serenity-columns.js
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const CANDIDATES = [
  'id',
  'user_id',
  'azure_organization',
  'organization',
  'azure_project',
  'project',
  'release_definition_id',
  'build_definition_id',
  'definition_id',
  'pipeline_id',
  'pipeline_name',
  'branch',
  'status',
  'token_hint',
  'last_validated_at',
  'created_at',
  'updated_at',
];

(async () => {
  const present = [];
  const missing = [];

  for (const col of CANDIDATES) {
    const { error } = await admin
      .from('azure_serenity_connections')
      .select(col)
      .limit(1);
    (error ? missing : present).push(col);
  }

  console.log('\nCOLUMNAS PRESENTES:');
  present.forEach((c) => console.log('  ✓ ' + c));
  console.log('\nNO EXISTEN:');
  missing.forEach((c) => console.log('  ✗ ' + c));
  console.log('');
})();
