import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
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

// Assicurati che i percorsi e i nomi dei servizi siano corretti per il tuo progetto
import { CocktailService, Cocktail } from '../services/strapi.service';
import { IngredientService, Ingredient } from '../services/ingredient.service';
import { ArticleService, Article } from '../services/article.service';
import { QuizService, Quiz } from '../services/quiz.service'; // <--- AGGIUNTO: Import QuizService
import { BreadcrumbsComponent } from '../assets/design-system/breadcrumbs/breadcrumbs.component';

@Component({
  selector: 'app-navbar',
  standalone: true,
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
  isMenuOpen: boolean = false;
  isScrolled: boolean = false;
  overlaySearchTerm: string = '';

  isSearchInputFocused: boolean = false;
  private blurTimeout: any;

  selectedCocktailCategory: string = '';
  selectedIngredientType: string = '';
  selectedArticleCategory: string = '';

  activeCocktailCategoryInUrl: string = '';
  activeIngredientTypeInUrl: string = '';
  activeArticleCategoryInUrl: string = '';

  // Variabili per la ricerca live
  liveSearchLoading: boolean = false;
  liveCocktailResults: Cocktail[] = [];
  liveIngredientResults: Ingredient[] = [];
  liveArticleResults: Article[] = [];
  liveQuizResults: Quiz[] = []; // <--- AGGIUNTO: Proprietà per i risultati dei quiz

  private searchTerms = new Subject<string>();

  private routerSubscription: Subscription | undefined;
  private searchSubscription: Subscription | undefined;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private cocktailService: CocktailService,
    private ingredientService: IngredientService,
    private articleService: ArticleService,
    private quizService: QuizService // <--- AGGIUNTO: Inietta QuizService
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
          this.activeCocktailCategoryInUrl = urlParams.get('category') || '';
        } else {
          this.selectedCocktailCategory = '';
          this.activeCocktailCategoryInUrl = '';
        }

        if (urlParts[0].includes('/ingredients')) {
          this.selectedIngredientType = urlParams.get('type') || '';
          this.activeIngredientTypeInUrl = urlParams.get('type') || '';
        } else {
          this.selectedIngredientType = '';
          this.activeIngredientTypeInUrl = '';
        }

        if (urlParts[0].includes('/articles')) {
          this.selectedArticleCategory = urlParams.get('category') || '';
          this.activeArticleCategoryInUrl = urlParams.get('category') || '';
        } else {
          this.selectedArticleCategory = '';
          this.activeArticleCategoryInUrl = '';
        }
      });

    window.addEventListener('scroll', this.onWindowScroll, true);

    this.searchSubscription = this.searchTerms
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term: string) => {
          this.liveCocktailResults = [];
          this.liveIngredientResults = [];
          this.liveArticleResults = [];
          this.liveQuizResults = []; // <--- AGGIUNTO: Pulisci i risultati dei quiz
          this.liveSearchLoading = false;

          if (term.length < 3 && !this.isSearchInputFocused) {
            return of(null);
          }
          if (term.length < 3) {
            return of(null);
          }

          this.liveSearchLoading = true;

          return forkJoin({
            cocktails: this.cocktailService.searchCocktailsByName(term).pipe(
              catchError((err) => {
                console.error('Errore nella ricerca cocktail:', err);
                return of([]);
              })
            ),
            ingredients: this.ingredientService
              .getIngredients(1, 10, term)
              .pipe(
                catchError((err) => {
                  console.error('Errore nella ricerca ingredienti:', err);
                  return of({
                    data: [],
                    meta: {
                      pagination: {
                        page: 1,
                        pageSize: 0,
                        pageCount: 0,
                        total: 0,
                      },
                    },
                  });
                })
              ),
            articles: this.articleService.getArticles(1, 10, term).pipe(
              catchError((err) => {
                console.error('Errore nella ricerca articoli:', err);
                return of({
                  data: [],
                  meta: {
                    pagination: {
                      page: 1,
                      pageSize: 0,
                      pageCount: 0,
                      total: 0,
                    },
                  },
                });
              })
            ),
            // <--- AGGIUNTO: Chiamata al servizio per la ricerca dei quiz
            quizzes: this.quizService.getQuizzes(1, 10, term).pipe(
              catchError((err) => {
                console.error('Errore nella ricerca quiz:', err);
                return of({
                  quizzes: [],
                  total: 0,
                });
              })
            ),
          }).pipe(
            catchError((err) => {
              console.error('Errore generale nella ricerca live:', err);
              return of(null);
            })
          );
        })
      )
      .subscribe((results) => {
        this.liveSearchLoading = false;

        if (results) {
          this.liveCocktailResults = results.cocktails;

          this.liveIngredientResults = results.ingredients.data;
          this.liveArticleResults = results.articles.data;
          this.liveQuizResults = results.quizzes.quizzes; // <--- AGGIUNTO: Popola i risultati dei quiz
        }
      });
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.onWindowScroll, true);
    this.routerSubscription?.unsubscribe();
    this.searchSubscription?.unsubscribe();
    clearTimeout(this.blurTimeout);
  }

  @HostListener('window:scroll', ['$event'])
  onWindowScroll(event: Event) {
    this.isScrolled = window.pageYOffset > 0;
  }

  toggleMenu(): void {
    this.isMenuOpen = !this.isMenuOpen;

    if (this.isMenuOpen) {
      document.body.style.overflow = 'hidden';
      this.overlaySearchTerm = '';
      this.clearSearchResults();
    } else {
      document.body.style.overflow = '';
      this.isSearchInputFocused = false;
      this.searchTerms.next(''); // Interrompe eventuali debounce
    }
  }

  closeMenu(): void {
    this.isMenuOpen = false;
    document.body.style.overflow = '';
    this.overlaySearchTerm = '';
    this.liveCocktailResults = [];
    this.liveIngredientResults = [];
    this.liveArticleResults = [];
    this.liveQuizResults = []; // <--- AGGIUNTO: Pulisci i risultati dei quiz
    this.liveSearchLoading = false;
    this.isSearchInputFocused = false;
    clearTimeout(this.blurTimeout);
  }

  onSearchTermChange(): void {
    this.searchTerms.next(this.overlaySearchTerm);
  }

  onSearchInputFocus(): void {
    clearTimeout(this.blurTimeout);
    this.isSearchInputFocused = true;
    if (this.overlaySearchTerm.length >= 3) {
      this.searchTerms.next(this.overlaySearchTerm);
    }
  }

  onSearchInputBlur(): void {
    this.blurTimeout = setTimeout(() => {
      this.isSearchInputFocused = false;
    }, 150);
  }

  clearSearchTerm(event?: Event): void {
    if (event) {
      event.stopPropagation(); // Evita che il click sul bottone scateni il blur dell'input
    }
    this.overlaySearchTerm = '';
    this.searchTerms.next(''); // Invia un termine vuoto per azzerare la ricerca
    this.clearSearchResults(); // Pulisci i risultati immediatamente
    // Potresti voler rimettere il focus sull'input dopo aver cancellato, ma non è sempre necessario
    // Dipende dall'esperienza utente che desideri
  }

  // NUOVO METODO: Per pulire tutti gli array dei risultati
  private clearSearchResults(): void {
    this.liveCocktailResults = [];
    this.liveIngredientResults = [];
    this.liveArticleResults = [];
    this.liveQuizResults = [];
    this.liveSearchLoading = false;
  }

  goCocktailCategory(): void {
    const category = this.selectedCocktailCategory;
    const queryParams = category ? { category: category } : {};
    this.router
      .navigate(['/cocktails'], { queryParams })
      .then(() => this.closeMenu());
  }

  goIngredientType(): void {
    const type = this.selectedIngredientType;
    const queryParams = type ? { type: type } : {};
    this.router
      .navigate(['/ingredients'], { queryParams })
      .then(() => this.closeMenu());
  }

  goArticleCategory(): void {
    const category = this.selectedArticleCategory;
    const queryParams = category ? { category: category } : {};
    this.router
      .navigate(['/articles'], { queryParams })
      .then(() => this.closeMenu());
  }
}
