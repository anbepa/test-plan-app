import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EvidenceAnalysisComponent } from './evidence-analysis.component';

describe('EvidenceAnalysisComponent', () => {
  let component: EvidenceAnalysisComponent;
  let fixture: ComponentFixture<EvidenceAnalysisComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EvidenceAnalysisComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EvidenceAnalysisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
