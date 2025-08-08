import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IngredientSearchCocktailListComponent } from './ingredient-search-cocktail-list.component';

describe('IngredientSearchCocktailListComponent', () => {
  let component: IngredientSearchCocktailListComponent;
  let fixture: ComponentFixture<IngredientSearchCocktailListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IngredientSearchCocktailListComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IngredientSearchCocktailListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
