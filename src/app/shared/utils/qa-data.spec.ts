import { formatQaData, parseQaDataQueries, qaDataSummary } from './qa-data';

describe('qa-data utils', () => {
  it('acepta solo SELECT de una línea y descarta escritura', () => {
    const q = parseQaDataQueries(`Aquí van:\n{"queries":[
      {"id":"ok","label":"CxC vigente","sql":"select id, state from schsaf.tbl_receivable where state = 'CREATED' limit 5;"},
      {"id":"malo","sql":"delete from schsaf.tbl_receivable"},
      {"id":"doble","sql":"select 1; drop table x"},
      {"id":"ok","sql":"select 2"}]}`);
    expect(q.map((x) => x.id)).toEqual(['ok']);
    expect(q[0].sql.endsWith(';')).toBeFalse();
  });

  it('devuelve vacío si la IA no responde JSON', () => {
    expect(parseQaDataQueries('no hay datos')).toEqual([]);
  });

  it('arma el bloque de contexto con registros, vacíos y errores', () => {
    const result = { fetchedAt: null, results: [
      { id: 'a', label: 'CxC vigente', columns: ['invoice_number', 'state'], rows: [['FV-1', 'CREATED']] },
      { id: 'b', label: 'CxC anulada', columns: ['invoice_number'], rows: [] },
      { id: 'c', label: 'Solicitud', error: 'column x does not exist' },
    ] };
    const text = formatQaData(result);
    expect(text).toContain('## Datos reales de QA');
    expect(text).toContain('invoice_number=FV-1, state=CREATED');
    expect(text).toContain('no hay registros en QA');
    expect(text).toContain('la consulta falló');
    expect(qaDataSummary(result)).toBe('1 de 3 datos con registros (1 filas) · 1 consulta(s) con error');
  });
});
