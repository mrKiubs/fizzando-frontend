import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  inject,
  PLATFORM_ID,
  NgZone,
  ViewChild,
  ElementRef,
  Renderer2,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  Router,
  ActivatedRoute,
  RouterModule,
  NavigationEnd,
} from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subscription, Subject, forkJoin, of } from 'rxjs';
import {
  filter,
  debounceTime,
  distinctUntilChanged,
  switchMap,
  catchError,
  take,
} from 'rxjs/operators';
import { CocktailService, Cocktail } from '../services/strapi.service';
import { IngredientService, Ingredient } from '../services/ingredient.service';
import { GlossaryService } from '../services/glossary.service';
import { BreadcrumbsComponent } from '../assets/design-system/breadcrumbs/breadcrumbs.component';
import { LogoComponent } from '../assets/design-system/logo/logo.component';
import { StickyHeaderDirective } from '../directives/sticky-header.directive';

@Component({
  selector: 'app-navbar',
  standalone: true,
  host: { ngSkipHydration: 'true' },
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    RouterModule,
    BreadcrumbsComponent,
    LogoComponent,
    StickyHeaderDirective,
  ],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly ngZone = inject(NgZone);

  @ViewChild('overlayRoot') overlayRoot!: ElementRef<HTMLElement>; // menu overlay
  @ViewChild('searchOverlayRoot') searchOverlayRoot!: ElementRef<HTMLElement>; // search overlay
  @ViewChild('overlaySearchInput')
  overlaySearchInput!: ElementRef<HTMLInputElement>;
  @ViewChild('menuToggle') menuToggleBtn!: ElementRef<HTMLButtonElement>;

  isMenuOpen = false;
  isSearchOpen = false;
  isScrolled = false;
  // live search (SOLO cocktail & ingredienti)
  overlaySearchTerm = '';
  isSearchInputFocused = false;
  liveSearchLoading = false;
  liveCocktailResults: Cocktail[] = [];
  liveIngredientResults: Ingredient[] = [];
  private searchTerms = new Subject<string>();
  private blurTimeout: any;
  private readonly TRANSITION_MS = 200;
  private waitAfterTransition(ms = this.TRANSITION_MS): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  // filtri e stato url
  selectedCocktailCategory = '';
  selectedIngredientType = '';
  selectedArticleCategory = '';

  selectedGlossaryCategory = '';
  glossaryCategories: string[] = [];
  activeGlossaryCategoryInUrl = '';

  activeCocktailCategoryInUrl = '';
  activeIngredientTypeInUrl = '';
  activeArticleCategoryInUrl = '';

  isHome = true;

  private routerSubscription?: Subscription;
  private searchSubscription?: Subscription;
  private lastFocused: HTMLElement | null = null;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private cocktailService: CocktailService,
    private ingredientService: IngredientService,
    private glossaryService: GlossaryService,
    private renderer: Renderer2
  ) {}

  ngOnInit(): void {
    const url0 = this.router.url.split('?')[0] || '/';
    this.isHome = url0 === '/';

    // categorie Glossary (dinamiche)
    this.glossaryService.getCategories().subscribe({
      next: (cats) => (this.glossaryCategories = cats || []),
      error: () => (this.glossaryCategories = []),
    });

    this.routerSubscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        const currentUrl = this.router.url;
        const urlParts = currentUrl.split('?');
        this.isHome = urlParts[0] === '/' || urlParts[0] === '';
        const urlParams = new URLSearchParams(urlParts[1] || '');

        if (urlParts[0].includes('/cocktails')) {
          this.selectedCocktailCategory = urlParams.get('category') || '';
          this.activeCocktailCategoryInUrl = this.selectedCocktailCategory;
        } else {
          this.selectedCocktailCategory = '';
          this.activeCocktailCategoryInUrl = '';
        }

        if (urlParts[0].includes('/ingredients')) {
          this.selectedIngredientType = urlParams.get('type') || '';
          this.activeIngredientTypeInUrl = this.selectedIngredientType;
        } else {
          this.selectedIngredientType = '';
          this.activeIngredientTypeInUrl = '';
        }

        if (urlParts[0].includes('/articles')) {
          this.selectedArticleCategory = urlParams.get('category') || '';
          this.activeArticleCategoryInUrl = this.selectedArticleCategory;
        } else {
          this.selectedArticleCategory = '';
          this.activeArticleCategoryInUrl = '';
        }

        if (urlParts[0].includes('/glossary')) {
          this.selectedGlossaryCategory = urlParams.get('category') || '';
          this.activeGlossaryCategoryInUrl = this.selectedGlossaryCategory;
        } else {
          this.selectedGlossaryCategory = '';
          this.activeGlossaryCategoryInUrl = '';
        }

        // chiudi overlay quando cambi pagina
        if (this.isMenuOpen) this.closeMenu();
        if (this.isSearchOpen) this.closeSearch();
      });

    // live search (SOLO cocktail/ingredienti)
    this.searchSubscription = this.searchTerms
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term: string) => {
          this.liveCocktailResults = [];
          this.liveIngredientResults = [];
          this.liveSearchLoading = false;

          if (term.length < 3 && !this.isSearchInputFocused) return of(null);
          if (term.length < 3) return of(null);

          this.liveSearchLoading = true;

          return forkJoin({
            cocktails: this.cocktailService
              .searchCocktailsByName(term)
              .pipe(catchError(() => of<Cocktail[]>([]))),
            ingredients: this.ingredientService
              .getIngredients(1, 10, term)
              .pipe(
                catchError(() =>
                  of({
                    data: [] as Ingredient[],
                    meta: {
                      pagination: {
                        page: 1,
                        pageSize: 0,
                        pageCount: 0,
                        total: 0,
                      },
                    },
                  })
                )
              ),
          }).pipe(catchError(() => of(null)));
        })
      )
      .subscribe((results) => {
        this.liveSearchLoading = false;
        if (results) {
          this.liveCocktailResults = results.cocktails;
          this.liveIngredientResults = results.ingredients.data;
        }
      });
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.searchSubscription?.unsubscribe();
    if (this.blurTimeout) clearTimeout(this.blurTimeout);
    this.setBackgroundInert(false);
    if (this.isBrowser) {
      document.body.style.overflow = '';
    }
  }

  @HostListener('window:scroll')
  onWindowScroll() {
    if (!this.isBrowser) return;
    const y =
      (typeof window !== 'undefined' && window.pageYOffset) ||
      (typeof document !== 'undefined' &&
        document.documentElement?.scrollTop) ||
      0;
    this.isScrolled = y > 0;
  }

  @HostListener('document:keydown', ['$event'])
  handleGlobalKeydown(e: KeyboardEvent) {
    // "/" apre la ricerca se non stai scrivendo
    if (e.key === '/' && !this.isMenuOpen && !this.isSearchOpen) {
      const ae = document.activeElement as HTMLElement | null;
      const isTyping =
        ae &&
        (ae.tagName === 'INPUT' ||
          ae.tagName === 'TEXTAREA' ||
          ae.isContentEditable);
      if (!isTyping) {
        e.preventDefault();
        this.openSearch();
        return;
      }
    }

    if (!(this.isMenuOpen || this.isSearchOpen)) return;

    if (e.key === 'Escape') {
      if (this.isMenuOpen) this.closeMenu();
      if (this.isSearchOpen) this.closeSearch();
      return;
    }

    if (e.key === 'Tab') {
      const root = this.getActiveOverlayRoot();
      const focusables = this.getFocusableIn(root || null);
      if (!focusables.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  private getFocusableIn(
    rootEl: HTMLElement | null | undefined
  ): HTMLElement[] {
    if (!rootEl) return [];
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return Array.from(rootEl.querySelectorAll<HTMLElement>(selectors)).filter(
      (el) => this.isFocusableElement(el)
    );
  }

  private isFocusableElement(el: HTMLElement): boolean {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    if (el.tabIndex >= 0) return true;

    const nodeName = el.nodeName.toLowerCase();
    switch (nodeName) {
      case 'a':
      case 'area':
        return !!(el as HTMLAnchorElement).href;
      case 'input':
      case 'select':
      case 'textarea':
      case 'button':
        return !(el as HTMLInputElement | HTMLButtonElement).disabled;
      case 'iframe':
        return true;
      default:
        return false;
    }
  }

  private getActiveOverlayRoot(): HTMLElement | null {
    if (this.isMenuOpen && this.overlayRoot?.nativeElement)
      return this.overlayRoot.nativeElement;
    if (this.isSearchOpen && this.searchOverlayRoot?.nativeElement)
      return this.searchOverlayRoot.nativeElement;
    return null;
  }

  // in classe (se non li hai già)
  private modifiedInertEls = new Set<HTMLElement>();
  private inertContainerEl: HTMLElement | null = null;

  private setBackgroundInert(
    enable: boolean,
    exceptEl?: HTMLElement | null
  ): void {
    if (!this.isBrowser) return;

    const headerEl = document.querySelector(
      'header.app-header'
    ) as HTMLElement | null;

    const clearInert = () => {
      if (this.modifiedInertEls.size) {
        this.modifiedInertEls.forEach((el) => {
          this.renderer.removeAttribute(el, 'inert');
          this.renderer.removeAttribute(el, 'aria-hidden');
        });
        this.modifiedInertEls.clear();
      }
      this.inertContainerEl = null;
    };

    if (!enable) {
      clearInert();
      return;
    }

    // enable === true
    if (!exceptEl) {
      // senza overlay di riferimento, non fare nulla
      return;
    }

    // 1) pulisci eventuali residui precedenti
    clearInert();

    // 2) usa come container il PARENT dell’overlay (fratelli diretti)
    const container = exceptEl.parentElement as HTMLElement | null;
    if (!container) return;
    this.inertContainerEl = container;

    const children = Array.from(container.children) as HTMLElement[];

    children.forEach((el) => {
      // non toccare overlay attivo
      if (el === exceptEl) return;

      // non toccare il header né un blocco che lo contenga
      if (headerEl && (el === headerEl || el.contains(headerEl))) return;

      // applica inert solo agli altri fratelli
      this.renderer.setAttribute(el, 'inert', '');
      this.renderer.setAttribute(el, 'aria-hidden', 'true');
      this.modifiedInertEls.add(el);
    });
  }

  // MENU (hamburger)
  async toggleMenu(): Promise<void> {
    // se la Search è aperta, chiudila prima e mantieni inert durante lo switch
    if (this.isSearchOpen) {
      await this.closeSearch(true); // ← NON rimuove inert
    }

    this.isMenuOpen = !this.isMenuOpen;
    if (this.isBrowser)
      document.body.style.overflow = this.isMenuOpen ? 'hidden' : '';

    if (this.isMenuOpen) {
      this.overlaySearchTerm = '';
      this.clearSearchResults();

      this.lastFocused = document.activeElement as HTMLElement;

      // attiva inert puntando al nuovo overlay
      this.setBackgroundInert(true, this.overlayRoot?.nativeElement || null);

      // focus al primo focusable nel menu dopo il frame
      setTimeout(() => {
        const first = this.getFocusableIn(this.overlayRoot?.nativeElement)[0];
        first?.focus?.();
      }, 0);
    } else {
      await this.closeMenu(); // usa la versione che toglie inert
    }
  }
  async closeMenu(preserveInert = false): Promise<void> {
    this.isMenuOpen = false;
    if (this.isBrowser) document.body.style.overflow = '';
    this.overlaySearchTerm = '';
    this.clearSearchResults();
    this.isSearchInputFocused = false;
    if (this.blurTimeout) clearTimeout(this.blurTimeout);

    await this.waitAfterTransition();

    if (!preserveInert) {
      this.setBackgroundInert(false);
      // 🔹 Ripristina focus SOLO se NON stai facendo switch
      (this.menuToggleBtn?.nativeElement ?? this.lastFocused)?.focus?.();
      this.lastFocused = null;
    }
  }

  // SEARCH (icona lente)
  async toggleSearch(): Promise<void> {
    if (this.isMenuOpen) {
      await this.closeMenu(true); // niente ripristino focus
    }

    this.isSearchOpen = !this.isSearchOpen;
    if (this.isBrowser)
      document.body.style.overflow = this.isSearchOpen ? 'hidden' : '';

    if (this.isSearchOpen) {
      this.lastFocused = document.activeElement as HTMLElement;
      this.isSearchInputFocused = true;

      this.setBackgroundInert(
        true,
        this.searchOverlayRoot?.nativeElement || null
      );

      // 🔹 Focus robusto (due RAF) dopo aver aggiornato inert
      this.ngZone.runOutsideAngular(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = this.overlaySearchInput?.nativeElement;
            if (el) {
              el.focus({ preventScroll: true });
              el.select?.();
            }
          });
        });
      });
    } else {
      await this.closeSearch(); // qui ripristina focus perché non è switch
    }
  }

  openSearch(): void {
    if (!this.isSearchOpen) this.toggleSearch();
  }

  async closeSearch(preserveInert = false): Promise<void> {
    if (!this.isSearchOpen) return;
    this.isSearchOpen = false;
    if (this.isBrowser) document.body.style.overflow = '';
    this.isSearchInputFocused = false;
    this.overlaySearchTerm = '';
    this.searchTerms.next('');
    this.clearSearchResults();

    await this.waitAfterTransition();

    if (!preserveInert) {
      this.setBackgroundInert(false);
      // 🔹 Ripristina focus SOLO se NON stai facendo switch
      (this.menuToggleBtn?.nativeElement ?? this.lastFocused)?.focus?.();
      this.lastFocused = null;
    }
  }

  // input handlers ricerca
  onSearchTermChange(): void {
    this.searchTerms.next(this.overlaySearchTerm);
  }

  onSearchInputFocus(): void {
    if (this.blurTimeout) clearTimeout(this.blurTimeout);
    this.isSearchInputFocused = true;
    if (this.overlaySearchTerm.length >= 3) {
      this.searchTerms.next(this.overlaySearchTerm);
    }
  }

  onSearchInputBlur(): void {
    this.ngZone.runOutsideAngular(() => {
      this.blurTimeout = setTimeout(() => {
        this.ngZone.run(() => (this.isSearchInputFocused = false));
      }, 150);
    });
  }

  clearSearchTerm(event?: Event): void {
    if (event) event.stopPropagation();
    this.overlaySearchTerm = '';
    this.searchTerms.next('');
    this.clearSearchResults();
  }

  private clearSearchResults(): void {
    this.liveCocktailResults = [];
    this.liveIngredientResults = [];
    this.liveSearchLoading = false;
  }

  // navigazione filtri
  goCocktailCategory(): void {
    const queryParams = this.selectedCocktailCategory
      ? { category: this.selectedCocktailCategory }
      : {};
    this.router
      .navigate(['/cocktails'], { queryParams })
      .then(() => this.closeMenu());
  }

  goIngredientType(): void {
    const queryParams = this.selectedIngredientType
      ? { type: this.selectedIngredientType }
      : {};
    this.router
      .navigate(['/ingredients'], { queryParams })
      .then(() => this.closeMenu());
  }

  goArticleCategory(): void {
    const queryParams = this.selectedArticleCategory
      ? { category: this.selectedArticleCategory }
      : {};
    this.router
      .navigate(['/articles'], { queryParams })
      .then(() => this.closeMenu());
  }

  goGlossaryCategory(): void {
    const queryParams = this.selectedGlossaryCategory
      ? { category: this.selectedGlossaryCategory }
      : {};
    this.router
      .navigate(['/glossary'], { queryParams })
      .then(() => this.closeMenu());
  }
}
