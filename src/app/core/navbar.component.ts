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
} from 'rxjs/operators';

import { CocktailService, Cocktail } from '../services/strapi.service';
import { IngredientService, Ingredient } from '../services/ingredient.service';
import { ArticleService, Article } from '../services/article.service';
import { QuizService, Quiz } from '../services/quiz.service';
import { BreadcrumbsComponent } from '../assets/design-system/breadcrumbs/breadcrumbs.component';

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
  ],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly ngZone = inject(NgZone);

  @ViewChild('overlaySearchInput')
  overlaySearchInput!: ElementRef<HTMLInputElement>;
  @ViewChild('overlayRoot') overlayRoot!: ElementRef<HTMLElement>;
  @ViewChild('menuToggle') menuToggleBtn!: ElementRef<HTMLButtonElement>;

  isMenuOpen = false;
  isScrolled = false;
  overlaySearchTerm = '';

  isSearchInputFocused = false;
  private blurTimeout: any;

  selectedCocktailCategory = '';
  selectedIngredientType = '';
  selectedArticleCategory = '';

  activeCocktailCategoryInUrl = '';
  activeIngredientTypeInUrl = '';
  activeArticleCategoryInUrl = '';

  liveSearchLoading = false;
  liveCocktailResults: Cocktail[] = [];
  liveIngredientResults: Ingredient[] = [];
  liveArticleResults: Article[] = [];
  liveQuizResults: Quiz[] = [];

  private searchTerms = new Subject<string>();

  private routerSubscription?: Subscription;
  private searchSubscription?: Subscription;
  private lastFocused: HTMLElement | null = null;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private cocktailService: CocktailService,
    private ingredientService: IngredientService,
    private articleService: ArticleService,
    private quizService: QuizService,
    private renderer: Renderer2
  ) {}

  ngOnInit(): void {
    this.routerSubscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        const currentUrl = this.router.url;
        const urlParts = currentUrl.split('?');
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
      });

    this.searchSubscription = this.searchTerms
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term: string) => {
          this.liveCocktailResults = [];
          this.liveIngredientResults = [];
          this.liveArticleResults = [];
          this.liveQuizResults = [];
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
            articles: this.articleService.getArticles(1, 10, term).pipe(
              catchError(() =>
                of({
                  data: [] as Article[],
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
            quizzes: this.quizService
              .getQuizzes(1, 10, term)
              .pipe(catchError(() => of({ quizzes: [] as Quiz[], total: 0 }))),
          }).pipe(catchError(() => of(null)));
        })
      )
      .subscribe((results) => {
        this.liveSearchLoading = false;
        if (results) {
          this.liveCocktailResults = results.cocktails;
          this.liveIngredientResults = results.ingredients.data;
          this.liveArticleResults = results.articles.data;
          this.liveQuizResults = results.quizzes.quizzes;
        }
      });
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.searchSubscription?.unsubscribe();
    if (this.blurTimeout) clearTimeout(this.blurTimeout);
    // rimuovi inert/aria-hidden se rimaste
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

  // Focus trap + ESC globale
  @HostListener('document:keydown', ['$event'])
  handleGlobalKeydown(e: KeyboardEvent) {
    if (!this.isMenuOpen) return;

    if (e.key === 'Escape') {
      this.closeMenu();
      return;
    }

    if (e.key === 'Tab') {
      const focusables = this.getFocusableInOverlay();
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

  private getFocusableInOverlay(): HTMLElement[] {
    if (!this.overlayRoot) return [];
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const root = this.overlayRoot.nativeElement;
    return Array.from(root.querySelectorAll<HTMLElement>(selectors)).filter(
      (el) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
    );
  }

  toggleMenu(): void {
    this.isMenuOpen = !this.isMenuOpen;
    if (this.isBrowser)
      document.body.style.overflow = this.isMenuOpen ? 'hidden' : '';

    if (this.isMenuOpen) {
      this.overlaySearchTerm = '';
      this.clearSearchResults();

      // salva focus precedente e porta il focus nella barra di ricerca
      this.lastFocused = document.activeElement as HTMLElement;
      setTimeout(() => this.overlaySearchInput?.nativeElement?.focus(), 0);

      // disabilita il resto della pagina
      this.setBackgroundInert(true);
    } else {
      this.isSearchInputFocused = false;
      this.searchTerms.next('');

      // riabilita la pagina e restituisci focus
      this.setBackgroundInert(false);
      (this.menuToggleBtn?.nativeElement ?? this.lastFocused)?.focus?.();
      this.lastFocused = null;
    }
  }

  closeMenu(): void {
    this.isMenuOpen = false;
    if (this.isBrowser) document.body.style.overflow = '';
    this.overlaySearchTerm = '';
    this.clearSearchResults();
    this.isSearchInputFocused = false;
    if (this.blurTimeout) clearTimeout(this.blurTimeout);

    this.setBackgroundInert(false);
    (this.menuToggleBtn?.nativeElement ?? this.lastFocused)?.focus?.();
    this.lastFocused = null;
  }

  private setBackgroundInert(enable: boolean): void {
    if (!this.isBrowser) return;
    const overlayEl = this.overlayRoot?.nativeElement;
    const container = overlayEl?.parentElement || document.body;
    const siblings = Array.from(container.children) as HTMLElement[];

    siblings.forEach((el) => {
      if (el === overlayEl) return;
      if (enable) {
        this.renderer.setAttribute(el, 'inert', '');
        this.renderer.setAttribute(el, 'aria-hidden', 'true');
      } else {
        this.renderer.removeAttribute(el, 'inert');
        this.renderer.removeAttribute(el, 'aria-hidden');
      }
    });
  }

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
    // fuori da Angular per non sporcare la stabilità
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
    this.liveArticleResults = [];
    this.liveQuizResults = [];
    this.liveSearchLoading = false;
  }

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
}
