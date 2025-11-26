import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TestCaseRefinerComponent } from './test-case-refiner.component';

describe('TestCaseRefinerComponent', () => {
  let component: TestCaseRefinerComponent;
  let fixture: ComponentFixture<TestCaseRefinerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestCaseRefinerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TestCaseRefinerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
