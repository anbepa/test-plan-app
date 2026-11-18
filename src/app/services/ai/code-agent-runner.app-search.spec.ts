import { CodeAgentRunner, limitedNotice } from './code-agent-runner';

/** search_app: memoria por término en la corrida y aviso cuando GitHub limita la búsqueda. */
describe('CodeAgentRunner · búsqueda en el aplicativo', () => {
  const match = (repo: string, text: string, line = 1) => ({ repositoryName: repo, path: `/src/${repo}.java`, line, text });

  function setup(responses: Array<{ matches: any[]; limitedTerms?: string[] }>) {
    const calls: string[][] = [];
    const gateway = {
      searchApp: jasmine.createSpy('searchApp').and.callFake(async (_p: string, _r: string[], terms: string[]) => {
        calls.push(terms);
        const next = responses.shift() || { matches: [] };
        return { totalCount: next.matches.length, matches: next.matches, limitedTerms: next.limitedTerms || [] };
      }),
    } as any;
    return { runner: new CodeAgentRunner(gateway) as any, calls };
  }

  it('no vuelve a pedir a GitHub un término ya buscado en la corrida', async () => {
    const { runner, calls } = setup([{ matches: [match('ms_report', 'select * from view_report_conciliation_temp')] }]);
    const first = await runner.searchAppCached('org', ['NU0139001_'], ['view_report_conciliation_temp']);
    const second = await runner.searchAppCached('org', ['NU0139001_'], ['VIEW_REPORT_CONCILIATION_TEMP']);
    expect(calls.length).toBe(1);
    expect(second.matches).toEqual(first.matches);
  });

  it('solo pide los términos nuevos y une los resultados sin duplicar', async () => {
    const shared = match('ms_maintenance', 'tbl_account_payable join tbl_payback_drafts', 7);
    const { runner, calls } = setup([
      { matches: [shared] },
      { matches: [shared, match('SQL', 'insert into tbl_payback_drafts', 3)] },
    ]);
    await runner.searchAppCached('org', ['NU0139001_'], ['tbl_account_payable']);
    const result = await runner.searchAppCached('org', ['NU0139001_'], ['tbl_account_payable', 'tbl_payback_drafts']);
    expect(calls).toEqual([['tbl_account_payable'], ['tbl_payback_drafts']]);
    expect(result.matches.length).toBe(2);
  });

  it('un término limitado por GitHub no se guarda y se reintenta después', async () => {
    const { runner, calls } = setup([
      { matches: [], limitedTerms: ['GCPP001'] },
      { matches: [match('ms_maintenance', 'String GCPP001 = "GCPP001";')] },
    ]);
    const limited = await runner.searchAppCached('org', ['NU0139001_'], ['GCPP001']);
    expect(limited.limitedTerms).toEqual(['GCPP001']);
    const retried = await runner.searchAppCached('org', ['NU0139001_'], ['GCPP001']);
    expect(calls.length).toBe(2);
    expect(retried.matches.length).toBe(1);
  });

  it('el aviso pide no concluir que no existe', () => {
    expect(limitedNotice([])).toBe('');
    const notice = limitedNotice(['tbl_bank_drafts_maintenance']);
    expect(notice).toContain('BÚSQUEDA NO DISPONIBLE para: tbl_bank_drafts_maintenance');
    expect(notice).toContain('NO concluyas que no existen');
  });
});
