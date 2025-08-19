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
import { Router, ActivatedRoute, RouterLink } from '@angular/router';

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

  private siteBaseUrl = '';

  // Riferimenti ai <script> JSON-LD per cleanup
  private itemListSchemaScript?: HTMLScriptElement;
  private collectionSchemaScript?: HTMLScriptElement;
  private breadcrumbsSchemaScript?: HTMLScriptElement;

  fontsLoaded = false;

  // --- Stato (signals per evitare FormsModule) ---
  private _searchTerm = signal<string>('');
  private _selectedCategory = signal<string>('');
  private _selectedAlcoholic = signal<string>('');
  private _isExpanded = signal<boolean>(false);

  // getter per template
  searchTerm = this._searchTerm;
  selectedCategory = this._selectedCategory;
  selectedAlcoholic = this._selectedAlcoholic;
  isExpanded = this._isExpanded;

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
      'Cocktail Explorer: Recipes, Ingredients & Guides | Fizzando'
    );

    // reagisci ai parametri di query
    this.route.queryParams.subscribe((params) => {
      const q = (params['search'] as string) || '';
      const cat = (params['category'] as string) || '';
      const alc = (params['alcoholic'] as string) || '';
      const page = parseInt(params['page'], 10) || 1;

      this._searchTerm.set(q);
      this._selectedCategory.set(cat);
      this._selectedAlcoholic.set(alc);
      this.currentPage = page;

      this.loadCocktails();
    });

    // fonts loaded → class per controllare FOUT
    if (this.isBrowser && (document as any)?.fonts?.ready) {
      (document as any).fonts.ready.then(() => (this.fontsLoaded = true));
    } else if (this.isBrowser) {
      requestAnimationFrame(() => (this.fontsLoaded = true));
    }
  }

  ngOnDestroy(): void {
    if (this.searchDebounceHandle) {
      clearTimeout(this.searchDebounceHandle);
    }
    this.cleanupSeo();
  }

  // --- Handlers per template (evitano cast in HTML) ---
  onSearchInput(e: Event) {
    const v = (e.target as HTMLInputElement).value ?? '';
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

  // --- Data/UI ---
  loadCocktails(): void {
    this.loading = true;
    this.error = null;
    this.cocktails = [];

    this.cocktailService
      .getCocktails(
        this.currentPage,
        this.pageSize,
        this._searchTerm(),
        this._selectedCategory(),
        this._selectedAlcoholic()
      )
      .subscribe({
        next: (res) => {
          if (res?.data?.length) {
            this.cocktails = res.data.map((cocktail) => {
              const randomValue = Math.random();
              const isTall = randomValue < 0.2;
              const isWide = !isTall && randomValue < 0.35;
              return {
                ...cocktail,
                isTall,
                isWide,
                matchedIngredientCount: 0,
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

          // Scroll-to-top solo nel browser e fuori da Angular
          if (this.isBrowser) {
            this.ngZone.runOutsideAngular(() => {
              requestAnimationFrame(() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              });
            });
          }

          // ⬇️ Aggiorna SEO dopo il caricamento dei dati
          this.setSeoTagsAndSchemaList();
        },
        error: () => {
          this.error = 'Impossibile caricare i cocktail. Riprova più tardi.';
          this.loading = false;
          this.totalItems = 0;
          this.totalPages = 0;
          this.cocktails = [];
          this.setSeoTagsAndSchemaList(); // aggiornati comunque per stato errore
        },
      });
  }

  // debounce 300ms per la search
  private debounceNavigateForSearch(): void {
    if (this.searchDebounceHandle) clearTimeout(this.searchDebounceHandle);
    this.searchDebounceHandle = setTimeout(() => {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { search: this._searchTerm() || null, page: 1 },
        queryParamsHandling: 'merge',
      });
    }, 300);
  }

  applyFilters(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        category: this._selectedCategory() || null,
        alcoholic: this._selectedAlcoholic() || null,
        search: this._searchTerm() || null,
        page: 1,
      },
      queryParamsHandling: 'merge',
    });
  }

  clearFilters(): void {
    this._searchTerm.set('');
    this._selectedCategory.set('');
    this._selectedAlcoholic.set('');

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
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { page },
        queryParamsHandling: 'merge',
      });
    }
  }

  trackByCocktailId(_index: number, cocktail: CocktailWithLayout): number {
    return cocktail.id;
  }

  toggleFaq(faqItem: FaqItemState): void {
    faqItem.isExpanded = !faqItem.isExpanded;
  }

  getActiveFiltersText(): string {
    const active: string[] = [];
    if (this._searchTerm()) active.push(`"${this._searchTerm()}"`);
    if (this._selectedCategory()) active.push(this._selectedCategory());
    if (this._selectedAlcoholic()) active.push(this._selectedAlcoholic());
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

  private buildUrlWithParams(
    patch: Record<string, string | number | null>
  ): string {
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

  // === SEO: Title & Description dinamici ===
  private buildDynamicTitle(): string {
    const parts: string[] = [];

    if (this._searchTerm()) parts.push(`Search: "${this._searchTerm()}"`);
    if (this._selectedCategory()) parts.push(this._selectedCategory());
    if (this._selectedAlcoholic()) parts.push(this._selectedAlcoholic());

    const base = parts.length
      ? `Cocktail Explorer • ${parts.join(' • ')}`
      : 'Cocktail Explorer';
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

    const results =
      this.totalItems > 0
        ? `Browse ${this.totalItems} cocktails`
        : 'Browse cocktail recipes';
    bits.push(results);

    const filters: string[] = [];
    if (this._searchTerm()) filters.push(`search "${this._searchTerm()}"`);
    if (this._selectedCategory())
      filters.push(`category ${this._selectedCategory()}`);
    if (this._selectedAlcoholic()) filters.push(this._selectedAlcoholic());
    if (filters.length) bits.push(`filtered by ${filters.join(', ')}`);

    bits.push(
      'Discover classics, tropicals, sours, sparkling and more. Images, ABV, ingredients and glassware included.'
    );
    return this.truncate(bits.join('. ') + '.', 158);
  }

  private truncate(text: string, maxLen: number): string {
    if (!text) return '';
    return text.length <= maxLen
      ? text
      : text.slice(0, maxLen - 1).trimEnd() + '…';
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

    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': itemListId,
      name: 'Cocktail Explorer',
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      numberOfItems: this.cocktails.length,
      url: pageAbsUrl,
      itemListElement: this.cocktails.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: this.getFullSiteUrl(`/cocktails/${c.slug}`),
        name: c.name,
        image: this.getCocktailImageUrl(c),
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

  private cleanupJsonLdScript(ref?: HTMLScriptElement) {
    const head = this.doc?.head;
    if (!head || !ref) return;
    if (head.contains(ref)) {
      this.renderer.removeChild(head, ref);
    }
  }

  // === SEO: impostazione completa per LIST ===
  private setSeoTagsAndSchemaList(): void {
    const title = this.buildDynamicTitle();
    const description = this.buildDynamicDescription();

    // Titolo e meta standard
    this.titleService.setTitle(title);
    this.metaService.updateTag({ name: 'description', content: description });

    // Canonical corrente
    const canonicalAbs = this.getFullSiteUrl(this.router.url);
    this.setCanonicalLink(canonicalAbs);

    // Prev / Next
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

    // OpenGraph / Twitter
    const ogImage =
      this.cocktails.length > 0
        ? this.getCocktailImageUrl(this.cocktails[0])
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
  }

  // === SEO: cleanup al destroy ===
  private cleanupSeo(): void {
    // Rimuovi OG/Twitter
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

    // Prev/Next
    const head = this.doc?.head;
    if (head) {
      head
        .querySelectorAll('link[rel="prev"], link[rel="next"]')
        .forEach((el) => this.renderer.removeChild(head, el));
    }

    // JSON-LD
    this.cleanupJsonLdScript(this.itemListSchemaScript);
    this.cleanupJsonLdScript(this.collectionSchemaScript);
    this.cleanupJsonLdScript(this.breadcrumbsSchemaScript);
  }
}
