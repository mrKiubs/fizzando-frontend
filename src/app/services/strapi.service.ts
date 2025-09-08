// src/app/services/strapi.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http'; // in cima al file
import { Observable, of, throwError, BehaviorSubject, forkJoin } from 'rxjs';
import { map, catchError, filter, take, tap, switchMap } from 'rxjs/operators';

import { env } from '../config/env';
// --- Interfacce (Necessarie per la tipizzazione dei dati) ---

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
  ingredient_type?: string | null; // ASSICURATI CHE QUESTA LINEA SIA PRESENTE!
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

@Injectable({
  providedIn: 'root',
})
export class CocktailService {
  private apiUrl = env.apiUrl;
  private cocktailsBaseUrl = `${this.apiUrl}/api/cocktails`;
  // private ingredientsBaseUrl = `${this.apiUrl}/api/ingredients`; // Rimosso, non più usato direttamente qui

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
    ingredient_type: 'Unknown Type', // Aggiunto anche qui per coerenza
  };

  private _allCocktailsCache: Cocktail[] | null = null;
  private _allCocktailsLoadingSubject = new BehaviorSubject<boolean>(false);
  private _allCocktailsDataSubject = new BehaviorSubject<Cocktail[] | null>(
    null
  );

  constructor(private http: HttpClient) {}

  private getFullStrapiImageUrl(relativePath: string | null): string | null {
    if (!relativePath) return null;
    return relativePath.startsWith('http')
      ? relativePath
      : this.apiUrl + relativePath;
  }

  private cleanIngredientCTData(rawIngredientData: any): IngredientCT {
    if (!rawIngredientData) {
      return { ...this.UNKNOWN_INGREDIENT_CT, image: null };
    }

    const ingredient = rawIngredientData;

    let ingredientImage: StrapiImage | null = null;
    if (ingredient.image) {
      const rawImage = ingredient.image;

      const formatsWithFullUrls: StrapiImageFormats = {};
      if (rawImage.formats) {
        for (const key in rawImage.formats) {
          if (rawImage.formats.hasOwnProperty(key)) {
            const format = rawImage.formats[key];
            if (format && format.url) {
              formatsWithFullUrls[key as keyof StrapiImageFormats] = {
                ...format,
                url: this.getFullStrapiImageUrl(format.url)!,
              };
            }
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
        createdAt: ingredient.createdAt,
        updatedAt: ingredient.updatedAt,
      } as StrapiImage;
    }

    return {
      id: ingredient.id || this.UNKNOWN_INGREDIENT_CT.id,
      name: ingredient.name || this.UNKNOWN_INGREDIENT_CT.name,
      external_id:
        ingredient.external_id || this.UNKNOWN_INGREDIENT_CT.external_id,
      description_from_cocktaildb: ingredient.description_from_cocktaildb,
      ai_flavor_profile: ingredient.ai_flavor_profile,
      ai_common_uses: ingredient.ai_common_uses,
      ai_substitutes: ingredient.ai_substitutes,
      ai_brief_history: ingredient.ai_brief_history,
      ai_interesting_facts: ingredient.ai_interesting_facts,
      ai_alcohol_content: ingredient.ai_alcohol_content,
      image: ingredientImage,
      createdAt: ingredient.createdAt,
      updatedAt: ingredient.updatedAt,
      publishedAt: ingredient.publishedAt,
      ingredient_type: ingredient.ingredient_type, // <--- ASSICURATI CHE QUESTA LINEA SIA PRESENTE
    };
  }

  private cleanCocktailData(rawCocktailData: any): Cocktail {
    const cocktail = rawCocktailData;

    let cocktailImage: StrapiImage | null = null;
    if (cocktail.image) {
      const rawImage = cocktail.image;

      const formatsWithFullUrls: StrapiImageFormats = {};
      if (rawImage.formats) {
        for (const key in rawImage.formats) {
          if (rawImage.formats.hasOwnProperty(key)) {
            const format = rawImage.formats[key];
            if (format && format.url) {
              formatsWithFullUrls[key as keyof StrapiImageFormats] = {
                ...format,
                url: this.getFullStrapiImageUrl(format.url)!,
              };
            }
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
    if (cocktail.ingredients_list && Array.isArray(cocktail.ingredients_list)) {
      cocktail.ingredients_list.forEach((item: any) => {
        const cleanedIngredient = this.cleanIngredientCTData(item.ingredient);
        cleanedIngredientsList.push({
          id: item.id,
          measure: item.measure || null,
          ingredient: cleanedIngredient,
        });
      });
    }

    return {
      id: cocktail.id,
      external_id: cocktail.external_id,
      name: cocktail.name,
      category: cocktail.category,
      alcoholic: cocktail.alcoholic,
      glass: cocktail.glass,
      instructions: cocktail.instructions,
      ingredients_list: cleanedIngredientsList,
      image: cocktailImage,
      ai_description: cocktail.ai_description,
      likes: cocktail.likes,
      createdAt: cocktail.createdAt,
      updatedAt: cocktail.updatedAt,
      publishedAt: cocktail.publishedAt,
      preparation_type: cocktail.preparation_type,
      ai_alcohol_content: cocktail.ai_alcohol_content,
      ai_presentation: cocktail.ai_presentation,
      ai_pairing: cocktail.ai_pairing,
      ai_origin: cocktail.ai_origin,
      ai_occasion: cocktail.ai_occasion,
      ai_sensory_description: cocktail.ai_sensory_description,
      ai_personality: cocktail.ai_personality,
      ai_variations: cocktail.ai_variations,
      slug: cocktail.slug,
    };
  }

  /**
   * Recupera i cocktail con paginazione e filtri.
   * Include una logica di caching per la lista completa di cocktail (pageSize 1000).
   * @param useCache Se true, cerca di usare la cache per una richiesta di tutti i cocktail.
   * @param forceReload Se true, forza il ricaricamento dei dati, ignorando la cache. Utile per refresh manuali.
   */
  getCocktails(
    page: number = 1,
    pageSize: number = 10,
    searchTerm?: string,
    category?: string,
    alcoholic?: string,
    useCache: boolean = false, // True solo per richieste all'intera lista (pageSize 1000)
    forceReload: boolean = false // Nuovo parametro per forzare il ricaricamento
  ): Observable<StrapiResponse<Cocktail>> {
    const isAllCocktailsRequest =
      pageSize === 1000 && !searchTerm && !category && !alcoholic;

    if (isAllCocktailsRequest && !forceReload) {
      if (this._allCocktailsCache) {
        console.log('Serving all cocktails from _allCocktailsCache.');
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

      if (this._allCocktailsLoadingSubject.getValue()) {
        console.log(
          'All cocktails request already in progress, waiting for data via _allCocktailsDataSubject.'
        );
        return this._allCocktailsDataSubject.pipe(
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
      .set('populate[image]', 'true') // Popola l'immagine principale del cocktail
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
      ) // AGGIUNTO
      .set(
        'populate[ingredients_list][populate][ingredient][populate][image]',
        'true'
      ); // Popola l'immagine dell'ingrediente nidificato

    if (searchTerm) {
      params = params.set('filters[name][$startsWithi]', searchTerm);
    }
    if (category) {
      params = params.set('filters[category][$eq]', category);
    }
    if (alcoholic) {
      params = params.set('filters[alcoholic][$eq]', alcoholic);
    }

    if (isAllCocktailsRequest && !this._allCocktailsLoadingSubject.getValue()) {
      this._allCocktailsLoadingSubject.next(true);
    }

    return this.http
      .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params })
      .pipe(
        map((response) => {
          response.data = response.data.map((item) =>
            this.cleanCocktailData(item)
          );
          if (isAllCocktailsRequest) {
            this._allCocktailsCache = response.data.sort((a, b) =>
              a.name.localeCompare(b.name)
            );
            this._allCocktailsDataSubject.next(this._allCocktailsCache);
            this._allCocktailsLoadingSubject.next(false);
          }
          return response as StrapiResponse<Cocktail>;
        }),
        catchError((err) => {
          console.error('Error loading cocktails:', err);
          if (isAllCocktailsRequest) {
            this._allCocktailsLoadingSubject.next(false);
            this._allCocktailsDataSubject.error(err);
          }
          return throwError(() => new Error('Could not load cocktails.'));
        })
      );
  }

  /**
   * Recupera un singolo cocktail tramite il suo slug.
   * Controlla prima la cache globale `_allCocktailsCache`.
   */
  getCocktailBySlug(slug: string): Observable<Cocktail | null> {
    // 1. Controlla la cache globale _allCocktailsCache
    if (this._allCocktailsCache) {
      const cachedCocktail = this._allCocktailsCache.find(
        (c) => c.slug === slug
      );
      if (cachedCocktail) {
        console.log(
          `Cocktail with slug '${slug}' found in _allCocktailsCache.`
        );
        if (
          cachedCocktail.ingredients_list &&
          cachedCocktail.ingredients_list.length > 0
        ) {
          console.log(
            `  Cached Cocktail Ingredient Type (from cache): ${cachedCocktail.ingredients_list[0].ingredient.ingredient_type}`
          );
        }
        return of(cachedCocktail);
      }
    }

    // 2. Se la richiesta per tutti i cocktail è in corso, attendi che finisca
    if (this._allCocktailsLoadingSubject.getValue()) {
      console.log(
        `_allCocktailsCache is loading, waiting for cocktail with slug '${slug}'.`
      );
      return this._allCocktailsDataSubject.pipe(
        filter((data) => data !== null),
        map((data) => {
          const found = data!.find((c) => c.slug === slug);
          if (found) {
            console.log(
              `Cocktail with slug '${slug}' found after _allCocktailsCache loaded.`
            );
            if (found.ingredients_list && found.ingredients_list.length > 0) {
              console.log(
                `  Found Cocktail Ingredient Type (after cache load): ${found.ingredients_list[0].ingredient.ingredient_type}`
              );
            }
          } else {
            console.warn(
              `Cocktail with slug '${slug}' not found in _allCocktailsCache after load.`
            );
          }
          return found || null;
        })
      );
    }

    // 3. Se non è in cache e non è in caricamento, fai una chiamata API specifica
    console.log(
      `Cocktail with slug '${slug}' not in cache, fetching from API.`
    );
    let params = new HttpParams()
      .set('filters[slug][$eq]', slug)
      .set('populate[image]', 'true')
      .set('populate[category]', 'true') // Aggiunto per coerenza
      .set('populate[glass]', 'true') // Aggiunto per coerenza
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
      ) // AGGIUNTO
      .set(
        'populate[ingredients_list][populate][ingredient][populate][image]',
        'true'
      ); // Popola l'immagine dell'ingrediente nidificato

    return this.http
      .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params })
      .pipe(
        map((response) => {
          if (response.data && response.data.length > 0) {
            const fetchedCocktail = this.cleanCocktailData(response.data[0]);
            if (
              fetchedCocktail.ingredients_list &&
              fetchedCocktail.ingredients_list.length > 0
            ) {
              console.log(
                `  Fetched Cocktail Ingredient Type (from API): ${fetchedCocktail.ingredients_list[0].ingredient.ingredient_type}`
              );
            }
            return fetchedCocktail;
          }
          return null;
        }),
        catchError((err) => {
          console.error('Error loading cocktail by slug from API:', err);
          return throwError(
            () => new Error('Could not load cocktail by slug from API.')
          );
        })
      );
  }

  /**
   * Simula l'azione di "mi piace" su un cocktail (nota: la logica attuale usa un valore casuale).
   */
  likeCocktail(cocktailId: number): Observable<any> {
    const url = `${this.cocktailsBaseUrl}/${cocktailId}`;
    return this.http
      .put(url, { data: { likes: (Math.random() * 1000).toFixed(0) } })
      .pipe(
        tap(() =>
          console.log(
            `Simulazione: Mi piace aggiunto al cocktail ${cocktailId}`
          )
        ),
        catchError((err) => {
          console.error('Error liking cocktail:', err);
          return throwError(() => new Error('Could not like cocktail.'));
        })
      );
  }

  /**
   * Cerca cocktail per nome (ricerca "starts with" case-insensitive).
   */
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
      ) // AGGIUNTO
      .set(
        'populate[ingredients_list][populate][ingredient][populate][image]',
        'true'
      ); // Popola l'immagine dell'ingrediente nidificato

    return this.http
      .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params })
      .pipe(
        map((response) => {
          return response.data.map((item) => this.cleanCocktailData(item));
        }),
        catchError((err) => {
          console.error('Error searching cocktails by name:', err);
          return throwError(() => new Error('Could not search cocktails.'));
        })
      );
  }

  /**
   * Recupera cocktail correlati a un ingrediente specifico tramite il suo ID esterno.
   */
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
      ) // AGGIUNTO
      .set(
        'populate[ingredients_list][populate][ingredient][populate][image]',
        'true'
      ); // Popola l'immagine dell'ingrediente nidificato

    return this.http
      .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params })
      .pipe(
        map((response) => {
          return response.data.map((item) => this.cleanCocktailData(item));
        }),
        catchError((err) => {
          console.error('Error getting related cocktails:', err);
          return throwError(
            () => new Error('Could not get related cocktails.')
          );
        })
      );
  }

  // Rimosso getIngredientByExternalId da qui, appartiene a IngredientService

  /**
   * Recupera cocktail in base a un array di ID esterni di ingredienti.
   * Permette di specificare se la corrispondenza deve essere esatta.
   */
  getCocktailsByIngredientIds(
    ingredientExternalIds: string[],
    exactMatch: boolean = false
  ): Observable<CocktailWithLayoutAndMatch[]> {
    if (!ingredientExternalIds || ingredientExternalIds.length === 0) {
      return of([]);
    }

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
      ) // AGGIUNTO
      .set(
        'populate[ingredients_list][populate][ingredient][populate][image]',
        'true'
      ) // Popola l'immagine dell'ingrediente nidificato
      .set('pagination[pageSize]', '1000');

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
        map((response) => {
          const allMatchingCocktails = response.data.map((item) =>
            this.cleanCocktailData(item)
          );
          return allMatchingCocktails.map((cocktail) => {
            const cocktailIngredientExternalIds = new Set(
              cocktail.ingredients_list.map(
                (item) => item.ingredient.external_id
              )
            );
            let matchedCount = 0;
            ingredientExternalIds.forEach((selectedId) => {
              if (cocktailIngredientExternalIds.has(selectedId)) {
                matchedCount++;
              }
            });
            return {
              ...cocktail,
              matchedIngredientCount: matchedCount,
            } as CocktailWithLayoutAndMatch;
          });
        }),
        catchError((err) => {
          console.error('Error getting cocktails by ingredient IDs:', err);
          return throwError(
            () => new Error('Could not get cocktails by ingredients.')
          );
        })
      );
  }

  /**
   * Recupera cocktail simili basandosi su un cocktail corrente.
   * Ottimizzato: NIENTE fetch da 1000. Al massimo 2–3 chiamate leggere:
   *  - per ingrediente primario/secondario (in parallelo)
   *  - fallback per category/alcoholic/glass (solo se servono)
   * Mantiene tutte le immagini (cocktail + ingredienti) come prima.
   */
  getSimilarCocktails(currentCocktail: Cocktail): Observable<Cocktail[]> {
    if (!currentCocktail?.ingredients_list?.length) {
      console.warn(
        'Cannot find similar cocktails: current cocktail or its ingredients are missing.'
      );
      return of([]);
    }

    const primaryIngredientId =
      currentCocktail.ingredients_list[0]?.ingredient?.external_id || null;
    const secondaryIngredientId =
      currentCocktail.ingredients_list[1]?.ingredient?.external_id || null;

    // Costruisce i params base SLIM ma con tutte le immagini necessarie
    const buildBaseParams = (pageSize: number = 48): HttpParams => {
      let p = new HttpParams()
        .set('pagination[page]', '1')
        .set('pagination[pageSize]', String(pageSize))
        // escludi il cocktail corrente
        .set('filters[id][$ne]', String(currentCocktail.id))
        // immagini del cocktail
        .set('populate[image]', 'true')
        // campi minimi + immagini ingredienti (serve nelle card)
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

      // opzionale (aiuta a snellire un filo i payload)
      p = p
        .set('fields[0]', 'name')
        .set('fields[1]', 'slug')
        .set('fields[2]', 'external_id')
        .set('fields[3]', 'category')
        .set('fields[4]', 'alcoholic')
        .set('fields[5]', 'glass');

      return p;
    };

    const fetchByIngredient = (
      extId: string,
      pageSize = 48
    ): Observable<Cocktail[]> => {
      const params = buildBaseParams(pageSize).set(
        'filters[ingredients_list][ingredient][external_id][$eq]',
        extId
      );

      return this.http
        .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params })
        .pipe(
          map((resp) => (resp.data || []).map((d) => this.cleanCocktailData(d)))
        );
    };

    const fetchByMetaFallback = (pageSize = 48): Observable<Cocktail[]> => {
      let p = buildBaseParams(pageSize);
      let orIndex = 0;

      if (currentCocktail.category) {
        p = p.set(
          `filters[$or][${orIndex++}][category][$eq]`,
          currentCocktail.category
        );
      }
      if (currentCocktail.alcoholic) {
        p = p.set(
          `filters[$or][${orIndex++}][alcoholic][$eq]`,
          currentCocktail.alcoholic
        );
      }
      if (currentCocktail.glass) {
        p = p.set(
          `filters[$or][${orIndex++}][glass][$eq]`,
          currentCocktail.glass
        );
      }

      if (orIndex === 0) return of<Cocktail[]>([]);
      return this.http
        .get<StrapiResponse<any>>(this.cocktailsBaseUrl, { params: p })
        .pipe(
          map((resp) => (resp.data || []).map((d) => this.cleanCocktailData(d)))
        );
    };

    // dedup per id
    const dedupe = (list: Cocktail[]): Cocktail[] => {
      const seen = new Set<number>();
      const out: Cocktail[] = [];
      for (const c of list) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          out.push(c);
        }
      }
      return out;
    };

    // Fisher–Yates
    const shuffle = <T>(arr: T[]): T[] => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    // 1) Ingredienti (1 o 2 query in parallelo)
    const queries: Observable<Cocktail[]>[] = [];
    if (primaryIngredientId)
      queries.push(fetchByIngredient(primaryIngredientId, 48));
    if (
      secondaryIngredientId &&
      secondaryIngredientId !== primaryIngredientId
    ) {
      queries.push(fetchByIngredient(secondaryIngredientId, 48));
    }
    const ingredientsPhase$ = queries.length
      ? forkJoin(queries).pipe(map((arr) => dedupe(arr.flat())))
      : of<Cocktail[]>([]);

    // 2) Se servono altri risultati, fallback su category/alcoholic/glass
    return ingredientsPhase$.pipe(
      switchMap((firstBatch) => {
        if (firstBatch.length >= 16) {
          return of(shuffle(firstBatch).slice(0, 16));
        }
        return fetchByMetaFallback(48).pipe(
          map((fallback) => {
            const merged = dedupe(firstBatch.concat(fallback));
            return shuffle(merged).slice(0, 16);
          })
        );
      }),
      catchError(() =>
        throwError(() => new Error('Could not load similar cocktails.'))
      )
    );
  }
}
