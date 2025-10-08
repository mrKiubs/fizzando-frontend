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

import { PrivacyPolicyComponent } from './legal/privacy-policy/privacy-policy.component';
import { CookiePolicyComponent } from './legal/cookie-policy/cookie-policy.component';
import { TermsConditionsComponent } from './legal/terms-conditions/terms-conditions.component';
import { CreditsComponent } from './legal/credits-component/credits-component.component';
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

      // HUB puliti (una sola definizione per ciascuno)
      {
        path: 'method/:methodSlug',
        component: CocktailListComponent,
        data: { hub: 'method', breadcrumb: 'Method' },
      },
      {
        path: 'glass/:glassSlug',
        component: CocktailListComponent,
        data: { hub: 'glass', breadcrumb: 'Glass' },
      },
      {
        path: 'category/:categorySlug',
        component: CocktailListComponent,
        data: { hub: 'category', breadcrumb: 'Category' },
      },
      {
        path: 'alcoholic/:alcoholicSlug',
        component: CocktailListComponent,
        data: { hub: 'alcoholic', breadcrumb: 'Alcoholic' },
      },

      // Dettaglio cocktail — tenere per ultimo perché è generico
      {
        path: ':slug',
        component: CocktailDetailComponent,
        data: { breadcrumb: 'Cocktail Details' },
      },
    ],
  },

  {
    path: 'ingredients',
    children: [
      { path: '', component: IngredientListComponent },
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

  {
    path: 'articles',
    children: [
      { path: '', component: ArticleListComponent },
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

  {
    path: 'privacy',
    component: PrivacyPolicyComponent,
    data: { breadcrumb: '🔒 Privacy Policy' },
  },
  {
    path: 'cookies',
    component: CookiePolicyComponent,
    data: { breadcrumb: '🍪 Cookie Policy' },
  },
  {
    path: 'terms',
    component: TermsConditionsComponent,
    data: { breadcrumb: '📄 Terms & Conditions' },
  },
  {
    path: 'credits',
    component: CreditsComponent,
    data: { breadcrumb: '🙏 Credits' },
  },

  { path: '**', redirectTo: '', data: { breadcrumb: 'Home' } },
];
