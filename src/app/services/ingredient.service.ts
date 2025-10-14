// src/app/services/ingredient.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  of,
  BehaviorSubject,
  throwError,
  Subscription,
} from 'rxjs';
import {
  map,
  filter,
  catchError,
  shareReplay,
  finalize,
  concatMap,
} from 'rxjs/operators';
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

// --- INTERFACCE (immutate) ---
export interface StrapiImage {
  id: number;
  name: string;
  alternativeText: string | null;
  caption: string | null;
  width: number;
  height: number;
  formats:
    | {
        thumbnail?: { url: string; [key: string]: any };
        small?: { url: string; [key: string]: any };
        medium?: { url: string; [key: string]: any };
        large?: { url: string; [key: string]: any };
        [key: string]: any;
      }
    | any; // <-- può arrivare string/null: lo normalizziamo
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

  ingredient_type: string | null;
  ai_cocktail_substitutes: any | null;
  article: Article | null;

  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  slug?: string; // opzionale (non esposto da Strapi pubblico)
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

  /** Cache "tutti gli ingredienti" (abilitata solo con useCache=true) */
  private _allIngredientsCache: Ingredient[] | null = null;
  private _allIngredientsLoadingSubject = new BehaviorSubject<boolean>(false);
  private _allIngredientsDataSubject = new BehaviorSubject<Ingredient[] | null>(
    null
  );

  /** Cache per external_id → ingrediente (hit istantanei) */
  private byExternalId = new Map<string, Ingredient>();
  private byExternalInFlight = new Map<string, Observable<Ingredient | null>>();

  /** Cache per liste (key = params) con TTL breve */
  private listCache = new Map<
    string,
    { ts: number; stream$: Observable<StrapiResponse<Ingredient>> }
  >();
  private listTTLms = 60_000; // 60s

  // ------- PREFETCH --------
  private PREFETCH_MAX_CONCURRENCY = 2;
  private activePrefetch = 0;
  private prefetchQueue: Array<() => Subscription> = [];
  private prefetchSubs = new Set<Subscription>();

  constructor(private http: HttpClient) {}

  // ---------- Helpers immagine ----------
  private getAbsoluteImageUrl(imageUrl: string | null | undefined): string {
    if (!imageUrl) return 'assets/no-image.png';
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))
      return imageUrl;
    const cleaned = imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl;
    return `${this.apiUrl}/${cleaned}`;
  }

  // >>> PATCH: funzione difensiva sui formats
  private processIngredientImage(
    image: StrapiImage | null
  ): StrapiImage | null {
    if (!image) return null;

    image.url = this.getAbsoluteImageUrl(image.url);

    const raw = (image as any).formats;
    let formats: any = raw;

    if (typeof raw === 'string') {
      try {
        formats = JSON.parse(raw);
      } catch {
        formats = null;
      }
    }

    if (formats && typeof formats === 'object') {
      for (const key of Object.keys(formats)) {
        const fmt = formats[key];
        if (fmt?.url) {
          fmt.url = this.getAbsoluteImageUrl(fmt.url);
        }
      }
      (image as any).formats = formats;
    } else {
      (image as any).formats = undefined;
    }

    return image;
  }

  // ---------- Comparator per "safe slug" (slug || external_id || name) ----------
  private compareBySlug(a: Ingredient, b: Ingredient): number {
    const sa = (
      a.slug ?? (a.external_id ? String(a.external_id) : a.name ?? '')
    )
      .toString()
      .trim()
      .toLowerCase();
    const sb = (
      b.slug ?? (b.external_id ? String(b.external_id) : b.name ?? '')
    )
      .toString()
      .trim()
      .toLowerCase();

    return sa.localeCompare(sb, 'en', { numeric: true, sensitivity: 'base' });
  }

  // =============== API PUBBLICHE ===============

  /**
   * Lista con paginazione/filtri.
   * NIENTE sort server-side su "slug" (Strapi lo rifiuta) → ordiniamo client-side.
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
      !!useCache &&
      !searchTerm &&
      isAlcoholic === undefined &&
      ingredientType === undefined;

    if (isAllIngredientsRequest && !forceReload && this._allIngredientsCache) {
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

    if (
      isAllIngredientsRequest &&
      this._allIngredientsLoadingSubject.getValue() &&
      !forceReload
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

    let params = new HttpParams()
      .set('publicationState', 'live') // <<< aggiunto
      .set('pagination[page]', String(page))
      .set('pagination[pageSize]', String(pageSize))
      // campi essenziali per card/lista/detail
      .set('fields[0]', 'name')
      .set('fields[1]', 'external_id')
      .set('fields[2]', 'description_from_cocktaildb')
      .set('fields[3]', 'isAlcoholic')
      .set('fields[4]', 'ingredient_type')
      // .set('fields[5]', 'slug') // <<< rimosso: non esposto → 400
      // image fields minimal:
      .set('populate[image][fields][0]', 'url')
      .set('populate[image][fields][1]', 'formats');

    if (searchTerm)
      params = params.set('filters[name][$startsWithi]', searchTerm);
    if (isAlcoholic !== undefined)
      params = params.set('filters[isAlcoholic][$eq]', String(isAlcoholic));
    if (ingredientType && ingredientType !== '')
      params = params.set('filters[ingredient_type][$eq]', ingredientType);

    if (isAllIngredientsRequest) this._allIngredientsLoadingSubject.next(true);

    const keyObj = {
      page,
      pageSize,
      searchTerm: searchTerm ?? '',
      isAlcoholic: isAlcoholic ?? null,
      ingredientType: ingredientType ?? '',
      sort: 'client:slug',
    };
    const key = JSON.stringify(keyObj);
    const now = Date.now();
    const cachedList = this.listCache.get(key);
    if (!forceReload && cachedList && now - cachedList.ts < this.listTTLms) {
      return cachedList.stream$;
    }

    const stream$ = this.http
      .get<StrapiResponse<Ingredient>>(this.baseUrl, { params })
      .pipe(
        map((response) => {
          response.data.forEach(
            (ing) => (ing.image = this.processIngredientImage(ing.image))
          );

          // ordina client-side per "safe slug"
          response.data = response.data
            .slice()
            .sort((a, b) => this.compareBySlug(a, b));

          if (isAllIngredientsRequest) {
            this._allIngredientsCache = response.data.slice();
            this._allIngredientsDataSubject.next(this._allIngredientsCache);
            this._allIngredientsLoadingSubject.next(false);
            this._allIngredientsCache.forEach((i) =>
              this.byExternalId.set((i.external_id || '').toLowerCase(), i)
            );
          }
          return response;
        }),
        catchError((err) => {
          if (isAllIngredientsRequest) {
            this._allIngredientsLoadingSubject.next(false);
            this._allIngredientsDataSubject.error(err);
          }
          console.error(
            '[IngredientService.getIngredients] HTTP error:',
            err?.status,
            err?.error || err
          );
          return throwError(
            () =>
              new Error(
                'Could not load ingredients. Check Strapi permissions and filters.'
              )
          );
        }),
        shareReplay(1)
      );

    this.listCache.set(key, { ts: now, stream$ });
    return stream$;
  }

  /**
   * Dettaglio per external_id (cache → “all” in corso → HTTP)
   */
  getIngredientByExternalId(externalId: string): Observable<Ingredient | null> {
    const key = (externalId || '').toLowerCase();

    const hit = this.byExternalId.get(key);
    if (hit) return of(hit);

    if (this._allIngredientsLoadingSubject.getValue()) {
      return this._allIngredientsDataSubject.pipe(
        filter((data) => data !== null),
        map((data) => {
          const found =
            data!.find((i) => (i.external_id || '').toLowerCase() === key) ||
            null;
          if (found) this.byExternalId.set(key, found);
          return found;
        }),
        catchError(() => of(null))
      );
    }

    const inFlight = this.byExternalInFlight.get(key);
    if (inFlight) return inFlight;

    let params = new HttpParams()
      .set('publicationState', 'live') // <<< aggiunto
      .set('filters[external_id][$eq]', externalId) // usa il valore originale
      // Campi usati in UI:
      .set('fields[0]', 'name')
      .set('fields[1]', 'external_id')
      .set('fields[2]', 'description_from_cocktaildb')
      .set('fields[3]', 'isAlcoholic')
      .set('fields[4]', 'ingredient_type')
      // .set('fields[5]', 'slug') // <<< rimosso: non esposto → 400
      .set('fields[5]', 'ai_flavor_profile')
      .set('fields[6]', 'ai_common_uses')
      .set('fields[7]', 'ai_substitutes')
      .set('fields[8]', 'ai_brief_history')
      .set('fields[9]', 'ai_interesting_facts')
      .set('fields[10]', 'ai_alcohol_content')
      // Image solo con i campi necessari:
      .set('populate[image][fields][0]', 'url')
      .set('populate[image][fields][1]', 'formats');

    const req$ = this.http
      .get<StrapiResponse<Ingredient>>(this.baseUrl, { params })
      .pipe(
        map((response) => {
          if (response.data && response.data.length > 0) {
            const ing = response.data[0];
            ing.image = this.processIngredientImage(ing.image);
            this.byExternalId.set(key, ing);
            return ing;
          }
          return null;
        }),
        catchError((err) => {
          console.error(
            '[IngredientService.getIngredientByExternalId] HTTP error:',
            err?.status,
            err?.error || err
          );
          return throwError(
            () => new Error('Could not get ingredient details from API.')
          );
        }),
        shareReplay(1)
      );

    this.byExternalInFlight.set(key, req$);
    req$.subscribe({
      next: () => this.byExternalInFlight.delete(key),
      error: () => this.byExternalInFlight.delete(key),
    });

    return req$;
  }

  // ================================
  //        PREFETCH
  // ================================

  prefetchIngredientByExternalId(externalId: string): void {
    const cacheKey = (externalId || '').toLowerCase();
    if (!cacheKey) return;
    if (this.byExternalId.get(cacheKey)) return;
    if (this.byExternalInFlight.get(cacheKey)) return;
    if (!this.canPrefetch()) return;

    // usa l'argomento originale nella fetch (no key lowercased)
    this.enqueueIdle(() => this.getIngredientByExternalId(externalId));
  }

  prefetchIngredientsByExternalIds(externalIds: string[], limit = 5): void {
    if (!Array.isArray(externalIds) || !externalIds.length) return;
    const unique = Array.from(
      new Set(externalIds.map((e) => (e || '').toLowerCase()))
    ).slice(0, limit);
    unique.forEach((id) => this.prefetchIngredientByExternalId(id));
  }

  prefetchAllIngredientsIndexSoft(pageSize = 100): void {
    if (
      this._allIngredientsCache ||
      this._allIngredientsLoadingSubject.getValue()
    )
      return;
    if (!this.canPrefetch()) return;
    this.scheduleIdle(() =>
      this.warmAllIngredientsIndex(pageSize).subscribe({
        next: () => {},
        error: () => {},
      })
    );
  }

  // ----- Prefetch runtime internals -----
  private enqueueIdle<T>(factory: () => Observable<T>): void {
    const job = () => {
      // contenitore per la subscribe
      const sink = new Subscription();
      this.prefetchSubs.add(sink);

      const obs$ = factory().pipe(finalize(() => this.onPrefetchDone(sink)));

      const innerSub = obs$.subscribe({
        next: () => {},
        error: () => {},
        complete: () => {},
      });

      sink.add(innerSub);
      return sink;
    };

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
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    const saveData = !!nav?.connection?.saveData;
    const effectiveType = (nav?.connection?.effectiveType ?? '') as string;
    const slow = /2g|slow-2g/.test(effectiveType);
    return !(saveData || slow);
  }

  /** Permette al client di idratare manualmente la cache con dati già disponibili (TransferState). */
  hydrateAllIngredientsCache(list: Ingredient[] | null | undefined): void {
    if (!Array.isArray(list) || !list.length) return;

    this._allIngredientsCache = list.slice();
    this._allIngredientsDataSubject.next(this._allIngredientsCache);
    this._allIngredientsLoadingSubject.next(false);

    for (const item of this._allIngredientsCache) {
      const key = String(item?.external_id ?? '').toLowerCase();
      if (key) this.byExternalId.set(key, item);
    }
  }

  hydrateIngredientDetail(ingredient: Ingredient | null | undefined): void {
    if (!ingredient) return;
    const key = String(ingredient.external_id ?? '').toLowerCase();
    if (!key) return;
    this.byExternalId.set(key, ingredient);
  }

  /** Scarica TUTTE le pagine e popola _allIngredientsCache (+ byExternalId). */
  warmAllIngredientsIndex(
    pageSize = 100,
    forceReload = false
  ): Observable<Ingredient[]> {
    if (this._allIngredientsCache && !forceReload)
      return of(this._allIngredientsCache);

    const collected: Ingredient[] = [];
    this._allIngredientsLoadingSubject.next(true);

    const baseFields = (p: number) =>
      new HttpParams()
        .set('publicationState', 'live') // <<< aggiunto
        .set('pagination[page]', String(p))
        .set('pagination[pageSize]', String(pageSize))
        .set('fields[0]', 'name')
        .set('fields[1]', 'external_id')
        .set('fields[2]', 'description_from_cocktaildb')
        .set('fields[3]', 'isAlcoholic')
        .set('fields[4]', 'ingredient_type')
        // .set('fields[5]', 'slug') // <<< rimosso
        .set('populate[image][fields][0]', 'url')
        .set('populate[image][fields][1]', 'formats');

    const first$ = this.http
      .get<StrapiResponse<Ingredient>>(this.baseUrl, { params: baseFields(1) })
      .pipe(
        map((resp) => {
          resp.data.forEach(
            (ing) => (ing.image = this.processIngredientImage(ing.image))
          );
          collected.push(...resp.data);
          return resp.meta?.pagination?.pageCount || 1;
        })
      );

    return first$.pipe(
      concatMap((pageCount) => {
        if (pageCount <= 1) return of(null);
        let chain$ = of(null as unknown);
        for (let p = 2; p <= pageCount; p++) {
          chain$ = chain$.pipe(
            concatMap(() =>
              this.http
                .get<StrapiResponse<Ingredient>>(this.baseUrl, {
                  params: baseFields(p),
                })
                .pipe(
                  map((resp) => {
                    resp.data.forEach(
                      (ing) =>
                        (ing.image = this.processIngredientImage(ing.image))
                    );
                    collected.push(...resp.data);
                    return null;
                  })
                )
            )
          );
        }
        return chain$;
      }),
      map(() => {
        this._allIngredientsCache = collected
          .slice()
          .sort((a, b) => this.compareBySlug(a, b));
        this._allIngredientsDataSubject.next(this._allIngredientsCache);
        this._allIngredientsLoadingSubject.next(false);
        this._allIngredientsCache.forEach((i) =>
          this.byExternalId.set((i.external_id || '').toLowerCase(), i)
        );
        return this._allIngredientsCache!;
      }),
      catchError((err) => {
        this._allIngredientsLoadingSubject.next(false);
        console.error(
          '[IngredientService.warmAllIngredientsIndex] HTTP error:',
          err?.status,
          err?.error || err
        );
        return throwError(() => err);
      }),
      shareReplay(1)
    );
  }
}
