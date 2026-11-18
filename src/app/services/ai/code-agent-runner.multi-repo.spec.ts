import { CodeAgentRunner, RepoRef } from './code-agent-runner';

/** Herramientas del agente cuando la HU cambió código en varios repos. */
describe('CodeAgentRunner · varios repos de la HU', () => {
  const maintenance: RepoRef = { project: 'cib-bancolombia', repositoryId: 'NU0139001_SAF_ms_maintenance', commit: 'a'.repeat(40) };
  const sql: RepoRef = { project: 'cib-bancolombia', repositoryId: 'NU0139001_SAF_SQL', commit: 'b'.repeat(40) };
  const trees: Record<string, string[]> = {
    NU0139001_SAF_ms_maintenance: ['/domain/usecase/ValidateHolidayUseCase.java', '/build.gradle'],
    NU0139001_SAF_SQL: ['/sql_code/view/2026070901_view_report_conciliation_temp.sql', '/sql_code/view/2026082401_view_report_conciliation_temp.sql', '/sql_code/table/tbl_account_payable.sql'],
  };

  function setup() {
    const gateway = {
      getTree: jasmine.createSpy('getTree').and.callFake(async (ref: RepoRef) => ({ files: trees[ref.repositoryId] })),
      search: jasmine.createSpy('search').and.callFake(async (ref: RepoRef, _terms: string[], paths: string[]) => ({
        searchedFiles: paths.length,
        matches: paths.filter((path) => path.includes('conciliation')).map((path) => ({ path, line: 3, text: `${ref.repositoryId} match` })),
      })),
      readFiles: jasmine.createSpy('readFiles').and.callFake(async (_ref: RepoRef, files: any[]) => files.map((file) => ({ path: file.path, content: '1| x', startLine: 1, endLine: 1, totalLines: 1 }))),
    } as any;
    const runner = new CodeAgentRunner(gateway) as any;
    const workspaces = [
      { name: 'NU0139001_SAF_ms_maintenance', ref: maintenance, files: [], group: {} },
      { name: 'NU0139001_SAF_SQL', ref: sql, files: [], group: {} },
    ];
    return { gateway, runner, workspaces };
  }

  async function ctxFor(runner: any, workspaces: any[]) {
    const repoTrees = await runner.loadRepoTrees(workspaces, trees['NU0139001_SAF_ms_maintenance'], [], maintenance);
    return { primaryRef: maintenance, workspaces, branchDiff: null, treeFiles: trees['NU0139001_SAF_ms_maintenance'], rankedFiles: trees['NU0139001_SAF_ms_maintenance'], repoTrees, filesReviewed: new Set<string>(), emit: () => {}, appScope: null };
  }

  it('list_files encuentra archivos del repo SQL aunque no sea el principal', async () => {
    const { runner, workspaces } = setup();
    const ctx = await ctxFor(runner, workspaces);
    const result: string = await runner.executeTool('list_files', { path_prefix: '/sql_code/view', contains: 'conciliation' }, ctx);
    expect(result).toContain('NU0139001_SAF_SQL:/sql_code/view/2026070901_view_report_conciliation_temp.sql');
    expect(result).toContain('NU0139001_SAF_SQL:/sql_code/view/2026082401_view_report_conciliation_temp.sql');
  });

  it('search_code busca en todos los repos y antepone el repo a cada coincidencia', async () => {
    const { runner, workspaces, gateway } = setup();
    const ctx = await ctxFor(runner, workspaces);
    const result: string = await runner.executeTool('search_code', { terms: ['view_report_conciliation_temp'] }, ctx);
    const searchedRepos = gateway.search.calls.allArgs().map((args: any[]) => args[0].repositoryId);
    expect(searchedRepos).toContain('NU0139001_SAF_SQL');
    expect(searchedRepos).toContain('NU0139001_SAF_ms_maintenance');
    expect(result).toContain('NU0139001_SAF_SQL:/sql_code/view/2026082401_view_report_conciliation_temp.sql:3');
  });

  it('search_code con repo busca solo en ese repo', async () => {
    const { runner, workspaces, gateway } = setup();
    const ctx = await ctxFor(runner, workspaces);
    await runner.executeTool('search_code', { terms: ['conciliation'], repo: 'NU0139001_SAF_SQL' }, ctx);
    const searchedRepos = new Set(gateway.search.calls.allArgs().map((args: any[]) => args[0].repositoryId));
    expect(Array.from(searchedRepos)).toEqual(['NU0139001_SAF_SQL']);
  });

  it('read_files acepta la ruta con el repo delante (REPO:/ruta) y lee del repo correcto', async () => {
    const { runner, workspaces, gateway } = setup();
    const ctx = await ctxFor(runner, workspaces);
    await runner.executeTool('read_files', { files: [{ path: 'NU0139001_SAF_SQL:/sql_code/table/tbl_account_payable.sql' }] }, ctx);
    const [ref, files] = gateway.readFiles.calls.mostRecent().args;
    expect(ref.repositoryId).toBe('NU0139001_SAF_SQL');
    expect(files[0].path).toBe('/sql_code/table/tbl_account_payable.sql');
  });

  it('con un solo repo no cambia el formato de las rutas', async () => {
    const { runner } = setup();
    const single = [{ name: 'NU0139001_SAF_ms_maintenance', ref: maintenance, files: [], group: {} }];
    const ctx = await ctxFor(runner, single);
    const result: string = await runner.executeTool('list_files', { contains: 'holiday' }, ctx);
    expect(result).toBe('/domain/usecase/ValidateHolidayUseCase.java');
  });

  it('con repo y rama elegidos a mano (sin cambios de la HU) busca en el repo principal', async () => {
    const { runner, gateway } = setup();
    const ctx = await ctxFor(runner, []);
    await runner.executeTool('search_code', { terms: ['holiday'] }, ctx);
    const [ref] = gateway.search.calls.mostRecent().args;
    expect(ref).toEqual(maintenance);
  });

  it('con GitHub (searchLimits) busca en una sola llamada por repo con todas sus rutas', async () => {
    const { runner, workspaces, gateway } = setup();
    gateway.searchLimits = () => ({ batchSize: 5000, maxFiles: 5000 });
    const ctx = await ctxFor(runner, workspaces);
    const result: string = await runner.executeTool('search_code', { terms: ['conciliation'] }, ctx);
    const calls = gateway.search.calls.allArgs();
    expect(calls.length).toBe(2);
    const sqlCall = calls.find((args: any[]) => args[0].repositoryId === 'NU0139001_SAF_SQL');
    expect(sqlCall[2].length).toBe(3);
    expect(result).toContain('Búsqueda completa');
  });
});
