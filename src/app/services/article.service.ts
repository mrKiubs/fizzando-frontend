import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { env } from '../config/env'; // Importa env

// Le tue interfacce esistenti
export interface Article {
  id: number;
  documentId?: string; // Reso opzionale se non sempre presente
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
  content?: string; // Aggiunto content per la ricerca se non è solo in sections
  // NUOVE PROPRIETÀ AGGIUNTE PER LA DASHBOARD E LA COERENZA
  summary?: string; // Aggiunto per la mappatura dell'introduzione come summary
  imageUrl?: string; // Aggiunto per l'URL dell'immagine processato
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

// Interfacce per la risposta di Strapi (se non le hai già definite altrove)
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
export class ArticleService {
  private strapiBaseUrl = env.apiUrl; // CORREZIONE: Usa env.apiUrl
  private apiUrl = `${this.strapiBaseUrl}/api/articles`;

  constructor(private http: HttpClient) {}

  private getAbsoluteImageUrl(imageUrl: string | undefined): string {
    if (!imageUrl) return '/assets/no-image.png';
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return imageUrl;
    }
    return `${this.strapiBaseUrl}${
      imageUrl.startsWith('/') ? imageUrl : '/' + imageUrl
    }`;
  }

  private processSingleImage(image: Image): void {
    if (image.url) image.url = this.getAbsoluteImageUrl(image.url);
    if (image.formats) {
      for (const key in image.formats) {
        const format = (image.formats as any)[key];
        if (format && format.url) {
          format.url = this.getAbsoluteImageUrl(format.url);
        }
      }
    }
  }

  // Questo metodo è utile per processare le immagini di un articolo completo
  private processArticleImages(article: Article): Article {
    if (article.image) this.processSingleImage(article.image);

    // Assicurati che related_cocktails e related_ingredients siano array prima di fare forEach
    article.related_cocktails?.forEach((cocktail: any) => {
      if (cocktail.image) this.processSingleImage(cocktail.image);
    });

    article.related_ingredients?.forEach((ingredient: any) => {
      if (ingredient.image) this.processSingleImage(ingredient.image);
    });

    article.sections?.forEach((section: Section) => {
      if (section.image) this.processSingleImage(section.image);
    });

    return article;
  }

  /**
   * Recupera gli articoli con paginazione e un termine di ricerca.
   * Cerca per titolo e introduzione/contenuto.
   * @param page Numero della pagina.
   * @param pageSize Dimensione della pagina.
   * @param searchTerm Termine di ricerca opzionale.
   */
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
      .set('populate', 'image');

    if (searchTerm) {
      params = params
        .set('filters[$or][0][title][$startsWithi]', searchTerm)
        .set('filters[$or][1][introduction][$containsi]', searchTerm);
    }

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
      map((response) => {
        // Mappa i dati raw di Strapi nell'interfaccia Article (Struttura Flat)
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
            // Non mappiamo summary e imageUrl qui, perché non sono presenti in tutte le chiamate
            // e sono specifici per getLatestArticles o per il frontend.
          };
          if (article.image) {
            this.processSingleImage(article.image);
          }
          return article;
        });
        return { data: mappedData, meta: response.meta };
      }),
      catchError((err) => {
        console.error('Error loading articles:', err);
        return throwError(() => new Error('Could not load articles.'));
      })
    );
  }

  /**
   * Recupera un singolo articolo tramite il suo slug.
   * Restituisce null se l'articolo non viene trovato.
   */
  getArticleBySlug(slug: string): Observable<Article | null> {
    let params = new HttpParams();
    params = params.set('filters[slug][$eq]', slug);
    params = params.append('populate', 'sections');
    params = params.append('populate', 'image');
    params = params.append('populate', 'categories');
    params = params.append('populate', 'related_cocktails.image'); // Popola anche l'immagine per i correlati
    params = params.append('populate', 'related_ingredients.image'); // Popola anche l'immagine per i correlati

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
      map((response) => {
        if (response.data && response.data.length > 0) {
          // Accesso diretto a data[0]
          const rawArticle = response.data[0];
          const article: Article = {
            // Mappatura flat
            id: rawArticle.id,
            title: rawArticle.title,
            slug: rawArticle.slug,
            introduction: rawArticle.introduction,
            conclusion: rawArticle.conclusion,
            createdAt: rawArticle.createdAt,
            updatedAt: rawArticle.updatedAt,
            publishedAt: rawArticle.publishedAt,
            generated_at: rawArticle.generated_at,
            article_status: rawArticle.article_status,
            sections: rawArticle.sections || [],
            image: rawArticle.image,
            related_cocktails: rawArticle.related_cocktails || [],
            related_ingredients: rawArticle.related_ingredients || [],
            categories: rawArticle.categories || [],
            content: rawArticle.content,
          };
          return this.processArticleImages(article);
        }
        return null; // Articolo non trovato
      }),
      catchError((err) => {
        console.error('Error getting article by slug:', err);
        return throwError(() => new Error('Could not get article by slug.'));
      })
    );
  }

  /**
   * Recupera un singolo articolo tramite il suo ID.
   * Restituisce null se l'articolo non viene trovato.
   */
  getArticleById(id: number): Observable<Article | null> {
    let params = new HttpParams();
    params = params.append('populate', 'sections');
    params = params.append('populate', 'image');
    params = params.append('populate', 'categories');
    params = params.append('populate', 'related_cocktails.image');
    params = params.append('populate', 'related_ingredients.image');

    return this.http
      .get<StrapiSingleResponse<any>>(`${this.apiUrl}/${id}`, { params })
      .pipe(
        map((response) => {
          if (response.data) {
            // Accesso diretto a data
            const rawArticle = response.data;
            const article: Article = {
              // Mappatura flat
              id: rawArticle.id,
              title: rawArticle.title,
              slug: rawArticle.slug,
              introduction: rawArticle.introduction,
              conclusion: rawArticle.conclusion,
              createdAt: rawArticle.createdAt,
              updatedAt: rawArticle.updatedAt,
              publishedAt: rawArticle.publishedAt,
              generated_at: rawArticle.generated_at,
              article_status: rawArticle.article_status,
              sections: rawArticle.sections || [],
              image: rawArticle.image,
              related_cocktails: rawArticle.related_cocktails || [],
              related_ingredients: rawArticle.related_ingredients || [],
              categories: rawArticle.categories || [],
              content: rawArticle.content,
            };
            return this.processArticleImages(article);
          }
          return null; // Articolo non trovato
        }),
        catchError((err) => {
          console.error('Error getting article by ID:', err);
          return throwError(() => new Error('Could not get article by ID.'));
        })
      );
  }

  /**
   * Recupera articoli filtrati per slug di categoria.
   */
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
      .set('populate', 'image');

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
      map((response) => {
        const mappedData: Article[] = response.data.map((item: any) => {
          const article: Article = {
            // Mappatura flat
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
          if (article.image) {
            this.processSingleImage(article.image);
          }
          return article;
        });
        return { data: mappedData, meta: response.meta };
      }),
      catchError((err) => {
        console.error('Error loading articles by category:', err);
        return throwError(
          () => new Error('Could not load articles by category.')
        );
      })
    );
  }

  /**
   * Recupera gli ultimi N articoli.
   * @param count Il numero di articoli più recenti da recuperare.
   * @returns Un Observable di una lista di oggetti Article.
   */
  getLatestArticles(count: number): Observable<Article[]> {
    let params = new HttpParams()
      .set('pagination[limit]', count.toString())
      .set('sort', 'publishedAt:desc') // Ordina per data di pubblicazione decrescente
      .set('fields[0]', 'title')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'introduction') // Usiamo introduction come summary per la card
      .set('populate', 'image'); // Popola l'immagine per la card

    return this.http.get<StrapiResponse<any>>(this.apiUrl, { params }).pipe(
      map((response) => {
        return response.data.map((item: any) => {
          const article: Article = {
            id: item.id,
            title: item.title,
            slug: item.slug,
            introduction: item.introduction, // Manteniamo introduction
            conclusion: item.conclusion, // Manteniamo conclusion
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
            summary: item.introduction, // Mappa introduction a summary
            imageUrl: item.image
              ? this.getAbsoluteImageUrl(item.image.url)
              : 'assets/no-image.png', // Prendi l'URL dell'immagine
          };
          return article;
        });
      }),
      catchError((err) => {
        console.error('Error loading latest articles:', err);
        return throwError(() => new Error('Could not load latest articles.'));
      })
    );
  }
}
