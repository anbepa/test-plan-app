// src/app/services/local-storage.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { LocalStorageService } from './local-storage.service';
import { PLATFORM_ID } from '@angular/core';

describe('LocalStorageService', () => {
  let service: LocalStorageService;
  let mockLocalStorage: { [key: string]: string };

  beforeEach(() => {
    // Mock localStorage
    mockLocalStorage = {};
    
    spyOn(localStorage, 'getItem').and.callFake((key: string) => {
      return mockLocalStorage[key] || null;
    });
    
    spyOn(localStorage, 'setItem').and.callFake((key: string, value: string) => {
      mockLocalStorage[key] = value;
    });
    
    spyOn(localStorage, 'removeItem').and.callFake((key: string) => {
      delete mockLocalStorage[key];
    });

    TestBed.configureTestingModule({
      providers: [
        LocalStorageService,
        { provide: PLATFORM_ID, useValue: 'browser' }
      ]
    });
    
    service = TestBed.inject(LocalStorageService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should save test plan state', () => {
    const testState = {
      testPlanTitle: 'Test Plan',
      huList: [],
      repositoryLink: 'https://test.com',
      outOfScopeContent: 'Test',
      strategyContent: 'Test',
      limitationsContent: 'Test',
      assumptionsContent: 'Test',
      teamContent: 'Test',
      lastUpdated: new Date().toISOString()
    };

    service.saveTestPlanState(testState);
    expect(localStorage.setItem).toHaveBeenCalled();
  });

  it('should load test plan state', () => {
    const testState = {
      testPlanTitle: 'Test Plan',
      huList: [],
      repositoryLink: 'https://test.com',
      outOfScopeContent: 'Test',
      strategyContent: 'Test',
      limitationsContent: 'Test',
      assumptionsContent: 'Test',
      teamContent: 'Test',
      lastUpdated: new Date().toISOString()
    };

    mockLocalStorage['test-plan-generator-data'] = JSON.stringify(testState);
    
    const loaded = service.loadTestPlanState();
    expect(loaded).toBeTruthy();
    expect(loaded?.testPlanTitle).toBe('Test Plan');
  });

  it('should check if stored state exists', () => {
    expect(service.hasStoredState()).toBeFalse();
    
    mockLocalStorage['test-plan-generator-data'] = JSON.stringify({ huList: [] });
    expect(service.hasStoredState()).toBeTrue();
  });

  it('should clear stored state', () => {
    mockLocalStorage['test-plan-generator-data'] = 'test';
    service.clearTestPlanState();
    expect(localStorage.removeItem).toHaveBeenCalled();
  });
});
