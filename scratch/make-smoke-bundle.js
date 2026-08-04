/**
 * Genera un bundle Serenity de prueba en Supabase Storage y devuelve una
 * signed URL, para probar el Release de Azure DevOps manualmente
 * (sin depender de la app).
 *
 * Uso:  node scratch/make-smoke-bundle.js
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const jobId = 'smoke-' + Date.now();

const bundle = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  run: {
    id: jobId,
    name: 'Smoke test pipeline',
    huTitle: 'HU demo',
    testPlanTitle: 'Plan demo',
  },
  feature: {
    name: 'Smoke test pipeline',
    description: ['HU: validacion de integracion Azure + Serenity'],
    tags: [],
    scenarios: [
      {
        name: 'Escenario de humo',
        type: 'Scenario',
        tags: [],
        steps: [
          { keyword: 'Given', text: 'el pipeline recibe el bundle' },
          { keyword: 'When', text: 'se ejecuta la tarea de materializacion' },
          { keyword: 'Then', text: 'se genera el reporte Serenity' },
        ],
      },
    ],
  },
  results: {
    'Escenario de humo': {
      steps: {
        '0': { status: 'passed', evidences: [], notes: '' },
        '1': { status: 'passed', evidences: [], notes: '' },
        '2': { status: 'passed', evidences: [], notes: '' },
      },
      notes: '',
    },
  },
  evidences: [],
  meta: { skippedEvidence: 0, totalScenarios: 1 },
};

(async () => {
  const path = `serenity-bundles/smoke/${jobId}.json`;

  const up = await admin.storage
    .from('execution-evidence')
    .upload(path, JSON.stringify(bundle), {
      contentType: 'application/json',
      upsert: true,
    });

  if (up.error) {
    console.error('UPLOAD ERROR:', up.error.message);
    process.exit(1);
  }

  const signed = await admin.storage
    .from('execution-evidence')
    .createSignedUrl(path, 86400);

  if (signed.error) {
    console.error('SIGN ERROR:', signed.error.message);
    process.exit(1);
  }

  console.log('\n=== PEGA ESTOS VALORES EN "Create a new release" ===\n');
  console.log('BUNDLE_URL:');
  console.log(signed.data.signedUrl);
  console.log('\nRUN_ID:');
  console.log(jobId);
  console.log('\nRUN_NAME:');
  console.log('Smoke test pipeline');
  console.log('\n(La URL es valida 24h)\n');
})();
