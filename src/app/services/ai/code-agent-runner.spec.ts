import { reconcileChangeLabels } from './code-agent-runner';

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
