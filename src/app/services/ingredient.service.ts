// src/app/services/ingredient.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, BehaviorSubject, throwError } from 'rxjs';
import { map, filter, catchError, finalize, shareReplay } from 'rxjs/operators';
import { env } from '../config/env';

// --- NUOVA INTERFACCIA: Article (per la relazione) ---
export interface Article {
  id: number;
  title: string;
  slug: string;
  content: string;
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
  ingredient_type: string | null;
  ai_cocktail_substitutes: any | null;
  article: Article | null;

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

@Injectable({ providedIn: 'root' })
export class IngredientService {
  private apiUrl = env.apiUrl;
  private baseUrl = `${this.apiUrl}/api/ingredients`;

  // Cache "ALL" con TTL per evitare dati stantii + peso in RAM
  private _allIngredientsCache: Ingredient[] | null = null;
  private _allIngredientsCacheAt = 0;
  private readonly ALL_TTL_MS = 3 * 60 * 1000; // 3 minuti

  private _allIngredientsLoadingSubject = new BehaviorSubject<boolean>(false);
  private _allIngredientsDataSubject = new BehaviorSubject<Ingredient[] | null>(
    null
  );

  // Micro-cache per coalescere richieste identiche ravvicinate
  private requestCache = new Map<string, { t: number; obs: Observable<any> }>();
  private readonly REQ_TTL_MS = 30 * 1000; // 30s

  constructor(private http: HttpClient) {}

  // ---------- Helpers ----------

  private joinUrl(base: string, path: string): string {
    const b = base.replace(/\/+$/, '');
    const p = path.replace(/^\/+/, '');
    return `${b}/${p}`;
  }

  private getAbsoluteImageUrl(imageUrl: string | null | undefined): string {
    if (!imageUrl) return 'assets/no-image.png';
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return imageUrl;
    }
    return this.joinUrl(this.apiUrl, imageUrl);
  }

  private processIngredientImage(
    image: StrapiImage | null
  ): StrapiImage | null {
    if (!image) return null;

    image.url = this.getAbsoluteImageUrl(image.url || 'assets/no-image.png');

    if (image.formats) {
      for (const key in image.formats) {
        if (Object.prototype.hasOwnProperty.call(image.formats, key)) {
          const fmt = (image.formats as any)[key];
          if (fmt?.url) fmt.url = this.getAbsoluteImageUrl(fmt.url);
        }
      }
    }
    return image;
  }

  private cacheKey(url: string, params: HttpParams): string {
    return `${url}?${params.toString()}`;
  }

  private getWithRequestCache<T>(
    url: string,
    params: HttpParams
  ): Observable<T> {
    const key = this.cacheKey(url, params);
    const now = Date.now();
    const hit = this.requestCache.get(key);
    if (hit && now - hit.t < this.REQ_TTL_MS) {
      return hit.obs as Observable<T>;
    }
    const obs = this.http.get<T>(url, { params }).pipe(shareReplay(1));
    this.requestCache.set(key, { t: now, obs });
    return obs;
  }

  private isAllCacheFresh(): boolean {
    return (
      !!this._allIngredientsCache &&
      Date.now() - this._allIngredientsCacheAt < this.ALL_TTL_MS
    );
  }

  // ---------- API ----------

  /**
   * Recupera gli ingredienti con paginazione e filtri.
   * Mantiene le immagini (con formats), ma evita colli di bottiglia:
   * - cache "ALL" con TTL
   * - micro-cache per URL+params con shareReplay
   * - niente Subject.error()
   */
  getIngredients(
    page: number = 1,
    pageSize: number = 10,
    searchTerm?: string,
    isAlcoholic?: boolean,
    ingredientType?: string,
    useCache: boolean = false,
    forceReload: boolean = false
  ): Observable<StrapiResponse<Ingredient>> {
    const isAllIngredientsRequest =
      pageSize === 1000 &&
      !searchTerm &&
      isAlcoholic === undefined &&
      ingredientType === undefined;

    // Serve dalla cache "ALL" se fresca e non forzata
    if (isAllIngredientsRequest && !forceReload && this.isAllCacheFresh()) {
      return of({
        data: this._allIngredientsCache!,
        meta: {
          pagination: {
            page: 1,
            pageSize: this._allIngredientsCache!.length,
            pageCount: 1,
            total: this._allIngredientsCache!.length,
          },
        },
      });
    }

    // Se sta già caricando "ALL", esponi lo stream
    if (
      isAllIngredientsRequest &&
      this._allIngredientsLoadingSubject.getValue()
    ) {
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

    // Build params (manteniamo populate=image completo)
    let params = new HttpParams()
      .set('pagination[page]', String(page))
      .set('pagination[pageSize]', String(pageSize))
      .set('populate', 'image');

    if (searchTerm)
      params = params.set('filters[name][$startsWithi]', searchTerm);
    if (isAlcoholic !== undefined)
      params = params.set('filters[isAlcoholic][$eq]', String(isAlcoholic));
    if (ingredientType)
      params = params.set('filters[ingredient_type][$eq]', ingredientType);

    if (isAllIngredientsRequest) this._allIngredientsLoadingSubject.next(true);

    // Usa la micro-cache per coalescere richieste identiche
    return this.getWithRequestCache<StrapiResponse<Ingredient>>(
      this.baseUrl,
      params
    ).pipe(
      map((response) => {
        // Normalizza URL immagini
        response.data.forEach((ingredient) => {
          ingredient.image = this.processIngredientImage(ingredient.image);
        });

        if (isAllIngredientsRequest) {
          // ordina e memorizza in cache con timestamp
          const sorted = response.data
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name));
          this._allIngredientsCache = sorted;
          this._allIngredientsCacheAt = Date.now();
          this._allIngredientsDataSubject.next(sorted);
        }

        return response;
      }),
      catchError((err) => {
        // Non "rompere" il subject condiviso
        if (isAllIngredientsRequest) {
          this._allIngredientsDataSubject.next(null);
        }
        return throwError(
          () =>
            new Error(
              'Could not load ingredients. Check Strapi permissions and filter configuration.'
            )
        );
      }),
      finalize(() => {
        if (isAllIngredientsRequest)
          this._allIngredientsLoadingSubject.next(false);
      })
    );
  }

  /**
   * Recupera un singolo ingrediente tramite il suo ID esterno.
   * Riusa la cache "ALL" se disponibile; altrimenti chiama l'API.
   * Mantiene immagini e popola anche l'articolo (campi interi, come da tuo schema).
   */
  getIngredientByExternalId(externalId: string): Observable<Ingredient | null> {
    // 1) Cache "ALL"
    if (this.isAllCacheFresh()) {
      const cached = this._allIngredientsCache!.find(
        (i) => i.external_id === externalId
      );
      if (cached) return of(cached);
    }

    // 2) Se l'ALL è in corso, attendi
    if (this._allIngredientsLoadingSubject.getValue()) {
      return this._allIngredientsDataSubject.pipe(
        filter((data) => data !== null),
        map((data) => data!.find((i) => i.external_id === externalId) || null),
        catchError(() => of(null))
      );
    }

    // 3) API specifica
    let params = new HttpParams()
      .set('filters[external_id][$eq]', externalId)
      .set('populate[image]', 'true')
      .set('populate[article]', 'true');

    return this.getWithRequestCache<StrapiResponse<Ingredient>>(
      this.baseUrl,
      params
    ).pipe(
      map((response) => {
        if (response.data && response.data.length > 0) {
          const ing = response.data[0];
          ing.image = this.processIngredientImage(ing.image);
          return ing;
        }
        return null;
      }),
      catchError(() =>
        throwError(
          () =>
            new Error(
              'Could not get ingredient details from API. Check Strapi permissions for article population.'
            )
        )
      )
    );
  }
}
