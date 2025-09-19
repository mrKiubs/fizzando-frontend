// src/app/services/strapi.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  of,
  throwError,
  BehaviorSubject,
  Subscription,
} from 'rxjs';
import { map, catchError, filter, shareReplay } from 'rxjs/operators';
import { env } from '../config/env';

// --- Interfacce (immutate) ---
export interface Ingredient {
  id: number;
  name: string;
  quantity: string;
  measure: string;
}
export interface IngredientCT {
  id: number;
  name: string;
  external_id: string;
  description_from_cocktaildb?: string;
  ai_flavor_profile?: string;
  ai_common_uses?: string;
  ai_substitutes?: string;
  ai_brief_history?: string;
  ai_interesting_facts?: string;
  ai_alcohol_content?: string;
  image: StrapiImage | null;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  ingredient_type?: string | null;
}
export interface IngredientDetail extends IngredientCT {
  relatedCocktails: Cocktail[];
}
export interface CocktailIngredientListItem {
  id?: number;
  measure: string | null;
  ingredient: IngredientCT;
}
export interface StrapiSingleImageFormatDetails {
  ext: string;
  url: string;
  hash: string;
  mime: string;
  name: string;
  path: string | null;
  size: number;
  width: number;
  height: number;
  sizeInBytes?: number;
}
export interface StrapiImageFormats {
  thumbnail?: StrapiSingleImageFormatDetails;
  small?: StrapiSingleImageFormatDetails;
  medium?: StrapiSingleImageFormatDetails;
  large?: StrapiSingleImageFormatDetails;
}
export interface StrapiImage {
  id: number;
  name: string;
  alternativeText: string | null;
  caption: string | null;
  width: number;
  height: number;
  formats: StrapiImageFormats;
  hash: string;
  ext: string;
  mime: string;
  size: number;
  url: string | null;
  previewUrl: string | null;
  provider: string;
  provider_metadata: any | null;
  createdAt: string;
  updatedAt: string;
}
export interface Cocktail {
  id: number;
  external_id: string;
  name: string;
  category: string;
  alcoholic: string;
  glass: string;
  instructions: string;
  ingredients_list: CocktailIngredientListItem[];
  image: StrapiImage | null;
  ai_description: string | null;
  likes: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  preparation_type?: string;
  ai_alcohol_content: string | null;
  ai_presentation: string | null;
  ai_pairing: string | null;
  ai_origin: string | null;
  ai_occasion: string | null;
  ai_sensory_description: string | null;
  ai_personality: string | null;
  ai_variations: string | null;
  slug: string;
}
export interface CocktailWithLayoutAndMatch extends Cocktail {
  isTall?: boolean;
  isWide?: boolean;
  matchedIngredientCount?: number;
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
export class CocktailService {
  private apiUrl = env.apiUrl;
  private cocktailsBaseUrl = `${this.apiUrl}/api/cocktails`;

  private readonly UNKNOWN_INGREDIENT_CT: IngredientCT = {
    id: -1,
    name: 'Unknown Ingredient',
    external_id: 'unknown-ingredient',
    image: null,
    description_from_cocktaildb: 'This ingredient is unknown or malformed.',
    ai_flavor_profile: 'Unknown',
    ai_common_uses: 'Unknown',
    ai_substitutes: 'Unknown',
    ai_brief_history: 'Unknown',
    ai_interesting_facts: 'Unknown',
    ai_alcohol_content: 'Unknown',
    ingredient_type: 'Unknown Type',
  };

  // ------- CACHE IN-MEMORY --------
  /** Cache "tutti i cocktail" (usata SOLO quando useCache === true). */
  private _allCocktailsCache: Cocktail[] | null = null;
  private _allCocktailsLoadingSubject = new BehaviorSubject<boolean>(false);
  private _allCocktailsDataSubject = new BehaviorSubject<Cocktail[] | null>(
    null
  );

  /** Cache per slug → cocktail (hit istantanei nella stessa sessione). */
  private bySlug = new Map<string, Cocktail>();
  private bySlugInFlight = new Map<string, Observable<Cocktail | null>>();

  /** Cache per liste: chiave = params stringificati → risposta (TTL leggero). */
  private listCache = new Map<
    string,
    { ts: number; stream$: Observable<StrapiResponse<Cocktail>> }
  >();
  private listTTLms = 600_000; // 60s

  // ------- PREFETCH (nuovo) --------
  private PREFETCH_MAX_CONCURRENCY = 2;
  private activePrefetch = 0;
  private prefetchQueue: Array<() => Subscription> = [];
  private prefetchSubs = new Set<Subscription>();

  constructor(private http: HttpClient) {}

  // --------- Helpers ----------
  private getFullStrapiImageUrl(relativePath: string | null): string | null {
    if (!relativePath) return null;
    return relativePath.startsWith('http')
      ? relativePath
      : this.apiUrl + relativePath;
  }

  private cleanIngredientCTData(raw: any): IngredientCT {
    if (!raw) return { ...this.UNKNOWN_INGREDIENT_CT, image: null };

    let ingredientImage: StrapiImage | null = null;
    if (raw.image) {
      const rawImage = raw.image;
      const formatsWithFullUrls: StrapiImageFormats = {};
      if (rawImage.formats) {
        for (const key in rawImage.formats) {
          const format = rawImage.formats[key];
          if (format?.url) {
            formatsWithFullUrls[key as keyof StrapiImageFormats] = {
              ...format,
              url: this.getFullStrapiImageUrl(format.url)!,
            };
          }
        }
      }
      ingredientImage = {
        id: rawImage.id,
        name: rawImage.name,
        alternativeText: rawImage.alternativeText,
        caption: rawImage.caption,
        width: rawImage.width,
        height: rawImage.height,
        formats: formatsWithFullUrls,
        hash: rawImage.hash,
        ext: rawImage.ext,
        mime: rawImage.mime,
        size: rawImage.size,
        url: this.getFullStrapiImageUrl(rawImage.url),
        previewUrl: this.getFullStrapiImageUrl(rawImage.previewUrl),
        provider: rawImage.provider,
        provider_metadata: rawImage.provider_metadata,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      } as StrapiImage;
    }

    return {
      id: raw.id ?? this.UNKNOWN_INGREDIENT_CT.id,
      name: raw.name ?? this.UNKNOWN_INGREDIENT_CT.name,
      external_id: raw.external_id ?? this.UNKNOWN_INGREDIENT_CT.external_id,
      description_from_cocktaildb: raw.description_from_cocktaildb,
      ai_flavor_profile: raw.ai_flavor_profile,
      ai_common_uses: raw.ai_common_uses,
      ai_substitutes: raw.ai_substitutes,
      ai_brief_history: raw.ai_brief_history,
      ai_interesting_facts: raw.ai_interesting_facts,
      ai_alcohol_content: raw.ai_alcohol_content,
      image: ingredientImage,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      publishedAt: raw.publishedAt,
      ingredient_type: raw.ingredient_type,
    };
  }

  private cleanCocktailData(raw: any): Cocktail {
    let cocktailImage: StrapiImage | null = null;
    if (raw.image) {
      const rawImage = raw.image;
      const formatsWithFullUrls: StrapiImageFormats = {};
      if (rawImage.formats) {
        for (const key in rawImage.formats) {
          const format = rawImage.formats[key];
          if (format?.url) {
            formatsWithFullUrls[key as keyof StrapiImageFormats] = {
              ...format,
              url: this.getFullStrapiImageUrl(format.url)!,
            };
          }
        }
      }
      cocktailImage = {
        id: rawImage.id,
        name: rawImage.name,
        alternativeText: rawImage.alternativeText,
        caption: rawImage.caption,
        width: rawImage.width,
        height: rawImage.height,
        formats: formatsWithFullUrls,
        hash: rawImage.hash,
        ext: rawImage.ext,
        mime: rawImage.mime,
        size: rawImage.size,
        url: this.getFullStrapiImageUrl(rawImage.url),
        previewUrl: this.getFullStrapiImageUrl(rawImage.previewUrl),
        provider: rawImage.provider,
        provider_metadata: rawImage.provider_metadata,
        createdAt: rawImage.createdAt,
        updatedAt: rawImage.updatedAt,
      } as StrapiImage;
    }

    const cleanedIngredientsList: CocktailIngredientListItem[] = [];
    if (Array.isArray(raw.ingredients_list)) {
      (raw.ingredients_list as any[]).forEach((item: any) => {
        const cleanedIngredient = this.cleanIngredientCTData(item.ingredient);
        cleanedIngredientsList.push({
          id: item.id,
          measure: item.measure ?? null,
          ingredient: cleanedIngredient,
        });
      });
    }

    return {
      id: raw.id,
      external_id: raw.external_id,
      name: raw.name,
      category: raw.category,
      alcoholic: raw.alcoholic,
      glass: raw.glass,
      instructions: raw.instructions,
      ingredients_list: cleanedIngredientsList,
      image: cocktailImage,
      ai_description: raw.ai_description,
      likes: raw.likes,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      publishedAt: raw.publishedAt,
      preparation_type: raw.preparation_type,
      ai_alcohol_content: raw.ai_alcohol_content,
      ai_presentation: raw.ai_presentation,
      ai_pairing: raw.ai_pairing,
      ai_origin: raw.ai_origin,
      ai_occasion: raw.ai_occasion,
      ai_sensory_description: raw.ai_sensory_description,
      ai_personality: raw.ai_personality,
      ai_variations: raw.ai_variations,
      slug: raw.slug,
    };
  }

  // ---------- API PUBBLICHE (immutate nelle firme) ----------

  getCocktails(
    page: number = 1,
    pageSize: number = 10,
    searchTerm?: string,
    category?: string,
    alcoholic?: string,
    useCache: boolean = false,
    forceReload: boolean = false
  ): Observable<StrapiResponse<Cocktail>> {
    const isAllCocktailsRequest =
      !!useCache && !searchTerm && !category && !alcoholic;

    if (isAllCocktailsRequest && !forceReload && this._allCocktailsCache) {
      return of({
        data: this._allCocktailsCache,
        meta: {
          pagination: {
            page: 1,
            pageSize: this._allCocktailsCache.length,
            pageCount: 1,
            total: this._allCocktailsCache.length,
          },
        },
      });
    }

    if (
      isAllCocktailsRequest &&
      this._allCocktailsLoadingSubject.getValue() &&
      !forceReload
    ) {
      return this._allCocktailsDataSubject.pipe(
        filter((data) => data !== null),
        map((data) => ({
          data: data as Cocktail[],
          meta: {
            pagination: {
              page: 1,
              pageSize: (data as Cocktail[]).length,
              pageCount: 1,
              total: (data as Cocktail[]).length,
            },
          },
        }))
      );
    }

    let params = new HttpParams()
      .set('pagination[page]', page.toString())
      .set('pagination[pageSize]', pageSize.toString())
      .set('populate[image]', 'true')
      .set(
        'populate[ingredients_list][populate][ingredient][fields][0]',
        'name'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][fields][1]',
        'external_id'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][fields][2]',
        'ingredient_type'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][populate][image]',
        'true'
      );

    if (searchTerm)
      params = params.set('filters[name][$startsWithi]', searchTerm);
    if (category) params = params.set('filters[category][$eq]', category);
    if (alcoholic) params = params.set('filters[alcoholic][$eq]', alcoholic);

    const keyObj = {
      page,
      pageSize,
      searchTerm: searchTerm ?? '',
      category: category ?? '',
      alcoholic: alcoholic ?? '',
    };
    const key = JSON.stringify(keyObj);
    const cachedList = this.listCache.get(key);
    const now = Date.now();
    if (!forceReload && cachedList && now - cachedList.ts < this.listTTLms)
      return cachedList.stream$;

    if (isAllCocktailsRequest) this._allCocktailsLoadingSubject.next(true);

    const stream$ = this.http
      .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params })
      .pipe(
        map((response: StrapiResponse<any>) => {
          response.data = (response.data as any[]).map((item: any) =>
            this.cleanCocktailData(item)
          );
          if (isAllCocktailsRequest) {
            this._allCocktailsCache = (response.data as Cocktail[])
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name));
            this._allCocktailsDataSubject.next(this._allCocktailsCache);
            this._allCocktailsLoadingSubject.next(false);
            this._allCocktailsCache.forEach((c) =>
              this.bySlug.set(c.slug.toLowerCase(), c)
            );
          }
          return response as StrapiResponse<Cocktail>;
        }),
        catchError((err) => {
          if (isAllCocktailsRequest) {
            this._allCocktailsLoadingSubject.next(false);
            this._allCocktailsDataSubject.error(err);
          }
          return throwError(() => new Error('Could not load cocktails.'));
        }),
        shareReplay(1)
      );

    this.listCache.set(key, { ts: now, stream$ });
    return stream$;
  }

  getCocktailBySlug(slug: string): Observable<Cocktail | null> {
    const norm = (slug || '').toLowerCase();

    const hit = this.bySlug.get(norm);
    if (hit) return of(hit);

    if (this._allCocktailsLoadingSubject.getValue()) {
      return this._allCocktailsDataSubject.pipe(
        filter((data) => data !== null),
        map((data) => {
          const found =
            (data as Cocktail[]).find((c) => c.slug.toLowerCase() === norm) ||
            null;
          if (found) this.bySlug.set(norm, found);
          return found;
        })
      );
    }

    const inFlight = this.bySlugInFlight.get(norm);
    if (inFlight) return inFlight;

    // ✅ Strapi v5: popola solo relazioni/media/comp. Se category/glass sono stringhe, NON popolarle.
    let params = new HttpParams()
      .set('filters[slug][$eq]', slug)
      .set('populate[image]', 'true')
      // .set('populate[category]', 'true') // ❌ rimosso (scalare in molti modelli)
      // .set('populate[glass]', 'true')    // ❌ rimosso (scalare in molti modelli)
      .set(
        'populate[ingredients_list][populate][ingredient][fields][0]',
        'name'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][fields][1]',
        'external_id'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][fields][2]',
        'ingredient_type'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][populate][image]',
        'true'
      );

    const req$ = this.http
      .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params })
      .pipe(
        map((response: StrapiResponse<any>) => {
          if (response.data?.length > 0) {
            const fetched = this.cleanCocktailData(response.data[0]);
            this.bySlug.set(norm, fetched);
            return fetched;
          }
          return null;
        }),
        catchError(() =>
          throwError(
            () => new Error('Could not load cocktail by slug from API.')
          )
        ),
        shareReplay(1)
      );

    this.bySlugInFlight.set(norm, req$);
    req$.subscribe({
      next: () => this.bySlugInFlight.delete(norm),
      error: () => this.bySlugInFlight.delete(norm),
    });
    return req$;
  }

  likeCocktail(cocktailId: number): Observable<any> {
    const url = `${this.cocktailsBaseUrl}/${cocktailId}`;
    return this.http
      .put(url, { data: { likes: (Math.random() * 48).toFixed(0) } })
      .pipe(
        catchError(() =>
          throwError(() => new Error('Could not like cocktail.'))
        )
      );
  }

  searchCocktailsByName(query: string): Observable<Cocktail[]> {
    let params = new HttpParams()
      .set('filters[name][$startsWithi]', query)
      .set('pagination[pageSize]', '10')
      .set('populate[image]', 'true')
      .set(
        'populate[ingredients_list][populate][ingredient][fields][0]',
        'name'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][fields][1]',
        'external_id'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][fields][2]',
        'ingredient_type'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][populate][image]',
        'true'
      );

    const key = JSON.stringify({ q: query, pageSize: 10, type: 'search' });
    const cached = this.listCache.get(key);
    const now = Date.now();
    if (cached && now - cached.ts < this.listTTLms)
      return cached.stream$.pipe(map((r) => r.data));

    const stream$ = this.http
      .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params })
      .pipe(
        map((response: StrapiResponse<any>) => {
          const data = (response.data as any[]).map((item: any) =>
            this.cleanCocktailData(item)
          );
          return { data, meta: response.meta } as StrapiResponse<Cocktail>;
        }),
        catchError(() =>
          throwError(() => new Error('Could not search cocktails.'))
        ),
        shareReplay(1)
      );

    this.listCache.set(key, { ts: now, stream$ });
    return stream$.pipe(map((r: StrapiResponse<Cocktail>) => r.data));
  }

  getRelatedCocktailsForIngredient(
    ingredientExternalId: string
  ): Observable<Cocktail[]> {
    let params = new HttpParams()
      .set(
        'filters[ingredients_list][ingredient][external_id][$eq]',
        ingredientExternalId
      )
      .set('populate[image]', 'true')
      .set(
        'populate[ingredients_list][populate][ingredient][fields][0]',
        'name'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][fields][1]',
        'external_id'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][fields][2]',
        'ingredient_type'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][populate][image]',
        'true'
      );

    const key = JSON.stringify({ rel: ingredientExternalId, type: 'related' });
    const cached = this.listCache.get(key);
    const now = Date.now();
    if (cached && now - cached.ts < this.listTTLms)
      return cached.stream$.pipe(map((r) => r.data));

    const stream$ = this.http
      .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params })
      .pipe(
        map((response: StrapiResponse<any>) => {
          const data = (response.data as any[]).map((item: any) =>
            this.cleanCocktailData(item)
          );
          return { data, meta: response.meta } as StrapiResponse<Cocktail>;
        }),
        catchError(() =>
          throwError(() => new Error('Could not get related cocktails.'))
        ),
        shareReplay(1)
      );

    this.listCache.set(key, { ts: now, stream$ });
    return stream$.pipe(map((r: StrapiResponse<Cocktail>) => r.data));
  }

  getCocktailsByIngredientIds(
    ingredientExternalIds: string[],
    exactMatch: boolean = false
  ): Observable<CocktailWithLayoutAndMatch[]> {
    if (!ingredientExternalIds?.length) return of([]);

    let params = new HttpParams()
      .set('populate[image]', 'true')
      .set(
        'populate[ingredients_list][populate][ingredient][fields][0]',
        'name'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][fields][1]',
        'external_id'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][fields][2]',
        'ingredient_type'
      )
      .set(
        'populate[ingredients_list][populate][ingredient][populate][image]',
        'true'
      )
      .set('pagination[pageSize]', '48');

    if (exactMatch) {
      ingredientExternalIds.forEach((id, index) => {
        params = params.set(
          `filters[ingredients_list][ingredient][external_id][$eq][${index}]`,
          id
        );
      });
    } else {
      ingredientExternalIds.forEach((id, index) => {
        params = params.set(
          `filters[$or][${index}][ingredients_list][ingredient][external_id][$eq]`,
          id
        );
      });
    }

    return this.http
      .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params })
      .pipe(
        map((response: StrapiResponse<any>) => {
          const all = (response.data as any[]).map((item: any) =>
            this.cleanCocktailData(item)
          );
          return all.map((cocktail) => {
            const ids = new Set(
              cocktail.ingredients_list.map((i) => i.ingredient.external_id)
            );
            let matchedCount = 0;
            ingredientExternalIds.forEach((sel) => {
              if (ids.has(sel)) matchedCount++;
            });
            return {
              ...cocktail,
              matchedIngredientCount: matchedCount,
            } as CocktailWithLayoutAndMatch;
          });
        }),
        catchError(() =>
          throwError(() => new Error('Could not get cocktails by ingredients.'))
        )
      );
  }

  getSimilarCocktails(currentCocktail: Cocktail): Observable<Cocktail[]> {
    if (!currentCocktail?.ingredients_list?.length) return of([]);

    return this.getCocktails(
      1,
      48,
      undefined,
      undefined,
      undefined,
      true,
      false
    ).pipe(
      map((response: StrapiResponse<Cocktail>) => {
        const allCocktails = response.data;
        const primary =
          currentCocktail.ingredients_list[0]?.ingredient?.external_id;
        const secondary =
          currentCocktail.ingredients_list[1]?.ingredient?.external_id;

        let candidates: Cocktail[] = [];
        if (primary) {
          candidates = allCocktails.filter(
            (c) =>
              c.external_id !== currentCocktail.external_id &&
              c.ingredients_list.some(
                (it) => it.ingredient.external_id === primary
              )
          );
        }
        if (candidates.length < 16 && secondary && secondary !== primary) {
          const extra = allCocktails.filter(
            (c) =>
              c.external_id !== currentCocktail.external_id &&
              !candidates.some((s) => s.external_id === c.external_id) &&
              c.ingredients_list.some(
                (it) => it.ingredient.external_id === secondary
              )
          );
          candidates = [...candidates, ...extra];
        }
        if (candidates.length < 16) {
          const fallback = allCocktails.filter((c) => {
            if (
              c.external_id === currentCocktail.external_id ||
              candidates.some((s) => s.external_id === c.external_id)
            )
              return false;
            const matchCategory =
              currentCocktail.category &&
              c.category === currentCocktail.category;
            const matchAlcoholic =
              currentCocktail.alcoholic &&
              c.alcoholic === currentCocktail.alcoholic;
            const matchGlass =
              currentCocktail.glass && c.glass === currentCocktail.glass;
            return matchCategory || matchAlcoholic || matchGlass;
          });
          candidates = [...candidates, ...fallback];
        }
        const shuffled = candidates.sort(() => 0.5 - Math.random());
        return shuffled.slice(0, 16);
      }),
      catchError(() =>
        throwError(() => new Error('Could not load similar cocktails.'))
      )
    );
  }

  // ================================
  //        PREFETCH (nuovo)
  // ================================

  /** Avvia (in idle) un prefetch del dettaglio, con coda e cap di concorrenza. */
  prefetchCocktailBySlug(slug: string): void {
    const norm = (slug || '').toLowerCase();
    if (!norm) return;
    if (this.bySlug.get(norm)) return; // già in cache
    if (this.bySlugInFlight.get(norm)) return; // già in volo
    if (!this.canPrefetch()) return; // rispetta rete/SaveData

    this.enqueueIdle(() => this.getCocktailBySlug(norm));
  }

  /** Prefetch di una lista di slug (es. card correlate visibili). */
  prefetchCocktailsBySlugs(slugs: string[], limit = 6): void {
    if (!Array.isArray(slugs) || !slugs.length) return;
    const unique = Array.from(
      new Set(slugs.map((s) => (s || '').toLowerCase()))
    ).slice(0, limit);
    unique.forEach((s) => this.prefetchCocktailBySlug(s));
  }

  /** Pre-warm dell’indice “all cocktails” (solo se non in cache). Parte in idle. */
  prefetchAllCocktailsIndexSoft(): void {
    if (this._allCocktailsCache || this._allCocktailsLoadingSubject.getValue())
      return;
    if (!this.canPrefetch()) return;
    this.enqueueIdle(() =>
      this.getCocktails(1, 48, undefined, undefined, undefined, true, false)
    );
  }

  // ----- Prefetch runtime internals -----

  /** Pianifica una richiesta (Observable) in idle, instradata nella coda con cap. */
  private enqueueIdle<T>(factory: () => Observable<T>): void {
    const job = () => {
      const sub = factory().subscribe({
        next: () => this.onPrefetchDone(sub),
        error: () => this.onPrefetchDone(sub),
      });
      this.prefetchSubs.add(sub);
      return sub;
    };

    // usa requestIdleCallback quando c’è, altrimenti micro-delay
    this.scheduleIdle(() => this.enqueueJob(job));
  }

  private enqueueJob(job: () => Subscription): void {
    this.prefetchQueue.push(job);
    this.drainQueue();
  }

  private drainQueue(): void {
    while (
      this.activePrefetch < this.PREFETCH_MAX_CONCURRENCY &&
      this.prefetchQueue.length
    ) {
      const job = this.prefetchQueue.shift()!;
      this.activePrefetch++;
      job();
    }
  }

  private onPrefetchDone(sub?: Subscription): void {
    if (sub) {
      try {
        sub.unsubscribe();
      } catch {}
      this.prefetchSubs.delete(sub);
    }
    this.activePrefetch = Math.max(0, this.activePrefetch - 1);
    this.drainQueue();
  }

  private scheduleIdle(cb: () => void): void {
    const anyWin = typeof window !== 'undefined' ? (window as any) : null;
    if (anyWin?.requestIdleCallback) {
      anyWin.requestIdleCallback(() => cb(), { timeout: 2000 });
    } else {
      setTimeout(() => cb(), 0);
    }
  }

  private canPrefetch(): boolean {
    // Risparmia dati o reti lente: evita di occupare banda
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    const saveData = !!nav?.connection?.saveData;
    const effectiveType = (nav?.connection?.effectiveType ?? '') as string;
    const slow = /2g|slow-2g/.test(effectiveType);
    return !(saveData || slow);
  }
}
