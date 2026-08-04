#!/usr/bin/env bash
# =====================================================================
# Tarea "Materializar bundle" — Azure DevOps Release (tipo Bash, Inline)
#
# Convierte el bundle JSON descargado en:
#   - <FEATDIR>/manual.feature   (Gherkin)
#   - <OUT>/manual-results.tsv   (resultados por paso)
#   - <EVID>/*.jpg|png           (evidencias decodificadas)
#
# Las rutas se exportan desde bash, por lo que NO hace falta llenar la
# sección "Environment Variables" de la tarea.
# =====================================================================

set -euo pipefail

# ── Rutas (ajusta ROOT_REL si cambia la estructura del repo) ──────────
ROOT="${SYSTEM_DEFAULTWORKINGDIRECTORY:-$PWD}"
ROOT_REL="_NU0139001_SAF_MR_Test/front_test/SAF_front_Manual"

export IN="$ROOT/ci/in/bundle.json"
export OUT="$ROOT/ci/out"
export EVID="$ROOT/evidences"
export FEATDIR="$ROOT/$ROOT_REL/src/test/resources/features/manual"

echo "IN      = $IN"
echo "OUT     = $OUT"
echo "EVID    = $EVID"
echo "FEATDIR = $FEATDIR"

if [ ! -f "$IN" ]; then
  echo "##[error]No existe el bundle en $IN. Revisa la tarea 'Descargar bundle'."
  exit 1
fi

mkdir -p "$OUT" "$EVID" "$FEATDIR"

node -e '
const fs = require("fs");
const path = require("path");

const { IN, OUT, EVID, FEATDIR } = process.env;
for (const [k, v] of Object.entries({ IN, OUT, EVID, FEATDIR })) {
  if (!v) { console.error(`##[error]Variable ${k} no definida`); process.exit(1); }
}

function oneLine(s) {
  return String(s == null ? "" : s).replace(/[\t\r\n]+/g, " ").replace(/#/g, "").replace(/\s{2,}/g, " ").trim();
}

const bundle = JSON.parse(fs.readFileSync(IN, "utf8"));

// ── 1) Evidencias: dataURL base64 -> archivo ────────────────────────
let written = 0;
for (const ev of (bundle.evidences || [])) {
  if (!ev || !ev.name || !ev.base64) continue;
  const b64 = String(ev.base64).replace(/^data:[^;]+;base64,/, "");
  fs.writeFileSync(path.join(EVID, ev.name), Buffer.from(b64, "base64"));
  written++;
}

// ── 2) Feature Gherkin ──────────────────────────────────────────────
const f = bundle.feature || {};
const out = [];
(f.tags || []).forEach(t => out.push(t));
out.push(`Feature: ${oneLine(f.name || "Reporte manual")}`);
(f.description || []).forEach(d => out.push("  " + oneLine(d)));

for (const sc of (f.scenarios || [])) {
  out.push("");
  (sc.tags || []).forEach(t => out.push("  " + t));
  out.push(`  ${sc.type || "Scenario"}: ${oneLine(sc.name)}`);
  (sc.steps || []).forEach(s => out.push(`    ${s.keyword} ${oneLine(s.text)}`));
}
fs.writeFileSync(path.join(FEATDIR, "manual.feature"), out.join("\n") + "\n");

// ── 3) TSV de resultados ────────────────────────────────────────────
const rows = [["scenario", "step_index", "status", "evidences", "notes"].join("\t")];
for (const [name, sc] of Object.entries(bundle.results || {})) {
  for (const [idx, r] of Object.entries((sc && sc.steps) || {})) {
    rows.push([
      oneLine(name),
      idx,
      r.status || "pending",
      (r.evidences || []).join(","),
      String(r.notes || "").replace(/\s+/g, " ")
    ].join("\t"));
  }
}
fs.writeFileSync(path.join(OUT, "manual-results.tsv"), rows.join("\n") + "\n");

console.log(`OK -> escenarios=${(f.scenarios || []).length} evidencias=${written} pasos=${rows.length - 1}`);
'

echo "--- feature ---"
head -20 "$FEATDIR/manual.feature"
echo "--- results ---"
head -10 "$OUT/manual-results.tsv"
echo "--- evidencias ---"
ls -1 "$EVID" | head -10
