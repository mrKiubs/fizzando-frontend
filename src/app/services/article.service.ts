// src/app/services/article.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { forkJoin, Observable, of, throwError } from 'rxjs';
import { map, catchError, shareReplay, switchMap, tap } from 'rxjs/operators';
import { env } from '../config/env';

/* ===== Tipi ===== */
export interface Article {
  id: number;
  documentId?: string;
  title: string;
  slug: string;
  introduction: string;
  conclusion: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  generated_at: string;
  article_status: string;
  sections: Section[];
  image: Image;
  related_cocktails: any[];
  related_ingredients: any[];
  categories: any[];
  content?: string;
  summary?: string;
  imageUrl?: string;
}

export interface Section {
  id: number;
  heading: string;
  content: { type: string; children: { text: string; type: string }[] }[];
  image?: Image;
}

export interface Image {
  id: number;
  name: string;
  formats: {
    thumbnail?: Format;
    small?: Format;
    medium?: Format;
    large?: Format;
  };
  url: string;
  ext: string;
  mime: string;
}

export interface Format {
  ext: string;
  url: string;
  width: number;
  height: number;
  size: number;
  mime: string;
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

/* ===== Service ===== */
@Injectable({ providedIn: 'root' })
export class ArticleService {
  private strapiBaseUrl = env.apiUrl; // es: http://127.0.0.1:1337
  private apiUrl = `${this.strapiBaseUrl}/api/articles`;

  // ---- CACHE IN-MEMORY ----
  /** Cache per slug/id → Article */
  private bySlug = new Map<string, Article>();
  private byId = new Map<number, Article>();

  /** Richieste in corso (coalescing) */
  private inFlightSlug = new Map<string, Observable<Article | null>>();
  private inFlightId = new Map<number, Observable<Article | null>>();

  /** Cache liste (key = params/string) con TTL breve */
  private listCache = new Map<
    string,
    { ts: number; stream$: Observable<StrapiResponse<Article>> }
  >();
  private listTTLms = 60_000; // 60s

  constructor(private http: HttpClient) {}

  /* --- Helpers immagini --- */
  private getAbsoluteImageUrl(imageUrl: string | undefined): string {
    if (!imageUrl) return '/assets/no-image.png';
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))
      return imageUrl;
    return `${this.strapiBaseUrl}${
      imageUrl.startsWith('/') ? imageUrl : '/' + imageUrl
    }`;
  }

  private processSingleImage(image: Image): void {
    if (image?.url) image.url = this.getAbsoluteImageUrl(image.url);
    if (image?.formats) {
      for (const key in image.formats) {
        const f = (image.formats as any)[key];
        if (f?.url) f.url = this.getAbsoluteImageUrl(f.url);
      }
    }
  }

  private processArticleImages(article: Article): Article {
    if (article.image) this.processSingleImage(article.image);
    article.sections?.forEach(
      (s) => s.image && this.processSingleImage(s.image)
    );
    article.related_cocktails?.forEach(
      (c: any) => c?.image && this.processSingleImage(c.image)
    );
    article.related_ingredients?.forEach(
      (i: any) => i?.image && this.processSingleImage(i.image)
    );

    if (!article.imageUrl && article.image) {
      const candidate =
        article.image.formats?.small?.url ??
        article.image.formats?.thumbnail?.url ??
        article.image.formats?.medium?.url ??
        article.image.url;
      article.imageUrl = this.getAbsoluteImageUrl(candidate);
    }
    return article;
  }

  // --------- Cache utils per liste ----------
  private getCachedList(
    key: string
  ): Observable<StrapiResponse<Article>> | null {
    const now = Date.now();
    const hit = this.listCache.get(key);
    if (hit && now - hit.ts < this.listTTLms) return hit.stream$;
    return null;
  }
  private setCachedList(
    key: string,
    stream$: Observable<StrapiResponse<Article>>
  ): void {
    this.listCache.set(key, { ts: Date.now(), stream$ });
  }

  /* =========================
   * LISTA (card)
   * ========================= */
  getArticles(
    page = 1,
    pageSize = 10,
    searchTerm?: string
  ): Observable<StrapiResponse<Article>> {
    let params = new HttpParams()
      .set('pagination[page]', page.toString())
      .set('pagination[pageSize]', pageSize.toString())
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('sort', 'publishedAt:desc')
      .set('populate', 'image');

    if (searchTerm) {
      params = params
        .set('filters[$or][0][title][$startsWithi]', searchTerm)
        .set('filters[$or][1][introduction][$containsi]', searchTerm);
    }

    const key = JSON.stringify({
      fn: 'getArticles',
      page,
      pageSize,
      searchTerm: searchTerm ?? '',
    });
    const cached = this.getCachedList(key);
    if (cached) return cached;

    const stream$ = this.http
      .get<StrapiResponse<any>>(this.apiUrl, { params })
      .pipe(
        map((response) => {
          const mapped: Article[] = (response.data ?? []).map((item: any) => {
            const a: Article = {
              id: item.id,
              title: item.title,
              slug: item.slug,
              introduction: item.introduction,
              conclusion: item.conclusion,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
              publishedAt: item.publishedAt,
              generated_at: item.generated_at,
              article_status: item.article_status,
              sections: item.sections || [],
              image: item.image,
              related_cocktails: item.related_cocktails || [],
              related_ingredients: item.related_ingredients || [],
              categories: item.categories || [],
              content: item.content,
            };
            if (a.image) this.processSingleImage(a.image);
            return a;
          });
          return { data: mapped, meta: response.meta };
        }),
        catchError((err) =>
          throwError(() => new Error('Could not load articles.'))
        ),
        shareReplay(1)
      );

    this.setCachedList(key, stream$);
    return stream$;
  }

  /* =========================
   * DETTAGLIO per slug (memoized)
   * ========================= */
  /* =========================
   * DETTAGLIO per slug (memoized)
   * ========================= */
  getArticleBySlug(slug: string): Observable<Article | null> {
    const rawSlug = (slug ?? '').trim();

    // usa SEMPRE l'apiUrl del service (evita mismatch con env.apiBaseUrl)
    const params = new HttpParams()
      .set('filters[slug][$eq]', rawSlug)
      .set('publicationState', 'live')
      .set('pagination[limit]', '1')
      // populate mirato, come nel resto del service
      .append('populate', 'sections')
      .append('populate', 'image')
      .append('populate', 'categories')
      .append('populate', 'related_cocktails.image')
      .append('populate', 'related_ingredients.image');

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
      map((response) => {
        const raw = response?.data?.[0];
        if (!raw) return null;

        // *** NORMALIZZAZIONE COERENTE con gli altri metodi ***
        const article: Article = {
          id: raw.id,
          title: raw.title,
          slug: raw.slug,
          introduction: raw.introduction,
          conclusion: raw.conclusion,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
          publishedAt: raw.publishedAt,
          generated_at: raw.generated_at,
          article_status: raw.article_status,
          sections: Array.isArray(raw.sections)
            ? raw.sections
            : raw.sections
            ? [raw.sections]
            : [],
          image: raw.image,
          related_cocktails: Array.isArray(raw.related_cocktails)
            ? raw.related_cocktails
            : raw.related_cocktails
            ? [raw.related_cocktails]
            : [],
          related_ingredients: Array.isArray(raw.related_ingredients)
            ? raw.related_ingredients
            : raw.related_ingredients
            ? [raw.related_ingredients]
            : [],
          categories: Array.isArray(raw.categories)
            ? raw.categories
            : raw.categories
            ? [raw.categories]
            : [],
          content: raw.content,
          imageUrl: undefined,
        };

        const processed = this.processArticleImages(article);

        // memoize per slug/id, come fai altrove
        if (processed.slug)
          this.bySlug.set(processed.slug.toLowerCase(), processed);
        if (processed.id) this.byId.set(processed.id, processed);

        return processed;
      }),
      catchError((err) => {
        console.error('[getArticleBySlug] HTTP error', {
          slug: rawSlug,
          status: (err as any)?.status,
          message: (err as any)?.message,
        });
        return throwError(() => new Error('Could not get article by slug'));
      }),
      shareReplay(1)
    );
  }

  /* =========================
   * DETTAGLIO per ID (memoized)
   * ========================= */
  getArticleById(id: number): Observable<Article | null> {
    // 1) cache per id
    const hit = this.byId.get(id);
    if (hit) return of(hit);

    // 2) richiesta in corso già esistente?
    const inFlight = this.inFlightId.get(id);
    if (inFlight) return inFlight;

    let params = new HttpParams()
      .append('populate', 'sections')
      .append('populate', 'image')
      .append('populate', 'categories')
      .append('populate', 'related_cocktails.image')
      .append('populate', 'related_ingredients.image');

    const req$ = this.http
      .get<StrapiSingleResponse<any>>(`${this.apiUrl}/${id}`, { params })
      .pipe(
        map((response) => {
          const raw = response.data;
          if (!raw) return null;

          const article: Article = {
            id: raw.id,
            title: raw.title,
            slug: raw.slug,
            introduction: raw.introduction,
            conclusion: raw.conclusion,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            publishedAt: raw.publishedAt,
            generated_at: raw.generated_at,
            article_status: raw.article_status,
            sections: raw.sections || [],
            image: raw.image,
            related_cocktails: raw.related_cocktails || [],
            related_ingredients: raw.related_ingredients || [],
            categories: raw.categories || [],
            content: raw.content,
          };

          const processed = this.processArticleImages(article);
          // memoize per id/slug
          this.byId.set(id, processed);
          if (processed.slug)
            this.bySlug.set(processed.slug.toLowerCase(), processed);
          return processed;
        }),
        catchError(() =>
          throwError(() => new Error('Could not get article by ID.'))
        ),
        shareReplay(1)
      );

    this.inFlightId.set(id, req$);
    req$.subscribe({
      next: () => this.inFlightId.delete(id),
      error: () => this.inFlightId.delete(id),
    });

    return req$;
  }

  /* =========================
   * LISTA per categoria (card) — cached
   * ========================= */
  getArticlesByCategorySlug(
    slug: string,
    page = 1,
    pageSize = 10
  ): Observable<StrapiResponse<Article>> {
    let params = new HttpParams()
      .set('pagination[page]', page.toString())
      .set('pagination[pageSize]', pageSize.toString())
      .set('filters[categories][slug][$eq]', slug)
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('sort', 'publishedAt:desc')
      .set('populate', 'image');

    const key = JSON.stringify({
      fn: 'getArticlesByCategorySlug',
      slug,
      page,
      pageSize,
    });
    const cached = this.getCachedList(key);
    if (cached) return cached;

    const stream$ = this.http
      .get<StrapiResponse<any>>(this.apiUrl, { params })
      .pipe(
        map((response) => {
          const mapped: Article[] = (response.data ?? []).map((item: any) => {
            const a: Article = {
              id: item.id,
              title: item.title,
              slug: item.slug,
              introduction: item.introduction,
              conclusion: item.conclusion,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
              publishedAt: item.publishedAt,
              generated_at: item.generated_at,
              article_status: item.article_status,
              sections: item.sections || [],
              image: item.image,
              related_cocktails: item.related_cocktails || [],
              related_ingredients: item.related_ingredients || [],
              categories: item.categories || [],
              content: item.content,
            };
            if (a.image) this.processSingleImage(a.image);
            return a;
          });
          return { data: mapped, meta: response.meta };
        }),
        catchError(() =>
          throwError(() => new Error('Could not load articles by category.'))
        ),
        shareReplay(1)
      );

    this.setCachedList(key, stream$);
    return stream$;
  }

  /* =========================
   * ULTIMI N articoli (card) — cached
   * ========================= */
  getLatestArticles(count: number): Observable<Article[]> {
    let params = new HttpParams()
      .set('pagination[limit]', count.toString())
      .set('sort', 'publishedAt:desc')
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('populate', 'image');

    const key = JSON.stringify({ fn: 'getLatestArticles', count });
    const cached = this.getCachedList(key);
    if (cached) return cached.pipe(map((r) => r.data));

    const stream$ = this.http
      .get<StrapiResponse<any>>(this.apiUrl, { params })
      .pipe(
        map((response) => {
          const data: Article[] = (response.data ?? []).map((item: any) => {
            const a: Article = {
              id: item.id,
              title: item.title,
              slug: item.slug,
              introduction: item.introduction,
              conclusion: item.conclusion,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
              publishedAt: item.publishedAt,
              generated_at: item.generated_at,
              article_status: item.article_status,
              sections: item.sections || [],
              image: item.image,
              related_cocktails: item.related_cocktails || [],
              related_ingredients: item.related_ingredients || [],
              categories: item.categories || [],
              content: item.content,
              summary: item.introduction,
              imageUrl: item.image
                ? this.getAbsoluteImageUrl(item.image.url)
                : '/assets/no-image.png',
            };
            return a;
          });
          return { data, meta: response.meta } as StrapiResponse<Article>;
        }),
        catchError(() =>
          throwError(() => new Error('Could not load latest articles.'))
        ),
        shareReplay(1)
      );

    this.setCachedList(key, stream$);
    return stream$.pipe(map((r) => r.data));
  }

  // Articoli che citano un certo COCKTAIL (id Strapi) — cached
  getArticlesByRelatedCocktailId(
    cocktailId: number,
    limit = 6
  ): Observable<Article[]> {
    let params = new HttpParams()
      .set('filters[related_cocktails][id][$eq]', String(cocktailId))
      .set('pagination[limit]', String(limit))
      .set('sort', 'publishedAt:desc')
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('populate', 'image');

    const key = JSON.stringify({
      fn: 'getArticlesByRelatedCocktailId',
      cocktailId,
      limit,
    });
    const cached = this.getCachedList(key);
    if (cached) return cached.pipe(map((r) => r.data));

    const stream$ = this.http
      .get<StrapiResponse<any>>(this.apiUrl, { params })
      .pipe(
        map((res) => {
          const data: Article[] = (res.data ?? []).map((raw: any) => {
            const a: Article = {
              id: raw.id,
              title: raw.title,
              slug: raw.slug,
              introduction: raw.introduction,
              conclusion: raw.conclusion,
              createdAt: raw.createdAt,
              updatedAt: raw.updatedAt,
              publishedAt: raw.publishedAt,
              generated_at: raw.generated_at,
              article_status: raw.article_status,
              sections: raw.sections || [],
              image: raw.image,
              related_cocktails: raw.related_cocktails || [],
              related_ingredients: raw.related_ingredients || [],
              categories: raw.categories || [],
              content: raw.content,
              imageUrl: undefined,
            };
            if (a.image) {
              this.processSingleImage(a.image);
              a.imageUrl = this.pickCardImageUrl(a.image);
            } else {
              a.imageUrl = '/assets/no-image.png';
            }
            return a;
          });
          return { data, meta: res.meta } as StrapiResponse<Article>;
        }),
        catchError(() =>
          throwError(() => new Error('Could not load related articles.'))
        ),
        shareReplay(1)
      );

    this.setCachedList(key, stream$);
    return stream$.pipe(map((r) => r.data));
  }

  // Articoli che citano un certo INGREDIENTE (id Strapi) — cached
  getArticlesByRelatedIngredientId(
    ingredientId: number,
    limit = 6
  ): Observable<Article[]> {
    let params = new HttpParams()
      .set('filters[related_ingredients][id][$eq]', String(ingredientId))
      .set('pagination[limit]', String(limit))
      .set('sort', 'publishedAt:desc')
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('populate', 'image');

    const key = JSON.stringify({
      fn: 'getArticlesByRelatedIngredientId',
      ingredientId,
      limit,
    });
    const cached = this.getCachedList(key);
    if (cached) return cached.pipe(map((r) => r.data));

    const stream$ = this.http
      .get<StrapiResponse<any>>(this.apiUrl, { params })
      .pipe(
        map((res) => {
          const data: Article[] = (res.data ?? []).map((raw: any) => {
            const a: Article = {
              id: raw.id,
              title: raw.title,
              slug: raw.slug,
              introduction: raw.introduction,
              conclusion: raw.conclusion,
              createdAt: raw.createdAt,
              updatedAt: raw.updatedAt,
              publishedAt: raw.publishedAt,
              generated_at: raw.generated_at,
              article_status: raw.article_status,
              sections: raw.sections || [],
              image: raw.image,
              related_cocktails: raw.related_cocktails || [],
              related_ingredients: raw.related_ingredients || [],
              categories: raw.categories || [],
              content: raw.content,
              imageUrl: undefined,
            };
            if (a.image) {
              this.processSingleImage(a.image);
              a.imageUrl = this.pickCardImageUrl(a.image);
            } else {
              a.imageUrl = '/assets/no-image.png';
            }
            return a;
          });
          return { data, meta: res.meta } as StrapiResponse<Article>;
        }),
        catchError(() =>
          throwError(() => new Error('Could not load related articles.'))
        ),
        shareReplay(1)
      );

    this.setCachedList(key, stream$);
    return stream$.pipe(map((r) => r.data));
  }

  private pickCardImageUrl(image?: Image): string {
    if (!image) return '/assets/no-image.png';
    const candidate =
      image.formats?.small?.url ??
      image.formats?.thumbnail?.url ??
      image.formats?.medium?.url ??
      image.url;
    return this.getAbsoluteImageUrl(candidate);
  }

  getRelatedArticlesByCategories(
    categorySlugs: string[],
    excludeSlug: string,
    limit = 6
  ): Observable<Article[]> {
    if (!categorySlugs?.length) return of<Article[]>([]);

    let params = new HttpParams()
      .set('pagination[page]', '1')
      .set('pagination[pageSize]', String(limit))
      .set('sort', 'publishedAt:desc')
      .set('filters[slug][$ne]', excludeSlug)
      .append('populate', 'image');

    // OR su più categorie
    categorySlugs.forEach((slug, i) => {
      params = params.set(`filters[$or][${i}][categories][slug][$eq]`, slug);
    });

    const key = JSON.stringify({
      fn: 'getRelatedArticlesByCategories',
      categorySlugs,
      excludeSlug,
      limit,
    });
    const cached = this.getCachedList(key);
    if (cached) return cached.pipe(map((r) => r.data));

    const stream$ = this.http
      .get<StrapiResponse<any>>(this.apiUrl, { params })
      .pipe(
        map(
          (res) =>
            ({
              data: (res.data ?? []).map((raw: any) => {
                const a: Article = {
                  id: raw.id,
                  title: raw.title,
                  slug: raw.slug,
                  introduction: raw.introduction,
                  conclusion: raw.conclusion,
                  createdAt: raw.createdAt,
                  updatedAt: raw.updatedAt,
                  publishedAt: raw.publishedAt,
                  generated_at: raw.generated_at,
                  article_status: raw.article_status,
                  sections: raw.sections || [],
                  image: raw.image,
                  related_cocktails: raw.related_cocktails || [],
                  related_ingredients: raw.related_ingredients || [],
                  categories: raw.categories || [],
                  content: raw.content,
                  imageUrl: this.pickCardImageUrl(raw.image),
                };
                if (a.image) this.processSingleImage(a.image);
                return a;
              }),
              meta: res.meta,
            } as StrapiResponse<Article>)
        ),
        shareReplay(1)
      );

    this.setCachedList(key, stream$);
    return stream$.pipe(map((r) => r.data));
  }

  /** Prende articoli per nome categoria (fallback se il category non ha slug) — cached */
  getArticlesByCategoryName(
    name: string,
    page = 1,
    pageSize = 10
  ): Observable<StrapiResponse<Article>> {
    let params = new HttpParams()
      .set('pagination[page]', page.toString())
      .set('pagination[pageSize]', pageSize.toString())
      .set('filters[categories][name][$eqi]', name)
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('populate', 'image')
      .set('sort[0]', 'publishedAt:desc');

    const key = JSON.stringify({
      fn: 'getArticlesByCategoryName',
      name,
      page,
      pageSize,
    });
    const cached = this.getCachedList(key);
    if (cached) return cached;

    const stream$ = this.http
      .get<StrapiResponse<any>>(this.apiUrl, { params })
      .pipe(
        map((response) => {
          const mappedData: Article[] = response.data.map((item: any) => {
            const article: Article = {
              id: item.id,
              title: item.title,
              slug: item.slug,
              introduction: item.introduction,
              conclusion: item.conclusion,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
              publishedAt: item.publishedAt,
              generated_at: item.generated_at,
              article_status: item.article_status,
              sections: item.sections || [],
              image: item.image,
              related_cocktails: item.related_cocktails || [],
              related_ingredients: item.related_ingredients || [],
              categories: item.categories || [],
              content: item.content,
              imageUrl: item.image
                ? this.getAbsoluteImageUrl(item.image.url)
                : '/assets/no-image.png',
            };
            if (article.image) this.processSingleImage(article.image);
            return article;
          });
          return { data: mappedData, meta: response.meta };
        }),
        catchError(() =>
          throwError(
            () => new Error('Could not load articles by category name.')
          )
        ),
        shareReplay(1)
      );

    this.setCachedList(key, stream$);
    return stream$;
  }

  /** Utility per deduplicare per slug */
  private uniqueBySlug(list: Article[]): Article[] {
    const seen = new Set<string>();
    const out: Article[] = [];
    for (const a of list) {
      const key = a.slug ?? String(a.id);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(a);
      }
    }
    return out;
  }

  /** Articoli correlati in base alle categorie dell’articolo corrente — usa le cache di lista */
  getRelatedArticlesByArticle(
    article: Article,
    limit = 6
  ): Observable<Article[]> {
    const cats = (article.categories ?? []) as any[];
    const withSlug = cats
      .map((c) => c?.slug)
      .filter((s: any): s is string => !!s);
    const withName = cats
      .map((c) => (!c?.slug ? c?.name : null))
      .filter((n: any): n is string => !!n);

    if (withSlug.length === 0 && withName.length === 0) return of([]);

    const perCatCalls: Observable<StrapiResponse<Article>>[] = [
      ...withSlug.map((slug) =>
        this.getArticlesByCategorySlug(slug, 1, Math.max(limit, 6))
      ),
      ...withName.map((name) =>
        this.getArticlesByCategoryName(name, 1, Math.max(limit, 6))
      ),
    ];

    return forkJoin(perCatCalls).pipe(
      map((results) => {
        const merged: Article[] = results.flatMap((r) => r.data ?? []);
        const filtered = merged.filter((a) => a.slug !== article.slug);
        const unique = this.uniqueBySlug(filtered);
        return unique.slice(0, limit);
      }),
      catchError(() => of([]))
    );
  }
}
