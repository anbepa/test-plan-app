import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TestCaseGeneratorComponent } from './test-case-generator.component';

describe('TestCaseGeneratorComponent', () => {
  let component: TestCaseGeneratorComponent;
  let fixture: ComponentFixture<TestCaseGeneratorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestCaseGeneratorComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TestCaseGeneratorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
