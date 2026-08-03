/**
 * Crea un bundle sintetico en /tmp/mattest para probar el script
 * scripts/azure-pipeline/materializar-bundle.sh sin usar Azure.
 *
 * Uso: node scratch/make-local-bundle-fixture.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = '/tmp/mattest';
const IN_DIR = path.join(ROOT, 'ci', 'in');

// JPEG 1x1 valido
const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQ' +
  'NDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBA' +
  'REA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const bundle = {
  schemaVersion: 1,
  feature: {
    name: 'Demo materializacion',
    description: ['HU: prueba de la tarea Materializar bundle'],
    tags: ['@manual'],
    scenarios: [
      {
        name: 'Escenario con evidencia',
        type: 'Scenario',
        tags: [],
        steps: [
          { keyword: 'Given', text: 'el bundle se descarga' },
          { keyword: 'When', text: 'se materializa' },
          { keyword: 'Then', text: 'se genera el feature' },
        ],
      },
    ],
  },
  results: {
    'Escenario con evidencia': {
      steps: {
        '0': { status: 'passed', evidences: ['ev-0-0-0.jpg'], notes: 'ok' },
        '1': { status: 'passed', evidences: [], notes: '' },
        '2': {
          status: 'failed',
          evidences: [],
          // Nota multilinea: valida que el TSV no se rompa
          notes: 'fallo\ncon salto de linea\ty tab',
        },
      },
    },
  },
  evidences: [{ name: 'ev-0-0-0.jpg', base64: TINY_JPEG }],
};

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(IN_DIR, { recursive: true });
fs.writeFileSync(path.join(IN_DIR, 'bundle.json'), JSON.stringify(bundle));

console.log('Fixture creado en', path.join(IN_DIR, 'bundle.json'));
