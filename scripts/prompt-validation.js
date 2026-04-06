const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const fetch = require('node-fetch');

const ROOT = path.resolve(__dirname, '..');
const PROMPTS_PATH = path.join(ROOT, 'src/app/config/prompts.config.ts');

function loadPrompts() {
  const tsCode = fs.readFileSync(PROMPTS_PATH, 'utf8');
  const js = ts.transpileModule(tsCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;

  const moduleObj = { exports: {} };
  const sandbox = { module: moduleObj, exports: moduleObj.exports, require, console };
  vm.runInNewContext(js, sandbox, { filename: 'prompts.config.js' });
  const exported = sandbox.module.exports;
  if (!exported || !exported.PROMPTS) throw new Error('No se pudo cargar PROMPTS');
  return exported.PROMPTS;
}

function buildAcceptanceCriteria(count) {
  const lines = [];
  for (let i = 1; i <= count; i++) {
    const id = `CR${String(i).padStart(2, '0')}`;
    lines.push(`${id}: Validar flujo ${i} en canal digital con regla específica ${i} y control de negocio ${i}.`);
  }
  return lines.join('\n');
}

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyScenario(tc) {
  const text = normalize(`${tc.title} ${tc.preconditions} ${tc.expectedResults} ${(tc.steps || []).map(s => s.accion).join(' ')}`);
  const isNegative = /(inval|error|rechaz|deneg|fall|bloque|no permite|no permite|expira|inconsisten|negativ)/.test(text);
  const isAlternate = /(altern|anul|reintento|contingen|rollback|parcial|degradado|intermitente|timeout)/.test(text);
  if (isNegative) return 'negative';
  if (isAlternate) return 'alternate';
  return 'positive';
}

function analyzeResult(result, criteriaCount) {
  const testCases = Array.isArray(result?.testCases) ? result.testCases : [];
  const titles = testCases.map(tc => normalize(tc.title));
  const uniqueTitles = new Set(titles);

  const allText = normalize(JSON.stringify(testCases));
  const coveredCriteria = [];
  for (let i = 1; i <= criteriaCount; i++) {
    const id = `cr${String(i).padStart(2, '0')}`;
    if (allText.includes(id)) coveredCriteria.push(id.toUpperCase());
  }

  const buckets = { positive: 0, negative: 0, alternate: 0 };
  for (const tc of testCases) {
    buckets[classifyScenario(tc)] += 1;
  }

  return {
    totalCases: testCases.length,
    duplicateTitles: testCases.length - uniqueTitles.size,
    criteriaCoverageById: `${coveredCriteria.length}/${criteriaCount}`,
    buckets
  };
}

function extractProviderText(provider, responseJson) {
  if (provider === 'gemini') {
    return responseJson?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('') || '';
  }
  return responseJson?.choices?.[0]?.message?.content || '';
}

function parseJsonLoose(raw) {
  let txt = (raw || '').trim();
  if (txt.startsWith('```json')) txt = txt.slice(7);
  if (txt.startsWith('```')) txt = txt.slice(3);
  if (txt.endsWith('```')) txt = txt.slice(0, -3);
  txt = txt.trim();

  const first = Math.min(
    ...['{', '['].map(ch => {
      const idx = txt.indexOf(ch);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    })
  );
  if (!Number.isFinite(first) || first === Number.MAX_SAFE_INTEGER) throw new Error('No JSON detectado');
  txt = txt.slice(first);

  const lastObj = txt.lastIndexOf('}');
  const lastArr = txt.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);
  if (end > 0) txt = txt.slice(0, end + 1);

  return JSON.parse(txt);
}

async function callProvider(provider, promptText) {
  const endpoint = provider === 'gemini'
    ? 'http://localhost:3000/api/gemini-proxy'
    : 'http://localhost:3000/api/deepseek-proxy';

  const payload = provider === 'gemini'
    ? {
      payload: {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { maxOutputTokens: 2600, temperature: 0.3 }
      },
      action: 'promptValidation'
    }
    : {
      payload: {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: promptText }],
        temperature: 0.3,
        max_tokens: 2200
      },
      action: 'promptValidation'
    };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(`${provider} ${response.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }

  const text = extractProviderText(provider, json);
  return parseJsonLoose(text);
}

async function run() {
  const PROMPTS = loadPrompts();
  const providers = ['gemini', 'deepseek'];
  const criteriaSizes = [5, 10, 12];
  const results = [];

  for (const provider of providers) {
    for (const size of criteriaSizes) {
      try {
        const description = `HU de banca digital para ejecutar operaciones multicanal con reglas de liberación de cupo y validaciones transversales. Caso ${size} criterios.`;
        const criteria = buildAcceptanceCriteria(size);
        const context = 'Prioriza cobertura por criterio con escenarios positivos, negativos y alternos, eliminando duplicados y manteniendo casos críticos.';

        const genPrompt = PROMPTS.DIRECT_GENERATION_PROMPT(description, criteria, 'Decision Table Testing', context);
        const generated = await callProvider(provider, genPrompt);
        const genAnalysis = analyzeResult(generated, size);

        const originalReq = `HU: ${description}\nCA: ${criteria}`;
        const refinePrompt = PROMPTS.DIRECT_REFINE_PROMPT(
          originalReq,
          JSON.stringify(generated.testCases || [], null, 2),
          'Refina para eliminar redundancias, mantener cobertura por criterio y priorizar escenarios críticos.',
          'Decision Table Testing'
        );
        const refined = await callProvider(provider, refinePrompt);
        const refAnalysis = analyzeResult(refined, size);

        results.push({
          provider,
          criteriaCount: size,
          generation: genAnalysis,
          refinement: refAnalysis
        });

        console.log(`\n[${provider.toUpperCase()}][${size} criterios]`);
        console.log('Generación:', genAnalysis);
        console.log('Refinamiento:', refAnalysis);
      } catch (err) {
        const errorMsg = err?.message || String(err);
        results.push({ provider, criteriaCount: size, error: errorMsg });
        console.log(`\n[${provider.toUpperCase()}][${size} criterios] ERROR: ${errorMsg}`);
      }
    }
  }

  const outPath = path.join(ROOT, 'scripts', 'prompt-validation-results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nReporte guardado en: ${outPath}`);
}

run().catch(err => {
  console.error('Error en pruebas de prompts:', err.message);
  process.exit(1);
});
