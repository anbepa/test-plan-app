import { ChangeDetectorRef, ElementRef } from '@angular/core';
import { of } from 'rxjs';
import { TestCaseGeneratorComponent } from './test-case-generator.component';

describe('TestCaseGeneratorComponent · origen del código (GitHub / Azure Repos)', () => {
  const cdrStub = { markForCheck: () => {}, detach: () => {}, detectChanges: () => {} } as unknown as ChangeDetectorRef;
  const elementRefStub = { nativeElement: document.createElement('div') } as ElementRef;
  const zoneStub = { run: (fn: () => unknown) => fn(), runOutsideAngular: (fn: () => unknown) => fn() } as any;

  function createComponent(repos: any) {
    return new TestCaseGeneratorComponent(
      { getActiveProviderName: () => 'mock' } as any,
      'browser',
      cdrStub,
      elementRefStub,
      { success: () => {}, error: () => {}, warning: () => {}, info: () => {} } as any,
      {} as any,
      { cells$: { subscribe: () => ({ unsubscribe: () => {} }) }, getCurrent: () => [] } as any,
      repos,
      {} as any,
      {} as any,
      zoneStub
    );
  }

  function reposStub() {
    return {
      provider: 'azure',
      listProjects: jasmine.createSpy('listProjects').and.returnValue(of([{ id: 'cib-bancolombia', name: 'cib-bancolombia' }])),
      listRepositories: jasmine.createSpy('listRepositories').and.returnValue(of([])),
      getWorkItemChanges: jasmine.createSpy('getWorkItemChanges').and.returnValue(of({ workItemId: 7743787, groups: [], omitted: [], emptyBranches: [] })),
      getLinkedBranches: jasmine.createSpy('getLinkedBranches').and.returnValue(of([])),
    } as any;
  }

  it('cambia a GitHub, limpia la selección de Azure y vuelve a buscar el código de la HU', () => {
    const repos = reposStub();
    const component = createComponent(repos);
    component.contextSource = 'criteria-code';
    component.currentHuId = '7743787';
    component.codeProject = 'Vicepresidencia Servicios de Tecnología';
    component.codeRepositoryId = 'azure-guid';
    component.codeBranch = 'trunk';
    component.codeProjects = [{ id: 'p1', name: 'Vicepresidencia Servicios de Tecnología' }];

    component.setCodeProvider('github');

    expect(repos.provider).toBe('github');
    expect(component.codeProjectLabel).toBe('Organización');
    expect(component.codeRepositoryId).toBe('');
    expect(component.codeBranch).toBe('');
    expect(repos.listProjects).toHaveBeenCalled();
    expect(repos.getWorkItemChanges).toHaveBeenCalledWith(7743787);
    // Una sola organización: queda preseleccionada.
    expect(component.codeProject).toBe('cib-bancolombia');
  });

  it('no cambia de origen mientras el agente explora', () => {
    const repos = reposStub();
    const component = createComponent(repos);
    component.codeExploring = true;
    component.setCodeProvider('github');
    expect(component.codeProvider).toBe('azure');
    expect(repos.provider).toBe('azure');
  });
});
