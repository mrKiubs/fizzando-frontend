import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./dashboard/dashboard.component').then(
        (m) => m.DashboardComponent
      ),
    data: { breadcrumb: 'Home' },
  },

  {
    path: 'cocktails',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./cocktails/cocktail-list/cocktail-list.component').then(
            (m) => m.CocktailListComponent
          ),
      },

      // HUB puliti (una sola definizione per ciascuno)
      {
        path: 'method/:methodSlug',
        loadComponent: () =>
          import('./cocktails/cocktail-list/cocktail-list.component').then(
            (m) => m.CocktailListComponent
          ),
        data: { hub: 'method', breadcrumb: 'Method' },
      },
      {
        path: 'glass/:glassSlug',
        loadComponent: () =>
          import('./cocktails/cocktail-list/cocktail-list.component').then(
            (m) => m.CocktailListComponent
          ),
        data: { hub: 'glass', breadcrumb: 'Glass' },
      },
      {
        path: 'category/:categorySlug',
        loadComponent: () =>
          import('./cocktails/cocktail-list/cocktail-list.component').then(
            (m) => m.CocktailListComponent
          ),
        data: { hub: 'category', breadcrumb: 'Category' },
      },
      {
        path: 'alcoholic/:alcoholicSlug',
        loadComponent: () =>
          import('./cocktails/cocktail-list/cocktail-list.component').then(
            (m) => m.CocktailListComponent
          ),
        data: { hub: 'alcoholic', breadcrumb: 'Alcoholic' },
      },

      // Dettaglio cocktail — tenere per ultimo perché è generico
      {
        path: ':slug',
        loadComponent: () =>
          import('./cocktails/cocktail-detail/cocktail-detail.component').then(
            (m) => m.CocktailDetailComponent
          ),
        data: { breadcrumb: 'Cocktail Details' },
      },
    ],
  },

  {
    path: 'ingredients',
    children: [
      {
        path: '',
        loadComponent: () =>
          import(
            './ingredients/ingredient-list/ingredient-list.component'
          ).then((m) => m.IngredientListComponent),
      },
      {
        path: ':externalId',
        loadComponent: () =>
          import(
            './ingredients/ingredient-detail/ingredient-detail.component'
          ).then((m) => m.IngredientDetailComponent),
        data: { breadcrumb: 'Ingredient Details' },
      },
    ],
  },

  {
    path: 'find-cocktail',
    loadComponent: () =>
      import(
        './cocktails/ingredient-search-cocktail-list/ingredient-search-cocktail-list.component'
      ).then((m) => m.IngredientSearchCocktailListComponent),
    data: { breadcrumb: '🔎 Find Cocktail' },
  },

  {
    path: 'glossary',
    loadComponent: () =>
      import('./glossary/glossary-list/glossary-list.component').then(
        (m) => m.GlossaryListComponent
      ),
    data: { breadcrumb: '📚 Glossary' },
  },

  {
    path: 'quiz',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./quiz/quiz-list/quiz-list.component').then(
            (m) => m.QuizListComponent
          ),
      },
      {
        path: ':slug',
        loadComponent: () =>
          import('./quiz/quiz-detail/quiz-detail.component').then(
            (m) => m.QuizDetailComponent
          ),
        data: { breadcrumb: 'Quiz Details' },
      },
    ],
  },

  {
    path: 'articles',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./articles/article-list/article-list.component').then(
            (m) => m.ArticleListComponent
          ),
      },
      {
        path: 'category/:slug',
        loadComponent: () =>
          import('./articles/article-list/article-list.component').then(
            (m) => m.ArticleListComponent
          ),
        data: { breadcrumb: '📂 Category' },
      },
      {
        path: ':slug',
        loadComponent: () =>
          import('./articles/article-detail/article-detail.component').then(
            (m) => m.ArticleDetailComponent
          ),
        data: { breadcrumb: 'Article Details' },
      },
    ],
  },

  {
    path: 'privacy',
    loadComponent: () =>
      import('./legal/privacy-policy/privacy-policy.component').then(
        (m) => m.PrivacyPolicyComponent
      ),
    data: { breadcrumb: '🔒 Privacy Policy' },
  },
  {
    path: 'cookies',
    loadComponent: () =>
      import('./legal/cookie-policy/cookie-policy.component').then(
        (m) => m.CookiePolicyComponent
      ),
    data: { breadcrumb: '🍪 Cookie Policy' },
  },
  {
    path: 'terms',
    loadComponent: () =>
      import('./legal/terms-conditions/terms-conditions.component').then(
        (m) => m.TermsConditionsComponent
      ),
    data: { breadcrumb: '📄 Terms & Conditions' },
  },
  {
    path: 'credits',
    loadComponent: () =>
      import('./legal/credits-component/credits-component.component').then(
        (m) => m.CreditsComponent
      ),
    data: { breadcrumb: '🙏 Credits' },
  },

  { path: '**', redirectTo: '', data: { breadcrumb: 'Home' } },
];
