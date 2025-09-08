// src/app/services/glossary.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, BehaviorSubject, ReplaySubject, of } from 'rxjs';
import {
  map,
  tap,
  catchError,
  switchMap,
  distinctUntilChanged,
  debounceTime,
  finalize,
} from 'rxjs/operators';
import { env } from '../config/env';

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

type QueryState = {
  searchTerm: string;
  selectedCategory: string;
  page: number;
  resetTerms: boolean;
};

@Injectable({ providedIn: 'root' })
export class GlossaryService {
  private baseUrl = (env.apiUrl || '').replace(/\/$/, '');
  private apiUrl = `${this.baseUrl}/api/glossary-terms`;

  private pageSize = 15;

  private _currentTerms: GlossaryTerm[] = [];
  private _totalItems = 0;
  private _currentPage = 1;

  // Dati della pagina corrente (emette solo quando arrivano davvero)
  public termsSubject = new ReplaySubject<{
    terms: GlossaryTerm[];
    total: number;
    currentPage: number;
    resetTerms: boolean;
  }>(1);

  // Loading pilotato dal servizio (on ogni richiesta, off su finalize)
  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  public totalItemsSubject = new BehaviorSubject<number>(0);
  public currentPageSubject = new BehaviorSubject<number>(1);
  private allUniqueCategoriesSubject = new BehaviorSubject<string[]>([]);

  private queryParamsTrigger = new BehaviorSubject<QueryState>({
    searchTerm: '',
    selectedCategory: '',
    page: 1,
    resetTerms: true,
  });

  constructor(private http: HttpClient) {
    // carica le categorie una volta
    this.fetchAllCategories().subscribe();

    // stream principale
    this.queryParamsTrigger
      .pipe(
        debounceTime(0),
        distinctUntilChanged(
          (a, b) =>
            a.searchTerm === b.searchTerm &&
            a.selectedCategory === b.selectedCategory &&
            a.page === b.page &&
            a.resetTerms === b.resetTerms
        ),
        tap((params) =>
          console.log('SERVICE (1): queryParamsTrigger emitted:', params)
        ),
        tap(() => this.loadingSubject.next(true)),
        switchMap((params) => {
          let httpParams = new HttpParams()
            .set('fields[0]', 'term')
            .set('fields[1]', 'slug')
            .set('fields[2]', 'category')
            .set('fields[3]', 'description')
            .set('pagination[pageSize]', this.pageSize.toString())
            .set('pagination[page]', params.page.toString())
            .set('pagination[withCount]', 'true')
            .set('sort', 'term:asc');

          if (params.selectedCategory) {
            httpParams = httpParams.set(
              'filters[category][$eq]',
              params.selectedCategory
            );
          }
          if (params.searchTerm) {
            httpParams = httpParams.set(
              'filters[term][$containsi]',
              params.searchTerm.toLowerCase()
            );
          }

          return this.http
            .get<StrapiResponse>(this.apiUrl, { params: httpParams })
            .pipe(
              map((response) => {
                const terms: GlossaryTerm[] = (response?.data ?? []).map(
                  (item) => ({
                    id: item.id,
                    term:
                      item.attributes?.term ?? item.term ?? 'No Term Provided',
                    slug: item.attributes?.slug ?? item.slug ?? '',
                    category:
                      item.attributes?.category ??
                      item.category ??
                      'Uncategorized',
                    description:
                      item.attributes?.description ??
                      item.description ??
                      'No description provided.',
                  })
                );
                return {
                  terms,
                  total: response?.meta?.pagination?.total ?? 0,
                  requestedPage: params.page,
                  resetTerms: true, // server pagination: niente accumulo
                };
              }),
              catchError((err) => {
                if (
                  err?.name === 'AbortError' ||
                  /aborted/i.test(err?.message ?? '')
                ) {
                  // abort "legittimi" (HMR/rapid nav) → non inchiodare il loader
                  return of({
                    terms: [],
                    total: this._totalItems,
                    requestedPage: this._currentPage,
                    resetTerms: true,
                  });
                }
                console.error('Error fetching filtered glossary terms:', err);
                return of({
                  terms: [],
                  total: this._totalItems,
                  requestedPage: params.page,
                  resetTerms: true,
                });
              }),
              finalize(() => this.loadingSubject.next(false))
            );
        })
      )
      .subscribe((data) => {
        // prendi la pagina così com'è dal server
        this._currentTerms = data.terms;
        this._totalItems = data.total;
        this._currentPage = data.requestedPage;

        this.termsSubject.next({
          terms: this._currentTerms,
          total: this._totalItems,
          currentPage: this._currentPage,
          resetTerms: true,
        });
        this.totalItemsSubject.next(this._totalItems);
        this.currentPageSubject.next(this._currentPage);
      });
  }

  // ===== API per il componente =====
  initializeGlossary(initialPage = 1): void {
    this.setFilters('', '', Math.max(1, initialPage));
  }

  /** Unico setter "atomico": applica search + category + page in una emissione */
  setFilters(searchTerm: string, selectedCategory: string, page = 1) {
    const next: QueryState = {
      searchTerm: (searchTerm ?? '').trim(),
      selectedCategory: (selectedCategory ?? '').trim(),
      page: Math.max(1, page),
      resetTerms: true,
    };
    const cur = this.queryParamsTrigger.value;
    if (!this.sameQuery(cur, next)) this.queryParamsTrigger.next(next);
  }

  /** Reset pulito (una sola emissione) */
  resetFilters() {
    const next: QueryState = {
      searchTerm: '',
      selectedCategory: '',
      page: 1,
      resetTerms: true,
    };
    const cur = this.queryParamsTrigger.value;
    if (!this.sameQuery(cur, next)) this.queryParamsTrigger.next(next);
  }

  setPage(page: number) {
    const c = this.queryParamsTrigger.value;
    this.setFilters(c.searchTerm, c.selectedCategory, page);
  }

  private sameQuery(a: QueryState, b: QueryState): boolean {
    return (
      a.searchTerm === b.searchTerm &&
      a.selectedCategory === b.selectedCategory &&
      a.page === b.page &&
      a.resetTerms === b.resetTerms
    );
  }

  private fetchAllCategories(): Observable<void> {
    const params = new HttpParams()
      .set('pagination[pageSize]', '180')
      .set('fields[0]', 'category');

    return this.http.get<StrapiResponse>(this.apiUrl, { params }).pipe(
      map((response) => {
        const categories = new Set<string>();
        (response?.data ?? []).forEach((item) => {
          const c = item.attributes?.category ?? item.category;
          if (c) categories.add(c);
        });
        this.allUniqueCategoriesSubject.next(
          Array.from(categories).sort((a, b) => a.localeCompare(b))
        );
      }),
      catchError((err) => {
        console.error('Error fetching all categories for glossary:', err);
        this.allUniqueCategoriesSubject.next([]);
        return of(void 0);
      }),
      map(() => void 0)
    );
  }

  // ===== Streams esposti =====
  getCategories(): Observable<string[]> {
    return this.allUniqueCategoriesSubject.pipe(
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
  }

  getCurrentTerms(): Observable<{
    terms: GlossaryTerm[];
    total: number;
    currentPage: number;
    resetTerms: boolean;
  }> {
    return this.termsSubject.asObservable();
  }

  getTotalItems(): Observable<number> {
    return this.totalItemsSubject.asObservable();
  }
}
