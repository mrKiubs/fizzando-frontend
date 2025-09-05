import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CreditsComponentComponent } from './credits-component.component';

describe('CreditsComponentComponent', () => {
  let component: CreditsComponentComponent;
  let fixture: ComponentFixture<CreditsComponentComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreditsComponentComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CreditsComponentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
