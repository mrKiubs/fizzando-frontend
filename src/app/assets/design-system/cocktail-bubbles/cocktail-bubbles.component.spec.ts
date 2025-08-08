import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CocktailBubblesComponent } from './cocktail-bubbles.component';

describe('CocktailBubblesComponent', () => {
  let component: CocktailBubblesComponent;
  let fixture: ComponentFixture<CocktailBubblesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CocktailBubblesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CocktailBubblesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
