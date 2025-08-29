// src/app/services/ingredient.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, BehaviorSubject, throwError } from 'rxjs';
import { map, filter, take, catchError, tap } from 'rxjs/operators';
import { env } from '../config/env';

// --- NUOVA INTERFACCIA: Article (per la relazione) ---
export interface Article {
  id: number;
  title: string;
  slug: string;
  content: string;
  // Aggiungi qui altri campi dell'articolo se necessario
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
}

// --- INTERFACCE AGGIORNATE ---
export interface StrapiImage {
  id: number;
  name: string;
  alternativeText: string | null;
  caption: string | null;
  width: number;
  height: number;
  formats: {
    thumbnail?: { url: string; [key: string]: any };
    small?: { url: string; [key: string]: any };
    medium?: { url: string; [key: string]: any };
    large?: { url: string; [key: string]: any };
    [key: string]: any;
  };
  hash: string;
  ext: string;
  mime: string;
  size: number;
  url: string;
  previewUrl: string | null;
  provider: string;
  provider_metadata: any | null;
  createdAt: string;
  updatedAt: string;
}

export interface Ingredient {
  id: number;
  documentId?: string;
  name: string;
  external_id: string;
  description_from_cocktaildb: string | null;
  isAlcoholic: boolean;
  image: StrapiImage | null;

  ai_flavor_profile: string | null;
  ai_common_uses: string | null;
  ai_substitutes: string | null;
  ai_brief_history: string | null;
  ai_interesting_facts: string | null;
  ai_alcohol_content: string | null;

  // --- CAMPI AGGIUNTI/RIPRISTINATI ---
  ingredient_type: string | null; // Enumeration in Strapi, trattato come stringa
  ai_cocktail_substitutes: any | null; // JSON in Strapi, trattato come any (o un'interfaccia più specifica se conosci la struttura)
  article: Article | null; // Relazione manyToOne con Article

  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  slug?: string;
}

export interface StrapiResponse<T> {
  data: T[];
  meta: {
    pagination: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
  };
}

export interface StrapiSingleResponse<T> {
  data: T;
  meta: any;
}

@Injectable({
  providedIn: 'root',
})
export class IngredientService {
  private apiUrl = env.apiUrl;
  private baseUrl = `${this.apiUrl}/api/ingredients`;

  private _allIngredientsCache: Ingredient[] | null = null;
  private _allIngredientsLoadingSubject = new BehaviorSubject<boolean>(false);
  private _allIngredientsDataSubject = new BehaviorSubject<Ingredient[] | null>(
    null
  );

  constructor(private http: HttpClient) {}

  private getAbsoluteImageUrl(imageUrl: string | null | undefined): string {
    if (!imageUrl) {
      return 'assets/no-image.png';
    }
    // Usa env.apiUrl per l'URL base
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return imageUrl;
    }
    const cleanedUrl = imageUrl.startsWith('/')
      ? imageUrl.substring(1)
      : imageUrl;
    return `${this.apiUrl}/${cleanedUrl}`;
  }

  private processIngredientImage(
    image: StrapiImage | null
  ): StrapiImage | null {
    if (!image) {
      return null;
    }

    if (image.url) {
      image.url = this.getAbsoluteImageUrl(image.url);
    } else {
      image.url = 'assets/no-image.png';
    }

    if (image.formats) {
      for (const key in image.formats) {
        if (Object.prototype.hasOwnProperty.call(image.formats, key)) {
          const format = (image.formats as any)[key];
          if (format && format.url) {
            format.url = this.getAbsoluteImageUrl(format.url);
          }
        }
      }
    }
    return image;
  }

  /**
   * Recupera gli ingredienti con paginazione e filtri.
   * Include una logica di caching per la lista completa di ingredienti (pageSize 1000).
   * @param useCache Se true, cerca di usare la cache per una richiesta di tutti gli ingredienti.
   * @param forceReload Se true, forza il ricaricamento dei dati, ignorando la cache. Utile per refresh manuali.
   * @param ingredientType Filtra per tipo di ingrediente (es. 'Spirit', 'Liqueur', 'Mixer').
   */
  getIngredients(
    page: number = 1,
    pageSize: number = 10,
    searchTerm?: string,
    isAlcoholic?: boolean,
    ingredientType?: string, // Nuovo parametro per il filtro ingredient_type
    useCache: boolean = false,
    forceReload: boolean = false
  ): Observable<StrapiResponse<Ingredient>> {
    const isAllIngredientsRequest =
      pageSize === 1000 &&
      !searchTerm &&
      isAlcoholic === undefined &&
      ingredientType === undefined;

    if (isAllIngredientsRequest && !forceReload) {
      if (this._allIngredientsCache) {
        console.log('Serving all ingredients from _allIngredientsCache.');
        return of({
          data: this._allIngredientsCache,
          meta: {
            pagination: {
              page: 1,
              pageSize: this._allIngredientsCache.length,
              pageCount: 1,
              total: this._allIngredientsCache.length,
            },
          },
        });
      }

      if (this._allIngredientsLoadingSubject.getValue()) {
        console.log(
          'All ingredients request already in progress, waiting for data via _allIngredientsDataSubject.'
        );
        return this._allIngredientsDataSubject.pipe(
          filter((data) => data !== null),
          map((data) => ({
            data: data!,
            meta: {
              pagination: {
                page: 1,
                pageSize: data!.length,
                pageCount: 1,
                total: data!.length,
              },
            },
          }))
        );
      }
    }

    let params = new HttpParams()
      .set('pagination[page]', page.toString())
      .set('pagination[pageSize]', pageSize.toString())
      .set('populate', 'image');

    if (searchTerm) {
      params = params.set('filters[name][$startsWithi]', searchTerm);
    }
    if (isAlcoholic !== undefined) {
      params = params.set('filters[isAlcoholic][$eq]', isAlcoholic.toString());
    }
    // Aggiungi il filtro ingredient_type solo se ha un valore valido
    if (ingredientType && ingredientType !== '') {
      params = params.set('filters[ingredient_type][$eq]', ingredientType);
    }

    if (
      isAllIngredientsRequest &&
      !this._allIngredientsLoadingSubject.getValue()
    ) {
      this._allIngredientsLoadingSubject.next(true);
    }

    console.log('Making NEW HTTP request for ingredients.');
    console.log(
      'IngredientService: Request URL with params:',
      `${this.baseUrl}?${params.toString()}`
    ); // DEBUG: Logga l'URL completo
    return this.http
      .get<StrapiResponse<Ingredient>>(this.baseUrl, { params })
      .pipe(
        map((response) => {
          response.data.forEach((ingredient) => {
            ingredient.image = this.processIngredientImage(ingredient.image);
          });

          if (isAllIngredientsRequest) {
            this._allIngredientsCache = response.data.sort((a, b) =>
              a.name.localeCompare(b.name)
            );
            this._allIngredientsDataSubject.next(this._allIngredientsCache);
            this._allIngredientsLoadingSubject.next(false);
          }
          return response;
        }),
        catchError((err) => {
          console.error('Error loading ingredients:', err);
          if (isAllIngredientsRequest) {
            this._allIngredientsLoadingSubject.next(false);
            this._allIngredientsDataSubject.error(err);
          }
          return throwError(
            () =>
              new Error(
                'Could not load ingredients. Check Strapi permissions and filter configuration.'
              )
          );
        })
      );
  }

  /**
   * Recupera un singolo ingrediente tramite il suo ID esterno.
   * Controlla prima la cache globale `_allIngredientsCache`.
   */
  getIngredientByExternalId(externalId: string): Observable<Ingredient | null> {
    // 1. Controlla la cache globale _allIngredientsCache
    if (this._allIngredientsCache) {
      const cachedIngredient = this._allIngredientsCache.find(
        (i) => i.external_id === externalId
      );
      if (cachedIngredient) {
        console.log(
          `Ingredient with external ID '${externalId}' found in _allIngredientsCache.`
        );
        return of(cachedIngredient);
      }
    }

    // 2. Se la richiesta per tutti gli ingredienti è in corso, attendi che finisca
    if (this._allIngredientsLoadingSubject.getValue()) {
      console.log(
        `_allIngredientsCache is loading, waiting for ingredient with external ID '${externalId}'.`
      );
      return this._allIngredientsDataSubject.pipe(
        filter((data) => data !== null),
        map((data) => {
          const found = data!.find((i) => i.external_id === externalId);
          if (found) {
            console.log(
              `Ingredient with external ID '${externalId}' found after _allIngredientsCache loaded.`
            );
          } else {
            console.warn(
              `Ingredient with external ID '${externalId}' not found in _allIngredientsCache after load.`
            );
          }
          return found || null;
        }),
        catchError((err) => {
          console.error(
            `Error after _allIngredientsCache loaded for external ID '${externalId}':`,
            err
          );
          return of(null);
        })
      );
    }

    // 3. Se non è in cache e non è in caricamento, fai una chiamata API specifica
    console.log(
      `Ingredient with external ID '${externalId}' not in cache, fetching from API.`
    );
    let params = new HttpParams()
      .set('filters[external_id][$eq]', externalId)
      .set('populate[image]', 'true')
      .set('populate[article]', 'true');

    console.log(
      'IngredientService: Detail Request URL with params:',
      `${this.baseUrl}?${params.toString()}`
    ); // DEBUG: Logga l'URL completo del dettaglio

    return this.http
      .get<StrapiResponse<Ingredient>>(this.baseUrl, { params })
      .pipe(
        map((response) => {
          if (response.data && response.data.length > 0) {
            const fetchedIngredient = response.data[0];
            fetchedIngredient.image = this.processIngredientImage(
              fetchedIngredient.image
            );
            return fetchedIngredient;
          }
          return null;
        }),
        catchError((err) => {
          console.error(
            'Error getting ingredient by external ID from API:',
            err
          );
          return throwError(
            () =>
              new Error(
                'Could not get ingredient details from API. Check Strapi permissions for article population.'
              )
          );
        })
      );
  }
}
