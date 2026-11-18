import { ChangeDetectorRef, ElementRef } from '@angular/core';
import { of, throwError } from 'rxjs';
import { TestCaseGeneratorComponent } from './test-case-generator.component';

describe('TestCaseGeneratorComponent · código de la HU desde GitHub', () => {
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

  it('consulta siempre GitHub y no avisa si la conexión existe', () => {
    const repos = {
      provider: 'azure',
      getGithubConnection: () => of({ owner: 'cib-bancolombia', status: 'connected' }),
      listProjects: () => of([{ id: 'cib-bancolombia', name: 'cib-bancolombia' }]),
      listRepositories: () => of([]),
    } as any;
    const component = createComponent(repos);
    (component as any).loadCodeProvider();
    expect(repos.provider).toBe('github');
    expect(component.codeProjectLabel).toBe('Organización');
    expect(component.githubCodeMissing).toBeFalse();
    // Con GitHub configurado, "Criterios + código" queda por defecto.
    expect(component.contextSource).toBe('criteria-code');
  });

  it('no cambia el modo si el usuario ya eligió "Solo criterios"', () => {
    const repos = {
      provider: 'github',
      getGithubConnection: () => of({ owner: 'cib-bancolombia', status: 'connected' }),
      listProjects: () => of([]),
    } as any;
    const component = createComponent(repos);
    component.onContextSourceChange('criteria');
    (component as any).loadCodeProvider();
    expect(component.contextSource).toBe('criteria');
  });

  it('avisa que falta configurar GitHub cuando no hay conexión', () => {
    const component = createComponent({ provider: 'github', getGithubConnection: () => of(null) } as any);
    (component as any).loadCodeProvider();
    expect(component.githubCodeMissing).toBeTrue();
  });

  it('avisa también si la consulta de la conexión falla', () => {
    const component = createComponent({ provider: 'github', getGithubConnection: () => throwError(() => new Error('500')) } as any);
    (component as any).loadCodeProvider();
    expect(component.githubCodeMissing).toBeTrue();
  });
  describe('exploración automática del contexto técnico', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    function ready(component: TestCaseGeneratorComponent) {
      spyOnProperty(component, 'usesCodeContext').and.returnValue(true);
      spyOnProperty(component, 'isCodeTargetReady').and.returnValue(true);
      component.currentDescription = 'Como usuario quiero…';
      component.currentHuId = '7743787';
      return spyOn(component, 'exploreCode');
    }

    it('explora sola una vez cuando la HU y su código están listos (sin generar)', () => {
      const component = createComponent({} as any);
      const explore = ready(component);
      component.scheduleAutoExplore();
      component.scheduleAutoExplore();
      jasmine.clock().tick(900);
      expect(explore).toHaveBeenCalledTimes(1);
      // No se repite (p. ej. tras cancelar o fallar) hasta que cambie la HU o el código.
      component.scheduleAutoExplore();
      jasmine.clock().tick(900);
      expect(explore).toHaveBeenCalledTimes(1);
      component.clearCodeContext('cambiaste la rama');
      jasmine.clock().tick(900);
      expect(explore).toHaveBeenCalledTimes(2);
    });

    it('no explora si ya hay contexto o si el modo es "Solo criterios"', () => {
      const component = createComponent({} as any);
      const explore = ready(component);
      component.codeContextText = 'contexto';
      component.scheduleAutoExplore();
      jasmine.clock().tick(900);
      expect(explore).not.toHaveBeenCalled();
    });
  });
});
