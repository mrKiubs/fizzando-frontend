import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Title } from '@angular/platform-browser';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import {
  trigger,
  state,
  style,
  transition,
  animate,
} from '@angular/animations';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, tap } from 'rxjs/operators';
import {
  CocktailService,
  Cocktail as BaseCocktail,
  CocktailWithLayoutAndMatch,
} from '../../services/strapi.service';
import { CocktailCardComponent } from '../cocktail-card/cocktail-card.component';
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';
import { AffiliateProductComponent } from '../../assets/design-system/affiliate-product/affiliate-product.component';

// Interfacce (rimangono invariate)
interface CocktailWithLayout extends BaseCocktail {
  isTall?: boolean;
  isWide?: boolean;
}

interface FaqItemState {
  isExpanded: boolean;
}

@Component({
  selector: 'app-cocktail-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    CocktailCardComponent,
    DevAdsComponent,
    RouterLink,
    AffiliateProductComponent,
  ],
  templateUrl: './cocktail-list.component.html',
  styleUrls: ['./cocktail-list.component.scss'],
  animations: [
    // La logica delle animazioni rimane invariata, puoi lasciarla così
    trigger('accordionAnimation', [
      state('closed', style({ height: '0', opacity: 0, overflow: 'hidden' })),
      state('open', style({ height: '*', opacity: 1, overflow: 'hidden' })),
      transition('closed <=> open', [animate('0.3s ease-out')]),
    ]),
    trigger('faqAccordionAnimation', [
      state(
        'collapsed',
        style({ height: '0', opacity: 0, overflow: 'hidden' })
      ),
      state('expanded', style({ height: '*', opacity: 1, overflow: 'hidden' })),
      transition('collapsed <=> expanded', [animate('0.3s ease-in-out')]),
    ]),
  ],
})
export class CocktailListComponent implements OnInit, OnDestroy {
  // --- Proprietà del Componente ---
  cocktails: CocktailWithLayoutAndMatch[] = [];
  loading = false;
  error: string | null = null;
  searchTerm: string = '';
  selectedCategory: string = '';
  selectedAlcoholic: string = '';
  currentPage: number = 1;
  pageSize: number = 20;
  totalItems: number = 0;
  totalPages: number = 0;
  isExpanded: boolean = false;
  isMobile: boolean = false;
  // Aggiungi una proprietà per il range di pagine nel paginatore
  readonly paginationRange = 2;

  // --- Dati statici (possono essere spostati in un servizio se necessario) ---
  categories: string[] = [
    'Classic',
    'Tropical',
    'Refreshing',
    'Aperitif',
    'After-Dinner',
    'Sour',
    'Spirit-Forward',
    'Sparkling',
    'Flaming',
    'Hot',
    'Other',
  ];
  alcoholicOptions: string[] = [
    'Alcoholic',
    'Non Alcoholic',
    'Optional Alcohol',
  ];

  faqs: FaqItemState[] = [
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
  ];

  productList = [
    {
      title: 'Libbey Mixologist 9-Piece Cocktail Set',
      imageUrl:
        'https://m.media-amazon.com/images/I/71MYEP67w2S._AC_SY879_.jpg',
      price: '$50.00',
      link: 'https://amzn.to/4fowM9o',
      showPlaceholder: true,
    },
    {
      title: 'Riedel Nick and Nora Cocktail Glasses, Set of 2',
      imageUrl:
        'https://m.media-amazon.com/images/I/61wIAjM9apL._AC_SX522_.jpg',
      price: '$45.00',
      link: 'https://www.amazon.com/Riedel-Nick-Nora-Cocktail-Glasses/dp/B07R8B7L1V',
      showPlaceholder: true,
    },
    {
      title: 'YARRAMATE 8Pcs 24oz Hybrid Insulated Cocktail Shaker',
      imageUrl:
        'https://m.media-amazon.com/images/I/71NZMAbpEjL._AC_SX679_.jpg',
      price: '$24.74',
      link: 'https://www.amazon.com/Cocktail-Codex-Fundamentals-Formulas-Evolutions/dp/1607749714',
      showPlaceholder: true,
    },
    {
      title: 'Bartesian Professional Cocktail Machine',
      imageUrl:
        'https://m.media-amazon.com/images/I/81YFuyY5xVL._AC_SX679_.jpg',
      price: '$269.99',
      link: 'https://www.amazon.com/Bartesian-Premium-Cocktail-Machine-Drinks/dp/B07T435M1S',
      showPlaceholder: true,
    },
    {
      title: 'BARE BARREL® Mixology Bartender Kit Bar Set',
      imageUrl:
        'https://m.media-amazon.com/images/I/81L4vmLO+KL._AC_SX679_.jpg',
      price: '$39.95',
      link: 'https://www.amazon.com/Hella-Cocktail-Co-Bitters-Variety/dp/B08V5QY3Q7',
      showPlaceholder: true,
    },
  ];

  productListRobot = [
    {
      title: 'Bartesian Professional Cocktail Machine',
      imageUrl:
        'https://m.media-amazon.com/images/I/71cC176W+mL._AC_SX679_.jpg',
      price: '$50.00',
      link: 'https://amzn.to/4fowM9o',
      showPlaceholder: true,
    },
    {
      title: 'Ninja SLUSHi with RapidChill Technology',
      imageUrl:
        'https://m.media-amazon.com/images/I/71+w3aZtRjL._AC_SX679_.jpg',
      price: '$45.00',
      link: 'https://www.amazon.com/Riedel-Nick-Nora-Cocktail-Glasses/dp/B07R8B7L1V',
      showPlaceholder: true,
    },
    {
      title: 'U-Taste Frozen Drink Slushie Machine',
      imageUrl:
        'https://m.media-amazon.com/images/I/81yHM6bY8FL._AC_SX679_.jpg',
      price: '$24.74',
      link: 'https://www.amazon.com/Cocktail-Codex-Fundamentals-Formulas-Evolutions/dp/1607749714',
      showPlaceholder: true,
    },
    {
      title: 'Cordless Cocktail Making Machine',
      imageUrl:
        'https://m.media-amazon.com/images/I/61wQXalBIiL._AC_SX679_.jpg',
      price: '$269.99',
      link: 'https://www.amazon.com/Bartesian-Premium-Cocktail-Machine-Drinks/dp/B07T435M1S',
      showPlaceholder: true,
    },
    {
      title: 'bev by BLACK+DECKER Cocktail Machine and Drink Maker',
      imageUrl:
        'https://m.media-amazon.com/images/I/71BVCgOXD0L._AC_SX679_.jpg',
      price: '$39.95',
      link: 'https://www.amazon.com/Hella-Cocktail-Co-Bitters-Variety/dp/B08V5QY3Q7',
      showPlaceholder: true,
    },
  ];
  // --- Subject e Subscriptions per gestire la logica reattiva ---
  private searchTerms = new Subject<string>();
  private subscriptions = new Subscription();

  constructor(
    private cocktailService: CocktailService,
    private titleService: Title,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.checkScreenWidth();
  }

  // --- Lifecycle Hooks ---
  ngOnInit(): void {
    this.titleService.setTitle(
      'Cocktail Explorer: Recipes, Ingredients & Guides | [Your App Name]'
    );

    // Unifica le sottoscrizioni per una gestione più semplice in ngOnDestroy
    this.subscriptions.add(
      this.route.queryParams.subscribe((params) => {
        // Estrai i parametri dalla URL e aggiorna lo stato del componente
        this.searchTerm = params['search'] || '';
        this.selectedCategory = params['category'] || '';
        this.selectedAlcoholic = params['alcoholic'] || '';
        this.currentPage = parseInt(params['page']) || 1;
        this.loadCocktails();
      })
    );

    this.subscriptions.add(
      this.searchTerms
        .pipe(debounceTime(300), distinctUntilChanged())
        .subscribe(() => {
          // Naviga con i nuovi parametri di ricerca, resettando la pagina a 1
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { search: this.searchTerm || null, page: 1 },
            queryParamsHandling: 'merge',
          });
        })
    );
  }

  ngOnDestroy(): void {
    // De-sottoscrizione pulita
    this.subscriptions.unsubscribe();
  }

  // --- Metodi per la gestione dei dati e della UI ---
  // All'interno della classe CocktailListComponent

  // All'interno della classe CocktailListComponent

  // All'interno della classe CocktailListComponent

  loadCocktails(): void {
    this.loading = true;
    this.error = null;
    this.cocktails = [];

    this.cocktailService
      .getCocktails(
        this.currentPage,
        this.pageSize,
        this.searchTerm,
        this.selectedCategory,
        this.selectedAlcoholic
      )
      .subscribe({
        next: (res) => {
          // Controllo robusto per i dati
          if (
            res &&
            res.data &&
            Array.isArray(res.data) &&
            res.data.length > 0
          ) {
            // Mappa i cocktail aggiungendo le proprietà di layout e di matching.
            // Questa riga è FONDAMENTALE per far funzionare il componente figlio.
            this.cocktails = res.data.map((cocktail) => {
              const randomValue = Math.random();
              const isTall = randomValue < 0.2;
              const isWide = !isTall && randomValue < 0.35;
              return {
                ...cocktail,
                isTall,
                isWide,
                matchedIngredientCount: 0, // Valore di default
              } as CocktailWithLayoutAndMatch;
            });

            this.totalItems = res.meta.pagination.total;
            this.totalPages = res.meta.pagination.pageCount;
          } else {
            this.cocktails = [];
            this.totalItems = 0;
            this.totalPages = 0;
          }

          this.loading = false;
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        error: (err: any) => {
          this.error = 'Impossibile caricare i cocktail. Riprova più tardi.';
          this.loading = false;
          this.totalItems = 0;
          this.totalPages = 0;
          this.cocktails = [];
        },
      });
  }

  onSearchTermChange(): void {
    this.searchTerms.next(this.searchTerm);
  }

  applyFilters(): void {
    // Naviga con tutti i filtri, resettando la pagina a 1
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        category: this.selectedCategory || null,
        alcoholic: this.selectedAlcoholic || null,
        search: this.searchTerm || null,
        page: 1,
      },
      queryParamsHandling: 'merge',
    });
  }

  clearFilters(): void {
    // Resetta le proprietà locali
    this.searchTerm = '';
    this.selectedCategory = '';
    this.selectedAlcoholic = '';
    this.searchTerms.next('');

    // Naviga rimuovendo tutti i filtri dall'URL
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        category: null,
        alcoholic: null,
        search: null,
        page: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  goToPage(page: number): void {
    // Assicurati che il numero di pagina sia valido
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { page },
        queryParamsHandling: 'merge',
      });
    }
  }

  trackByCocktailId(index: number, cocktail: CocktailWithLayout): number {
    return cocktail.id;
  }

  toggleExpansion(): void {
    this.isExpanded = !this.isExpanded;
  }

  toggleFaq(faqItem: FaqItemState): void {
    faqItem.isExpanded = !faqItem.isExpanded;
  }

  getActiveFiltersText(): string {
    const activeFilters: string[] = [];
    if (this.searchTerm) activeFilters.push(`"${this.searchTerm}"`);
    if (this.selectedCategory) activeFilters.push(this.selectedCategory);
    if (this.selectedAlcoholic) activeFilters.push(this.selectedAlcoholic);
    return activeFilters.length > 0
      ? activeFilters.join(', ')
      : 'No filters active';
  }

  // --- Metodi per il Paginatore avanzato ---
  getVisiblePages(): number[] {
    const pages = [];
    const startPage = Math.max(2, this.currentPage - this.paginationRange);
    const endPage = Math.min(
      this.totalPages - 1,
      this.currentPage + this.paginationRange
    );

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }
    return pages;
  }

  showFirstPage(): boolean {
    return this.totalPages > 1 && this.currentPage > this.paginationRange;
  }

  showFirstEllipsis(): boolean {
    return this.totalPages > 1 && this.currentPage > this.paginationRange + 1;
  }

  showLastEllipsis(): boolean {
    return (
      this.totalPages > 1 &&
      this.currentPage < this.totalPages - this.paginationRange
    );
  }

  showLastPage(): boolean {
    return (
      this.totalPages > 1 &&
      this.currentPage < this.totalPages - this.paginationRange + 1
    );
  }

  // --- Gestione della reattività dello schermo ---
  @HostListener('window:resize', ['$event'])
  onResize(): void {
    this.checkScreenWidth();
  }

  checkScreenWidth(): void {
    this.isMobile = window.innerWidth <= 600;
  }
}
