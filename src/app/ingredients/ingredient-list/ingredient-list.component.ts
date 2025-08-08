import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IngredientService,
  Ingredient,
} from '../../services/ingredient.service';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Title } from '@angular/platform-browser';
import { Router, ActivatedRoute } from '@angular/router';

import { IngredientCardComponent } from '../ingredient-card/ingredient-card.component';

import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import {
  trigger,
  state,
  style,
  transition,
  animate,
} from '@angular/animations';

interface FaqItemState {
  isExpanded: boolean;
}

@Component({
  selector: 'app-ingredient-list',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, IngredientCardComponent],
  templateUrl: './ingredient-list.component.html',
  styleUrls: ['./ingredient-list.component.scss'],
  animations: [
    trigger('accordionAnimation', [
      state(
        'void',
        style({
          height: '0',
          opacity: 0,
          overflow: 'hidden',
        })
      ),
      state(
        'closed',
        style({
          height: '0',
          opacity: 0,
          overflow: 'hidden',
        })
      ),
      state(
        'open',
        style({
          height: '*',
          opacity: 1,
          overflow: 'hidden',
        })
      ),
      transition('closed => open', [
        style({ height: '0', opacity: 0 }),
        animate('0.3s ease-out', style({ height: '*', opacity: 1 })),
      ]),
      transition('open => closed', [
        style({ height: '*', opacity: 1 }),
        animate('0.3s ease-out', style({ height: '0', opacity: 0 })),
      ]),
      transition('void => open', [
        style({ height: '0', opacity: 0 }),
        animate('0.3s ease-out', style({ height: '*', opacity: 1 })),
      ]),
      transition('open => void', [
        style({ height: '*', opacity: 1 }),
        animate('0.3s ease-out', style({ height: '0', opacity: 0 })),
      ]),
    ]),
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
export class IngredientListComponent implements OnInit, OnDestroy {
  ingredients: Ingredient[] = [];
  loading = false;
  error: string | null = null;

  searchTerm: string = '';
  selectedAlcoholicFilter: string = ''; // Questo sarà 'true', 'false' o ''
  selectedIngredientType: string = ''; // Nuovo filtro per ingredient_type

  currentPage: number = 1;
  pageSize: number = 20;
  totalItems: number = 0;

  pageSizeOptions: number[] = [10, 20, 50, 100];

  alcoholicOptions: { value: string; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'true', label: 'Alcoholic' },
    { value: 'false', label: 'Non-Alcoholic' },
  ];

  // AGGIORNATO: Ora questi valori corrispondono ESATTAMENTE (case-sensitive) a quelli della tua enumerazione 'ingredient_type' in Strapi
  ingredientTypes: { value: string; label: string }[] = [
    { value: '', label: 'All Types' },
    { value: 'Spirits', label: 'Spirits' },
    { value: 'Liqueurs & Cordials', label: 'Liqueurs & Cordials' },
    { value: 'Wines & Fortified Wines', label: 'Wines & Fortified Wines' },
    { value: 'Bitters', label: 'Bitters' },
    { value: 'Syrups & Sweeteners', label: 'Syrups & Sweeteners' },
    { value: 'Citrus Juices', label: 'Citrus Juices' },
    { value: 'Fruit Juices (Non-Citrus)', label: 'Fruit Juices (Non-Citrus)' },
    { value: 'Carbonated Mixers', label: 'Carbonated Mixers' },
    { value: 'Non-Carbonated Mixers', label: 'Non-Carbonated Mixers' },
    { value: 'Fresh Herbs & Botanicals', label: 'Fresh Herbs & Botanicals' },
    { value: 'Spices', label: 'Spices' },
    {
      value: 'Fresh Fruits (Solid/Garnish)',
      label: 'Fresh Fruits (Solid/Garnish)',
    },
    { value: 'Vegetables (Non-Herb)', label: 'Vegetables (Non-Herb)' },
    { value: 'Dairy & Eggs', label: 'Dairy & Eggs' },
    {
      value: 'Other Extracts & Flavorings',
      label: 'Other Extracts & Flavorings',
    },
    {
      value: 'Salts & Sugars (Rimming/Specialty)',
      label: 'Salts & Sugars (Rimming/Specialty)',
    },
    { value: 'Miscellaneous', label: 'Miscellaneous' },
  ];

  isExpanded: boolean = false;

  private searchTerms = new Subject<string>();
  private searchSubscription: Subscription | undefined;
  private queryParamsSubscription: Subscription | undefined;

  faqs: FaqItemState[] = [
    { isExpanded: false }, // FAQ 1
    { isExpanded: false }, // FAQ 2
    { isExpanded: false }, // FAQ 3
    { isExpanded: false }, // FAQ 4
    { isExpanded: false }, // FAQ 5
    { isExpanded: false }, // FAQ 6
  ];

  constructor(
    private ingredientService: IngredientService,
    private titleService: Title,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.titleService.setTitle(
      'Cocktail Ingredients List: Discover & Explore | [Your App Name]'
    );

    this.queryParamsSubscription = this.route.queryParams.subscribe(
      (params) => {
        const urlSearchTerm = params['search'] || '';
        const urlAlcoholic = params['alcoholic'] || '';
        const urlIngredientType = params['type'] || '';

        this.searchTerm = urlSearchTerm;

        this.selectedAlcoholicFilter = ['true', 'false'].includes(
          urlAlcoholic.toLowerCase()
        )
          ? urlAlcoholic.toLowerCase()
          : '';

        // Normalizza il valore di 'type' dall'URL per farlo corrispondere alle opzioni della select
        // Questo cerca una corrispondenza case-insensitive dall'URL all'array ingredientTypes
        // ma poi imposta il valore esatto (case-sensitive) per la selezione
        this.selectedIngredientType =
          this.ingredientTypes.find(
            (type) =>
              type.value.toLowerCase() === urlIngredientType.toLowerCase()
          )?.value || '';

        console.log('IngredientListComponent: Filter values from URL:', {
          searchTerm: this.searchTerm,
          selectedAlcoholicFilter: this.selectedAlcoholicFilter,
          selectedIngredientType: this.selectedIngredientType,
        });

        this.currentPage = 1;
        this.loadIngredients(true);
      }
    );

    this.searchSubscription = this.searchTerms
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { search: this.searchTerm || null },
          queryParamsHandling: 'merge',
        });
      });
  }

  ngOnDestroy(): void {
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
    }
    if (this.queryParamsSubscription) {
      this.queryParamsSubscription.unsubscribe();
    }
  }

  loadIngredients(resetResults: boolean = false) {
    this.loading = true;
    this.error = null;

    let isAlcoholic: boolean | undefined;
    if (this.selectedAlcoholicFilter === 'true') {
      isAlcoholic = true;
    } else if (this.selectedAlcoholicFilter === 'false') {
      isAlcoholic = false;
    } else {
      isAlcoholic = undefined;
    }

    console.log('IngredientListComponent: Calling getIngredients with:', {
      page: this.currentPage,
      pageSize: this.pageSize,
      searchTerm: this.searchTerm,
      isAlcoholic: isAlcoholic,
      ingredientType: this.selectedIngredientType, // Questo è il valore esatto di Strapi
    });

    this.ingredientService
      .getIngredients(
        this.currentPage,
        this.pageSize,
        this.searchTerm,
        isAlcoholic,
        this.selectedIngredientType // Passa il valore esatto di Strapi
      )
      .subscribe({
        next: (res) => {
          if (resetResults) {
            this.ingredients = [];
          }
          this.ingredients = [...this.ingredients, ...res.data];

          this.totalItems = res.meta.pagination.total;
          this.loading = false;
          console.log(
            'IngredientListComponent: Ingredients loaded successfully.',
            res.data
          );
        },
        error: (err) => {
          console.error('Error loading ingredients:', err);
          this.error =
            'Unable to load ingredients. Please try again later. ' +
            err.message;
          this.loading = false;
        },
      });
  }

  onSearchTermChange(): void {
    this.searchTerms.next(this.searchTerm);
  }

  applyFilters() {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        alcoholic: this.selectedAlcoholicFilter || null,
        type: this.selectedIngredientType || null,
        search: this.searchTerm || null,
      },
      queryParamsHandling: 'merge',
    });
  }

  clearFilters() {
    this.searchTerm = '';
    this.selectedAlcoholicFilter = '';
    this.selectedIngredientType = '';
    this.searchTerms.next('');

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        alcoholic: null,
        type: null,
        search: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  loadMore(): void {
    if (!this.loading && this.ingredients.length < this.totalItems) {
      this.currentPage++;
      this.loadIngredients(false);
    }
  }

  trackById(index: number, ingredient: Ingredient): number {
    return ingredient.id;
  }

  toggleExpansion(): void {
    this.isExpanded = !this.isExpanded;
  }

  toggleFaq(faqItem: FaqItemState): void {
    faqItem.isExpanded = !faqItem.isExpanded;
  }

  getActiveFiltersText(): string {
    const activeFilters: string[] = [];

    if (this.searchTerm) {
      activeFilters.push(`"${this.searchTerm}"`);
    }
    if (this.selectedAlcoholicFilter === 'true') {
      activeFilters.push('Alcoholic');
    } else if (this.selectedAlcoholicFilter === 'false') {
      activeFilters.push('Non-Alcoholic');
    }
    if (this.selectedIngredientType) {
      const selectedTypeLabel = this.ingredientTypes.find(
        (type) => type.value === this.selectedIngredientType
      )?.label;
      if (selectedTypeLabel) {
        activeFilters.push(selectedTypeLabel);
      }
    }

    if (activeFilters.length > 0) {
      return activeFilters.join(', ');
    } else {
      return 'No filters active';
    }
  }

  get nextLoadAmount(): number {
    return Math.min(this.pageSize, this.totalItems - this.ingredients.length);
  }
}
