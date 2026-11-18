import { parseTechContext } from './tech-context-parser';

describe('parseTechContext', () => {
  const sample = [
    '## Resumen técnico',
    'La HU cambia la vista `schsaf.view_report_conciliation_temp`.',
    '',
    '## Flujo de ejecución real',
    '- Disparo: reporte "Temporales" → `GET /api/conciliation-report/xlsx`.',
    '- Datos a preparar: `schsaf.tbl_bank_drafts_maintenance` (state=\'SUCCESSFUL\')',
    '  y `schsaf.tbl_maintenance`.',
    '- Consulta de control: `schsaf.view_report_conciliation_temp` filtrando fecha.',
    '',
    '## Receta de datos',
    '- Dato: devolución de ME en USD | Origen: no verificable en el repositorio | Cómo crearlo: registrar el mantenimiento | Fuente: NU0139001_SAF_SQL:sql_code/view/a.sql:10',
    '',
    '## Equivalencias de códigos',
    '- ME = producto Factoring de ME. Evidencia: `ME(Set.of(...))` Fuente: AcronymByProduct.java:11',
    '- XX = algo. no confirmada',
    '',
    '## Cobertura de criterios en el código',
    '- [CA-01] "criterio" → IMPLEMENTADO. Detalle: x',
    '',
    '## Comportamientos del código no cubiertos por los criterios',
    '- [RT-09] (CAMBIO HU) La validación de día hábil ya no exime a ME. Código: `return LT.contains(x) ?` Fuente: ValidateHolidayUseCase.java:22',
    '',
    '## Archivos revisados',
    '- sql_code/view/2026082401_view.sql — vista del reporte',
  ].join('\n');

  it('separa resumen, flujo, receta, equivalencias, reglas y listas', () => {
    const model = parseTechContext(sample);
    expect(model.structured).toBeTrue();
    expect(model.summary).toContain('view_report_conciliation_temp');
    expect(model.flow.map((step) => step.label)).toEqual(['Disparo', 'Datos a preparar', 'Consulta de control']);
    expect(model.flow[0].icon).toBe('▶');
    expect(model.flow[1].text).toContain('tbl_maintenance');
    expect(model.recipe[0].title).toBe('devolución de ME en USD');
    expect(model.recipe[0].unverified).toBe(1);
    expect(model.recipe[0].fields.find((field) => field.label === 'Fuente')?.value).toContain('a.sql:10');
    expect(model.equivalences.length).toBe(2);
    expect(model.equivalences[0]).toEqual(jasmine.objectContaining({ code: 'ME', meaning: 'producto Factoring de ME', confirmed: true }));
    expect(model.equivalences[1].confirmed).toBeFalse();
    expect(model.ruleGroups[0].rules[0]).toEqual(jasmine.objectContaining({
      id: 'RT-09', change: 'CAMBIO HU', code: '`return LT.contains(x) ?`', source: 'ValidateHolidayUseCase.java:22',
    }));
    expect(model.lists.map((list) => list.title)).toEqual(['Archivos revisados']);
    expect(model.lists[0].files).toBeTrue();
  });

  it('omite la cobertura de criterios (se muestra en su tabla)', () => {
    const model = parseTechContext(sample);
    expect(JSON.stringify(model)).not.toContain('CA-01');
  });

  it('un texto sin secciones del agente no es estructurado', () => {
    expect(parseTechContext('texto libre editado por el usuario').structured).toBeFalse();
  });
});
