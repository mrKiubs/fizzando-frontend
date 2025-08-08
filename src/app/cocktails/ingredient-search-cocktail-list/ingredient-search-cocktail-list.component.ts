import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { CocktailCardComponent } from '../../cocktails/cocktail-card/cocktail-card.component';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

import {
  CocktailService,
  Cocktail,
  CocktailWithLayoutAndMatch,
} from '../../services/strapi.service';
import {
  IngredientService,
  Ingredient,
} from '../../services/ingredient.service';
import { Subject, Subscription, Observable, of } from 'rxjs';
import {
  debounceTime,
  distinctUntilChanged,
  switchMap,
  map,
  startWith,
} from 'rxjs/operators';

import {
  trigger,
  state,
  style,
  transition,
  animate,
} from '@angular/animations';
import { env } from '../../config/env';

interface FaqItemState {
  isExpanded: boolean;
}

@Component({
  selector: 'app-ingredient-search-cocktail-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    CocktailCardComponent,
    RouterLink,
  ],
  templateUrl: './ingredient-search-cocktail-list.component.html',
  styleUrls: ['./ingredient-search-cocktail-list.component.scss'],
  animations: [
    trigger('faqAccordionAnimation', [
      state('void', style({ height: '0', opacity: 0, overflow: 'hidden' })),
      state(
        'collapsed',
        style({ height: '0', opacity: 0, overflow: 'hidden' })
      ),
      state('expanded', style({ height: '*', opacity: 1, overflow: 'hidden' })),
      transition('collapsed <=> expanded', [animate('0.3s ease-in-out')]),
      transition('void => expanded', [
        style({ height: '0', opacity: 0 }),
        animate('0.3s ease-in-out', style({ height: '*', opacity: 1 })),
      ]),
      transition('expanded => void', [
        style({ height: '*', opacity: 1 }),
        animate('0.3s ease-in-out', style({ height: '0', opacity: 0 })),
      ]),
    ]),
  ],
})
export class IngredientSearchCocktailListComponent
  implements OnInit, OnDestroy
{
  allIngredients: Ingredient[] = [];
  selectedIngredientIds: string[] = [];
  filteredIngredients: Ingredient[] = [];
  ingredientSearchTerm: string = '';

  perfectMatchCocktails: CocktailWithLayoutAndMatch[] = [];
  partialMatchCocktails: CocktailWithLayoutAndMatch[] = [];

  loadingIngredients = false;
  loadingCocktails = false;
  error: string | null = null;

  private ingredientsSearchTerms = new Subject<string>();
  private cocktailSearchTrigger = new Subject<string[]>();
  private subscriptions: Subscription[] = [];

  faqs: FaqItemState[] = [
    { isExpanded: false }, // FAQ 1 (index 0)
    { isExpanded: false }, // FAQ 2 (index 1)
    { isExpanded: false }, // FAQ 3 (index 2)
    { isExpanded: false }, // FAQ 4 (index 3)
    { isExpanded: false }, // FAQ 5 (index 4)
    { isExpanded: false }, // FAQ 6 (index 5)
    { isExpanded: false }, // FAQ 7 (index 6)
  ];

  constructor(
    private cocktailService: CocktailService,
    private ingredientService: IngredientService,
    private titleService: Title
  ) {}

  ngOnInit(): void {
    this.titleService.setTitle(
      'Find Cocktails by Ingredients | Your Home Bar | [Your App Name]'
    );
    this.loadAllIngredients();

    this.subscriptions.push(
      this.ingredientsSearchTerms
        .pipe(
          startWith(''),
          debounceTime(200),
          distinctUntilChanged(),
          map((term) => term.trim().toLowerCase()),
          map((term) =>
            term
              ? this.allIngredients.filter((ingredient) =>
                  ingredient.name.toLowerCase().startsWith(term)
                )
              : this.allIngredients
          )
        )
        .subscribe((ingredients) => {
          this.filteredIngredients = ingredients;
        })
    );

    this.subscriptions.push(
      this.cocktailSearchTrigger
        .pipe(
          debounceTime(300),
          distinctUntilChanged(
            (prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)
          ),
          switchMap((ids: string[]) => {
            console.log('--- cocktailSearchTrigger activated with IDs:', ids);
            console.log('--- switchMap received IDs length:', ids.length);
            this.loadingCocktails = true;
            this.perfectMatchCocktails = [];
            this.partialMatchCocktails = [];
            this.error = null;

            if (ids.length === 0) {
              this.loadingCocktails = false;
              return of({ perfect: [], partial: [] });
            }

            const allPossibleMatches$: Observable<
              CocktailWithLayoutAndMatch[]
            > = this.cocktailService.getCocktailsByIngredientIds(ids, false);

            return allPossibleMatches$.pipe(
              map((allMatches) => {
                const perfect: CocktailWithLayoutAndMatch[] = [];
                const partial: CocktailWithLayoutAndMatch[] = [];

                console.log(
                  '--- Processing allMatches. Expected ALL selected to be present (ids.length):',
                  ids.length
                );

                allMatches.forEach((cocktail) => {
                  const matchedCount = cocktail.matchedIngredientCount || 0;
                  console.log(
                    `Cocktail: ${cocktail.name}, Matched Selected Ingredients: ${matchedCount}, Cocktail Total Ingredients: ${cocktail.ingredients_list.length}`
                  );

                  // LOGICA PER "PERFECT MATCH":
                  // Un cocktail è un "perfect match" SE tutti i suoi ingredienti *richiesti dal cocktail*
                  // sono presenti tra gli ingredienti selezionati dall'utente (matchedCount === cocktail.ingredients_list.length).
                  // Se un cocktail ha N ingredienti e io ne ho selezionati N+X, ma tra questi N+X ci sono tutti gli N
                  // del cocktail, allora è un perfect match per quel cocktail.
                  if (matchedCount === cocktail.ingredients_list.length) {
                    perfect.push(this.addLayoutProps(cocktail, matchedCount)); // Non impostiamo isPartialMatch qui
                  } else {
                    if (matchedCount > 0) {
                      // È un "partial match" se almeno un ingrediente corrisponde
                      partial.push(this.addLayoutProps(cocktail, matchedCount)); // Non impostiamo isPartialMatch qui
                    }
                  }
                });

                perfect.sort((a, b) =>
                  (a.name || '').localeCompare(b.name || '')
                );

                partial.sort((a, b) => {
                  if (
                    (b.matchedIngredientCount || 0) !==
                    (a.matchedIngredientCount || 0)
                  ) {
                    return (
                      (b.matchedIngredientCount || 0) -
                      (a.matchedIngredientCount || 0)
                    );
                  }
                  return (a.name || '').localeCompare(b.name || '');
                });

                return { perfect, partial };
              })
            );
          })
        )
        .subscribe({
          next: ({ perfect, partial }) => {
            console.log('Cocktail search results received.');
            console.log(`Final Perfect Matches count: ${perfect.length}`);
            console.log(`Final Partial Matches count: ${partial.length}`);
            this.perfectMatchCocktails = perfect;
            this.partialMatchCocktails = partial;
            this.loadingCocktails = false;
          },
          error: (err: any) => {
            console.error('Error loading cocktails by ingredients:', err);
            this.error = 'Unable to load cocktails. Please try again.';
            this.loadingCocktails = false;
          },
        })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  loadAllIngredients(): void {
    this.loadingIngredients = true;
    this.ingredientService.getIngredients(1, 1000).subscribe({
      next: (res) => {
        this.allIngredients = res.data;
        this.filteredIngredients = res.data;
        this.loadingIngredients = false;
      },
      error: (err: any) => {
        console.error('Error loading ingredients:', err);
        this.error = 'Unable to load ingredients list.';
        this.loadingIngredients = false;
      },
    });
  }

  onIngredientSearchTermChange(): void {
    this.ingredientsSearchTerms.next(this.ingredientSearchTerm);
  }

  toggleIngredientSelection(ingredientExternalId: string): void {
    console.log('toggleIngredientSelection called for:', ingredientExternalId);
    const index = this.selectedIngredientIds.indexOf(ingredientExternalId);
    let updatedSelectedIds: string[];

    if (index > -1) {
      updatedSelectedIds = this.selectedIngredientIds.filter(
        (id) => id !== ingredientExternalId
      );
    } else {
      updatedSelectedIds = [
        ...this.selectedIngredientIds,
        ingredientExternalId,
      ];
    }

    this.selectedIngredientIds = updatedSelectedIds;

    console.log(
      'Current selectedIngredientIds (after update):',
      this.selectedIngredientIds
    );
    console.log(
      'Current selectedIngredientIds length (after update):',
      this.selectedIngredientIds.length
    );

    this.cocktailSearchTrigger.next(this.selectedIngredientIds);
    console.log('cocktailSearchTrigger.next() called.');
  }

  clearSelectedIngredients(): void {
    this.selectedIngredientIds = [];
    this.cocktailSearchTrigger.next([]);
    this.perfectMatchCocktails = [];
    this.partialMatchCocktails = [];
  }

  private addLayoutProps(
    cocktail: CocktailWithLayoutAndMatch,
    matchedCount?: number
  ): CocktailWithLayoutAndMatch {
    let isTall = cocktail.isTall || false;
    let isWide = cocktail.isWide || false;

    if (
      typeof cocktail.isTall === 'undefined' &&
      typeof cocktail.isWide === 'undefined'
    ) {
      const randomValue = Math.random();
      if (randomValue < 0.2) {
        isTall = true;
      } else if (randomValue < 0.35) {
        isWide = true;
      }
    }

    // NON impostiamo isPartialMatch qui. La logica del badge lo gestirà.
    return {
      ...cocktail,
      isTall,
      isWide,
      matchedIngredientCount: matchedCount,
    } as CocktailWithLayoutAndMatch;
  }

  getIngredientNameById(id: string): string {
    const ingredient = this.allIngredients.find((i) => i.external_id === id);
    return ingredient ? ingredient.name : id;
  }
  getIngredientById(id: string): Ingredient | undefined {
    return this.allIngredients.find((i) => i.external_id === id);
  }

  getIngredientImageUrlById(id: string): string {
    const ingredient = this.getIngredientById(id);
    if (ingredient && ingredient.image?.url) {
      if (ingredient.image.url.startsWith('http')) {
        return ingredient.image.url;
      }
      return env.apiUrl + ingredient.image.url;
    }
    return 'assets/no-image.png';
  }

  trackByIngredientId(index: number, ingredient: Ingredient): string {
    return ingredient.external_id;
  }

  trackByCocktailId(
    index: number,
    cocktail: CocktailWithLayoutAndMatch
  ): number {
    return cocktail.id;
  }

  toggleFaq(faqItem: FaqItemState): void {
    faqItem.isExpanded = !faqItem.isExpanded;
  }
}
