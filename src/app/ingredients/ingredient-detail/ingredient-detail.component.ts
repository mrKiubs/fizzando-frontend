import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IngredientService,
  Ingredient,
  Article, // Importa l'interfaccia Article
} from '../../services/ingredient.service'; // Assicurati che il percorso sia corretto
import { CocktailService, Cocktail } from '../../services/strapi.service'; // Assicurati che il percorso sia corretto
import { MatIconModule } from '@angular/material/icon';
import { CocktailCardComponent } from '../../cocktails/cocktail-card/cocktail-card.component';
import { Subscription } from 'rxjs';
import { FormatAbvPipe } from '../../assets/pipes/format-abv.pipe';
import { env } from '../../config/env';

// L'interfaccia IngredientDetail estende Ingredient e include i cocktail correlati
export interface IngredientDetail extends Ingredient {
  relatedCocktails?: Cocktail[];
}

@Component({
  selector: 'app-ingredient-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    CocktailCardComponent,
    RouterLink,
    FormatAbvPipe,
  ],
  templateUrl: './ingredient-detail.component.html',
  styleUrls: ['./ingredient-detail.component.scss'],
})
export class IngredientDetailComponent implements OnInit, OnDestroy {
  ingredient: IngredientDetail | null = null;
  loading = true;
  error: string | null = null;

  allIngredients: Ingredient[] = [];
  currentIngredientIndex: number = -1;
  previousIngredient: {
    externalId: string;
    name: string;
    imageUrl: string;
  } | null = null;
  nextIngredient: {
    externalId: string;
    name: string;
    imageUrl: string;
  } | null = null;

  private routeSubscription: Subscription | undefined;
  private allIngredientsSubscription: Subscription | undefined;
  private relatedCocktailsSubscription: Subscription | undefined;

  constructor(
    private route: ActivatedRoute,
    private ingredientService: IngredientService,
    private cocktailService: CocktailService
  ) {}

  ngOnInit(): void {
    // Carica tutti gli ingredienti (usando la cache del servizio se disponibile)
    // Non passiamo filtri qui per assicurarci di avere la lista completa per la navigazione
    this.allIngredientsSubscription = this.ingredientService
      .getIngredients(1, 1000, undefined, undefined, undefined, true) // `true` per abilitare la cache, `undefined` per i filtri
      .subscribe({
        next: (response) => {
          this.allIngredients = response.data; // allIngredients è già ordinato alfabeticamente dal servizio
          this.subscribeToRouteParams();
        },
        error: (err: any) => {
          console.error('Error loading all ingredients for navigation:', err);
          this.error = 'Could not load navigation data for ingredients.';
          this.loading = false;
          this.subscribeToRouteParams(); // Tenta comunque di caricare il dettaglio
        },
      });
  }

  ngOnDestroy(): void {
    if (this.routeSubscription) {
      this.routeSubscription.unsubscribe();
    }
    if (this.allIngredientsSubscription) {
      this.allIngredientsSubscription.unsubscribe();
    }
    if (this.relatedCocktailsSubscription) {
      this.relatedCocktailsSubscription.unsubscribe();
    }
  }

  private subscribeToRouteParams(): void {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const externalId = params.get('externalId');
      if (externalId) {
        this.loadIngredientDetailsFromCache(externalId);
      } else {
        this.error = 'Ingredient ID not provided.';
        this.loading = false;
      }
    });
  }

  loadIngredientDetailsFromCache(externalId: string): void {
    this.loading = true;
    this.error = null;

    const foundIngredient = this.allIngredients.find(
      (i) => i.external_id === externalId
    );

    if (foundIngredient) {
      this.ingredient = { ...foundIngredient }; // Clona l'oggetto per sicurezza
      this.setNavigationIngredients(externalId);

      // Carica i cocktail correlati (questa chiamata è ancora necessaria, poiché non sono in allIngredients)
      this.relatedCocktailsSubscription = this.cocktailService
        .getRelatedCocktailsForIngredient(externalId)
        .subscribe({
          next: (relatedCocktailsData) => {
            if (this.ingredient) {
              this.ingredient.relatedCocktails = relatedCocktailsData;
            }
            this.loading = false;
          },
          error: (cocktailError) => {
            console.error('Error fetching related cocktails:', cocktailError);
            this.error = 'Could not load related cocktails.';
            this.loading = false;
          },
        });
    } else {
      console.warn(
        `Ingredient with external ID '${externalId}' not found in cached list. Attempting direct fetch.`
      );
      // Fallback: Se l'ingrediente non è nella cache (es. se la lista completa non si è caricata o l'ID è sbagliato)
      // Fai una chiamata API specifica come ultima risorsa.
      this.ingredientService.getIngredientByExternalId(externalId).subscribe({
        next: (directFetchedIngredient) => {
          if (directFetchedIngredient) {
            this.ingredient = directFetchedIngredient as IngredientDetail; // Cast per includere relatedCocktails
            this.setNavigationIngredients(externalId); // Tenta di impostare la navigazione anche con un singolo ingrediente
            // Fetch dei cocktail correlati anche qui, se l'ingrediente è stato caricato direttamente
            this.relatedCocktailsSubscription = this.cocktailService
              .getRelatedCocktailsForIngredient(externalId)
              .subscribe({
                next: (relatedCocktailsData) => {
                  if (this.ingredient) {
                    this.ingredient.relatedCocktails = relatedCocktailsData;
                  }
                  this.loading = false;
                },
                error: (cocktailError) => {
                  console.error(
                    'Error fetching related cocktails (direct fetch):',
                    cocktailError
                  );
                  this.error = 'Could not load related cocktails.';
                  this.loading = false;
                },
              });
          } else {
            this.error = 'Ingredient not found.';
            this.loading = false;
          }
        },
        error: (err) => {
          console.error('Error fetching ingredient directly:', err);
          this.error = 'Unable to load ingredient details.';
          this.loading = false;
        },
      });
    }
  }

  setNavigationIngredients(currentExternalId: string): void {
    if (!this.allIngredients || this.allIngredients.length === 0) {
      console.warn(
        'allIngredients is not yet populated, navigation might be incomplete.'
      );
      return;
    }

    this.currentIngredientIndex = this.allIngredients.findIndex(
      (i) => i.external_id === currentExternalId
    );

    this.previousIngredient = null;
    this.nextIngredient = null;

    if (this.currentIngredientIndex > 0) {
      const prev = this.allIngredients[this.currentIngredientIndex - 1];
      this.previousIngredient = {
        externalId: prev.external_id,
        name: prev.name,
        imageUrl: this.getIngredientImageUrl(prev),
      };
    }

    if (this.currentIngredientIndex < this.allIngredients.length - 1) {
      const next = this.allIngredients[this.currentIngredientIndex + 1];
      this.nextIngredient = {
        externalId: next.external_id,
        name: next.name,
        imageUrl: this.getIngredientImageUrl(next),
      };
    }
  }

  goBack(): void {
    window.history.back();
  }

  getIngredientImageUrl(ingredient: Ingredient | undefined): string {
    if (ingredient && ingredient.image?.url) {
      if (ingredient.image.url.startsWith('http')) {
        return ingredient.image.url;
      }
      return env.apiUrl + ingredient.image.url;
    }
    return 'assets/no-image.png';
  }

  getRelatedCocktailImageUrl(cocktail: Cocktail): string {
    if (cocktail.image?.url) {
      if (cocktail.image.url.startsWith('http')) {
        return cocktail.image.url;
      }
      return env.apiUrl + cocktail.image.url;
    }
    return 'assets/no-image.png';
  }

  trackByCocktailId(index: number, cocktail: Cocktail): number {
    return cocktail.id;
  }
}
