import { ChangeDetectorRef, ElementRef } from '@angular/core';
import { TestCaseGeneratorComponent } from './test-case-generator.component';

describe('TestCaseGeneratorComponent · ramas agregadas a mano', () => {
  const cdrStub = { markForCheck: () => {}, detach: () => {}, detectChanges: () => {} } as unknown as ChangeDetectorRef;
  const elementRefStub = { nativeElement: document.createElement('div') } as ElementRef;
  const zoneStub = { run: (fn: () => unknown) => fn(), runOutsideAngular: (fn: () => unknown) => fn() } as any;

  const branchesOf = (names: string[]) => names.map((name) => ({ name, commitId: name + '-sha' })) as any;

  function createComponent(): TestCaseGeneratorComponent {
    const component = new TestCaseGeneratorComponent(
      { getActiveProviderName: () => 'mock' } as any,
      'browser',
      cdrStub,
      elementRefStub,
      { success: () => {}, error: () => {}, warning: () => {}, info: () => {} } as any,
      {} as any,
      { cells$: { subscribe: () => ({ unsubscribe: () => {} }) }, getCurrent: () => [] } as any,
      {} as any,
      {} as any,
      {} as any,
      zoneStub
    );
    component.codeProject = 'Proyecto';
    component.codeRepositoryId = 'repo-1';
    component.codeRepositories = [{ id: 'repo-1', name: 'NU_ms_maintenance', defaultBranch: 'trunk' } as any];
    component.codeBranches = branchesOf(['trunk', 'current', 'feature/a', 'feature/b']);
    return component;
  }

  it('usa la rama principal del repositorio como base si la HU no tiene cambios allí', () => {
    const component = createComponent();
    component.codeBranch = 'feature/a';
    expect(component.extraBaseBranch).toBe('trunk');
    expect(component.canAddExtraTarget).toBeTrue();
  });

  it('usa la rama destino que la HU ya tiene en ese repositorio como base', () => {
    const component = createComponent();
    component.codeHuChanges = { workItemId: 1, groups: [{ repositoryId: 'repo-1', targetBranch: 'current', files: [{ path: 'a.java' }] } as any] } as any;
    component.codeBranch = 'feature/a';
    expect(component.extraBaseBranch).toBe('current');
  });

  it('respeta la base elegida por el usuario', () => {
    const component = createComponent();
    component.codeBranch = 'feature/a';
    component.codeBaseBranchChoice = 'feature/b';
    expect(component.extraBaseBranch).toBe('feature/b');
  });

  it('avisa y no permite agregar la rama principal', () => {
    const component = createComponent();
    component.codeBranch = 'trunk';
    expect(component.canAddExtraTarget).toBeFalse();
    expect(component.extraTargetProblem).toContain('distinta de la principal');
  });

  it('agrega la rama, limpia la selección y no admite duplicados', () => {
    const component = createComponent();
    component.codeBranch = 'feature/a';
    component.addExtraTarget();
    expect(component.codeExtraTargets.length).toBe(1);
    expect(component.codeExtraTargets[0]).toEqual(jasmine.objectContaining({ repositoryId: 'repo-1', branch: 'feature/a', baseBranch: 'trunk', repositoryName: 'NU_ms_maintenance' }));
    expect(component.codeBranch).toBe('');
    expect(component.isCodeTargetReady).toBeTrue();

    // Al elegir otra vez el repositorio, la app vuelve a cargar sus ramas.
    component.codeRepositoryId = 'repo-1';
    component.codeBranches = branchesOf(['trunk', 'current', 'feature/a', 'feature/b']);
    component.codeBranch = 'feature/a';
    expect(component.extraTargetProblem).toContain('ya está agregada');
    expect(component.canAddExtraTarget).toBeFalse();
  });

  it('quita una rama agregada', () => {
    const component = createComponent();
    component.codeBranch = 'feature/a';
    component.addExtraTarget();
    component.codeRepositoryId = 'repo-1';
    component.codeBranches = branchesOf(['trunk', 'current', 'feature/a', 'feature/b']);
    component.codeBranch = 'feature/b';
    component.addExtraTarget();
    component.removeExtraTarget(0);
    expect(component.codeExtraTargets.map((t) => t.branch)).toEqual(['feature/b']);
  });

  it('una selección completa sin agregar también cuenta cuando no hay cambios de la HU a la vista', () => {
    const component = createComponent();
    component.codeBranch = 'feature/b';
    expect(component.pendingExtraTarget?.branch).toBe('feature/b');
  });
});
