"use strict";
/**
 * ManualTestV2 — Materializador STANDALONE (sin webapp).
 *
 * Toma el "bundle" JSON exportado desde manual-execution (test-plan-app) y lo
 * materializa en disco tal como Serenity lo necesita, SIN depender de ninguna
 * librería de webapp. Todo (parser Gherkin, importador y escritura del TSV que
 * consume ManualResults.java) vive en este único archivo.
 *
 * Uso:
 *   node ci/materialize.js <bundle.json> [--evidence-dir <path>]
 *
 * Salidas:
 *   src/test/resources/features/<run>.feature   ← escenarios en Gherkin
 *   evidences/<ev-*.ext>                         ← imágenes decodificadas
 *   ci/out/manual-results.tsv                    ← veredicto/evidencia por paso
 *
 * Estructura del bundle (schemaVersion 1):
 *   {
 *     "run": { "id", "name", "huTitle", "testPlanTitle" },
 *     "feature": { "name", "description":[], "tags":[], "scenarios":[
 *         { "name", "type", "tags":[], "steps":[ {"keyword","text"} ] } ] },
 *     "results": { "<scenario>": { "steps": { "0": {status, evidences:[], notes} } } },
 *     "evidences": [ { "name":"ev-0-1-0.webp", "base64":"data:image/webp;base64,..." } ]
 *   }
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FEATURES_DIR = path.join(ROOT, "src", "test", "resources", "features");
const EVIDENCES_DIR = path.join(ROOT, "evidences");
const OUT_DIR = path.join(ROOT, "ci", "out");
const RESULTS_TSV = path.join(OUT_DIR, "manual-results.tsv");
const RESULTS_JSON = path.join(OUT_DIR, "manual-results.json");

const ALLOWED_EXT = /\.(png|jpg|jpeg|gif|webp|pdf)$/i;

// ────────────────────────── helpers ──────────────────────────
function ensureDirs() {
  for (const d of [FEATURES_DIR, EVIDENCES_DIR, OUT_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function clearDir(dir, filterRe) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (filterRe && !filterRe.test(f)) continue;
    try { fs.unlinkSync(path.join(dir, f)); n++; } catch (_) {}
  }
  return n;
}

function safeName(name) {
  const base = path.basename(String(name || ""));
  return base.replace(/[^\w.\- ]/g, "_");
}

function decodeBase64(data) {
  const s = String(data || "").replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(s, "base64");
}

function b64(s) {
  return Buffer.from(String(s == null ? "" : s), "utf8").toString("base64");
}

// Gherkin es sensible a saltos de linea y caracteres especiales (# comentario,
// : delimitador de keyword). Aplanamos y sanitizamos antes de serializar.
function oneLine(s) {
  return String(s == null ? "" : s)
    .replace(/[\t\r\n]+/g, " ")
    .replace(/#/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ────────────────────── serializador Gherkin ──────────────────────
function serializeFeature(feature) {
  const out = [];
  if ((feature.tags || []).length) out.push(feature.tags.join(" "));
  out.push("Feature: " + oneLine(feature.name || "Untitled"));
  for (const d of feature.description || []) {
    const t = oneLine(d);
    if (t) out.push("  " + t);
  }
  out.push("");
  for (const s of feature.scenarios || []) {
    if ((s.tags || []).length) out.push("  " + s.tags.join(" "));
    out.push("  " + (s.type || "Scenario") + ": " + oneLine(s.name));
    for (const st of s.steps || []) out.push("    " + st.keyword + " " + oneLine(st.text));
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ─────────────────────────── validación ───────────────────────────
function validate(bundle) {
  if (!bundle || typeof bundle !== "object") throw new Error("Bundle inválido: no es un objeto JSON");
  if (!bundle.feature || !Array.isArray(bundle.feature.scenarios))
    throw new Error("Bundle inválido: falta feature.scenarios");
  if (bundle.results && typeof bundle.results !== "object")
    throw new Error("Bundle inválido: results debe ser un objeto");
  if (bundle.evidences && !Array.isArray(bundle.evidences))
    throw new Error("Bundle inválido: evidences debe ser un arreglo");
}

function safeFeatureFileName(bundle) {
  let base = (bundle.run && (bundle.run.name || bundle.run.id)) ||
             (bundle.feature && bundle.feature.name) || "reporte";
  base = String(base).toLowerCase().replace(/[^\w\- ]/g, "").trim()
           .replace(/\s+/g, "-").slice(0, 40) || "reporte";
  return base + ".feature";
}

// ─────────────────────────── importación ───────────────────────────
function importBundle(bundle) {
  validate(bundle);

  // 1) Limpiar estado previo para que el reporte refleje SOLO este bundle.
  const removedFeatures = clearDir(FEATURES_DIR, /\.feature$/i);
  const removedEvidence = clearDir(EVIDENCES_DIR, ALLOWED_EXT);

  // 2) Escribir evidencias (base64 -> archivos).
  let savedEvidence = 0;
  const evErrors = [];
  for (const ev of bundle.evidences || []) {
    try {
      const name = safeName(ev && ev.name);
      if (!ALLOWED_EXT.test(name)) { evErrors.push(name + " (extensión no permitida)"); continue; }
      fs.writeFileSync(path.join(EVIDENCES_DIR, name), decodeBase64(ev.base64 || ev.data));
      savedEvidence++;
    } catch (e) { evErrors.push(((ev && ev.name) || "?") + ": " + e.message); }
  }

  // 3) Escribir el archivo .feature.
  const feature = {
    name: (bundle.feature && bundle.feature.name) || "Reporte manual",
    description: Array.isArray(bundle.feature.description)
      ? bundle.feature.description
      : (bundle.feature.description ? [bundle.feature.description] : []),
    tags: Array.isArray(bundle.feature.tags) ? bundle.feature.tags : [],
    scenarios: (bundle.feature.scenarios || []).map((s) => ({
      name: (s && s.name) || "Escenario",
      type: s && s.type === "Scenario Outline" ? "Scenario Outline" : "Scenario",
      tags: Array.isArray(s && s.tags) ? s.tags : [],
      steps: (Array.isArray(s && s.steps) ? s.steps : [])
        .filter((st) => st && st.text != null && String(st.text).trim())
        .map((st) => ({ keyword: st.keyword || "Given", text: String(st.text).trim() })),
    })),
  };
  const featureFile = safeFeatureFileName(bundle);
  fs.writeFileSync(path.join(FEATURES_DIR, featureFile), serializeFeature(feature), "utf8");

  // 4) Normalizar resultados (soporta múltiples evidencias por paso).
  const results = {};
  for (const [scenarioName, sc] of Object.entries(bundle.results || {})) {
    const steps = {};
    for (const [idx, r] of Object.entries((sc && sc.steps) || {})) {
      const raw = Array.isArray(r.evidences) ? r.evidences : (r.evidence ? [r.evidence] : []);
      const names = raw.map(safeName).filter(Boolean);
      steps[String(idx)] = {
        status: ["passed", "failed", "pending"].includes(r.status) ? r.status : "passed",
        evidences: names,
        notes: r.notes || "",
      };
    }
    // La clave debe coincidir EXACTAMENTE con scenario.getName() que ve
    // Cucumber, es decir el nombre ya aplanado que se escribio en el .feature.
    results[oneLine(scenarioName)] = { steps, notes: (sc && sc.notes) || "" };
  }

  return {
    ok: true, featureFile, results,
    scenarios: feature.scenarios.length,
    steps: feature.scenarios.reduce((a, s) => a + s.steps.length, 0),
    savedEvidence, removedFeatures, removedEvidence, evErrors,
  };
}

// ─────────────── escritura del TSV que consume ManualResults.java ───────────────
// Formato (una línea POR PASO):
//   base64(scenario) \t stepIndex \t status \t base64(evidence;evidence) \t base64(notes)
function writeEngineResults(results) {
  fs.writeFileSync(RESULTS_JSON, JSON.stringify(results, null, 2), "utf8");
  const lines = [];
  for (const [name, sc] of Object.entries(results)) {
    const steps = (sc && sc.steps) || {};
    for (const [idx, r] of Object.entries(steps)) {
      const evList = Array.isArray(r.evidences) ? r.evidences : (r.evidence ? [r.evidence] : []);
      lines.push([
        b64(name),
        String(idx),
        (r.status || "passed"),
        b64(evList.join(";")),
        b64(r.notes || ""),
      ].join("\t"));
    }
  }
  fs.writeFileSync(RESULTS_TSV, lines.join("\n"), "utf8");
  return RESULTS_TSV;
}

// ─────────────────────────────── CLI ───────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const bundlePath = args[0];
  let evidenceDir = null;
  const evIdx = args.indexOf("--evidence-dir");
  if (evIdx >= 0 && args[evIdx + 1]) evidenceDir = args[evIdx + 1];

  if (!bundlePath) {
    console.error("Uso: node ci/materialize.js <bundle.json> [--evidence-dir <path>]");
    process.exit(1);
  }
  if (!fs.existsSync(bundlePath)) {
    console.error("Bundle no encontrado: " + bundlePath);
    process.exit(1);
  }

  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  } catch (e) {
    console.error("JSON del bundle inválido: " + e.message);
    process.exit(1);
  }

  // Parche opcional: evidencias en directorio externo (no embebidas en base64).
  if (evidenceDir && fs.existsSync(evidenceDir)) {
    let patched = 0;
    for (const ev of (bundle.evidences || [])) {
      if (ev.base64) continue;
      const srcPath = path.join(evidenceDir, safeName(ev.name));
      if (fs.existsSync(srcPath)) {
        ev.base64 = fs.readFileSync(srcPath, "utf8").trim();
        patched++;
      }
    }
    console.log("[materialize] Evidencias parcheadas desde " + evidenceDir + ": " + patched);
  }

  ensureDirs();
  try {
    const res = importBundle(bundle);
    const tsv = writeEngineResults(res.results);
    console.log("[materialize] feature file : " + res.featureFile);
    console.log("[materialize] escenarios   : " + res.scenarios);
    console.log("[materialize] pasos        : " + res.steps);
    console.log("[materialize] evidencias   : " + res.savedEvidence);
    if (res.evErrors && res.evErrors.length) {
      console.log("[materialize] avisos evidencia: " + JSON.stringify(res.evErrors));
    }
    console.log("[materialize] TSV resultados: " + tsv);
  } catch (e) {
    console.error("[materialize] FALLÓ: " + e.message);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { importBundle, writeEngineResults, serializeFeature, validate };
