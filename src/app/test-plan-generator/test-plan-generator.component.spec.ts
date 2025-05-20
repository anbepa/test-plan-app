import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TestPlanGeneratorComponent } from './test-plan-generator.component';

describe('TestPlanGeneratorComponent', () => {
  let component: TestPlanGeneratorComponent;
  let fixture: ComponentFixture<TestPlanGeneratorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestPlanGeneratorComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TestPlanGeneratorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
