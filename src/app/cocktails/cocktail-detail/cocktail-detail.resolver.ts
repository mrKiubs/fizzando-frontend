// src/app/cocktails/cocktail-detail/cocktail-detail.resolver.ts

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, ResolveFn } from '@angular/router';
import { of } from 'rxjs';
import { catchError, take } from 'rxjs/operators';

import { CocktailService, Cocktail } from '../../services/strapi.service';

export const cocktailDetailResolver: ResolveFn<Cocktail | null> = (
  route: ActivatedRouteSnapshot
) => {
  const slug = route.paramMap.get('slug');
  if (!slug) return of(null);

  return inject(CocktailService)
    .getCocktailBySlug(slug)
    .pipe(
      take(1),
      catchError(() => of(null))
    );
};
