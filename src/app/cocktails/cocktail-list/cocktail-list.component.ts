// src/app/cocktails/cocktail-list/cocktail-list.component.ts
import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  inject,
  PLATFORM_ID,
  NgZone,
  Renderer2,
  signal,
} from '@angular/core';
import { isPlatformBrowser, CommonModule, DOCUMENT } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Title, Meta } from '@angular/platform-browser';
import {
  Router,
  ActivatedRoute,
  RouterLink,
  RouterLinkActive,
} from '@angular/router';
import { combineLatest } from 'rxjs';

import {
  CocktailService,
  Cocktail as BaseCocktail,
  CocktailWithLayoutAndMatch,
} from '../../services/strapi.service';

import { CocktailCardComponent } from '../cocktail-card/cocktail-card.component';
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';
import { AffiliateProductComponent } from '../../assets/design-system/affiliate-product/affiliate-product.component';
import { env } from '../../config/env';

// --- Interfacce ---
interface CocktailWithLayout extends BaseCocktail {
  isTall?: boolean;
  isWide?: boolean;
}
interface FaqItemState {
  isExpanded: boolean;
}
interface ProductItem {
  title: string;
  imageUrl: string;
  price: string;
  link: string;
  showPlaceholder: boolean;
}

@Component({
  selector: 'app-cocktail-list',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    RouterLink,
    CocktailCardComponent,
    DevAdsComponent,
    AffiliateProductComponent,
    RouterLinkActive,
    FacetChipsComponent,
  ],
  templateUrl: './cocktail-list.component.html',
  styleUrls: ['./cocktail-list.component.scss'],
})
export class CocktailListComponent implements OnInit, OnDestroy {
  // --- SSR / Browser env ---
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly ngZone = inject(NgZone);
  private readonly renderer = inject(Renderer2);
  private readonly doc = inject(DOCUMENT) as Document;

  // — Hub state
  hubKind: 'root' | 'method' | 'glass' | 'category' | 'alcoholic' = 'root';
  hubSlug = '';

  get hubLabel(): string {
    if (this.hubKind === 'method') return this.unslugify(this.hubSlug);
    if (this.hubKind === 'glass') return this.unslugify(this.hubSlug);
    if (this.hubKind === 'category') return this.unslugify(this.hubSlug);
    if (this.hubKind === 'alcoholic') return this.unslugify(this.hubSlug);
    return '';
  }
  get hubTitle(): string {
    switch (this.hubKind) {
      case 'method':
        return `${this.hubLabel} Cocktails`;
      case 'glass':
        return `${this.hubLabel} Glass Cocktails`;
      case 'category':
        return `${this.hubLabel} Cocktails`;
      case 'alcoholic':
        return `${this.hubLabel} Cocktails`;
      default:
        return 'Cocktails Explorer';
    }
  }
  get hubSubtitle(): string {
    if (this.hubKind === 'root')
      return 'Your Ultimate Cocktail Guide: Search, Filter, and Discover New Drinks';
    return 'Browse hand-picked recipes in this hub and jump to related filters.';
  }

  private siteBaseUrl = '';

  // Riferimenti ai <script> JSON-LD per cleanup
  private itemListSchemaScript?: HTMLScriptElement;
  private collectionSchemaScript?: HTMLScriptElement;
  private breadcrumbsSchemaScript?: HTMLScriptElement;
  private faqSchemaScript?: HTMLScriptElement;

  fontsLoaded = false;

  // --- Stato (signals) ---
  private _searchTerm = signal<string>('');
  private _selectedCategory = signal<string>('');
  private _selectedAlcoholic = signal<string>('');
  private _selectedLetter = signal<string>(''); // ⭐ nuovo
  private _isExpanded = signal<boolean>(false);

  // esposizione al template
  searchTerm = this._searchTerm;
  selectedCategory = this._selectedCategory;
  selectedAlcoholic = this._selectedAlcoholic;
  selectedLetter = this._selectedLetter; // ⭐ nuovo
  isExpanded = this._isExpanded;

  // === Page headings (bind nel template) ===
  public pageH1 = '';
  public pageH2 = '';
  public pageDescription = '';

  // Barra lettere
  letters: string[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  readonly numberKey = '0-9';

  // Disponibilità lettere (riempito lazy)
  availableLetters = new Set<string>();
  letterAvailabilityLoaded = false;

  // freeze/scroll mgmt
  private frozenY = 0;
  private isScrollFrozen = false;
  private lastScrollYBeforeNav = 0;
  private prevScrollBehavior = '';
  private listHeightLocked = false;
  private preventTouchMove = (e: TouchEvent) => e.preventDefault();

  private readonly isIOS =
    this.isBrowser && /iP(ad|hone|od)/i.test(navigator.userAgent);
  private readonly isAndroid =
    this.isBrowser && /Android/i.test(navigator.userAgent);
  private get freezeSafe(): boolean {
    return !(this.isIOS || this.isAndroid);
  }

  // setter helper + debounce search
  setSearch = (v: string) => {
    this._searchTerm.set(v);
    this.debounceNavigateForSearch();
  };
  setCategory = (v: string) => this._selectedCategory.set(v);
  setAlcoholic = (v: string) => this._selectedAlcoholic.set(v);
  toggleExpansion = () => this._isExpanded.update((v) => !v);

  // --- Lista/Pagination ---
  cocktails: CocktailWithLayoutAndMatch[] = [];
  loading = false;
  error: string | null = null;
  currentPage = 1;
  pageSize = 20;
  totalItems = 0;
  totalPages = 0;
  isMobile = false;
  readonly paginationRange = 2;

  hubMethods = [
    'Built in Glass',
    'Shaken',
    'Stirred',
    'Blended',
    'Other',
    'Layered',
    'Muddled',
    'Built in Punch Bowl',
    'Heated',
    'Infusion & Aging',
    'Bomb Shot',
  ];
  hubGlasses = [
    'Cocktail Glass',
    'Highball Glass',
    'Collins Glass',
    'Old Fashioned Glass',
    'Shot Glass',
    'Coffee Mug',
    'Whiskey Sour Glass',
    'Hurricane Glass',
    'Punch Bowl',
    'Wine Glass',
    'Champagne Flute',
    'Irish Coffee Glass',
    'Pint Glass',
    'Beer Glass',
    'Pitcher',
    'Beer Mug',
    'Margarita Glass',
    'Mason Jar',
    'Balloon Glass',
    'Coupe Glass',
    'Cordial Glass',
    'Brandy Snifter',
    'Nick & Nora Glass',
    'Julep Cup',
    'Copper Mug',
  ];
  hubCategories = [
    'Refreshing',
    'After-Dinner',
    'Sour',
    'Tropical',
    'Spirit-Forward',
    'Classic',
    'Hot',
    'Aperitif',
    'Sparkling',
    'Flaming',
    'Punch',
    'Shot',
    'Beer',
    'Aromatic',
    'Homemade Liqueur',
  ];

  // --- CONTATORI (slug -> totale)
  methodCounts: Record<string, number> = {};
  glassCounts: Record<string, number> = {};
  categoryCounts: Record<string, number> = {};
  private countsLoaded = false;

  // helper per una singola conta
  private countFor(
    kind: 'method' | 'glass' | 'category',
    label: string
  ): Promise<[string, number]> {
    const slug = this.toSlug(label);
    return new Promise((resolve) => {
      const req$ =
        kind === 'method'
          ? this.cocktailService.getCocktails(
              1,
              1,
              '',
              '',
              '',
              false,
              false,
              false,
              false,
              label,
              ''
            )
          : kind === 'glass'
          ? this.cocktailService.getCocktails(
              1,
              1,
              '',
              '',
              '',
              false,
              false,
              false,
              false,
              '',
              label
            )
          : this.cocktailService.getCocktails(
              1,
              1,
              '',
              label,
              '',
              false,
              false,
              false,
              false,
              '',
              ''
            );

      req$.subscribe({
        next: (res) => resolve([slug, res?.meta?.pagination?.total ?? 0]),
        error: () => resolve([slug, 0]),
      });
    });
  }

  // carica tutti i contatori una volta
  private async loadFacetCountsOnce(): Promise<void> {
    if (this.countsLoaded) return;
    this.countsLoaded = true;

    // METHOD
    await Promise.all(
      this.hubMethods.map((m) =>
        this.countFor('method', m).then(([s, n]) => (this.methodCounts[s] = n))
      )
    );
    // GLASS
    await Promise.all(
      this.hubGlasses.map((g) =>
        this.countFor('glass', g).then(([s, n]) => (this.glassCounts[s] = n))
      )
    );
    // CATEGORY
    await Promise.all(
      this.hubCategories.map((c) =>
        this.countFor('category', c).then(
          ([s, n]) => (this.categoryCounts[s] = n)
        )
      )
    );
  }

  // esponi un helper per il template
  count(kind: 'method' | 'glass' | 'category', label: string): number {
    const s = this.toSlug(label);
    return kind === 'method'
      ? this.methodCounts[s] ?? 0
      : kind === 'glass'
      ? this.glassCounts[s] ?? 0
      : this.categoryCounts[s] ?? 0;
  }

  // wrapper pubblico solo per il template
  public toSlug(v: string): string {
    return this.slugify(v);
  }

  private lastAvailabilityContext = '';
  private resetLetterAvailability(): void {
    this.availableLetters.clear();
    this.letterAvailabilityLoaded = false;
  }

  // Quali filtri sono permessi per hub
  private isRootHub(): boolean {
    return this.hubKind === 'root';
  }
  isLetterOnlyHub(): boolean {
    return (
      this.hubKind === 'method' ||
      this.hubKind === 'glass' ||
      this.hubKind === 'category' ||
      this.hubKind === 'alcoholic'
    );
  }

  isRootHubView(): boolean {
    return this.hubKind === 'root';
  }

  // --- Intento di scroll per UX condizionale ---
  private pendingScroll: 'none' | 'filter' | 'search' | 'page' = 'none';

  // --- Dati statici ---
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

  productList: ProductItem[] = [
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

  productListRobot: ProductItem[] = [
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

  // --- debounce senza RxJS ---
  private searchDebounceHandle: any = null;

  constructor(
    private cocktailService: CocktailService,
    private titleService: Title,
    private metaService: Meta,
    private route: ActivatedRoute,
    private router: Router
  ) {
    if (this.isBrowser) {
      this.checkScreenWidth();
      this.siteBaseUrl = window.location.origin;
    }
  }

  // --- Lifecycle ---
  ngOnInit(): void {
    // Titolo provvisorio (aggiornato dopo la prima load)
    this.titleService.setTitle(
      'Cocktails Explorer: Recipes, Ingredients & Guides | Fizzando'
    );
    combineLatest([this.route.paramMap, this.route.queryParams]).subscribe(
      ([pmap, params]) => {
        // query
        const q = (params['search'] as string) || '';
        const cat = (params['category'] as string) || '';
        const alc = (params['alcoholic'] as string) || '';

        const signature = `${this.hubKind}|${this.hubSlug}|${cat}|${alc}`;
        if (signature !== this.lastAvailabilityContext) {
          this.resetLetterAvailability();
          this.lastAvailabilityContext = signature;
        }
        const page = parseInt(params['page'], 10) || 1;
        const letterRaw = (params['letter'] as string) || '';

        // parametri "hub"
        const methodSlug = pmap.get('methodSlug') || '';
        const glassSlug = pmap.get('glassSlug') || '';
        const categorySlug = pmap.get('categorySlug') || '';
        const alcoholicSlug = pmap.get('alcoholicSlug') || '';

        // ---- Imposta hubSlug e (se serve) hubKind in base alla rotta o ai query ----
        if (methodSlug) {
          this.hubKind = 'method';
          this.hubSlug = methodSlug;
        } else if (glassSlug) {
          this.hubKind = 'glass';
          this.hubSlug = glassSlug;
        } else if (categorySlug) {
          //  /cocktails/category/:categorySlug
          this.hubKind = 'category';
          this.hubSlug = categorySlug;
        } else if (alcoholicSlug) {
          // /cocktails/alcoholic/:alcoholicSlug
          this.hubKind = 'alcoholic';
          this.hubSlug = alcoholicSlug;
        } else if (cat) {
          // fallback query param
          this.hubKind = 'category';
          this.hubSlug = this.slugify(cat);
        } else if (alc) {
          // fallback query param
          this.hubKind = 'alcoholic';
          this.hubSlug = this.slugify(alc);
        } else {
          this.hubKind = 'root';
          this.hubSlug = '';
        }

        // Signals: usa prima lo slug di rotta, poi eventuale query param
        const catFromHub = categorySlug ? this.unslugify(categorySlug) : '';
        const alcFromHub = alcoholicSlug ? this.unslugify(alcoholicSlug) : '';
        this._selectedCategory.set(catFromHub || cat);
        this._selectedAlcoholic.set(alcFromHub || alc);

        this._searchTerm.set(q);
        this._selectedLetter.set(this.normalizeLetter(letterRaw));
        this._selectedMethod.set(methodSlug ? this.unslugify(methodSlug) : '');
        this._selectedGlass.set(glassSlug ? this.unslugify(glassSlug) : '');
        this.currentPage = page;

        // --- Pulizia legacy *QUI DENTRO* ---
        const qp = this.route.snapshot.queryParams;

        if (
          this.hubKind === 'method' &&
          (qp['preparation_type'] || qp['page'] === '1')
        ) {
          this.router.navigate([], {
            relativeTo: this.route,
            replaceUrl: true,
            queryParamsHandling: 'merge',
            queryParams: { preparation_type: null, page: null },
            state: { suppressScroll: true },
          });
          return; // evita doppia load
        }

        if (this.hubKind === 'glass' && (qp['glass'] || qp['page'] === '1')) {
          this.router.navigate([], {
            relativeTo: this.route,
            replaceUrl: true,
            queryParamsHandling: 'merge',
            queryParams: { glass: null, page: null },
            state: { suppressScroll: true },
          });
          return;
        }

        if (
          this.hubKind === 'category' &&
          (qp['category'] || qp['page'] === '1')
        ) {
          this.router.navigate([], {
            relativeTo: this.route,
            replaceUrl: true,
            queryParamsHandling: 'merge',
            queryParams: { category: null, page: null },
            state: { suppressScroll: true },
          });
          return;
        }

        if (
          this.hubKind === 'alcoholic' &&
          (qp['alcoholic'] || qp['page'] === '1')
        ) {
          this.router.navigate([], {
            relativeTo: this.route,
            replaceUrl: true,
            queryParamsHandling: 'merge',
            queryParams: { alcoholic: null, page: null },
            state: { suppressScroll: true },
          });
          return;
        }

        this.setSeoTagsAndSchemaHeaders();

        this.loadCocktails();
      }
    );

    // --- Enforce policy filtri: root = completi, hub = solo lettera ---
    if (this.isLetterOnlyHub()) {
      // se sei in una sotto-sezione, rimuovi filtri non permessi
      const qp = this.route.snapshot.queryParams;
      if (qp['category'] || qp['alcoholic'] || qp['search']) {
        this.router.navigate([], {
          relativeTo: this.route,
          replaceUrl: true,
          queryParamsHandling: 'merge',
          queryParams: {
            category: null,
            alcoholic: null,
            search: null,
            page: 1,
          },
          state: { suppressScroll: true },
        });
        return; // eviti doppie load con i vecchi param
      }
    } else {
      // sei nel root: nessuna pulizia speciale
    }

    // fonts loaded → class per controllare FOUT
    if (this.isBrowser && (document as any)?.fonts?.ready) {
      (document as any).fonts.ready.then(() => (this.fontsLoaded = true));
    } else if (this.isBrowser) {
      requestAnimationFrame(() => (this.fontsLoaded = true));
    }

    this.loadFacetCountsOnce();
  }

  ngOnDestroy(): void {
    if (this.searchDebounceHandle) {
      clearTimeout(this.searchDebounceHandle);
    }
    this.cleanupSeo();
  }

  // --- Normalizza la lettera (A–Z) ---
  private normalizeLetter(v: string): string {
    const raw = (v || '').trim();
    // consenti “0-9” come chiave per i numeri
    if (raw === this.numberKey) return this.numberKey;

    const c = raw.charAt(0).toUpperCase();
    return /^[A-Z]$/.test(c) ? c : '';
  }

  // --- Handlers per template ---
  onSearchInput(e: Event) {
    const v = (e.target as HTMLInputElement).value ?? '';
    // se l'utente digita, lascia che la search prevalga
    this.setSearch(v);
  }
  onCategoryChange(e: Event) {
    const v = (e.target as HTMLSelectElement).value ?? '';
    this.setCategory(v);
    this.applyFilters();
  }
  onAlcoholicChange(e: Event) {
    const v = (e.target as HTMLSelectElement).value ?? '';
    this.setAlcoholic(v);
    this.applyFilters();
  }

  // ⭐ Nuovo: applica/azzera filtro lettera
  applyLetter(letter: string | null): void {
    const norm = this.normalizeLetter(letter || '');
    const current = this._selectedLetter();

    // toggle: se clicchi la stessa lettera → rimuovi
    const nextVal = norm && norm === current ? '' : norm;

    // quando scegli una lettera, azzera la search per evitare conflitti UX
    this._searchTerm.set('');

    this.pendingScroll = 'filter';
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        letter: nextVal || null,
        search: null, // azzera search
        page: 1,
      },
      queryParamsHandling: 'merge',
      state: { suppressScroll: true },
    });
  }

  // --- Data/UI ---
  loadCocktails(): void {
    this.loading = true;
    this.error = null;

    // ⭐ Search effettiva: prima search, altrimenti lettera
    const effectiveSearch = this._searchTerm() || this._selectedLetter();

    this.cocktailService
      .getCocktails(
        this.currentPage,
        this.pageSize,
        this._searchTerm() || this._selectedLetter(),
        this._selectedCategory(),
        this._selectedAlcoholic(),
        true,
        true,
        false,
        false,
        this._selectedMethod(), // ← passa il Method
        this._selectedGlass() // ← passa il Glass
      )
      .subscribe({
        next: (res) => {
          if (res?.data?.length) {
            let mappedCocktails = res.data.map((cocktail) => {
              const rnd = Math.random();
              const isTall = rnd < 0.2;
              const isWide = !isTall && rnd < 0.35;
              return {
                ...cocktail,
                isTall,
                isWide,
                matchedIngredientCount: 0,
              } as CocktailWithLayoutAndMatch;
            });

            // Ordina per slug A→Z
            mappedCocktails.sort((a, b) => a.slug.localeCompare(b.slug));

            this.cocktails = mappedCocktails;
            this.totalItems = res.meta.pagination.total;
            this.totalPages = res.meta.pagination.pageCount;
            this.primeAvailabilityFromPage();
          } else {
            this.cocktails = [];
            this.totalItems = 0;
            this.totalPages = 0;
          }

          this.loading = false;

          // Avvia lo scan solo la prima volta
          if (this.isBrowser && !this.letterAvailabilityLoaded) {
            this.scheduleLetterAvailabilityScan();
          }

          // Scroll condizionale
          const intent = this.pendingScroll;
          this.pendingScroll = 'none';
          if (this.isBrowser && intent === 'page') {
            this.scrollToFirstCardAfterRender();
          }

          this.setSeoTagsAndSchemaList();
        },
        error: () => {
          this.error = 'Impossibile caricare i cocktail. Riprova più tardi.';
          this.loading = false;
          this.totalItems = 0;
          this.totalPages = 0;
          this.unfreezeScroll(true);
          this.unlockListHeight();
          this.setSeoTagsAndSchemaList();
        },
      });
  }

  // debounce 300ms per la search
  private debounceNavigateForSearch(): void {
    // --- Disabilita la search nelle sotto-sezioni (solo root la usa) ---
    if (this.isLetterOnlyHub()) {
      // se ci sono query param di search residui, li rimuoviamo
      const qp = this.route.snapshot.queryParams;
      if (qp['search']) {
        this.router.navigate([], {
          relativeTo: this.route,
          replaceUrl: true,
          queryParamsHandling: 'merge',
          queryParams: { search: null, page: 1 },
          state: { suppressScroll: true },
        });
      }
      return; // esci: nei sotto-hub non esegui ricerca
    }

    // --- Normale comportamento root ---
    if (this.searchDebounceHandle) clearTimeout(this.searchDebounceHandle);

    this.searchDebounceHandle = setTimeout(() => {
      this.pendingScroll = 'search';
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          search: this._searchTerm() || null,
          page: 1,
          // opzionale: se vuoi che digitando una search si rimuova la lettera dall'URL:
          // letter: this._searchTerm() ? null : this._selectedLetter() || null,
        },
        queryParamsHandling: 'merge',
        state: { suppressScroll: true },
      });
    }, 300);
  }

  applyFilters(): void {
    this.pendingScroll = 'filter';

    if (this.isLetterOnlyHub()) {
      // Nelle sotto-sezioni consentiamo solo la lettera; togliamo gli altri se per caso il template li invia
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          letter: this._selectedLetter() || null,
          category: null,
          alcoholic: null,
          search: null,
          page: 1,
        },
        queryParamsHandling: 'merge',
        state: { suppressScroll: true },
      });
      return;
    }

    // ROOT: tutti i filtri
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        category: this._selectedCategory() || null,
        alcoholic: this._selectedAlcoholic() || null,
        search: this._searchTerm() || null,
        letter: this._selectedLetter() || null,
        page: 1,
      },
      queryParamsHandling: 'merge',
      state: { suppressScroll: true },
    });
  }

  clearFilters(): void {
    this.pendingScroll = 'filter';

    // reset stato locale
    this._searchTerm.set('');
    this._selectedCategory.set('');
    this._selectedAlcoholic.set('');
    this._selectedLetter.set('');

    if (this.isLetterOnlyHub()) {
      // nelle sotto-sezioni: ripulisci tutto, resta solo la pagina
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          category: null,
          alcoholic: null,
          search: null,
          letter: null,
          page: 1,
        },
        queryParamsHandling: 'merge',
        state: { suppressScroll: true },
      });
    } else {
      // root
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          category: null,
          alcoholic: null,
          search: null,
          letter: null,
          page: null,
        },
        queryParamsHandling: 'merge',
        state: { suppressScroll: true },
      });
    }
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      if (this.freezeSafe) {
        this.freezeScroll(); // desktop
      } else if (this.isBrowser) {
        this.lastScrollYBeforeNav = window.scrollY; // mobile: solo memorizza
      }

      this.pendingScroll = 'page';
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { page },
        queryParamsHandling: 'merge',
        state: { suppressScroll: true },
      });

      if (!this.freezeSafe && this.isBrowser) {
        requestAnimationFrame(() =>
          window.scrollTo({
            top: this.lastScrollYBeforeNav,
            left: 0,
            behavior: 'auto',
          })
        );
      }
    }
  }

  trackByCocktailId(_index: number, cocktail: CocktailWithLayout): number {
    return cocktail.id;
  }

  toggleFaq(faqItem: FaqItemState): void {
    faqItem.isExpanded = !faqItem.isExpanded;
  }

  get accordionTitle(): string {
    return 'Filter by letter';
  }

  // --- Summary filtri (aggiunge lettera se non c'è search) ---
  getActiveFiltersText(): string {
    const active: string[] = [];
    if (this._searchTerm()) active.push(`"${this._searchTerm()}"`);
    if (!this._searchTerm() && this._selectedLetter())
      active.push(`Letter: ${this._selectedLetter()}`);
    return active.length ? active.join(', ') : 'No filters active';
  }

  // --- Paginatore ---
  getVisiblePages(): number[] {
    const pages: number[] = [];
    const startPage = Math.max(2, this.currentPage - this.paginationRange);
    const endPage = Math.min(
      this.totalPages - 1,
      this.currentPage + this.paginationRange
    );
    for (let i = startPage; i <= endPage; i++) pages.push(i);
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

  // --- Responsiveness ---
  @HostListener('window:resize')
  onResize(): void {
    if (this.isBrowser) this.checkScreenWidth();
  }
  private checkScreenWidth(): void {
    if (!this.isBrowser) return;
    this.isMobile = window.innerWidth <= 600;
  }

  // === Helpers immagini/URL ===
  private getFullSiteUrl(pathOrUrl: string): string {
    if (!this.siteBaseUrl) return pathOrUrl;
    return pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.siteBaseUrl}${pathOrUrl}`;
  }

  private getCurrentPath(): string {
    return this.router.url.split('?')[0] || '/cocktails';
  }

  getCocktailImageUrl(cocktail: BaseCocktail | undefined): string {
    if (cocktail?.image?.url) {
      return cocktail.image.url.startsWith('http')
        ? cocktail.image.url
        : env.apiUrl + cocktail.image.url;
    }
    return this.getFullSiteUrl('/assets/no-image.png');
  }

  // Public perché lo usi nel template per costruire href
  buildUrlWithParams(patch: Record<string, string | number | null>): string {
    const path = this.getCurrentPath();
    const current = { ...this.route.snapshot.queryParams } as Record<
      string,
      any
    >;
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v === null || v === '') delete current[k];
      else current[k] = String(v);
    }
    if (current['page'] === '1') delete current['page'];
    const qs = new URLSearchParams(current as any).toString();
    return qs ? `${path}?${qs}` : path;
  }

  // === SEO/H1/H2 factory centralizzata ===
  private computeSeoCopy(): {
    pageTitle: string;
    h1: string;
    h2: string;
    description: string;
  } {
    const siteSuffix = ' | Fizzando';
    const kind = this.hubKind; // 'root' | 'method' | 'glass' | 'category' | 'alcoholic'
    const label = this.hubLabel; // es. "Shaken", "Coupe", "Classic"
    const slug = this.hubSlug; // es. "shaken", "coupe", "classic"

    let h1 = 'Cocktails Explorer';
    let h2 =
      'Your Ultimate Cocktail Guide: Search, Filter, and Discover New Drinks';
    let titleCore = 'Cocktails Explorer';
    let desc = '';

    if (kind !== 'root' && label) {
      const p = this.getSeoPreset(kind, label, slug);
      h1 = p.h1 || h1;
      h2 = p.h2 || h2;
      titleCore = p.titleCore || h1;
      desc = p.desc || '';
      // hard-limit descrizione a ~170 char
      desc = this.truncate(desc, 170);
    }

    // Paginazione nel <title> se serve
    const pageSuffix =
      this.totalPages > 1
        ? ` (Page ${this.currentPage}${
            this.totalPages ? ' of ' + this.totalPages : ''
          })`
        : '';

    const pageTitle = `${titleCore}${pageSuffix} ${siteSuffix}`;

    return { pageTitle, h1, h2, description: desc };
  }

  // (I vecchi helper di titolo/descrizione restano se vuoi riusarli altrove)
  private truncate(text: string, maxLen: number): string {
    if (!text) return '';
    return text.length <= maxLen
      ? text
      : text.slice(0, maxLen - 1).trimEnd() + '…';
  }

  private _selectedMethod = signal<string>(''); // es. 'Shaken'
  private _selectedGlass = signal<string>(''); // es. 'Highball glass'
  selectedMethod = this._selectedMethod;
  selectedGlass = this._selectedGlass;

  private unslugify(v: string): string {
    const s = (v || '').replace(/-/g, ' ').trim();
    // Title case semplice + fix comuni
    const t = s.replace(/\b\w/g, (m) => m.toUpperCase());
    return t
      .replace(/\bIn\b/g, 'in') // "Built in Glass"
      .replace(/\bAnd\b/g, 'and') // "Nick and Nora"
      .replace(/\bOf\b/g, 'of');
  }

  private slugify(v: string): string {
    return (v || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '');
  }

  // === SEO: Canonical / Prev / Next link ===
  private setCanonicalLink(absUrl: string): void {
    const head = this.doc?.head;
    if (!head) return;

    let linkEl = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!linkEl) {
      linkEl = this.renderer.createElement('link');
      this.renderer.setAttribute(linkEl, 'rel', 'canonical');
      this.renderer.appendChild(head, linkEl);
    }
    this.renderer.setAttribute(linkEl, 'href', absUrl);
  }

  private setPrevNextLinks(
    prevAbs: string | null,
    nextAbs: string | null
  ): void {
    const head = this.doc?.head;
    if (!head) return;

    head
      .querySelectorAll('link[rel="prev"], link[rel="next"]')
      .forEach((el) => {
        this.renderer.removeChild(head, el);
      });

    if (prevAbs) {
      const prev = this.renderer.createElement('link');
      this.renderer.setAttribute(prev, 'rel', 'prev');
      this.renderer.setAttribute(prev, 'href', prevAbs);
      this.renderer.appendChild(head, prev);
    }
    if (nextAbs) {
      const next = this.renderer.createElement('link');
      this.renderer.setAttribute(next, 'rel', 'next');
      this.renderer.setAttribute(next, 'href', nextAbs);
      this.renderer.appendChild(head, next);
    }
  }

  // === SEO: JSON-LD ===
  private addJsonLdItemList(): void {
    const head = this.doc?.head;
    if (!head) return;

    this.cleanupJsonLdScript(this.itemListSchemaScript);

    const script = this.renderer.createElement('script');
    this.renderer.setAttribute(script, 'type', 'application/ld+json');
    this.renderer.setAttribute(script, 'id', 'cocktail-itemlist-schema');

    const pageAbsUrl = this.getFullSiteUrl(this.router.url);
    const itemListId = pageAbsUrl + '#itemlist';

    // posizione globale corretta (pagina 2 → parte da 21, ecc.)
    const startIndex = this.pageStart || 1;

    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': itemListId,
      name: 'Cocktails Explorer',
      inLanguage: 'en',
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      numberOfItems: this.totalItems,
      startIndex,
      url: pageAbsUrl,
      itemListElement: this.cocktails.map((c, i) => ({
        '@type': 'ListItem',
        position: startIndex + i,
        item: {
          '@type': 'Recipe',
          '@id': this.getFullSiteUrl(`/cocktails/${c.slug}`),
          url: this.getFullSiteUrl(`/cocktails/${c.slug}`),
          name: c.name,
          image: this.getCocktailImageUrl(c),
        },
      })),
    };

    this.renderer.appendChild(
      script,
      this.renderer.createText(JSON.stringify(itemList))
    );
    this.renderer.appendChild(head, script);
    this.itemListSchemaScript = script as HTMLScriptElement;
  }

  private addJsonLdCollectionPageAndBreadcrumbs(
    pageTitle: string,
    pageDescription: string
  ): void {
    const head = this.doc?.head;
    if (!head) return;

    // CollectionPage
    this.cleanupJsonLdScript(this.collectionSchemaScript);
    const coll = this.renderer.createElement('script');
    this.renderer.setAttribute(coll, 'type', 'application/ld+json');
    this.renderer.setAttribute(coll, 'id', 'collectionpage-schema');

    const pageAbsUrl = this.getFullSiteUrl(this.router.url);
    const itemListId = pageAbsUrl + '#itemlist';
    const collectionPage = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: pageTitle.replace(' | Fizzando', ''),
      description: pageDescription,
      url: pageAbsUrl,
      mainEntity: { '@id': itemListId },
    };
    this.renderer.appendChild(
      coll,
      this.renderer.createText(JSON.stringify(collectionPage))
    );
    this.renderer.appendChild(head, coll);
    this.collectionSchemaScript = coll as HTMLScriptElement;

    // BreadcrumbList
    this.cleanupJsonLdScript(this.breadcrumbsSchemaScript);
    const bc = this.renderer.createElement('script');
    this.renderer.setAttribute(bc, 'type', 'application/ld+json');
    this.renderer.setAttribute(bc, 'id', 'breadcrumbs-schema');

    const crumbs = [
      { name: 'Home', url: this.getFullSiteUrl('/') },
      { name: 'Cocktails', url: this.getFullSiteUrl('/cocktails') },
    ];
    const breadcrumbList = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i,
        name: c.name,
        item: c.url,
      })),
    };
    this.renderer.appendChild(
      bc,
      this.renderer.createText(JSON.stringify(breadcrumbList))
    );
    this.renderer.appendChild(head, bc);
    this.breadcrumbsSchemaScript = bc as HTMLScriptElement;
  }

  private cleanupJsonLdScript(ref?: HTMLScriptElement) {
    const head = this.doc?.head;
    if (!head || !ref) return;
    if (head.contains(ref)) {
      this.renderer.removeChild(head, ref);
    }
  }

  // === SEO: impostazione completa per LIST ===
  private setSeoTagsAndSchemaList(): void {
    // Nota: pageTitle e description sono già stati impostati da setSeoTagsAndSchemaHeaders().

    const ogImage =
      this.cocktails.length > 0
        ? this.getCocktailImageUrl(this.cocktails[0])
        : this.getFullSiteUrl('/assets/og-default.png');

    // Aggiorna solo i tag che richiedono l'immagine (OG Image e Twitter Image)
    this.metaService.updateTag({ property: 'og:image', content: ogImage });
    this.metaService.updateTag({ name: 'twitter:image', content: ogImage });

    // JSON-LD ItemList (richiede l'array cocktail)
    this.addJsonLdItemList();

    // Tutto il resto (H1, Title, Canonical, Prev/Next, etc.) è stato rimosso
    // perché viene gestito da setSeoTagsAndSchemaHeaders().
  }

  private addJsonLdFaqPage(): void {
    const head = this.doc?.head;
    if (!head) return;

    this.cleanupJsonLdScript(this.faqSchemaScript);

    const script = this.renderer.createElement('script');
    this.renderer.setAttribute(script, 'type', 'application/ld+json');
    this.renderer.setAttribute(script, 'id', 'faq-schema');

    const faq = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What are the most popular classic cocktails?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Timeless classic cocktails include Daiquiri, Manhattan, Sidecar, Boulevardier, and Pisco Sour.',
          },
        },
        {
          '@type': 'Question',
          name: 'How can I choose the right glass for each cocktail?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Use a coupe for shaken citrus drinks (e.g., Daiquiri), a Collins glass for tall fizzy serves (Tom Collins), and a rocks glass for spirit-forward classics (Sazerac).',
          },
        },
        {
          '@type': 'Question',
          name: 'Which cocktails are best for beginners?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Aperol Spritz, Cuba Libre, Bellini and Paloma are simple, high-success options for beginners.',
          },
        },
        {
          '@type': 'Question',
          name: 'How do I calculate the alcohol content (ABV) of a cocktail?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'ABV depends on spirit strength, volumes and dilution. Our cards show an estimated ABV so you can compare drink strength before mixing.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I switch any classic cocktail to a non-alcoholic version?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Many cocktails can become mocktails by using zero-proof alternatives or rebalancing mixers (e.g., Virgin Mojito or alcohol-free Piña Colada).',
          },
        },
        {
          '@type': 'Question',
          name: 'Where can I discover new cocktail ideas and trends?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Modern favorites include French 75, Mai Tai, Caipirinha and Espresso Martini. We keep the archive updated with seasonal drinks and bartender-driven innovations.',
          },
        },
      ],
    };

    this.renderer.appendChild(
      script,
      this.renderer.createText(JSON.stringify(faq))
    );
    this.renderer.appendChild(head, script);
    this.faqSchemaScript = script as HTMLScriptElement;
  }

  private cleanupSeo(): void {
    this.metaService.removeTag("property='og:title'");
    this.metaService.removeTag("property='og:description'");
    this.metaService.removeTag("property='og:image'");
    this.metaService.removeTag("property='og:url'");
    this.metaService.removeTag("property='og:type'");
    this.metaService.removeTag("property='og:site_name'");
    this.metaService.removeTag("name='twitter:card'");
    this.metaService.removeTag("name='twitter:title'");
    this.metaService.removeTag("name='twitter:description'");
    this.metaService.removeTag("name='twitter:image'");

    const head = this.doc?.head;
    if (head) {
      head
        .querySelectorAll('link[rel="prev"], link[rel="next"]')
        .forEach((el) => this.renderer.removeChild(head, el));
    }

    this.cleanupJsonLdScript(this.itemListSchemaScript);
    this.cleanupJsonLdScript(this.collectionSchemaScript);
    this.cleanupJsonLdScript(this.breadcrumbsSchemaScript);
    this.cleanupJsonLdScript(this.faqSchemaScript);
  }

  // --- Offset per header/menu fixed ---
  private getScrollOffset(): number {
    if (!this.isBrowser) return 0;

    const candidates = [
      document.querySelector('app-navbar'),
      document.querySelector('.site-header'),
      document.querySelector('header.sticky'),
      document.querySelector('.app-toolbar'),
      document.querySelector('header'),
    ].filter(Boolean) as HTMLElement[];

    const header = candidates.find((el) => {
      const cs = getComputedStyle(el);
      const pos = cs.position;
      const rect = el.getBoundingClientRect();
      return (
        (pos === 'fixed' || pos === 'sticky') &&
        rect.height > 0 &&
        Math.abs(rect.top) < 4
      );
    });

    const headerH = header
      ? Math.round(header.getBoundingClientRect().height)
      : 0;

    const extra = this.isMobile ? 130 : 130;

    return headerH + extra;
  }

  // --- Lock/unlock altezza lista per evitare scatti di layout ---
  private lockListHeight(): void {
    if (!this.isBrowser || this.listHeightLocked) return;
    const list = document.querySelector('.cocktail-list') as HTMLElement | null;
    if (!list) return;
    const h = list.offsetHeight || list.getBoundingClientRect().height || 0;
    if (h <= 0) return;
    list.style.minHeight = h + 'px';
    list.style.maxHeight = h + 'px';
    list.style.overflow = 'hidden';
    this.listHeightLocked = true;
  }

  private unlockListHeight(): void {
    if (!this.isBrowser || !this.listHeightLocked) return;
    const list = document.querySelector('.cocktail-list') as HTMLElement | null;
    if (list) {
      list.style.minHeight = '';
      list.style.maxHeight = '';
      list.style.overflow = '';
    }
    this.listHeightLocked = false;
  }

  // --- Freeze/unfreeze scroll viewport ---
  private freezeScroll(): void {
    if (!this.isBrowser || this.isScrollFrozen || !this.freezeSafe) return;

    this.frozenY = window.scrollY;

    const html = document.documentElement as HTMLElement;
    this.prevScrollBehavior = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    html.style.overflow = 'hidden';

    const sbw = window.innerWidth - document.documentElement.clientWidth;

    const body = document.body as HTMLBodyElement;
    body.style.position = 'fixed';
    body.style.top = `-${this.frozenY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    if (sbw > 0) body.style.paddingRight = `${sbw}px`;

    window.addEventListener('touchmove', this.preventTouchMove, {
      passive: false,
    });

    this.isScrollFrozen = true;
  }

  private unfreezeScroll(restore = true): void {
    if (!this.isBrowser || !this.isScrollFrozen) return;

    const body = document.body as HTMLBodyElement;
    body.style.position = '';
    body.style.top = '';
    body.style.left = '';
    body.style.right = '';
    body.style.width = '';
    body.style.overflow = '';
    body.style.paddingRight = '';

    const html = document.documentElement as HTMLElement;
    html.style.overflow = '';
    html.style.scrollBehavior = this.prevScrollBehavior || '';

    window.removeEventListener('touchmove', this.preventTouchMove);
    this.isScrollFrozen = false;

    if (restore)
      window.scrollTo({ top: this.frozenY, left: 0, behavior: 'auto' });
  }

  // --- Scroll post-render controllato ---
  private scrollToFirstCardAfterRender(): void {
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          this.unfreezeScroll(true);

          const firstCard = document.querySelector(
            '.cocktail-list app-cocktail-card'
          ) as HTMLElement | null;
          const listEl =
            firstCard ||
            (document.querySelector('.cocktail-list') as HTMLElement | null) ||
            (document.querySelector(
              '.cocktail-card-legend'
            ) as HTMLElement | null) ||
            (document.querySelector(
              '.page-header-container'
            ) as HTMLElement | null);

          if (!listEl) return;

          const targetY =
            listEl.getBoundingClientRect().top +
            window.scrollY -
            this.getScrollOffset();

          window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });

          setTimeout(() => {
            const correctedY =
              listEl.getBoundingClientRect().top +
              window.scrollY -
              this.getScrollOffset();
            if (Math.abs(correctedY - targetY) > 8) {
              window.scrollTo({
                top: Math.max(0, correctedY),
                behavior: 'auto',
              });
            }
          }, 260);
        }, 70);
      });
    });
  }

  // Range visibile (1-based). Se non ci sono risultati torna 0–0.
  get pageStart(): number {
    return this.totalItems > 0 ? (this.currentPage - 1) * this.pageSize + 1 : 0;
  }
  get pageEnd(): number {
    return this.totalItems > 0
      ? Math.min(this.currentPage * this.pageSize, this.totalItems)
      : 0;
  }

  /** Avvia lo scan dopo la prima load (idle), con bassa concorrenza */
  private scheduleLetterAvailabilityScan(): void {
    // Non fare nulla in SSR o se già fatto
    if (!this.isBrowser || this.letterAvailabilityLoaded) return;

    const start = () => this.computeLetterAvailability();

    // Usa globalThis invece di window e verifica la presenza dell’API
    const ric = (globalThis as any).requestIdleCallback as
      | ((cb: Function, opts?: { timeout?: number }) => any)
      | undefined;

    if (ric) {
      ric(start, { timeout: 1500 });
    } else {
      setTimeout(start, 200);
    }
  }

  /** Chiede al backend pageSize=1 per ogni lettera/numero e popola availableLetters */
  private async computeLetterAvailability(): Promise<void> {
    // Non eseguire in SSR
    if (!this.isBrowser) return;

    const keys = [...this.letters, this.numberKey];
    const CONCURRENCY = 4;
    let i = 0;

    const run = async () => {
      while (i < keys.length) {
        const key = keys[i++];
        await this.fetchLetterAvailability(key).catch(() => {});
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, run));
    this.letterAvailabilityLoaded = true;
  }

  /** Ritorna true se esiste almeno 1 cocktail per il “key” (A..Z o 0–9) */
  private async fetchLetterAvailability(key: string): Promise<boolean> {
    const page = 1;
    const size = 1;

    // 1) Filtri coerenti con la sezione corrente:
    // - root        → category & alcoholic attivi se selezionati
    // - category    → forza il category dell’hub
    // - alcoholic   → forza l’alcoholic dell’hub
    // - method/glass→ già passati sotto come parametri dedicati
    const catFilter =
      this.hubKind === 'category' || this.isRootHub()
        ? this._selectedCategory()
        : '';
    const alcFilter =
      this.hubKind === 'alcoholic' || this.isRootHub()
        ? this._selectedAlcoholic()
        : '';

    const method = this._selectedMethod();
    const glass = this._selectedGlass();

    // Piccolo helper per fare una probe su "name startsWith"
    const probe = (startsWith: string) =>
      new Promise<boolean>((resolve) => {
        this.cocktailService
          .getCocktails(
            page,
            size,
            startsWith, // usa il carattere da testare
            catFilter,
            alcFilter,
            true, // includeImages
            true, // includeABV
            false, // includeIngredients
            false, // includeSteps
            method,
            glass
          )
          .subscribe({
            next: (res) => {
              const hasAny = (res?.meta?.pagination?.total || 0) > 0;
              resolve(hasAny);
            },
            error: () => resolve(false),
          });
      });

    // 2) Caso "0–9": Strapi non capisce "startsWithi = 0-9".
    //    Facciamo fino a 10 probe, con early-exit alla prima che trova qualcosa.
    if (key === this.numberKey) {
      const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      for (const d of digits) {
        const ok = await probe(d);
        if (ok) {
          this.availableLetters.add(this.numberKey);
          return true;
        }
      }
      return false;
    }

    // 3) Lettere A–Z: singola probe
    const ok = await probe(key);
    if (ok) this.availableLetters.add(key);
    return ok;
  }

  // Subito abilitare le lettere viste nella pagina corrente (niente fetch extra)
  private primeAvailabilityFromPage(): void {
    const seen = new Set<string>();
    for (const c of this.cocktails) {
      const ch = (c.slug || '').charAt(0).toLowerCase();
      if (ch >= '0' && ch <= '9') seen.add(this.numberKey);
      else if (ch >= 'a' && ch <= 'z') seen.add(ch.toUpperCase());
    }
    seen.forEach((l) => this.availableLetters.add(l));
  }

  // Mentre carica → non cliccabile; dopo lo scan → cliccabile solo se presente
  isLetterClickable(key: string): boolean {
    if (!this.letterAvailabilityLoaded) return false; // evita flicker
    return this.availableLetters.has(key);
  }

  // Gestione click che ignora i disabilitati
  onLetterChipClick(e: Event, key: string | null): void {
    // consenti sempre “All”
    if (!key) {
      this.applyLetter(null);
      return;
    }

    // ⬇️ CONSENTI click quando lo scan non è ancora finito
    if (this.letterAvailabilityLoaded && !this.availableLetters.has(key)) {
      e.preventDefault();
      return; // qui blocchi SOLO dopo lo scan e se davvero assente
    }

    this.applyLetter(key);
  }

  // === Preset SEO opzionali per i top hub ===
  private seoPresets: Record<
    string,
    { h1?: string; h2?: string; titleCore?: string; desc?: string }
  > = {
    // METHODS (slug)
    shaken: {
      h1: 'Shaken Cocktails',
      h2: 'Technique hub',
      titleCore: 'Shaken Cocktails',
      desc: 'Discover shaken cocktails: bright, chilled drinks with balanced dilution and texture. Curated recipes with ingredients, ABV, images and pro tips.',
    },
    stirred: {
      h1: 'Stirred Cocktails',
      h2: 'Technique hub',
      titleCore: 'Stirred Cocktails',
      desc: 'Explore stirred cocktails: clear, spirit-forward builds with silky texture. Find specs, ABV estimates, images and serving notes.',
    },
    'built-in-glass': {
      h1: 'Built in Glass Cocktails',
      h2: 'Technique hub',
      titleCore: 'Built in Glass Cocktails',
      desc: 'Browse built-in-glass cocktails: quick, refreshing builds with minimal tools. Ingredients, ABV, images and pro tips.',
    },

    // GLASSES (slug)
    coupe: {
      h1: 'Cocktails Served in a Coupe',
      h2: 'Glassware hub',
      titleCore: 'Coupe Cocktails',
      desc: 'Browse cocktails served in a coupe: elegant, stemmed presentations for shaken or stirred classics. Ingredients, serving notes, ABV and images.',
    },
    'highball-glass': {
      h1: 'Cocktails Served in a Highball Glass',
      h2: 'Glassware hub',
      titleCore: 'Highball Glass Cocktails',
      desc: 'Discover highball glass cocktails: tall, effervescent serves with perfect dilution. Ingredients, ABV, images and serving tips.',
    },

    // CATEGORIES (slug)
    classic: {
      h1: 'Classic Cocktails',
      h2: 'Style hub',
      titleCore: 'Classic Cocktails',
      desc: 'Explore classic cocktails from our archive—time-tested builds with precise specs. Find ingredients, ABV estimates, images and serving guidance.',
    },
    sour: {
      h1: 'Sour Cocktails',
      h2: 'Style hub',
      titleCore: 'Sour Cocktails',
      desc: 'Discover sour cocktails: citrus-driven balance with structured sweetness and dilution. Recipes with ingredients, ABV, images and pro tips.',
    },

    // ALCOHOLIC PROFILE (slug)
    'non-alcoholic': {
      h1: 'Non Alcoholic Drinks',
      h2: 'Profile hub',
      titleCore: 'Non Alcoholic Drinks',
      desc: 'Find non-alcoholic drinks with clarity on flavor, balance and presentation. Zero-proof choices with ingredients, images and dilution-aware ABV notes.',
    },
    alcoholic: {
      h1: 'Alcoholic Drinks',
      h2: 'Profile hub',
      titleCore: 'Alcoholic Drinks',
      desc: 'Browse alcoholic drinks by technique, glass and style. Clear specs with ingredients, ABV estimates, images and serving suggestions.',
    },
    'optional-alcohol': {
      h1: 'Optional Alcohol Drinks',
      h2: 'Profile hub',
      titleCore: 'Optional Alcohol Drinks',
      desc: 'Explore drinks that flex between zero-proof and spirited builds. Ingredients, ABV guidance, images and serving notes.',
    },
  };

  private getSeoPreset(kind: typeof this.hubKind, label: string, slug: string) {
    const preset = this.seoPresets[slug];
    if (preset) return preset;

    // Fallback generici ben scritti
    switch (kind) {
      case 'method':
        return {
          h1: `${label} Cocktails`,
          h2: 'Technique hub',
          titleCore: `${label} Cocktails`,
          desc: `Discover ${label.toLowerCase()} cocktails: curated recipes with ingredients, ABV, images and expert tips.`,
        };
      case 'glass':
        return {
          h1: `Cocktails Served in a ${label}`,
          h2: 'Glassware hub',
          titleCore: `${label} Cocktails`,
          desc: `Browse cocktails served in a ${label.toLowerCase()}: ingredients, serving notes, ABV and images.`,
        };
      case 'category':
        return {
          h1: `${label} Cocktails`,
          h2: 'Style hub',
          titleCore: `${label} Cocktails`,
          desc: `Explore ${label.toLowerCase()} cocktails from our archive. Ingredients, estimated ABV, images and serving guidance.`,
        };
      case 'alcoholic':
        // normalizza “Non Alcoholic” ecc.
        const normalized = label.replace(/\s+/g, ' ');
        return {
          h1: `${normalized} Drinks`,
          h2: 'Profile hub',
          titleCore: `${normalized} Drinks`,
          desc: `Find ${normalized.toLowerCase()} drinks with clear ingredients, images and ABV guidance.`,
        };
      default:
        return {
          h1: 'Cocktails Explorer',
          h2: 'Your Ultimate Cocktail Guide',
          titleCore: 'Cocktails Explorer',
          desc: '',
        };
    }
  }

  // ... (vicino a setSeoTagsAndSchemaList)

  /** Imposta title, meta, canonical e breadcrumbs (parte indipendente dai dati) */
  private setSeoTagsAndSchemaHeaders(): void {
    const { pageTitle, h1, h2, description } = this.computeSeoCopy();

    // Esponi per il template (H1/H2/lead)
    this.pageH1 = h1;
    this.pageH2 = h2;
    this.pageDescription = description;

    // <title> + meta description
    this.titleService.setTitle(pageTitle);
    this.metaService.updateTag({ name: 'description', content: description });

    const canonicalAbs = this.getFullSiteUrl(this.router.url);
    this.setCanonicalLink(canonicalAbs);

    const prevUrl =
      this.totalPages > 1 && this.currentPage > 1
        ? this.getFullSiteUrl(
            this.buildUrlWithParams({ page: this.currentPage - 1 })
          )
        : null;
    const nextUrl =
      this.totalPages > 1 && this.currentPage < this.totalPages
        ? this.getFullSiteUrl(
            this.buildUrlWithParams({ page: this.currentPage + 1 })
          )
        : null;
    this.setPrevNextLinks(prevUrl, nextUrl);

    // Aggiorna OpenGraph/Twitter meta tags
    this.metaService.updateTag({ property: 'og:title', content: pageTitle });
    if (description) {
      this.metaService.updateTag({
        property: 'og:description',
        content: description,
      });
      this.metaService.updateTag({
        name: 'twitter:description',
        content: description,
      });
    } else {
      this.metaService.removeTag("name='description'");
    }
    this.metaService.updateTag({ property: 'og:url', content: canonicalAbs });
    this.metaService.updateTag({ property: 'og:type', content: 'website' });
    this.metaService.updateTag({
      property: 'og:site_name',
      content: 'Fizzando',
    });
    this.metaService.updateTag({
      name: 'twitter:card',
      content: 'summary_large_image',
    });
    this.metaService.updateTag({ name: 'twitter:title', content: pageTitle });

    // Nota: l'immagine OG dipende dalla lista, quindi la settiamo dopo.

    // Schemi JSON-LD non dipendenti dalla lista (CollectionPage, Breadcrumbs, FAQ)
    // Qui non usiamo il campo `description` per l'immagine OG perché dipende dalla lista,
    // la lasceremo nella funzione che usa i dati.
    this.addJsonLdCollectionPageAndBreadcrumbs(pageTitle, description);
    this.addJsonLdFaqPage();
  }
}
