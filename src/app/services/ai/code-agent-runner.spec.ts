import { buildCriteriaContext, judgeFacts, mergeJudgeVotes, reconcileChangeLabels } from './code-agent-runner';

describe('reconcileChangeLabels', () => {
  const changedPaths = ['/domain/usecase/ReportUseCase.java'];
  const diffs = new Map([[
    '/domain/usecase/ReportUseCase.java',
    [
      '@@ cerca de la línea 90 @@',
      '  94| LocalDate reportDate = endDate;',
      '+ 95| LocalDate previousMonthEndDate = reportDate.minusDays(1);',
      '- base 118| LocalDateTime dateEnd = dateStart.plusDays(1);',
      '+ 112| var dateEnd = LocalDateTime.now();',
    ].join('\n'),
  ]]);

  it('mantiene (CAMBIO HU) cuando la cita cae en líneas cambiadas', () => {
    const line = '- [RT-01] (CAMBIO HU) Corte al cierre. Fuente: ReportUseCase.java:95';
    expect(reconcileChangeLabels(line, changedPaths, diffs)).toBe(line);
  });

  it('reconoce nombres de archivo abreviados', () => {
    const line = '- [RT-06] (CAMBIO HU) Ventana hasta ahora. Fuente: UseCase.java:112';
    expect(reconcileChangeLabels(line, changedPaths, diffs)).toBe(line);
  });

  it('acepta citas de líneas eliminadas con numeración del archivo base', () => {
    const line = '- [RT-07] (CAMBIO HU) Se eliminó el corte al día siguiente. Fuente: ReportUseCase.java:118';
    expect(reconcileChangeLabels(line, changedPaths, diffs)).toBe(line);
  });

  it('pasa a (EXISTENTE) si las líneas citadas no cambiaron', () => {
    const line = '- [RT-02] (CAMBIO HU) Filtro LIFE. Fuente: ReportUseCase.java:38-39, 142-145';
    expect(reconcileChangeLabels(line, changedPaths, diffs)).toContain('(EXISTENTE)');
  });

  it('pasa a (EXISTENTE) si el archivo citado no está en los cambios de la HU', () => {
    const line = '- [RT-03] (CAMBIO HU) Nombre del archivo. Fuente: api/ReportController.java:133-142';
    expect(reconcileChangeLabels(line, changedPaths, diffs)).toContain('(EXISTENTE)');
  });

  it('no toca líneas sin cita ni comportamientos ya marcados (EXISTENTE)', () => {
    const context = '- [RT-04] (CAMBIO HU) Sin cita\n- [RT-05] (EXISTENTE) Otro. Fuente: ReportUseCase.java:95';
    expect(reconcileChangeLabels(context, changedPaths, diffs)).toBe(context);
  });
});

describe('buildCriteriaContext', () => {
  const agent = [
    '## Resumen técnico', 'Cambia la fuente del informe.', '',
    '## Flujo de ejecución real', '- Disparo: GET /report', '',
    '## Reglas del código',
    '- [RT-01] (CAMBIO HU) Toma la foto al cierre. Código: `tch.created_at = :date` Fuente: Repo.java:59',
    '- [RT-02] (CAMBIO HU) LIFE creado antes del día 1. Código: `tr.created_at < :startDate` Fuente: Repo.java:117',
    '- [RT-03] (EXISTENTE) Filtro LIFE ≥ 100.000. Código: `value >= 100000` Fuente: UseCase.java:142',
    '',
    '## Búsquedas sin resultado', '- "malla": sin cron', '',
    '## Datos de prueba sugeridos', '- endDate=2024-06-01', '',
    '## Archivos revisados', '- Repo.java — consultas',
  ].join('\n');
  const judge = [
    '## Cobertura de criterios en el código',
    '- [CA-01] "Malla día 1" → SIN EVIDENCIA. Detalle: no hay cron. Reglas: ninguna',
    '- [CA-02] "Corte al cierre" → IMPLEMENTADO. Detalle: foto al cierre. Reglas: RT-01',
  ].join('\n');

  it('el juez solo recibe flujo, reglas literales y búsquedas', () => {
    const facts = judgeFacts(agent);
    expect(facts).toContain('`tch.created_at = :date`');
    expect(facts).toContain('Búsquedas sin resultado');
    expect(facts).not.toContain('Resumen técnico');
    expect(facts).not.toContain('Datos de prueba');
  });

  it('resuelve las reglas del juez a archivo:línea', () => {
    const context = buildCriteriaContext(agent, judge);
    expect(context).toContain('- [CA-02] "Corte al cierre" → IMPLEMENTADO. Detalle: foto al cierre. Fuente: Repo.java:59');
    expect(context).not.toContain('Reglas: RT-01');
  });

  it('los RT no usados por ningún criterio quedan como no cubiertos, sin código literal', () => {
    const context = buildCriteriaContext(agent, judge);
    const uncovered = context.split('## Comportamientos del código no cubiertos por los criterios')[1];
    expect(uncovered).toContain('- [RT-02] (CAMBIO HU) LIFE creado antes del día 1. Fuente: Repo.java:117');
    expect(uncovered).toContain('[RT-03] (EXISTENTE)');
    expect(uncovered).not.toContain('[RT-01]');
    expect(uncovered).not.toContain('Código:');
  });

  it('sin respuesta válida del juez conserva el contexto del agente', () => {
    expect(buildCriteriaContext(agent, 'texto sin matriz')).toBe(agent);
  });
});

describe('mergeJudgeVotes', () => {
  const vote = (s1: string, s2: string, detail = 'x') =>
    `## Cobertura de criterios en el código\n- [CA-01] "A" → ${s1}. Detalle: ${detail}. Reglas: RT-01\n- [CA-02] "B" → ${s2}. Detalle: ${detail}. Reglas: ninguna`;

  it('gana la mayoría por criterio', () => {
    const merged = mergeJudgeVotes([vote('IMPLEMENTADO', 'PARCIAL'), vote('PARCIAL', 'PARCIAL'), vote('IMPLEMENTADO', 'SIN EVIDENCIA')]);
    expect(merged).toContain('[CA-01] "A" → IMPLEMENTADO.');
    expect(merged).toContain('[CA-02] "B" → PARCIAL.');
  });

  it('sin mayoría elige el estado más prudente', () => {
    const merged = mergeJudgeVotes([vote('IMPLEMENTADO', 'IMPLEMENTADO'), vote('DIFERENTE', 'IMPLEMENTADO'), vote('PARCIAL', 'IMPLEMENTADO')]);
    expect(merged).toContain('[CA-01] "A" → PARCIAL.');
  });

  it('ignora veredictos con distinto número de criterios', () => {
    const odd = '## Cobertura de criterios en el código\n- [CA-01] "A" → SIN EVIDENCIA. Detalle: y';
    const merged = mergeJudgeVotes([vote('IMPLEMENTADO', 'PARCIAL'), odd, vote('IMPLEMENTADO', 'PARCIAL')]);
    expect(merged).toContain('[CA-01] "A" → IMPLEMENTADO.');
    expect(merged).toContain('[CA-02]');
  });
});
