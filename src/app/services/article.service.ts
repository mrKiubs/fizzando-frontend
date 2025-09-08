// src/app/services/article.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError, shareReplay } from 'rxjs/operators';
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

  // micro-cache delle GET per coalescere richieste identiche ravvicinate
  private reqCache = new Map<string, { t: number; obs: Observable<any> }>();
  private readonly REQ_TTL_MS = 30_000;

  constructor(private http: HttpClient) {}

  /* --- Helpers cache --- */
  private cacheKey(url: string, params: HttpParams): string {
    return `${url}?${params.toString()}`;
  }
  private getWithCache<T>(url: string, params: HttpParams): Observable<T> {
    const key = this.cacheKey(url, params);
    const hit = this.reqCache.get(key);
    const now = Date.now();
    if (hit && now - hit.t < this.REQ_TTL_MS) return hit.obs as Observable<T>;
    const obs = this.http.get<T>(url, { params }).pipe(shareReplay(1));
    this.reqCache.set(key, { t: now, obs });
    return obs;
  }

  /* --- Helpers immagini --- */
  private joinUrl(base: string, path: string): string {
    const b = base.replace(/\/+$/, '');
    const p = path.replace(/^\/+/, '');
    return `${b}/${p}`;
  }

  private getAbsoluteImageUrl(imageUrl: string | undefined): string {
    if (!imageUrl) return '/assets/no-image.png';
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))
      return imageUrl;
    return this.joinUrl(this.strapiBaseUrl, imageUrl);
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

  private pickCardImageUrl(image?: Image): string {
    if (!image) return '/assets/no-image.png';
    const candidate =
      image.formats?.small?.url ??
      image.formats?.thumbnail?.url ??
      image.formats?.medium?.url ??
      image.url;
    return this.getAbsoluteImageUrl(candidate);
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
      .set('sort', 'publishedAt:desc')
      .set('populate', 'image')
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction');

    // Manteniamo il count per le pagine principali (servono i numeri)
    // Se NON ti serve il totale, puoi scommentare la riga seguente:
    // params = params.set('pagination[withCount]', 'false');

    if (searchTerm) {
      params = params
        .set('filters[$or][0][title][$startsWithi]', searchTerm)
        .set('filters[$or][1][introduction][$containsi]', searchTerm);
    }

    return this.getWithCache<StrapiResponse<any>>(this.apiUrl, params).pipe(
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
      catchError((err) => {
        console.error('Error loading articles:', err);
        return throwError(() => new Error('Could not load articles.'));
      })
    );
  }

  /* =========================
   * DETTAGLIO per slug
   * ========================= */
  getArticleBySlug(slug: string): Observable<Article | null> {
    let params = new HttpParams()
      .set('filters[slug][$eq]', slug)
      .set('pagination[withCount]', 'false')
      .append('populate', 'sections')
      .append('populate', 'image')
      .append('populate', 'categories')
      .append('populate', 'related_cocktails.image')
      .append('populate', 'related_ingredients.image');

    return this.getWithCache<StrapiResponse<any>>(this.apiUrl, params).pipe(
      map((response) => {
        const raw = response.data?.[0];
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

        return this.processArticleImages(article);
      }),
      catchError((err) => {
        console.error('Error getting article by slug:', err);
        return throwError(() => new Error('Could not get article by slug.'));
      })
    );
  }

  /* =========================
   * DETTAGLIO per ID
   * ========================= */
  getArticleById(id: number): Observable<Article | null> {
    let params = new HttpParams()
      .set('pagination[withCount]', 'false')
      .append('populate', 'sections')
      .append('populate', 'image')
      .append('populate', 'categories')
      .append('populate', 'related_cocktails.image')
      .append('populate', 'related_ingredients.image');

    return this.getWithCache<StrapiSingleResponse<any>>(
      `${this.apiUrl}/${id}`,
      params
    ).pipe(
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

        return this.processArticleImages(article);
      }),
      catchError((err) => {
        console.error('Error getting article by ID:', err);
        return throwError(() => new Error('Could not get article by ID.'));
      })
    );
  }

  /* =========================
   * LISTA per categoria (card)
   * ========================= */
  getArticlesByCategorySlug(
    slug: string,
    page = 1,
    pageSize = 10
  ): Observable<StrapiResponse<Article>> {
    let params = new HttpParams()
      .set('pagination[page]', page.toString())
      .set('pagination[pageSize]', pageSize.toString())
      .set('sort', 'publishedAt:desc')
      .set('filters[categories][slug][$eq]', slug)
      .set('populate', 'image')
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction');

    return this.getWithCache<StrapiResponse<any>>(this.apiUrl, params).pipe(
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
      catchError((err) => {
        console.error('Error loading articles by category:', err);
        return throwError(
          () => new Error('Could not load articles by category.')
        );
      })
    );
  }

  /* =========================
   * ULTIMI N articoli (card)
   * ========================= */
  getLatestArticles(count: number): Observable<Article[]> {
    let params = new HttpParams()
      .set('pagination[limit]', count.toString())
      .set('pagination[withCount]', 'false')
      .set('sort', 'publishedAt:desc')
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('populate', 'image');

    return this.getWithCache<StrapiResponse<any>>(this.apiUrl, params).pipe(
      map((response) =>
        (response.data ?? []).map((item: any) => {
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
        })
      ),
      catchError((err) => {
        console.error('Error loading latest articles:', err);
        return throwError(() => new Error('Could not load latest articles.'));
      })
    );
  }

  // Articoli che citano un certo COCKTAIL (id Strapi)
  getArticlesByRelatedCocktailId(
    cocktailId: number,
    limit = 6
  ): Observable<Article[]> {
    let params = new HttpParams()
      .set('filters[related_cocktails][id][$eq]', String(cocktailId))
      .set('pagination[limit]', String(limit))
      .set('pagination[withCount]', 'false')
      .set('sort', 'publishedAt:desc')
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('populate', 'image');

    return this.getWithCache<StrapiResponse<any>>(this.apiUrl, params).pipe(
      map((res) =>
        (res.data ?? []).map((raw: any) => {
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
            imageUrl: raw.image
              ? this.pickCardImageUrl(raw.image)
              : '/assets/no-image.png',
          };
          if (a.image) this.processSingleImage(a.image);
          return a;
        })
      ),
      catchError((err) => {
        console.error('Error loading related articles by cocktail:', err);
        return throwError(() => new Error('Could not load related articles.'));
      })
    );
  }

  // Articoli che citano un certo INGREDIENTE (id Strapi)
  getArticlesByRelatedIngredientId(
    ingredientId: number,
    limit = 6
  ): Observable<Article[]> {
    let params = new HttpParams()
      .set('filters[related_ingredients][id][$eq]', String(ingredientId))
      .set('pagination[limit]', String(limit))
      .set('pagination[withCount]', 'false')
      .set('sort', 'publishedAt:desc')
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('populate', 'image');

    return this.getWithCache<StrapiResponse<any>>(this.apiUrl, params).pipe(
      map((res) =>
        (res.data ?? []).map((raw: any) => {
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
            imageUrl: raw.image
              ? this.pickCardImageUrl(raw.image)
              : '/assets/no-image.png',
          };
          if (a.image) this.processSingleImage(a.image);
          return a;
        })
      ),
      catchError((err) => {
        console.error('Error loading related articles by ingredient:', err);
        return throwError(() => new Error('Could not load related articles.'));
      })
    );
  }

  /**
   * Articoli correlati rispetto alle categorie dell’articolo corrente.
   * Ottimizzato: UNA sola richiesta con OR + $in (slug / name) e exclude sul corrente.
   */
  getRelatedArticlesByArticle(
    article: Article,
    limit = 6
  ): Observable<Article[]> {
    const cats = (article.categories ?? []) as any[];
    const slugList = cats
      .map((c) => c?.slug)
      .filter((s: any): s is string => !!s);
    const nameList = cats
      .map((c) => (!c?.slug ? c?.name : null))
      .filter((n: any): n is string => !!n);

    if (slugList.length === 0 && nameList.length === 0) return of([]);

    let params = new HttpParams()
      .set('pagination[page]', '1')
      .set('pagination[pageSize]', String(limit))
      .set('pagination[withCount]', 'false')
      .set('sort', 'publishedAt:desc')
      .set('filters[slug][$ne]', article.slug)
      .set('populate', 'image')
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction');

    // OR 0: slug IN [...]
    slugList.forEach((slug, i) => {
      params = params.set(`filters[$or][0][categories][slug][$in][${i}]`, slug);
    });
    // OR 1: name IN [...] (solo per categorie senza slug)
    nameList.forEach((name, i) => {
      params = params.set(`filters[$or][1][categories][name][$in][${i}]`, name);
    });

    return this.getWithCache<StrapiResponse<any>>(this.apiUrl, params).pipe(
      map((res) => {
        const items = (res.data ?? []).map((raw: any) => {
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
        });
        // Dedup in caso di articoli che matchano sia per slug che per name
        return this.uniqueBySlug(items).slice(0, limit);
      }),
      catchError((err) => {
        console.error('Error building related articles:', err);
        return of([]); // fallback silenzioso
      })
    );
  }
}
