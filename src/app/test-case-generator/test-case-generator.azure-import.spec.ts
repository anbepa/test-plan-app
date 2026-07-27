import { ChangeDetectorRef, ElementRef } from '@angular/core';
import { of, throwError } from 'rxjs';
import { TestCaseGeneratorComponent } from './test-case-generator.component';

describe('TestCaseGeneratorComponent Azure import', () => {
  const aiServiceStub = {
    getActiveProviderName: () => 'mock-provider'
  } as any;

  const cdrStub: ChangeDetectorRef = {
    markForCheck: () => {},
    detach: () => {},
    detectChanges: () => {},
    checkNoChanges: () => {},
    reattach: () => {}
  };

  const elementRefStub = {
    nativeElement: {
      querySelector: () => null
    }
  } as ElementRef;

  const toastStub = {
    success: () => '',
    error: () => '',
    warning: () => '',
    info: () => ''
  } as any;

  it('debe completar campos al importar HU y seleccionar célula por coincidencia', () => {
    const azureServiceStub = {
      importUserStory: () => of({
        id: 7632264,
        title: 'HU importada',
        nodeName: 'EQU0903 - BRAINSTORM',
        sprint: 'Sprint 249',
        description: 'Descripción limpia',
        acceptanceCriteria: 'Criterios limpios'
      })
    } as any;

    const component = new TestCaseGeneratorComponent(
      aiServiceStub,
      'browser',
      cdrStub,
      elementRefStub,
      toastStub,
      azureServiceStub
    );

    component.azureUserStoryIdInput = '7632264';
    component.importFromAzureDevOps();

    expect(component.currentHuId).toBe('7632264');
    expect(component.currentHuTitle).toBe('HU importada');
    expect(component.currentSprint).toBe('Sprint 249');
    expect(component.currentDescription).toBe('Descripción limpia');
    expect(component.currentAcceptanceCriteria).toBe('Criterios limpios');
    expect(component.cellName).toBe('BRAINSTORM');
    expect(component.azureNodeNameWarning).toBeNull();
    expect(component.azureImportErrorMessage).toBeNull();
  });

  it('no debe borrar datos manuales cuando falla importación', () => {
    const azureServiceStub = {
      importUserStory: () => throwError(() => ({ message: 'Error de conexión con Azure DevOps.' }))
    } as any;

    const component = new TestCaseGeneratorComponent(
      aiServiceStub,
      'browser',
      cdrStub,
      elementRefStub,
      toastStub,
      azureServiceStub
    );

    component.currentHuTitle = 'Dato manual';
    component.currentDescription = 'Descripción manual';
    component.currentAcceptanceCriteria = 'Criterios manuales';
    component.azureUserStoryIdInput = '12';

    component.importFromAzureDevOps();

    expect(component.currentHuTitle).toBe('Dato manual');
    expect(component.currentDescription).toBe('Descripción manual');
    expect(component.currentAcceptanceCriteria).toBe('Criterios manuales');
    expect(component.azureImportErrorMessage).toBe('Error de conexión con Azure DevOps.');
  });
});
