import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { forkJoin, Observable, of, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
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
      .set('sort', 'publishedAt:desc') // <-- come nel tuo file “buono”
      .set('populate', 'image'); // <-- UNA chiave populate per riga

    if (searchTerm) {
      params = params
        .set('filters[$or][0][title][$startsWithi]', searchTerm)
        .set('filters[$or][1][introduction][$containsi]', searchTerm);
    }

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
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
      .append('populate', 'sections')
      .append('populate', 'image')
      .append('populate', 'categories')
      .append('populate', 'related_cocktails.image') // <-- dot-notation che ti funzionava
      // .append('populate', 'related_cocktails.category') // <-- SOLO se il campo SI CHIAMA davvero "category"
      .append('populate', 'related_ingredients.image'); // <-- dot-notation che ti funzionava

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
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
      .append('populate', 'sections')
      .append('populate', 'image')
      .append('populate', 'categories')
      .append('populate', 'related_cocktails.image')
      // .append('populate', 'related_cocktails.category') // vedi nota sopra
      .append('populate', 'related_ingredients.image');

    return this.http
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
      .set('filters[categories][slug][$eq]', slug)
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('sort', 'publishedAt:desc')
      .set('populate', 'image');

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
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
      .set('sort', 'publishedAt:desc') // come nel tuo file “buono”
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('populate', 'image');

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
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
      .set('sort', 'publishedAt:desc')
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('populate', 'image');

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
      map((res) => {
        const list: Article[] = (res.data ?? []).map((raw: any) => {
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
            imageUrl: undefined, // lo settiamo sotto
          };
          if (a.image) {
            this.processSingleImage(a.image);
            a.imageUrl = this.pickCardImageUrl(a.image);
          } else {
            a.imageUrl = '/assets/no-image.png';
          }
          return a;
        });
        return list;
      }),
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
      .set('sort', 'publishedAt:desc')
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('populate', 'image');

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
      map((res) => {
        const list: Article[] = (res.data ?? []).map((raw: any) => {
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
        return list;
      }),
      catchError((err) => {
        console.error('Error loading related articles by ingredient:', err);
        return throwError(() => new Error('Could not load related articles.'));
      })
    );
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
      .append('populate', 'image'); // ci basta l’immagine per la card

    // OR su più categorie
    categorySlugs.forEach((slug, i) => {
      params = params.set(`filters[$or][${i}][categories][slug][$eq]`, slug);
    });

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
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
            imageUrl: this.pickCardImageUrl(raw.image), // se hai l’helper
          };
          if (a.image) this.processSingleImage(a.image);
          return a;
        })
      )
    );
  }

  /** Prende articoli per nome categoria (fallback se il category non ha slug) */
  getArticlesByCategoryName(
    name: string,
    page = 1,
    pageSize = 10
  ): Observable<StrapiResponse<Article>> {
    let params = new HttpParams()
      .set('pagination[page]', page.toString())
      .set('pagination[pageSize]', pageSize.toString())
      .set('filters[categories][name][$eqi]', name) // case-insensitive
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction')
      .set('populate', 'image')
      .set('sort[0]', 'publishedAt:desc');

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
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
      catchError((err) => {
        console.error('Error loading articles by category name:', err);
        return throwError(
          () => new Error('Could not load articles by category name.')
        );
      })
    );
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

  /** Articoli correlati in base alle categorie dell’articolo corrente */
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

    // se non ho né slug né name → niente correlati
    if (withSlug.length === 0 && withName.length === 0) {
      return of([]);
    }

    // per ogni categoria creo una richiesta (per slug o per name)
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
        // unisco tutte le liste
        const merged: Article[] = results.flatMap((r) => r.data ?? []);
        // tolgo l’articolo corrente
        const filtered = merged.filter((a) => a.slug !== article.slug);
        // dedup per slug
        const unique = this.uniqueBySlug(filtered);
        // prendo i primi N
        return unique.slice(0, limit);
      }),
      catchError((err) => {
        console.error('Error building related articles:', err);
        return of([]); // fallback silenzioso
      })
    );
  }
}
