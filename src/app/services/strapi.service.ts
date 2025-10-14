// src/app/services/strapi.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  of,
  throwError,
  BehaviorSubject,
  Subscription,
  forkJoin,
} from 'rxjs';
import {
  map,
  catchError,
  filter,
  shareReplay,
  concatMap,
} from 'rxjs/operators';
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

export interface SimilarityMeta {
  score: number; // 0..1
  ingredientOverlap?: number; // 0..1 (Jaccard pesato)
  cat?: boolean;
  method?: boolean;
  glass?: boolean;
  alcoholic?: boolean;
  abvClass?: boolean;
  motto?: string;
}
export interface CocktailWithLayoutAndMatch extends Cocktail {
  isTall?: boolean;
  isWide?: boolean;
  matchedIngredientCount?: number;
  similarityScore?: number;
  similarityMeta?: SimilarityMeta;
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

export interface AdjacentPair {
  prev: Cocktail | null;
  next: Cocktail | null;
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
  private adjacentCache = new Map<
    string,
    { prev: Cocktail | null; next: Cocktail | null; ts: number }
  >();
  private adjacentTTLms = 5 * 60_000;

  // ===== Similarity + Motto helpers (EN only) =====

  // Small utils
  private _norm(s?: string | null): string {
    return (s || '').toLowerCase().trim();
  }
  private _hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return h;
  }
  private _pick<T>(arr: readonly T[], seed: string): T {
    const idx = Math.abs(this._hash(seed)) % Math.max(1, arr.length);
    return arr[idx];
  }
  private _truncate(s: string, n = 36): string {
    s = (s || '').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  private _firstSentence(s?: string | null): string {
    if (!s) return '';
    const part = String(s)
      .split(/[.|;|•|–|—|-]/)[0]
      .trim();
    return part;
  }

  // ABV class from ai_alcohol_content % or alcoholic label
  private _abvClass(
    aiAlcohol?: string | null,
    alcoholic?: string | null
  ): 'low' | 'med' | 'high' {
    const s = this._norm(aiAlcohol);
    const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
    const num = m ? parseFloat(m[1]) : NaN;
    if (!isNaN(num)) {
      if (num < 12) return 'low';
      if (num < 25) return 'med';
      return 'high';
    }
    const alc = this._norm(alcoholic);
    if (alc.includes('non alcoholic') || alc.includes('optional alcohol'))
      return 'low';
    return 'med';
  }

  // Ingredient weighting (higher weight for top items = likely base spirit)
  private _ingredientWeightedSet(c: Cocktail): Map<string, number> {
    const map = new Map<string, number>();
    const list = c?.ingredients_list || [];
    list.forEach((item, idx) => {
      const id =
        this._norm(item?.ingredient?.external_id) ||
        this._norm(item?.ingredient?.name);
      if (!id) return;
      let w = 0.3;
      if (idx === 0) w = 1.0;
      else if (idx === 1) w = 0.8;
      else if (idx === 2) w = 0.6;
      else if (idx <= 4) w = 0.5;
      map.set(id, Math.max(map.get(id) || 0, w));
    });
    return map;
  }
  private _weightedJaccard(
    a: Map<string, number>,
    b: Map<string, number>
  ): number {
    let inter = 0,
      uni = 0;
    const keys = new Set([...a.keys(), ...b.keys()]);
    keys.forEach((k) => {
      const wa = a.get(k) || 0;
      const wb = b.get(k) || 0;
      inter += Math.min(wa, wb);
      uni += Math.max(wa, wb);
    });
    return uni > 0 ? inter / uni : 0;
  }
  private _eq(a?: string | null, b?: string | null): 0 | 1 {
    return this._norm(a) === this._norm(b) ? 1 : 0;
  }

  // Main similarity score [0..1]
  private _similarityScore(cur: Cocktail, cand: Cocktail): number {
    const W = {
      ingredients: 0.4,
      category: 0.15,
      method: 0.15,
      glass: 0.1,
      alcoholic: 0.05,
      abvClass: 0.15,
    } as const;

    const ji = this._weightedJaccard(
      this._ingredientWeightedSet(cur),
      this._ingredientWeightedSet(cand)
    );

    const cat = this._eq(cur.category, cand.category);
    const meth = this._eq(cur.preparation_type, cand.preparation_type);
    const glass = this._eq(cur.glass, cand.glass);
    const alc = this._eq(cur.alcoholic, cand.alcoholic);

    const abvA = this._abvClass(cur.ai_alcohol_content, cur.alcoholic);
    const abvB = this._abvClass(cand.ai_alcohol_content, cand.alcoholic);
    const abv = abvA === abvB ? 1 : 0;

    const score =
      W.ingredients * ji +
      W.category * cat +
      W.method * meth +
      W.glass * glass +
      W.alcoholic * alc +
      W.abvClass * abv;

    return +score.toFixed(4);
  }

  // EN mottos
  private readonly MOTTO_EN = {
    base: [
      'Shares the base: {{base}}',
      'Same core: {{base}}',
      'Shared spirit: {{base}}',
      'United by {{base}}',
    ],
    service: [
      'Same serve · {{method}} in {{glass}}',
      'Method & glass aligned',
      'Twin serve · {{method}} · {{glass}}',
      'Same ritual: {{method}} · {{glass}}',
    ],
    family: [
      'Same family · {{category}}',
      'ABV & style aligned',
      'Similar balance in the glass',
      'Kindred character',
    ],
    overlap: [
      'Shared flavor profile',
      'Common aromatic thread',
      'Ingredient footprint aligned',
      'Coherent flavor line',
      'Taste affinity',
    ],
    methodOnly: ['Same making gesture · {{method}}'],
    glassOnly: ['Same glass · {{glass}}'],
    flavor: [
      '{{flavor}}',
      'Shared notes: {{flavor}}',
      'Kindred feel: {{flavor}}',
    ],
    fallback: ['Good pairing', 'Close in style', 'A coherent choice'],
  } as const;

  // Build the final EN motto (ordered rules)
  private _buildMottoEn(
    cur: Cocktail,
    cand: Cocktail,
    sm: SimilarityMeta
  ): string {
    const baseName = cur?.ingredients_list?.[0]?.ingredient?.name || '';
    const baseNorm = this._norm(baseName);
    const candHasBase =
      !!baseNorm &&
      (cand?.ingredients_list || []).some(
        (it) => this._norm(it?.ingredient?.name) === baseNorm
      );

    const method = cand.preparation_type || cur.preparation_type || 'Serve';
    const glass = cand.glass || cur.glass || 'glass';
    const category = cand.category || cur.category || 'Cocktail';
    const flavorAI = this._firstSentence(
      (cand as any).ai_flavor_profile || (cand as any).ai_sensory_description
    );

    if (candHasBase && baseName) {
      return this._pick(this.MOTTO_EN.base, cand.slug).replace(
        '{{base}}',
        baseName
      );
    }

    if (sm.method && sm.glass) {
      return this._pick(this.MOTTO_EN.service, cand.slug)
        .replace('{{method}}', method)
        .replace('{{glass}}', glass);
    }

    if (sm.cat && sm.abvClass) {
      return this._pick(this.MOTTO_EN.family, cand.slug).replace(
        '{{category}}',
        category
      );
    }

    if ((sm.ingredientOverlap ?? 0) >= 0.45) {
      return this._pick(this.MOTTO_EN.overlap, cand.slug);
    }

    if (sm.method) {
      return this._pick(this.MOTTO_EN.methodOnly, cand.slug).replace(
        '{{method}}',
        method
      );
    }
    if (sm.glass) {
      return this._pick(this.MOTTO_EN.glassOnly, cand.slug).replace(
        '{{glass}}',
        glass
      );
    }

    if (flavorAI) {
      return this._pick(this.MOTTO_EN.flavor, cand.slug).replace(
        '{{flavor}}',
        this._truncate(flavorAI, 36)
      );
    }

    return this._pick(this.MOTTO_EN.fallback, cand.slug);
  }

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
      slug: (raw.slug || '').toLowerCase(),
    };
  }

  // ---------- API PUBBLICHE (immutate nelle firme) ----------

  getCocktails(
    page: number = 1,
    pageSize: number = 10,
    searchTerm?: string,
    category?: string,
    alcoholic?: string,
    forceAlphaSort: boolean = false,
    includeIngredients: boolean = true,
    useCache: boolean = false,
    forceReload: boolean = false,
    method?: string, // 👈 NEW
    glass?: string // 👈 NEW
  ): Observable<StrapiResponse<Cocktail>> {
    const isAllCocktailsRequest =
      !!useCache && !searchTerm && !category && !alcoholic && !method && !glass;

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

    // Crea un array con i nomi dei campi degli ingredienti
    const ingredientFields = ['name', 'external_id', 'ingredient_type'];

    let params = new HttpParams()
      .set('pagination[page]', page.toString())
      .set('pagination[pageSize]', pageSize.toString())
      .set('populate[image]', 'true'); // Popola l'immagine del cocktail
    if (forceAlphaSort) {
      params = params.set('sort', 'slug:asc');
    }
    // Cicla sull'array e imposta i campi degli ingredienti in modo dinamico
    ingredientFields.forEach((field, index) => {
      params = params.set(
        `populate[ingredients_list][populate][ingredient][fields][${index}]`,
        field
      );
    });

    // Popola l'immagine annidata dell'ingrediente
    params = params.set(
      'populate[ingredients_list][populate][ingredient][populate][image]',
      'true'
    );

    // --- filtro ricerca/lettera ---
    if (searchTerm) {
      const isDigitGroup = searchTerm === '0-9';
      const isSingleLetter = /^[A-Z]$/i.test(searchTerm);

      if (isDigitGroup) {
        // 🔢 0–9: OR su slug che iniziano con una cifra
        // (slug è tutto lowercase → usiamo $startsWith, case-sensitive ma ok)
        for (let d = 0; d <= 9; d++) {
          params = params.set(
            `filters[$or][${d}][slug][$startsWith]`,
            String(d)
          );
        }
      } else if (isSingleLetter) {
        // 🔤 lettera singola: filtra per slug che inizia con quella lettera
        // (più veloce e coerente con i tuoi url/ordinamenti)
        const l = searchTerm.toLowerCase();
        params = params.set('filters[slug][$startsWith]', l);

        // Se vuoi estendere anche al "name" (fallback UI),
        // decommenta questo OR al posto della riga sopra:
        // params = params
        //   .set('filters[$or][0][slug][$startsWith]', l)
        //   .set('filters[$or][1][name][$startsWithi]', searchTerm);
      } else {
        // 📝 ricerca testuale: tieni lo startsWith sul name
        params = params.set('filters[name][$startsWithi]', searchTerm);
      }
    }

    if (category) params = params.set('filters[category][$eq]', category);
    if (alcoholic) params = params.set('filters[alcoholic][$eq]', alcoholic);
    if (method) params = params.set('filters[preparation_type][$eq]', method);
    if (glass) params = params.set('filters[glass][$eq]', glass);
    const keyObj = {
      page,
      pageSize,
      searchTerm: searchTerm ?? '',
      category: category ?? '',
      alcoholic: alcoholic ?? '',
      method: method ?? '',
      glass: glass ?? '',
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
              .sort((a, b) =>
                (a.slug || '').localeCompare(b.slug || '', undefined, {
                  sensitivity: 'base',
                })
              );
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

  private isFullCocktail(c: Cocktail | null | undefined): boolean {
    return !!c && typeof (c as any).ingredients_list !== 'undefined';
  }

  getCocktailBySlug(slug: string): Observable<Cocktail | null> {
    const norm = (slug || '').toLowerCase();

    const hit = this.bySlug.get(norm);
    if (hit && this.isFullCocktail(hit)) return of(hit);

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
    // Definisci i campi che ti servono per l'entità 'ingredient'
    const ingredientFields = ['name', 'external_id', 'ingredient_type'];

    let params = new HttpParams()
      // Filtra per slug, come nella tua versione originale
      .set('filters[slug][$eq]', slug)

      // Popola l'immagine del cocktail
      .set('populate[image]', 'true');

    // Aggiungi i campi dell'ingrediente in modo dinamico
    ingredientFields.forEach((field, index) => {
      params = params.set(
        `populate[ingredients_list][populate][ingredient][fields][${index}]`,
        field
      );
    });

    // Popola l'immagine dell'ingrediente annidata
    params = params.set(
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
    // Definisci i campi che ti servono per l'entità 'ingredient'
    const ingredientFields = ['name', 'external_id', 'ingredient_type'];

    let params = new HttpParams()
      // Filtro per nome e paginazione
      .set('filters[name][$startsWithi]', query)
      .set('pagination[pageSize]', '10')
      // Popola l'immagine del cocktail
      .set('populate[image]', 'true');

    // Aggiungi i campi dell'ingrediente in modo dinamico
    ingredientFields.forEach((field, index) => {
      params = params.set(
        `populate[ingredients_list][populate][ingredient][fields][${index}]`,
        field
      );
    });

    // Popola l'immagine dell'ingrediente annidata
    params = params.set(
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
    // Definisci i campi che ti servono per l'entità 'ingredient'
    const ingredientFields = ['name', 'external_id', 'ingredient_type'];

    let params = new HttpParams()
      // Filtro per l'ingrediente esterno
      .set(
        'filters[ingredients_list][ingredient][external_id][$eq]',
        ingredientExternalId
      )

      // Popola l'immagine del cocktail
      .set('populate[image]', 'true');

    // Aggiungi i campi dell'ingrediente in modo dinamico
    ingredientFields.forEach((field, index) => {
      params = params.set(
        `populate[ingredients_list][populate][ingredient][fields][${index}]`,
        field
      );
    });

    // Popola l'immagine dell'ingrediente annidata
    params = params.set(
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

    // Definisci i campi che ti servono per l'entità 'ingredient'
    const ingredientFields = ['name', 'external_id', 'ingredient_type'];

    let params = new HttpParams()
      // Paginazione
      .set('pagination[pageSize]', '48')

      // Popola l'immagine del cocktail
      .set('populate[image]', 'true');

    // Aggiungi i campi dell'ingrediente in modo dinamico
    ingredientFields.forEach((field, index) => {
      params = params.set(
        `populate[ingredients_list][populate][ingredient][fields][${index}]`,
        field
      );
    });

    // Popola l'immagine dell'ingrediente annidata
    params = params.set(
      'populate[ingredients_list][populate][ingredient][populate][image]',
      'true'
    );

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

  getSimilarCocktails(
    currentCocktail: Cocktail,
    limit = 16
  ): Observable<CocktailWithLayoutAndMatch[]> {
    if (!currentCocktail?.ingredients_list?.length) return of([]);

    // Ingredient ids del corrente (riduce i candidati prima del ranking)
    const primaryIds = currentCocktail.ingredients_list
      .map((i) => i?.ingredient?.external_id)
      .filter(Boolean) as string[];

    // Lista base: includi ingredienti per calcolo overlap
    const base$ = primaryIds.length
      ? this.getCocktails(
          1,
          120,
          undefined,
          undefined,
          undefined,
          false,
          true /* include ingredients */
        )
      : this.getCocktails(1, 200, undefined, undefined, undefined, true, true);

    return base$.pipe(
      map((resp) => {
        const all = resp.data;
        const curId = String(currentCocktail.external_id);

        const prelim = primaryIds.length
          ? all.filter(
              (c) =>
                String(c.external_id) !== curId &&
                c.ingredients_list?.some((it) =>
                  primaryIds.includes(it.ingredient?.external_id)
                )
            )
          : all.filter((c) => String(c.external_id) !== curId);

        // Ranking + meta + motto
        const ranked = prelim
          .map((c) => {
            const score = this._similarityScore(currentCocktail, c);
            const a = this._ingredientWeightedSet(currentCocktail);
            const b = this._ingredientWeightedSet(c);
            const ingredientOverlap = this._weightedJaccard(a, b);

            const meta: SimilarityMeta = {
              score,
              ingredientOverlap,
              cat: this._eq(currentCocktail.category, c.category) === 1,
              method:
                this._eq(
                  currentCocktail.preparation_type,
                  c.preparation_type
                ) === 1,
              glass: this._eq(currentCocktail.glass, c.glass) === 1,
              alcoholic: this._eq(currentCocktail.alcoholic, c.alcoholic) === 1,
              abvClass:
                this._abvClass(
                  currentCocktail.ai_alcohol_content,
                  currentCocktail.alcoholic
                ) === this._abvClass(c.ai_alcohol_content, c.alcoholic),
            };
            meta.motto = this._buildMottoEn(currentCocktail, c, meta);

            return {
              ...c,
              similarityScore: score,
              similarityMeta: meta,
            } as CocktailWithLayoutAndMatch;
          })
          .sort((a, b) => {
            const diff = b.similarityScore! - a.similarityScore!;
            if (Math.abs(diff) > 0.0001) return diff;
            const mA = this._eq(
              currentCocktail.preparation_type,
              a.preparation_type
            );
            const mB = this._eq(
              currentCocktail.preparation_type,
              b.preparation_type
            );
            if (mA !== mB) return mB - mA;
            const gA = this._eq(currentCocktail.glass, a.glass);
            const gB = this._eq(currentCocktail.glass, b.glass);
            return gB - gA;
          });

        // Fallback per riempire fino a limit
        let out = ranked;
        if (out.length < limit) {
          const extras = all
            .filter(
              (c) =>
                String(c.external_id) !== curId &&
                !out.some((o) => o.external_id === c.external_id) &&
                (this._eq(c.category, currentCocktail.category) ||
                  this._eq(
                    c.preparation_type,
                    currentCocktail.preparation_type
                  ) ||
                  this._eq(c.glass, currentCocktail.glass))
            )
            .map((c) => {
              const score = this._similarityScore(currentCocktail, c);
              const a = this._ingredientWeightedSet(currentCocktail);
              const b = this._ingredientWeightedSet(c);
              const ingredientOverlap = this._weightedJaccard(a, b);

              const meta: SimilarityMeta = {
                score,
                ingredientOverlap,
                cat: this._eq(currentCocktail.category, c.category) === 1,
                method:
                  this._eq(
                    currentCocktail.preparation_type,
                    c.preparation_type
                  ) === 1,
                glass: this._eq(currentCocktail.glass, c.glass) === 1,
                alcoholic:
                  this._eq(currentCocktail.alcoholic, c.alcoholic) === 1,
                abvClass:
                  this._abvClass(
                    currentCocktail.ai_alcohol_content,
                    currentCocktail.alcoholic
                  ) === this._abvClass(c.ai_alcohol_content, c.alcoholic),
              };
              meta.motto = this._buildMottoEn(currentCocktail, c, meta);

              return {
                ...c,
                similarityScore: score,
                similarityMeta: meta,
              } as CocktailWithLayoutAndMatch;
            })
            .sort((a, b) => b.similarityScore! - a.similarityScore!);

          out = out.concat(extras);
        }

        return out.slice(0, limit);
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

  // Aggiungi nel CocktailService
  warmAllCocktailsIndex(
    pageSize = 100,
    forceReload = false
  ): Observable<Cocktail[]> {
    if (this._allCocktailsCache && !forceReload)
      return of(this._allCocktailsCache);

    this._allCocktailsLoadingSubject.next(true);

    const firstParams = new HttpParams()
      .set('pagination[page]', '1')
      .set('pagination[pageSize]', String(pageSize))
      .set('populate[image]', 'true')
      .set('sort', 'slug:asc');

    return this.http
      .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params: firstParams })
      .pipe(
        map((r): { first: Cocktail[]; pageCount: number } => ({
          first: (r.data as any[]).map((it: any) => this.cleanCocktailData(it)),
          pageCount: r.meta?.pagination?.pageCount || 1,
        })),
        concatMap(
          ({ first, pageCount }: { first: Cocktail[]; pageCount: number }) => {
            if (pageCount <= 1) return of(first);

            let chain$ = of(first as Cocktail[]);
            for (let p = 2; p <= pageCount; p++) {
              const pParams = new HttpParams()
                .set('pagination[page]', String(p))
                .set('pagination[pageSize]', String(pageSize))
                .set('populate[image]', 'true')
                .set('sort', 'slug:asc');

              chain$ = chain$.pipe(
                concatMap((collected: Cocktail[]) =>
                  this.http
                    .get<StrapiResponse<any>>(this.cocktailsBaseUrl, {
                      params: pParams,
                    })
                    .pipe(
                      map((resp) =>
                        collected.concat(
                          (resp.data as any[]).map((it: any) =>
                            this.cleanCocktailData(it)
                          )
                        )
                      )
                    )
                )
              );
            }
            return chain$;
          }
        ),
        map((all: Cocktail[]) => {
          this._allCocktailsCache = all
            .slice()
            .sort((a: Cocktail, b: Cocktail) =>
              (a.slug || '').localeCompare(b.slug || '', undefined, {
                sensitivity: 'base',
              })
            );

          this._allCocktailsDataSubject.next(this._allCocktailsCache);
          this._allCocktailsLoadingSubject.next(false);

          this._allCocktailsCache?.forEach((c) =>
            this.bySlug.set((c.slug || '').toLowerCase(), c)
          );

          return this._allCocktailsCache!;
        }),
        catchError((err) => {
          this._allCocktailsLoadingSubject.next(false);
          return throwError(() => err);
        }),
        shareReplay(1)
      );
  }

  // Sostituisci la tua prefetch soft:
  prefetchAllCocktailsIndexSoft(pageSize = 100): void {
    if (this._allCocktailsCache || this._allCocktailsLoadingSubject.getValue())
      return;
    if (!this.canPrefetch()) return;
    this.enqueueIdle(() => this.warmAllCocktailsIndex(pageSize));
  }

  getAdjacentCocktailsBySlug(currentSlug: string): Observable<AdjacentPair> {
    const norm = (currentSlug || '').toLowerCase();
    const now = Date.now();

    // 1) cache
    const hit = this.adjacentCache.get(norm);
    if (hit && now - hit.ts < this.adjacentTTLms) {
      return of({ prev: hit.prev, next: hit.next });
    }

    // 2) indice caldo → nessuna HTTP
    if (this._allCocktailsCache?.length) {
      const arr = this._allCocktailsCache;
      const idx = arr.findIndex((c) => (c.slug || '').toLowerCase() === norm);
      const prev = idx > 0 ? arr[idx - 1] : null;
      const next = idx >= 0 && idx < arr.length - 1 ? arr[idx + 1] : null;
      this.adjacentCache.set(norm, { prev, next, ts: now });
      return of({ prev, next });
    }

    // 3) fallback HTTP ultraleggero (solo name/slug/external_id + image)
    const baseFields = ['name', 'slug', 'external_id'];
    const project = (p: HttpParams) => {
      baseFields.forEach((f, i) => (p = p.set(`fields[${i}]`, f)));
      p = p.set('populate[image][fields][0]', 'url');
      p = p.set('populate[image][fields][1]', 'formats');
      return p; // niente ingredients_list
    };

    const nextParams = project(
      new HttpParams()
        .set('filters[slug][$gt]', norm)
        .set('sort', 'slug:asc')
        .set('pagination[pageSize]', '1')
    );

    const prevParams = project(
      new HttpParams()
        .set('filters[slug][$lt]', norm)
        .set('sort', 'slug:desc')
        .set('pagination[pageSize]', '1')
    );

    const next$ = this.http
      .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params: nextParams })
      .pipe(
        map((r) => (r.data?.[0] ? this.cleanCocktailData(r.data[0]) : null)),
        catchError(() => of(null))
      );

    const prev$ = this.http
      .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params: prevParams })
      .pipe(
        map((r) => (r.data?.[0] ? this.cleanCocktailData(r.data[0]) : null)),
        catchError(() => of(null))
      );

    return forkJoin({ prev: prev$, next: next$ }).pipe(
      map((res: AdjacentPair): AdjacentPair => {
        this.adjacentCache.set(norm, {
          prev: res.prev,
          next: res.next,
          ts: now,
        });
        return res; // ✅ IMPORTANTISSIMO: restituisci res
      })
    );
  }
}
