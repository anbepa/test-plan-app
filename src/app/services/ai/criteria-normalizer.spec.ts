import { criteriaIds, formatNormalizedCriteria, isNormalizedCriteria, parseNormalizedCriteria, scenarioMatrixGaps, scenarioType, uncoveredChangeBehaviorIds, uncoveredCriteria } from './criteria-normalizer';

describe('criteria-normalizer', () => {
  const raw = '```json\n' + JSON.stringify({
    groups: [
      {
        title: 'Al ingresar al menú Devoluciones, el sistema deberá:',
        criteria: [
          { id: 'CA-01', text: 'Devolución DPP: solo registros en COP', options: [], note: '' },
          { id: 'CA-02', text: 'Giro de CxP: solo registros en COP', options: [], note: '' },
        ],
        summaries: [],
      },
      {
        title: '',
        criteria: [
          { id: 'CA-05', text: 'Multimoneda: no consolidar ni cruzar', options: ['COP → DPP, Giro', 'USD → Devoluciones ME'], note: 'Se tomó como un solo criterio.' },
          { id: 'CA-06', text: '   ', options: [] },
        ],
        summaries: [{ text: 'Cada módulo muestra solo su moneda', covers: ['CA-01', 'CA-05'] }],
      },
    ],
  }) + '\n```';

  it('renumera de forma continua y remapea los resúmenes', () => {
    const groups = parseNormalizedCriteria(raw);
    expect(groups.flatMap((group) => group.criteria.map((criterion) => criterion.id))).toEqual(['CA-01', 'CA-02', 'CA-03']);
    expect(groups[1].summaries[0].covers).toEqual(['CA-01', 'CA-03']);
  });

  it('arma la lista numerada con opciones, interpretación y resumen', () => {
    const text = formatNormalizedCriteria(parseNormalizedCriteria(raw));
    expect(text).toContain('### Al ingresar al menú Devoluciones, el sistema deberá\n- **CA-01** Devolución DPP: solo registros en COP');
    expect(text).toContain('  - Opciones: COP → DPP, Giro; USD → Devoluciones ME');
    expect(text).toContain('  - ⚠ Interpretación: Se tomó como un solo criterio.');
    expect(text).toContain('- Resumen (se verifica en CA-01, CA-03): Cada módulo muestra solo su moneda');
    expect(isNormalizedCriteria(text)).toBeTrue();
    expect(criteriaIds(text)).toEqual(['CA-01', 'CA-02', 'CA-03']);
  });

  it('una respuesta inválida no produce lista (se usan los criterios originales)', () => {
    expect(parseNormalizedCriteria('no es json')).toEqual([]);
    expect(isNormalizedCriteria('- Dado que el usuario… CA-01')).toBeFalse();
  });

  it('detecta criterios sin escenario', () => {
    const text = formatNormalizedCriteria(parseNormalizedCriteria(raw));
    expect(uncoveredCriteria(text, [{ coveredCriteria: ['CA-01', 'CA-03'] }, { coveredCriteria: ['RT-01'] }])).toEqual(['CA-02']);
  });

  it('los comportamientos (CAMBIO HU) no cubiertos también requieren escenario', () => {
    const context = [
      '## Cobertura de criterios en el código', '- [CA-01] "A" → IMPLEMENTADO. Detalle: x',
      '## Comportamientos del código no cubiertos por los criterios',
      '- [RT-03] (CAMBIO HU) Se elimina el filtro por estado. Fuente: Repo.java:10',
      '- [RT-07] (EXISTENTE) Filtro LIFE. Fuente: UseCase.java:5',
      '- [RT-08] (CAMBIO HU) Valor pagado nulo. Fuente: UseCase.java:9',
      '', '## Datos de prueba sugeridos', '- [RT-09] (CAMBIO HU) no es de esta sección',
    ].join('\n');
    expect(uncoveredChangeBehaviorIds(context)).toEqual(['RT-03', 'RT-08']);
    const text = formatNormalizedCriteria(parseNormalizedCriteria(raw));
    expect(uncoveredCriteria(text, [{ coveredCriteria: ['CA-01', 'CA-02', 'CA-03', 'RT-03'] }], context)).toEqual(['RT-08']);
  });
  it('clasifica el tipo de escenario por el prefijo del título', () => {
    expect(scenarioType('Positivo – Lista solo COP')).toBe('Positivo');
    expect(scenarioType('negativo - USD rechazado')).toBe('Negativo');
    expect(scenarioType('Regresion – default COP')).toBe('Regresión');
    expect(scenarioType('Lista solo COP')).toBeNull();
  });

  it('exige positivo y negativo evaluado por criterio, y regresión por cada CAMBIO HU', () => {
    const text = '- **CA-01** A\n- **CA-02** B';
    const context = '## Comportamientos del código no cubiertos por los criterios\n- [RT-01] (CAMBIO HU) Default COP. Fuente: X.java:1\n- [RT-02] (EXISTENTE) Y. Fuente: Y.java:1';
    const cases = [
      { title: 'Positivo – A', coveredCriteria: ['CA-01'] },
      { title: 'Negativo – A excluido', coveredCriteria: ['CA-01'] },
      { title: 'Positivo – B', coveredCriteria: ['CA-02', 'CA-01'] },
    ];
    expect(scenarioMatrixGaps(text, cases, [], context)).toEqual(['CA-02 sin negativo evaluado', 'RT-01 sin regresión']);
    const complete = [...cases, { title: 'Regresión – default COP', coveredCriteria: ['RT-01'] }];
    expect(scenarioMatrixGaps(text, complete, [{ id: 'CA-02', negative: 'N/A: solo consulta' }], context)).toEqual([]);
  });
});

