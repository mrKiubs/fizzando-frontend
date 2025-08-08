import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GlossaryCardComponent } from './glossary-card.component';

describe('GlossaryCardComponent', () => {
  let component: GlossaryCardComponent;
  let fixture: ComponentFixture<GlossaryCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GlossaryCardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GlossaryCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
