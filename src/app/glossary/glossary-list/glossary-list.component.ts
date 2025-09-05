import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  Inject,
  PLATFORM_ID,
  NgZone,
  Renderer2,
} from '@angular/core';
import { CommonModule, isPlatformBrowser, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router, ActivatedRoute } from '@angular/router';

import { GlossaryCardComponent } from '../glossary-card/glossary-card.component';
import { GlossaryService, GlossaryTerm } from '../../services/glossary.service';
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';

import { Subject, Subscription, Observable } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { Title, Meta } from '@angular/platform-browser';

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
  selector: 'app-glossary-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    GlossaryCardComponent,
    DevAdsComponent,
  ],
  templateUrl: './glossary-list.component.html',
  styleUrls: ['./glossary-list.component.scss'],
  animations: [
    trigger('accordionAnimation', [
      state('void', style({ height: '0', opacity: 0, overflow: 'hidden' })),
      state('closed', style({ height: '0', opacity: 0, overflow: 'hidden' })),
      state('open', style({ height: '*', opacity: 1, overflow: 'hidden' })),
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
  ],
})
export class GlossaryListComponent implements OnInit, OnDestroy {
  // DATA
  terms: GlossaryTerm[] = [];
  visibleTerms: GlossaryTerm[] = []; // pagina corrente (= terms)
  loading = false; // aggiornato SOLO dal servizio
  error: string | null = null;

  // FILTRI
  searchTerm: string = '';
  selectedCategory: string = '';

  // PAGINAZIONE
  currentPage: number = 1;
  pageSize: number = 15;
  totalItems: number = 0;
  totalPages: number = 0;
  readonly paginationRange = 2;

  // STREAM
  categories$: Observable<string[]> = new Observable<string[]>();

  // UI
  isExpanded: boolean = false;

  // ADV
  isMobile = false;
  adInterval = 6;
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  private recalcAdInterval(): void {
    this.adInterval = this.randomBetween(8, 11);
  }

  // SUBS
  private searchTermsSubject = new Subject<string>();
  private searchSubscription?: Subscription;
  private termsDataSubscription?: Subscription;
  private totalItemsSubscription?: Subscription;
  private qpSub?: Subscription;
  private loadingSub?: Subscription;

  // FAQ
  faqs: FaqItemState[] = [
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
  ];

  // Scroll system (come IngredientList)
  private pendingScroll: 'none' | 'filter' | 'search' | 'page' = 'none';
  private frozenY = 0;
  private isScrollFrozen = false;
  private prevScrollBehavior = '';
  private listHeightLocked = false;
  private preventTouchMove = (e: TouchEvent) => e.preventDefault();
  private lastScrollYBeforeNav = 0;

  private readonly isBrowser: boolean;
  private readonly isIOS: boolean;
  private readonly isAndroid: boolean;
  private get freezeSafe(): boolean {
    return !(this.isIOS || this.isAndroid);
  }

  // ===== SEO state =====
  private siteBaseUrl = '';
  private itemListSchemaScript?: HTMLScriptElement;
  private collectionSchemaScript?: HTMLScriptElement;
  private breadcrumbsSchemaScript?: HTMLScriptElement;
  private faqSchemaScript?: HTMLScriptElement;
  private definedSetSchemaScript?: HTMLScriptElement;

  constructor(
    private glossaryService: GlossaryService,
    private titleService: Title,
    private router: Router,
    private route: ActivatedRoute,
    @Inject(PLATFORM_ID) platformId: Object,
    private ngZone: NgZone,
    private renderer: Renderer2,
    @Inject(DOCUMENT) private doc: Document,
    private metaService: Meta
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.isIOS = this.isBrowser && /iP(ad|hone|od)/i.test(navigator.userAgent);
    this.isAndroid = this.isBrowser && /Android/i.test(navigator.userAgent);
    if (this.isBrowser) {
      this.checkScreenWidth();
      this.siteBaseUrl = window.location.origin;
    }
  }

  ngOnInit(): void {
    // Titolo pagina
    this.titleService.setTitle(
      'Cocktail Glossary: Terms, Techniques & Definitions | Fizzando'
    );

    // binding loader al servizio (unica fonte di verità)
    this.loadingSub = this.glossaryService.loading$.subscribe(
      (isLoading) => (this.loading = isLoading)
    );

    // Categorie
    this.categories$ = this.glossaryService.getCategories();

    // Dati pagina
    this.termsDataSubscription = this.glossaryService
      .getCurrentTerms()
      .subscribe(
        (data) => {
          this.terms = data.terms;
          this.visibleTerms = this.terms; // no slice
          this.totalItems = data.total;
          this.currentPage = data.currentPage;
          this.totalPages = Math.max(
            1,
            Math.ceil(this.totalItems / this.pageSize)
          );
          this.error = null;

          // sblocca altezza lista e gestisci scroll post-render
          this.unlockListHeight();
          const intent = this.pendingScroll;
          this.pendingScroll = 'none';
          if (this.isBrowser && intent === 'page') {
            this.scrollToFirstCardAfterRender();
          }

          // === SEO/Schema ===
          this.applyAnchorIds(); // assegna id="term-<slug>" alle card
          this.setSeoTagsAndSchemaList(); // meta + JSON-LD (DefinedTermSet, ItemList, ecc.)
        },
        (error) => {
          console.error('GLOSSARY COMPONENT: Error fetching terms:', error);
          this.error = 'Failed to load glossary terms. Please try again later.';
          this.unlockListHeight();

          // aggiorna meta anche in errore (no-results)
          this.applyAnchorIds();
          this.setSeoTagsAndSchemaList();
        }
      );

    // Totale -> aggiorna totalPages quando cambia
    this.totalItemsSubscription = this.glossaryService
      .getTotalItems()
      .subscribe((total) => {
        this.totalItems = total;
        this.totalPages = Math.max(
          1,
          Math.ceil(this.totalItems / this.pageSize)
        );
      });

    // Query params → cambio pagina
    this.qpSub = this.route.queryParams.subscribe((params) => {
      const p = parseInt(params['page'], 10) || 1;
      if (p !== this.currentPage) {
        this.currentPage = Math.max(1, p);
        this.recalcAdInterval();
        this.glossaryService.setPage(this.currentPage);
      }
      // opzionale: riflette anche search/category nelle UI
      if (typeof params['search'] === 'string')
        this.searchTerm = params['search'];
      if (typeof params['category'] === 'string')
        this.selectedCategory = params['category'];
    });

    // Debounce ricerca (digita → 1 sola richiesta)
    this.searchSubscription = this.searchTermsSubject
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe((term) => {
        this.currentPage = 1;
        this.recalcAdInterval();
        this.pendingScroll = 'search';

        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {
            page: 1,
            search: term || null,
            category: this.selectedCategory || null,
          },
          queryParamsHandling: 'merge',
          state: { suppressScroll: true },
        });

        this.glossaryService.setFilters(term, this.selectedCategory, 1);
      });

    // Caricamento iniziale
    const initialPage = Math.max(
      1,
      parseInt(this.route.snapshot.queryParamMap.get('page') || '1', 10)
    );
    // allinea anche i filtri dallo snapshot (se presenti in URL)
    this.searchTerm = this.route.snapshot.queryParamMap.get('search') || '';
    this.selectedCategory =
      this.route.snapshot.queryParamMap.get('category') || '';

    this.recalcAdInterval();
    this.glossaryService.setFilters(
      this.searchTerm,
      this.selectedCategory,
      initialPage
    );
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
    this.termsDataSubscription?.unsubscribe();
    this.totalItemsSubscription?.unsubscribe();
    this.qpSub?.unsubscribe();
    this.loadingSub?.unsubscribe();
    this.unfreezeScroll(false);
    this.unlockListHeight();
    this.cleanupSeo(); // << rimuove meta/JSON-LD aggiunti
  }

  // ===== Ricerca / Filtri =====
  onSearchTermChange(): void {
    this.searchTermsSubject.next(this.searchTerm || '');
  }

  applyFilters(): void {
    this.currentPage = 1;
    this.recalcAdInterval();
    this.pendingScroll = 'filter';

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        page: 1,
        category: this.selectedCategory || null,
        search: this.searchTerm || null,
      },
      queryParamsHandling: 'merge',
      state: { suppressScroll: true },
    });

    this.glossaryService.setFilters(this.searchTerm, this.selectedCategory, 1);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedCategory = '';
    this.currentPage = 1;
    this.recalcAdInterval();
    this.pendingScroll = 'filter';

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: null, category: null, search: null },
      queryParamsHandling: 'merge',
      state: { suppressScroll: true },
    });

    // un solo trigger "atomico": niente next('') aggiuntivi
    this.glossaryService.resetFilters();
  }

  // ===== Paginatore (stile IngredientList) =====
  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;

    if (this.freezeSafe) {
      this.freezeScroll(); // desktop: freeze viewport
      this.lockListHeight(); // blocca altezza lista per evitare salti
    } else if (this.isBrowser) {
      this.lastScrollYBeforeNav = window.scrollY; // mobile: memorizza
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

  // href builder per numeri di pagina
  buildUrlWithParams(patch: Record<string, string | number | null>): string {
    const path = this.router.url.split('?')[0] || '/glossary';
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

  // ===== UI/Accessibilità =====
  trackByTermId(_index: number, term: GlossaryTerm): number {
    return term.id;
  }

  toggleExpansion(): void {
    this.isExpanded = !this.isExpanded;
  }

  toggleFaq(faqItem: FaqItemState): void {
    faqItem.isExpanded = !faqItem.isExpanded;
  }

  getActiveFiltersText(): string {
    const active: string[] = [];
    if (this.searchTerm) active.push(`"${this.searchTerm}"`);
    if (this.selectedCategory) active.push(this.selectedCategory);
    return active.length ? active.join(', ') : 'No filters active';
  }

  // Range visibile (1-based)
  get pageStart(): number {
    if (this.totalItems === 0) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }
  get pageEnd(): number {
    if (this.totalItems === 0) return 0;
    return Math.min(this.currentPage * this.pageSize, this.totalItems);
  }

  // ===== Responsiveness =====
  @HostListener('window:resize')
  onResize(): void {
    if (this.isBrowser) this.checkScreenWidth();
  }
  private checkScreenWidth(): void {
    if (!this.isBrowser) return;
    this.isMobile = window.innerWidth <= 600;
  }

  // ===== Scroll helpers (copiato dallo schema IngredientList) =====
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

  private lockListHeight(): void {
    if (!this.isBrowser || this.listHeightLocked) return;
    const list = document.querySelector(
      '.glossary-list, .glossary-grid-container'
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
      '.glossary-list, .glossary-grid-container'
    ) as HTMLElement | null;
    if (list) {
      list.style.minHeight = '';
      list.style.maxHeight = '';
      list.style.overflow = '';
    }
    this.listHeightLocked = false;
  }

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

  private scrollToFirstCardAfterRender(): void {
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          this.unfreezeScroll(true);

          const firstCard = document.querySelector(
            '.glossary-list app-glossary-card, .glossary-grid-container app-glossary-card'
          ) as HTMLElement | null;

          const listEl =
            firstCard ||
            (document.querySelector(
              '.glossary-list, .glossary-grid-container'
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

          setTimeout(
            () =>
              (() => {
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
              })(),
            260
          );
        }, 70);
      });
    });
  }

  // ======== SEO / Schema.org (LIST PAGE con ancore, senza dettagli) ========

  /** Assegna id="term-<slug>" ai <app-glossary-card> per creare ancore interne */
  private applyAnchorIds(): void {
    if (!this.isBrowser) return;
    const cards = Array.from(
      document.querySelectorAll(
        '.glossary-grid-container app-glossary-card, .glossary-list app-glossary-card'
      )
    ) as HTMLElement[];

    cards.forEach((el, i) => {
      const slug =
        this.visibleTerms[i]?.slug ||
        this.slugify(this.visibleTerms[i]?.term || '');
      if (slug) this.renderer.setAttribute(el, 'id', `term-${slug}`);
    });
  }

  private slugify(input: string): string {
    return (input || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private getFullSiteUrl(pathOrUrl: string): string {
    if (!this.siteBaseUrl) return pathOrUrl;
    return pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.siteBaseUrl}${pathOrUrl}`;
  }

  private buildDynamicTitle(): string {
    const parts: string[] = [];
    if (this.searchTerm) parts.push(`Search: "${this.searchTerm}"`);
    if (this.selectedCategory) parts.push(this.selectedCategory);

    const base = parts.length
      ? `Cocktail Glossary • ${parts.join(' • ')}`
      : 'Cocktail Glossary';

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
        ? `Explore ${this.totalItems} mixology terms`
        : 'Explore mixology terms'
    );

    const filters: string[] = [];
    if (this.searchTerm) filters.push(`search "${this.searchTerm}"`);
    if (this.selectedCategory)
      filters.push(`category ${this.selectedCategory}`);
    if (filters.length) bits.push(`filtered by ${filters.join(', ')}`);

    bits.push('Definitions, techniques and bar lingo explained clearly.');
    const txt = bits.join('. ') + '.';
    return txt.length <= 158 ? txt : txt.slice(0, 157).trimEnd() + '…';
  }

  /** SEO: meta + canonical/prev/next + JSON-LD (DefinedTermSet, ItemList, CollectionPage, FAQ) */
  private setSeoTagsAndSchemaList(): void {
    if (!this.isBrowser) return;

    const run = () => {
      const title = this.buildDynamicTitle();
      const description = this.buildDynamicDescription();

      // <title> + meta description
      this.titleService.setTitle(title);
      this.metaService.updateTag({ name: 'description', content: description });

      // canonical (URL completo con query)
      const canonicalAbs = this.getFullSiteUrl(this.router.url);
      this.setCanonicalLink(canonicalAbs);

      // prev/next per paginator
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
      const ogImage = this.getFullSiteUrl('/assets/og-default.png');
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
      this.addJsonLdDefinedTermSet(); // glossario semantico
      this.addJsonLdItemListReferencingAnchors(); // compatibilità rich results
      this.addJsonLdCollectionPageAndBreadcrumbs(title, description);
      this.addJsonLdFaqPage();
    };

    const ric: (cb: () => void) => any =
      (window as any).requestIdleCallback ||
      ((cb: () => void) => setTimeout(cb, 1));
    ric(run);
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

  /** Pulisce uno script JSON-LD precedente */
  private cleanupJsonLdScript(ref?: HTMLScriptElement) {
    const head = this.doc?.head;
    if (!head || !ref) return;
    if (head.contains(ref)) this.renderer.removeChild(head, ref);
  }

  /** DefinedTermSet (+ DefinedTerm) con ancore interne */
  private addJsonLdDefinedTermSet(): void {
    const head = this.doc?.head;
    if (!head) return;

    this.cleanupJsonLdScript(this.definedSetSchemaScript);

    const script = this.renderer.createElement('script');
    this.renderer.setAttribute(script, 'type', 'application/ld+json');
    this.renderer.setAttribute(script, 'id', 'glossary-definedtermset-schema');

    const pageAbsUrl = this.getFullSiteUrl(this.router.url);
    const setId = pageAbsUrl + '#defined-term-set';

    const terms = this.visibleTerms.map((t) => {
      const slug = t.slug || this.slugify(t.term);
      const termId = pageAbsUrl + '#term-' + slug;
      return {
        '@type': 'DefinedTerm',
        '@id': termId,
        name: t.term,
        description: t.description,
        inDefinedTermSet: { '@id': setId },
      };
    });

    const definedTermSet = {
      '@context': 'https://schema.org',
      '@type': 'DefinedTermSet',
      '@id': setId,
      name: 'Cocktail Glossary',
      hasDefinedTerm: terms,
    };

    this.renderer.appendChild(
      script,
      this.renderer.createText(JSON.stringify(definedTermSet))
    );
    this.renderer.appendChild(head, script);
    this.definedSetSchemaScript = script as HTMLScriptElement;
  }

  /** ItemList che referenzia le stesse ancore (compatibilità rich results) */
  private addJsonLdItemListReferencingAnchors(): void {
    const head = this.doc?.head;
    if (!head) return;

    this.cleanupJsonLdScript(this.itemListSchemaScript);

    const script = this.renderer.createElement('script');
    this.renderer.setAttribute(script, 'type', 'application/ld+json');
    this.renderer.setAttribute(script, 'id', 'glossary-itemlist-schema');

    const pageAbsUrl = this.getFullSiteUrl(this.router.url);
    const collectionId = pageAbsUrl + '#collection';
    const startIndex = this.pageStart || 1;

    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': pageAbsUrl + '#itemlist',
      name: 'Cocktail Glossary',
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      numberOfItems: this.totalItems,
      startIndex,
      url: pageAbsUrl,
      isPartOf: { '@id': collectionId },
      itemListElement: this.visibleTerms.map((t, i) => {
        const slug = t.slug || this.slugify(t.term);
        return {
          '@type': 'ListItem',
          position: startIndex + i,
          item: {
            '@type': 'DefinedTerm',
            '@id': pageAbsUrl + '#term-' + slug,
            name: t.term,
            description: t.description,
          },
        };
      }),
    };

    this.renderer.appendChild(
      script,
      this.renderer.createText(JSON.stringify(itemList))
    );
    this.renderer.appendChild(head, script);
    this.itemListSchemaScript = script as HTMLScriptElement;
  }

  /** CollectionPage + Breadcrumbs */
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
    this.renderer.setAttribute(coll, 'id', 'glossary-collectionpage-schema');

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
    this.renderer.setAttribute(bc, 'id', 'glossary-breadcrumbs-schema');

    const crumbs = [
      { name: 'Home', url: this.getFullSiteUrl('/') },
      { name: 'Glossary', url: this.getFullSiteUrl('/glossary') },
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

  /** FAQPage sintetica (coerente con i tuoi contenuti) */
  private addJsonLdFaqPage(): void {
    const head = this.doc?.head;
    if (!head) return;

    this.cleanupJsonLdScript(this.faqSchemaScript);

    const script = this.renderer.createElement('script');
    this.renderer.setAttribute(script, 'type', 'application/ld+json');
    this.renderer.setAttribute(script, 'id', 'glossary-faq-schema');

    const faq = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What kind of terms can I find in the Cocktail Glossary?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Definitions for ingredients, bar tools, techniques, historical terms, and drink styles.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I filter terms by category?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Use the Category dropdown in the Filters section to narrow results.',
          },
        },
        {
          '@type': 'Question',
          name: 'How often is the glossary updated?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'We periodically review and add new terms to keep the glossary current.',
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

  /** Cleanup meta/JSON-LD e link prev/next */
  private cleanupSeo(): void {
    // Social meta
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

    // link prev/next
    const head = this.doc?.head;
    if (head) {
      head
        .querySelectorAll('link[rel="prev"], link[rel="next"]')
        .forEach((el) => this.renderer.removeChild(head, el));
    }

    // JSON-LD scripts
    this.cleanupJsonLdScript(this.itemListSchemaScript);
    this.cleanupJsonLdScript(this.collectionSchemaScript);
    this.cleanupJsonLdScript(this.breadcrumbsSchemaScript);
    this.cleanupJsonLdScript(this.faqSchemaScript);
    this.cleanupJsonLdScript(this.definedSetSchemaScript);
  }
}
