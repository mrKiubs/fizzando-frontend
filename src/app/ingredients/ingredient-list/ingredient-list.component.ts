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
import { CommonModule, isPlatformBrowser, DOCUMENT } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Title, Meta } from '@angular/platform-browser';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';

import {
  IngredientService,
  Ingredient,
} from '../../services/ingredient.service';

import { IngredientCardComponent } from '../ingredient-card/ingredient-card.component';
import { env } from '../../config/env';
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';
import { AffiliateProductComponent } from '../../assets/design-system/affiliate-product/affiliate-product.component';

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
  selector: 'app-ingredient-list',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    RouterLink,
    IngredientCardComponent,
    DevAdsComponent,
    AffiliateProductComponent,
  ],
  templateUrl: './ingredient-list.component.html',
  styleUrls: ['./ingredient-list.component.scss'],
})
export class IngredientListComponent implements OnInit, OnDestroy {
  // --- SSR / Browser env ---
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly ngZone = inject(NgZone);
  private readonly renderer = inject(Renderer2);
  private readonly doc = inject(DOCUMENT) as Document;

  private siteBaseUrl = '';

  // Riferimenti ai <script> JSON-LD per cleanup
  private itemListSchemaScript?: HTMLScriptElement;
  private collectionSchemaScript?: HTMLScriptElement;
  private breadcrumbsSchemaScript?: HTMLScriptElement;
  private faqSchemaScript?: HTMLScriptElement;

  fontsLoaded = false;

  // --- Stato via signals (come CocktailList) ---
  private _searchTerm = signal<string>('');
  private _selectedAlcoholic = signal<string>(''); // '', 'true', 'false'
  private _selectedType = signal<string>(''); // label ufficiale (es. 'Liqueurs & Cordials')
  private _isExpanded = signal<boolean>(false);

  adInterval = 12; // default
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  private recalcAdInterval(): void {
    this.adInterval = this.randomBetween(11, 18);
  }

  // getter per template
  searchTerm = this._searchTerm;
  selectedAlcoholic = this._selectedAlcoholic;
  selectedType = this._selectedType;
  isExpanded = this._isExpanded;

  // --- Lista / Pagination (come CocktailList) ---
  ingredients: Ingredient[] = [];
  loading = false;
  error: string | null = null;
  currentPage = 1;
  pageSize = 23;
  totalItems = 0;
  totalPages = 0;
  isMobile = false;
  readonly paginationRange = 2;

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

  // --- Intento di scroll per UX condizionale ---
  private pendingScroll: 'none' | 'filter' | 'search' | 'page' = 'none';

  // --- Freeze scroll (desktop like CocktailList) ---
  private frozenY = 0;
  private isScrollFrozen = false;
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
  private lastScrollYBeforeNav = 0;

  // --- Dati statici (opzioni filtri) ---
  alcoholicOptions: string[] = ['Alcoholic', 'Non-Alcoholic']; // UI
  ingredientTypes: string[] = [
    'Spirits',
    'Liqueurs & Cordials',
    'Wines & Fortified Wines',
    'Bitters',
    'Syrups & Sweeteners',
    'Citrus Juices',
    'Fruit Juices (Non-Citrus)',
    'Carbonated Mixers',
    'Non-Carbonated Mixers',
    'Fresh Herbs & Botanicals',
    'Spices',
    'Fresh Fruits (Solid/Garnish)',
    'Vegetables (Non-Herb)',
    'Dairy & Eggs',
    'Other Extracts & Flavorings',
    'Salts & Sugars (Rimming/Specialty)',
    'Miscellaneous',
  ];

  // === slug <-> label helpers (NUOVO) ===
  private slugify(input: string): string {
    return input
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  private ingredientTypeSlugToLabel = new Map<string, string>(
    this.ingredientTypes.map((label) => [this.slugify(label), label])
  );

  faqs: FaqItemState[] = [
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
  ];

  // --- debounce senza RxJS ---
  private searchDebounceHandle: any = null;

  constructor(
    private ingredientService: IngredientService,
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
    // Titolo provvisorio
    this.titleService.setTitle(
      'Ingredient Explorer: Spirits, Mixers & More | Fizzando'
    );

    // Sub ai parametri di query (come CocktailList)
    this.route.queryParams.subscribe((params) => {
      const q = (params['search'] as string) || '';
      const alc = (params['alcoholic'] as string) || ''; // '', 'true', 'false'
      const typeParam = (params['type'] as string) || ''; // può essere slug o label
      const page = parseInt(params['page'], 10) || 1;

      this._searchTerm.set(q);
      this._selectedAlcoholic.set(alc === 'true' || alc === 'false' ? alc : '');

      // 🔁 SLUG → LABEL (per stato interno e select)
      let mappedLabel = '';
      if (typeParam) {
        const fromMap = this.ingredientTypeSlugToLabel.get(
          typeParam.toLowerCase()
        );
        if (fromMap) {
          mappedLabel = fromMap; // è uno slug valido
        } else {
          // fallback: qualcuno ha messo direttamente la label
          const direct = this.ingredientTypes.find(
            (t) => t.toLowerCase() === typeParam.toLowerCase()
          );
          mappedLabel = direct || '';
        }
      }
      this._selectedType.set(mappedLabel);

      this.currentPage = page;
      this.recalcAdInterval();
      this.loadIngredients();
    });

    // Fonts loaded
    if (this.isBrowser && (document as any)?.fonts?.ready) {
      (document as any).fonts.ready.then(() => (this.fontsLoaded = true));
    } else if (this.isBrowser) {
      requestAnimationFrame(() => (this.fontsLoaded = true));
    }
  }

  ngOnDestroy(): void {
    if (this.searchDebounceHandle) clearTimeout(this.searchDebounceHandle);
    this.cleanupSeo();
  }

  // === Handlers / setters (no FormsModule) ===
  setSearch = (v: string) => {
    this._searchTerm.set(v);
    this.debounceNavigateForSearch();
  };
  setAlcoholicUi = (v: string) => {
    // dalla UI ('Alcoholic'/'Non-Alcoholic') → query param 'true'/'false'/''
    const mapped =
      v === 'Alcoholic' ? 'true' : v === 'Non-Alcoholic' ? 'false' : '';
    this._selectedAlcoholic.set(mapped);
    this.applyFilters();
  };
  setType = (v: string) => {
    this._selectedType.set(v || '');
    this.applyFilters();
  };
  toggleExpansion = () => this._isExpanded.update((v) => !v);

  onSearchInput(e: Event) {
    const v = (e.target as HTMLInputElement).value ?? '';
    this.setSearch(v);
  }

  // === Data/UI ===
  loadIngredients(): void {
    this.loading = true;
    this.error = null;

    const alcParam = this._selectedAlcoholic();
    const isAlcoholic =
      alcParam === 'true' ? true : alcParam === 'false' ? false : undefined;

    this.ingredientService
      .getIngredients(
        this.currentPage,
        this.pageSize,
        this._searchTerm(),
        isAlcoholic,
        this._selectedType() || undefined // PASSO LA LABEL al servizio
      )
      .subscribe({
        next: (res) => {
          this.ingredients = res?.data ?? [];
          this.totalItems = res?.meta?.pagination?.total ?? 0;
          this.totalPages = res?.meta?.pagination?.pageCount ?? 0;

          this.loading = false;
          this.unlockListHeight(); // ✅ sblocca quando i nuovi item sono in pagina

          const intent = this.pendingScroll;
          this.pendingScroll = 'none';
          if (this.isBrowser && intent === 'page') {
            this.scrollToFirstCardAfterRender();
          }

          this.setSeoTagsAndSchemaList();
        },
        error: (err) => {
          this.error = 'Unable to load ingredients. Please try again later.';
          this.loading = false;
          this.totalItems = 0;
          this.totalPages = 0;
          this.unfreezeScroll(true);
          this.unlockListHeight();
          this.setSeoTagsAndSchemaList();
          console.error(err);
        },
      });
  }

  // debounce 300ms per la search
  private debounceNavigateForSearch(): void {
    if (this.searchDebounceHandle) clearTimeout(this.searchDebounceHandle);
    this.searchDebounceHandle = setTimeout(() => {
      this.pendingScroll = 'search';
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { search: this._searchTerm() || null, page: 1 },
        queryParamsHandling: 'merge',
        state: { suppressScroll: true },
      });
    }, 300);
  }

  applyFilters(): void {
    this.pendingScroll = 'filter';

    // LABEL → SLUG per l'URL
    const typeLabel = this._selectedType();
    const typeSlug = typeLabel ? this.slugify(typeLabel) : null;

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        alcoholic: this._selectedAlcoholic() || null, // 'true'/'false'/''
        type: typeSlug, // 👈 sempre slug in URL
        search: this._searchTerm() || null,
        page: 1,
      },
      queryParamsHandling: 'merge',
      state: { suppressScroll: true },
    });
  }

  clearFilters(): void {
    this.pendingScroll = 'filter';
    this._searchTerm.set('');
    this._selectedAlcoholic.set('');
    this._selectedType.set('');

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { alcoholic: null, type: null, search: null, page: null },
      queryParamsHandling: 'merge',
      state: { suppressScroll: true },
    });
  }

  // --- Paginatore identico ---
  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      if (this.freezeSafe) {
        this.freezeScroll(); // desktop
        this.lockListHeight(); // ✅ evita salto sulla lista
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
  showFirstEllipsis(): boolean {
    return this.totalPages > 1 && this.currentPage > this.paginationRange + 1;
  }
  showLastEllipsis(): boolean {
    return (
      this.totalPages > 1 &&
      this.currentPage < this.totalPages - this.paginationRange
    );
  }

  trackById(_index: number, ingredient: Ingredient): number {
    return ingredient.id;
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
    return this.router.url.split('?')[0] || '/ingredients';
  }

  getIngredientImageUrl(ing: Ingredient | undefined): string {
    const u = (ing as any)?.image?.url as string | undefined;
    if (u) {
      return u.startsWith('http') ? u : env.apiUrl + u;
    }
    return this.getFullSiteUrl('/assets/no-image.png');
  }

  // href builder per i numeri di pagina
  buildUrlWithParams(patch: Record<string, string | number | null>): string {
    const path = this.getCurrentPath();
    const current = { ...this.route.snapshot.queryParams } as Record<
      string,
      any
    >;
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v === null) delete current[k];
      else current[k] = String(v);
    }
    const qs = new URLSearchParams(current as any).toString();
    return qs ? `${path}?${qs}` : path;
  }

  // === UI helpers ===
  getActiveFiltersText(): string {
    const active: string[] = [];
    if (this._searchTerm()) active.push(`"${this._searchTerm()}"`);
    if (this._selectedAlcoholic() === 'true') active.push('Alcoholic');
    if (this._selectedAlcoholic() === 'false') active.push('Non-Alcoholic');
    if (this._selectedType()) active.push(this._selectedType());
    return active.length ? active.join(', ') : 'No filters active';
  }

  // Range visibile (1-based)
  get pageStart(): number {
    return this.totalItems > 0 ? (this.currentPage - 1) * this.pageSize + 1 : 0;
  }
  get pageEnd(): number {
    return this.totalItems > 0
      ? Math.min(this.currentPage * this.pageSize, this.totalItems)
      : 0;
  }

  // === SEO dinamico / JSON-LD (allineato) ===
  /** ——— SEO: title/description dinamici ——— */
  private buildDynamicTitle(): string {
    const parts: string[] = [];
    if (this._searchTerm()) parts.push(`Search: "${this._searchTerm()}"`);
    if (this._selectedType()) parts.push(this._selectedType());
    if (this._selectedAlcoholic() === 'true') parts.push('Alcoholic');
    if (this._selectedAlcoholic() === 'false') parts.push('Non-Alcoholic');

    const base = parts.length
      ? `Ingredient Explorer • ${parts.join(' • ')}`
      : 'Ingredient Explorer';

    const pageSuffix =
      this.totalPages > 1
        ? ` (Page ${this.currentPage}${
            this.totalPages ? ' of ' + this.totalPages : ''
          })`
        : '';

    return `${base}${pageSuffix} | Fizzando`;
  }

  private buildDynamicDescription(): string {
    const bits: string[] = [];
    bits.push(
      this.totalItems > 0
        ? `Browse ${this.totalItems} cocktail ingredients`
        : 'Browse cocktail ingredients'
    );

    const filters: string[] = [];
    if (this._searchTerm()) filters.push(`search "${this._searchTerm()}"`);
    if (this._selectedType()) filters.push(`type ${this._selectedType()}`);
    if (this._selectedAlcoholic() === 'true') filters.push('alcoholic');
    if (this._selectedAlcoholic() === 'false') filters.push('non-alcoholic');
    if (filters.length) bits.push(`filtered by ${filters.join(', ')}`);

    bits.push(
      'Discover spirits, liqueurs, mixers, juices, syrups, herbs and more.'
    );
    return this.truncate(bits.join('. ') + '.', 158);
  }

  private truncate(text: string, maxLen: number): string {
    if (!text) return '';
    return text.length <= maxLen
      ? text
      : text.slice(0, maxLen - 1).trimEnd() + '…';
  }

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
      .forEach((el) => this.renderer.removeChild(head, el));

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

  /** ——— JSON-LD: ItemList della pagina ——— */
  private addJsonLdItemList(): void {
    const head = this.doc?.head;
    if (!head) return;

    this.cleanupJsonLdScript(this.itemListSchemaScript);

    const script = this.renderer.createElement('script');
    this.renderer.setAttribute(script, 'type', 'application/ld+json');
    this.renderer.setAttribute(script, 'id', 'ingredient-itemlist-schema');

    const pageAbsUrl = this.getFullSiteUrl(this.router.url);
    const itemListId = pageAbsUrl + '#itemlist';
    const collectionId = pageAbsUrl + '#collection';
    const startIndex = this.pageStart || 1;

    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': itemListId,
      name: 'Ingredient Explorer',
      inLanguage: 'en',
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      numberOfItems: this.totalItems,
      startIndex,
      url: pageAbsUrl,
      isPartOf: { '@id': collectionId },
      itemListElement: this.ingredients.map((it, i) => ({
        '@type': 'ListItem',
        position: startIndex + i,
        item: {
          '@type': 'Product',
          '@id': this.getFullSiteUrl(`/ingredients/${(it as any).slug}`),
          url: this.getFullSiteUrl(`/ingredients/${(it as any).slug}`),
          name: it.name,
          image: this.getIngredientImageUrl(it),
          brand: { '@type': 'Organization', name: 'Fizzando' },
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

  /** ——— JSON-LD: CollectionPage + Breadcrumbs ——— */
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
    const collectionId = pageAbsUrl + '#collection';

    const collectionPage = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': collectionId,
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
      { name: 'Ingredients', url: this.getFullSiteUrl('/ingredients') },
    ];

    const breadcrumbList = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
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

  /** ——— JSON-LD: FAQPage (allineato ai testi ingredienti, nessun link ai cocktails) ——— */
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
          name: 'What types of ingredients are included?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'The archive covers spirits, liqueurs & cordials, fortified wines, bitters, syrups & sweeteners, juices, mixers, fresh herbs, spices, fruits & vegetables, and dairy & eggs.',
          },
        },
        {
          '@type': 'Question',
          name: 'What information does each ingredient card show?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Each card highlights the name, image, type, and whether it’s alcoholic or non-alcoholic. Detailed pages may include ABV, flavor profile, common uses, origin, storage tips, and substitutions.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I substitute one ingredient for another?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes—many ingredients have practical substitutes. For example, Triple Sec and Cointreau are often interchangeable; rich syrup (2:1) can replace simple syrup by reducing volume; citrus swaps may work with recipe-specific tweaks.',
          },
        },
        {
          '@type': 'Question',
          name: 'How should I store different ingredients?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Keep spirits and liqueurs in a cool, dark place with the cap tightly sealed. Juices and syrups go in the fridge after opening; bitters are shelf-stable. Fresh herbs and fruit are best used quickly; store herbs dry and chilled, and citrus whole.',
          },
        },
        {
          '@type': 'Question',
          name: 'How do I know if an ingredient contains alcohol?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Ingredients are tagged as Alcoholic or Non-Alcoholic, and ABV is listed when available. Some items like bitters contain alcohol but are used in very small amounts—check the label and the ingredient profile.',
          },
        },
        {
          '@type': 'Question',
          name: 'Are there non-alcoholic alternatives for common spirits?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes—there are zero-proof options that mimic gin, rum, tequila, whiskey, and aperitifs. You can also build flavor with acid, bitterness, spice, and texture to achieve balance without alcohol.',
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

  /** ——— SEO deferrata: meta + OG/Twitter + canonical/prev/next + JSON-LD ——— */
  private setSeoTagsAndSchemaList(): void {
    if (!this.isBrowser) return;

    const run = () => {
      const title = this.buildDynamicTitle();
      const description = this.buildDynamicDescription();

      // <title> + meta description
      this.titleService.setTitle(title);
      this.metaService.updateTag({ name: 'description', content: description });

      // canonical
      const canonicalAbs = this.getFullSiteUrl(this.router.url);
      this.setCanonicalLink(canonicalAbs);

      // prev/next
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

      // Social
      const ogImage =
        this.ingredients.length > 0
          ? this.getIngredientImageUrl(this.ingredients[0])
          : this.getFullSiteUrl('/assets/og-default.png');

      this.metaService.updateTag({ property: 'og:title', content: title });
      this.metaService.updateTag({
        property: 'og:description',
        content: description,
      });
      this.metaService.updateTag({ property: 'og:url', content: canonicalAbs });
      this.metaService.updateTag({ property: 'og:type', content: 'website' });
      this.metaService.updateTag({ property: 'og:image', content: ogImage });
      this.metaService.updateTag({
        property: 'og:site_name',
        content: 'Fizzando',
      });

      this.metaService.updateTag({
        name: 'twitter:card',
        content: 'summary_large_image',
      });
      this.metaService.updateTag({ name: 'twitter:title', content: title });
      this.metaService.updateTag({
        name: 'twitter:description',
        content: description,
      });
      this.metaService.updateTag({ name: 'twitter:image', content: ogImage });

      // JSON-LD
      this.addJsonLdItemList();
      this.addJsonLdCollectionPageAndBreadcrumbs(title, description);
      this.addJsonLdFaqPage();
    };

    // Defer SEO to idle to avoid blocking LCP/CLS
    const ric: (cb: () => void) => any =
      (window as any).requestIdleCallback ||
      ((cb: () => void) => setTimeout(cb, 1));
    ric(run);
  }

  private cleanupJsonLdScript(ref?: HTMLScriptElement) {
    const head = this.doc?.head;
    if (!head || !ref) return;
    if (head.contains(ref)) this.renderer.removeChild(head, ref);
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

  // --- Offset per header/menu fixed (copiato) ---
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

  // --- Lock/unlock altezza lista (come CocktailList) ---
  private lockListHeight(): void {
    if (!this.isBrowser || this.listHeightLocked) return;
    const list = document.querySelector(
      '.ingredient-list, .cocktail-list'
    ) as HTMLElement | null;
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
    const list = document.querySelector(
      '.ingredient-list, .cocktail-list'
    ) as HTMLElement | null;
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
            '.cocktail-list app-ingredient-card, .ingredient-list app-ingredient-card'
          ) as HTMLElement | null;
          const listEl =
            firstCard ||
            (document.querySelector(
              '.cocktail-list, .ingredient-list'
            ) as HTMLElement | null) ||
            (document.querySelector(
              '.ingredient-card-legend'
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

  toggleFaq(faqItem: FaqItemState): void {
    faqItem.isExpanded = !faqItem.isExpanded;
  }
}
