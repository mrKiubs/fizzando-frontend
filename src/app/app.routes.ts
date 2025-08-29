import { Routes } from '@angular/router';

import { DashboardComponent } from './dashboard/dashboard.component';

import { CocktailListComponent } from './cocktails/cocktail-list/cocktail-list.component';
import { CocktailDetailComponent } from './cocktails/cocktail-detail/cocktail-detail.component';

import { IngredientListComponent } from './ingredients/ingredient-list/ingredient-list.component';
import { IngredientDetailComponent } from './ingredients/ingredient-detail/ingredient-detail.component';
import { IngredientSearchCocktailListComponent } from './cocktails/ingredient-search-cocktail-list/ingredient-search-cocktail-list.component';

import { GlossaryListComponent } from './glossary/glossary-list/glossary-list.component';

import { QuizListComponent } from './quiz/quiz-list/quiz-list.component';
import { QuizDetailComponent } from './quiz/quiz-detail/quiz-detail.component';

import { ArticleListComponent } from './articles/article-list/article-list.component';
import { ArticleDetailComponent } from './articles/article-detail/article-detail.component';

export const routes: Routes = [
  {
    path: '',
    component: DashboardComponent,
    data: { breadcrumb: 'Home' },
  },

  {
    path: 'cocktails',

    children: [
      {
        path: '',
        component: CocktailListComponent,
      },
      {
        path: ':slug',
        component: CocktailDetailComponent,
        data: { breadcrumb: 'Cocktail Details' }, // opzionale, puoi rimuoverlo se vuoi il nome slug nel breadcrumb
      },
    ],
  },

  {
    path: 'ingredients',
    children: [
      {
        path: '',
        component: IngredientListComponent,
      },
      {
        path: ':externalId',
        component: IngredientDetailComponent,
        data: { breadcrumb: 'Ingredient Details' },
      },
    ],
  },

  {
    path: 'find-cocktail',
    component: IngredientSearchCocktailListComponent,
    data: { breadcrumb: '🔎 Find Cocktail' },
  },

  {
    path: 'glossary',
    component: GlossaryListComponent,
    data: { breadcrumb: '📚 Glossary' },
  },
  /*
  {
    path: 'quiz',

    children: [
      {
        path: '',
        component: QuizListComponent,
      },
      {
        path: ':slug',
        component: QuizDetailComponent,
        data: { breadcrumb: 'Quiz Details' },
      },
    ],
  },
*/
  {
    path: 'articles',
    children: [
      {
        path: '',
        component: ArticleListComponent,
      },
      {
        path: 'category/:slug',
        component: ArticleListComponent,
        data: { breadcrumb: '📂 Category' },
      },
      {
        path: ':slug',
        component: ArticleDetailComponent,
        data: { breadcrumb: 'Article Details' },
      },
    ],
  },

  // Wildcard fallback (non sempre serve breadcrumb)
  {
    path: '**',
    redirectTo: '',
    data: { breadcrumb: 'Home' },
  },
];
