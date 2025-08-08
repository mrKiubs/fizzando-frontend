// src/app/services/glossary.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, BehaviorSubject, combineLatest, of } from 'rxjs';
import {
  map,
  tap,
  catchError,
  switchMap,
  debounceTime,
  distinctUntilChanged,
  filter,
} from 'rxjs/operators';

export interface GlossaryTerm {
  id: number;
  term: string;
  slug: string;
  category: string;
  description: string;
}

interface StrapiResponse {
  data: any[];
  meta: {
    pagination: {
      total: number;
      page: number;
      pageSize: number;
      pageCount: number;
    };
  };
}

@Injectable({
  providedIn: 'root',
})
export class GlossaryService {
  private apiUrl = 'http://192.168.1.241:1337/api/glossary-terms';

  private pageSize = 10;

  // Stato interno del servizio per i termini e il totale
  private _currentTerms: GlossaryTerm[] = [];
  private _totalItems: number = 0;
  private _currentPage: number = 1;

  // Subject per emettere lo stato aggiornato ai componenti
  // --- CORREZIONE: Tipizzazione di termsSubject per emettere l'OGGETTO COMPLETO
  public termsSubject = new BehaviorSubject<{
    terms: GlossaryTerm[];
    total: number;
    currentPage: number;
    resetTerms: boolean;
  }>({ terms: [], total: 0, currentPage: 1, resetTerms: true });
  // --- FINE CORREZIONE

  public totalItemsSubject = new BehaviorSubject<number>(0);
  public currentPageSubject = new BehaviorSubject<number>(1);

  private allUniqueCategoriesSubject = new BehaviorSubject<string[]>([]);

  // Subject che triggera nuove query quando i filtri o la pagina cambiano
  private queryParamsTrigger = new BehaviorSubject<{
    searchTerm: string;
    selectedCategory: string;
    page: number;
    resetTerms: boolean; // Nuovo flag per indicare se resettare l'array dei termini
  }>({ searchTerm: '', selectedCategory: '', page: 1, resetTerms: true });

  constructor(private http: HttpClient) {
    // Carica tutte le categorie all'avvio del servizio
    this.fetchAllCategories().subscribe();

    // Ascolta i cambiamenti nei queryParamsTrigger e esegui la richiesta API
    this.queryParamsTrigger
      .pipe(
        // Rimuoviamo o commentiamo distinctUntilChanged TEMPORANEAMENTE per il debug,
        // ma è importante notare che la correzione del setSelectedCategory lo renderà utile.
        // distinctUntilChanged( (prev, curr) => JSON.stringify(prev) === JSON.stringify(curr) ),
        tap((params) =>
          console.log('SERVICE (1): queryParamsTrigger emitted:', params)
        ), // DEBUG LOG 1
        switchMap((params) => {
          let httpParams = new HttpParams()
            .set('populate', '*')
            .set('pagination[pageSize]', this.pageSize.toString())
            .set('pagination[page]', params.page.toString())
            .set('pagination[withCount]', 'true');

          if (params.selectedCategory && params.selectedCategory !== '') {
            httpParams = httpParams.set(
              'filters[category][$eq]',
              params.selectedCategory
            );
          }

          if (params.searchTerm) {
            const lowerSearchTerm = params.searchTerm.toLowerCase();
            httpParams = httpParams.set(
              'filters[term][$containsi]',
              lowerSearchTerm
            );
          }

          console.log(
            'SERVICE (2): Making API call with params:',
            httpParams.toString()
          ); // DEBUG LOG 2

          return this.http
            .get<StrapiResponse>(this.apiUrl, { params: httpParams })
            .pipe(
              map((response) => {
                if (!response || !Array.isArray(response.data)) {
                  console.warn(
                    'Strapi response.data is not an array or is missing.'
                  );
                  return {
                    terms: [],
                    total: 0,
                    requestedPage: params.page,
                    resetTerms: params.resetTerms,
                  };
                }

                const terms = response.data
                  .filter((item) => item)
                  .map((item) => ({
                    id: item.id,
                    term:
                      item.attributes?.term || item.term || 'No Term Provided',
                    slug: item.attributes?.slug || item.slug || '',
                    category:
                      item.attributes?.category ||
                      item.category ||
                      'Uncategorized',
                    description:
                      item.attributes?.description ||
                      item.description ||
                      'No description provided.',
                  }));

                terms.sort((a, b) => a.term.localeCompare(b.term));

                return {
                  terms: terms,
                  total: response.meta?.pagination?.total || 0,
                  requestedPage: params.page,
                  resetTerms: params.resetTerms, // Passa il flag resetTerms
                };
              }),
              catchError((error) => {
                console.error('Error fetching filtered glossary terms:', error);
                return of({
                  terms: [],
                  total: 0,
                  requestedPage: params.page,
                  resetTerms: params.resetTerms,
                });
              })
            );
        })
      )
      .subscribe((data) => {
        // DEBUG LOGS START
        console.log(
          'SERVICE (3): API response received. data.resetTerms:',
          data.resetTerms,
          'New terms count:',
          data.terms.length
        );
        console.log(
          'SERVICE (4): Current _currentTerms before update (count):',
          this._currentTerms.length
        );
        // DEBUG LOGS END

        // Aggiorna lo stato interno del servizio e emetti i nuovi valori
        if (data.resetTerms) {
          this._currentTerms = data.terms;
        } else {
          this._currentTerms = [...this._currentTerms, ...data.terms];
        }
        this._totalItems = data.total;
        this._currentPage = data.requestedPage;

        // DEBUG LOGS START
        console.log(
          'SERVICE (5): _currentTerms after update (count):',
          this._currentTerms.length
        );
        // DEBUG LOGS END

        // --- CORREZIONE: Emetti l'oggetto completo anche qui
        this.termsSubject.next({
          terms: this._currentTerms,
          total: this._totalItems,
          currentPage: this._currentPage,
          resetTerms: data.resetTerms,
        });
        // --- FINE CORREZIONE

        this.totalItemsSubject.next(this._totalItems);
        this.currentPageSubject.next(this._currentPage);
      });
  }

  // NUOVO METODO:
  initializeGlossary(): void {
    console.log(
      'SERVICE (X): initializeGlossary called, triggering initial query.'
    );
    this.queryParamsTrigger.next({
      searchTerm: '',
      selectedCategory: '',
      page: 1,
      resetTerms: true,
    });
  }

  // --- Metodi per aggiornare i filtri ---
  setSearchTerm(term: string) {
    const currentParams = this.queryParamsTrigger.value;
    console.log('SERVICE (6): setSearchTerm called with:', term); // DEBUG LOG 6
    this.queryParamsTrigger.next({
      searchTerm: term,
      selectedCategory: currentParams.selectedCategory,
      page: 1, // Reset pagina alla ricerca
      resetTerms: true, // Reset dell'array dei termini
    });
  }

  setSelectedCategory(category: string) {
    const currentParams = this.queryParamsTrigger.value;
    console.log('SERVICE (7): setSelectedCategory called with:', category); // DEBUG LOG 7
    this.queryParamsTrigger.next({
      searchTerm: currentParams.searchTerm,
      selectedCategory: category, // <--- CORREZIONE: ORA USA IL PARAMETRO 'category'
      page: 1, // Reset pagina alla selezione categoria
      resetTerms: true, // Reset dell'array dei termini
    });
  }

  loadMore() {
    console.log('SERVICE (8): loadMore called.'); // DEBUG LOG 8
    const currentParams = this.queryParamsTrigger.value;
    // Solo se ci sono ancora elementi da caricare
    if (this._currentTerms.length < this._totalItems) {
      this.queryParamsTrigger.next({
        searchTerm: currentParams.searchTerm,
        selectedCategory: currentParams.selectedCategory,
        page: currentParams.page + 1, // Incrementa la pagina
        resetTerms: false, // Non resettare l'array, aggiungi
      });
    } else {
      console.log('SERVICE (9): No more items to load.'); // DEBUG LOG 9
    }
  }
  // --- Fine metodi per aggiornare i filtri ---

  private fetchAllCategories(): Observable<void> {
    const MAX_TERMS_FOR_CATEGORIES = 10000;
    const params = new HttpParams()
      .set('pagination[pageSize]', MAX_TERMS_FOR_CATEGORIES.toString())
      .set('fields[0]', 'category');

    return this.http.get<StrapiResponse>(this.apiUrl, { params }).pipe(
      map((response) => {
        console.log('Strapi raw response data:', response.data);
        const categories = new Set<string>();
        if (response && Array.isArray(response.data)) {
          response.data.forEach((item) => {
            const categoryName = item.attributes?.category || item.category;
            if (categoryName) {
              categories.add(categoryName);
            }
          });
        }
        const sortedCategories = Array.from(categories).sort((a, b) =>
          a.localeCompare(b)
        );
        this.allUniqueCategoriesSubject.next(sortedCategories);
      }),
      catchError((error) => {
        console.error('Error fetching all categories for glossary:', error);
        this.allUniqueCategoriesSubject.next([]);
        return of(null);
      }),
      map(() => {})
    );
  }

  getCategories(): Observable<string[]> {
    return this.allUniqueCategoriesSubject.pipe(
      distinctUntilChanged(
        (prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)
      ),
      map((categories) => {
        return ['', ...categories]; // Aggiunge l'opzione "All Categories"
      })
    );
  }

  // --- CORREZIONE: Aggiorna il tipo di ritorno di getCurrentTerms
  getCurrentTerms(): Observable<{
    terms: GlossaryTerm[];
    total: number;
    currentPage: number;
    resetTerms: boolean;
  }> {
    return this.termsSubject.asObservable();
  }
  // --- FINE CORREZIONE

  getTotalItems(): Observable<number> {
    return this.totalItemsSubject.asObservable();
  }
}
