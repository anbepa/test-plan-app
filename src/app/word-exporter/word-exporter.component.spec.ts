import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WordExporterComponent } from './word-exporter.component';

describe('WordExporterComponent', () => {
  let component: WordExporterComponent;
  let fixture: ComponentFixture<WordExporterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WordExporterComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WordExporterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
