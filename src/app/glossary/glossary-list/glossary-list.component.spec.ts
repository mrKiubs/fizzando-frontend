import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GlossaryListComponent } from './glossary-list.component';

describe('GlossaryListComponent', () => {
  let component: GlossaryListComponent;
  let fixture: ComponentFixture<GlossaryListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GlossaryListComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GlossaryListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
