import { criteriaIds, formatNormalizedCriteria, isNormalizedCriteria, parseNormalizedCriteria, uncoveredCriteria } from './criteria-normalizer';

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
});
