// src/app/dashboard/dashboard.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { forkJoin, Subscription } from 'rxjs'; // Importa forkJoin e Subscription
import { DatePipe } from '@angular/common'; // Importa DatePipe per la formattazione della data
import { env } from '../config/env';
import { catchError, finalize, tap } from 'rxjs/operators'; // Importa operatori

// Importa servizi e interfacce
import {
  CocktailService,
  Cocktail,
  StrapiImage,
  CocktailWithLayoutAndMatch,
} from '../services/strapi.service'; // Assumi che strapi.service gestisca i cocktail
import { IngredientService, Ingredient } from '../services/ingredient.service'; // Assumi un servizio separato per gli ingredienti
import { QuizService, Quiz } from '../services/quiz.service'; // Importa QuizService e Quiz
import { ArticleService, Article } from '../services/article.service'; // Importa ArticleService e Article

// Importa i componenti delle card
import { CocktailCardComponent } from '../cocktails/cocktail-card/cocktail-card.component';
import { IngredientCardComponent } from '../ingredients/ingredient-card/ingredient-card.component'; // Assumi che esista

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    RouterLink,
    CocktailCardComponent,
    IngredientCardComponent,
    DatePipe, // Aggiungi DatePipe agli imports
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  allCocktails: Cocktail[] = []; // Usato per calcolare featured, latest, random e stats
  featuredCocktails: CocktailWithLayoutAndMatch[] = []; // Rinominato per chiarezza
  latestCocktails: CocktailWithLayoutAndMatch[] = []; // Rinominato per chiarezza
  randomCocktail?: CocktailWithLayoutAndMatch; // Rinominato per chiarezza

  latestIngredients: Ingredient[] = []; // Nuovo: per gli ultimi ingredienti
  latestQuizzes: Quiz[] = []; // Nuovo: per gli ultimi quiz
  latestArticles: Article[] = []; // Nuovo: per gli ultimi articoli

  // NUOVE PROPRIETÀ: per gli articoli per categoria
  historyArticles: Article[] = [];
  techniquesArticles: Article[] = [];
  ingredientsArticles: Article[] = [];

  categoriesCount: Record<string, number> = {};
  totalCocktails = 0;
  loading = true;
  error: string | null = null;
  private dataSubscription: Subscription | undefined; // Aggiunto per gestire la sottoscrizione

  constructor(
    private cocktailService: CocktailService,
    private ingredientService: IngredientService, // Inietta IngredientService
    private quizService: QuizService, // Inietta QuizService
    private articleService: ArticleService // Inietta ArticleService
  ) {}

  ngOnInit() {
    this.loadDashboardData();
  }

  ngOnDestroy(): void {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe(); // Annulla la sottoscrizione per evitare memory leak
    }
  }

  loadDashboardData(): void {
    this.loading = true;
    this.error = null; // Resetta l'errore ad ogni inizializzazione

    // Usa forkJoin per recuperare tutti i dati in parallelo
    this.dataSubscription = forkJoin({
      // Recupera tutti i cocktail per elaborazione interna (max 1000)
      cocktailsResponse: this.cocktailService.getCocktails(
        1,
        1000,
        undefined,
        undefined,
        undefined,
        true,
        false
      ),
      // Recupera gli ultimi 5 ingredienti (o quanti ne vuoi mostrare)
      ingredientsResponse: this.ingredientService.getIngredients(
        1,
        5,
        undefined,
        undefined,
        undefined,
        true,
        false
      ),
      // Recupera gli ultimi 3 quiz
      quizzes: this.quizService.getLatestQuizzes(3),
      // Recupera gli ultimi 3 articoli
      articles: this.articleService.getLatestArticles(3),
      // NUOVE CHIAMATE: Recupera 3 articoli per categoria usando il metodo corretto
      historyArticles: this.articleService.getArticlesByCategorySlug(
        'history',
        3
      ), // Corretto
      techniquesArticles: this.articleService.getArticlesByCategorySlug(
        'techniques',
        3
      ), // Corretto
      ingredientsArticles: this.articleService.getArticlesByCategorySlug(
        'ingredients',
        3
      ), // Corretto
    })
      .pipe(
        tap(
          ({
            cocktailsResponse,
            ingredientsResponse,
            quizzes,
            articles,
            historyArticles,
            techniquesArticles,
            ingredientsArticles,
          }) => {
            this.allCocktails = cocktailsResponse.data;
            this.totalCocktails = cocktailsResponse.meta.pagination.total;

            // Popola i cocktail in evidenza (es. i primi 10)
            this.featuredCocktails = this.allCocktails
              .slice(0, 10)
              .map((c) => ({ ...c, isTall: false, isWide: false }));
            // Popola gli ultimi cocktail aggiunti (es. i primi 10 per data di creazione)
            this.latestCocktails = [...this.allCocktails]
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime()
              )
              .slice(0, 10)
              .map((c) => ({ ...c, isTall: false, isWide: false }));

            // Seleziona un cocktail casuale per la Hero Section
            if (this.allCocktails.length > 0) {
              const randomIndex = Math.floor(
                Math.random() * this.allCocktails.length
              );
              this.randomCocktail = {
                ...this.allCocktails[randomIndex],
                isTall: false,
                isWide: false,
              };
            }

            // Calcola il conteggio delle categorie
            this.categoriesCount = this.allCocktails.reduce((acc, cocktail) => {
              const cat = cocktail.category
                ? cocktail.category.trim()
                : 'Unknown';
              acc[cat] = (acc[cat] || 0) + 1;
              return acc;
            }, {} as Record<string, number>);

            // Ordina le categorie alfabeticamente
            this.categoriesCount = Object.keys(this.categoriesCount)
              .sort()
              .reduce((obj, key) => {
                obj[key] = this.categoriesCount[key];
                return obj;
              }, {} as Record<string, number>);

            // Popola gli ultimi ingredienti
            this.latestIngredients = ingredientsResponse.data;
            // Popola gli ultimi quiz
            this.latestQuizzes = quizzes;
            // Popola gli ultimi articoli
            this.latestArticles = articles;

            // NUOVA ASSEGNAZIONE: Popola gli articoli per categoria
            // Assumi che il servizio restituisca { data: [], meta: {} }
            this.historyArticles = historyArticles.data;
            this.techniquesArticles = techniquesArticles.data;
            this.ingredientsArticles = ingredientsArticles.data;
          }
        ),
        catchError((err) => {
          console.error(
            'Errore durante il caricamento dei dati della dashboard:',
            err
          );
          this.error =
            'Impossibile caricare i dati della dashboard. Riprova più tardi.';
          return []; // Ritorna un array vuoto per completare l'Observable
        }),
        finalize(() => {
          this.loading = false; // Tutti i dati sono stati caricati (o l'errore gestito)
        })
      )
      .subscribe();
  }

  // Helper per ottenere l'URL completo dell'immagine (se non già gestito dal servizio)
  getAbsoluteImageUrl(image: StrapiImage | null | undefined): string {
    if (!image?.url) {
      return 'https://placehold.co/400x300/e0e0e0/333333?text=No+Image'; // Placeholder
    }
    return image.url.startsWith('http') ? image.url : env.apiUrl + image.url;
  }
}
