import { TestBed } from '@angular/core/testing';
import { fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AzureDevOpsIntegrationService } from './azure-devops-integration.service';
import { SupabaseClientService } from '../database/supabase-client.service';

describe('AzureDevOpsIntegrationService', () => {
  let service: AzureDevOpsIntegrationService;
  let httpMock: HttpTestingController;

  const supabaseMock = {
    supabase: {
      auth: {
        getSession: jasmine.createSpy('getSession').and.resolveTo({
          data: {
            session: {
              access_token: 'mock-token',
              expires_at: Math.floor(Date.now() / 1000) + 3600
            }
          }
        }),
        refreshSession: jasmine.createSpy('refreshSession').and.resolveTo({
          data: {
            session: {
              access_token: 'refreshed-token',
              expires_at: Math.floor(Date.now() / 1000) + 3600
            }
          },
          error: null
        })
      }
    }
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AzureDevOpsIntegrationService,
        { provide: SupabaseClientService, useValue: supabaseMock }
      ]
    });

    service = TestBed.inject(AzureDevOpsIntegrationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('debe enviar Authorization al guardar conexión', fakeAsync(() => {
    service.saveConnection({ organization: 'GrupoBancolombia', personalAccessToken: 'abc123' }).subscribe();
    flushMicrotasks();

    const req = httpMock.expectOne('/api/integrations/azure-devops/connections');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer mock-token');

    req.flush({
      id: 'uuid',
      organization: 'GrupoBancolombia',
      status: 'connected',
      tokenHint: '••••C123',
      lastValidatedAt: new Date().toISOString()
    });
    flushMicrotasks();
  }));

  it('debe enviar el ID en importación de HU', fakeAsync(() => {
    service.importUserStory(7632264).subscribe();
    flushMicrotasks();

    const req = httpMock.expectOne('/api/integrations/azure-devops/work-items/import');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ userStoryId: 7632264 });

    req.flush({
      id: 7632264,
      title: 'HU',
      nodeName: 'BRAINSTORM',
      sprint: 'Sprint 249',
      description: 'Desc',
      acceptanceCriteria: 'Crit'
    });
    flushMicrotasks();
  }));
});
