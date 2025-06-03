import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FlowComparisonComponent } from './flow-comparison.component';

describe('FlowComparisonComponent', () => {
  let component: FlowComparisonComponent;
  let fixture: ComponentFixture<FlowComparisonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlowComparisonComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FlowComparisonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
