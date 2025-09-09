// src/app/services/glossary.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, BehaviorSubject, ReplaySubject, of } from 'rxjs';
import {
  map,
  catchError,
  switchMap,
  distinctUntilChanged,
  debounceTime,
  finalize,
  shareReplay,
  tap,
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

  // Stato interno corrente (solo per ripubblicare sui subject già esposti)
  private _currentTerms: GlossaryTerm[] = [];
  private _totalItems = 0;
  private _currentPage = 1;

  // Output verso i componenti (immutati)
  public termsSubject = new ReplaySubject<{
    terms: GlossaryTerm[];
    total: number;
    currentPage: number;
    resetTerms: boolean;
  }>(1);

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

  // -------- Cache per liste con TTL (params → stream$) --------
  private listCache = new Map<
    string,
    {
      ts: number;
      stream$: Observable<{
        terms: GlossaryTerm[];
        total: number;
        requestedPage: number;
        resetTerms: boolean;
      }>;
    }
  >();
  private listTTLms = 60_000; // 60s (regolabile senza toccare altri file)

  constructor(private http: HttpClient) {
    // carica una volta le categorie
    this.fetchAllCategories().subscribe();

    // stream principale di query → risultati (con cache+coalescing)
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
        switchMap((params) => {
          const key = this.makeKey(params);

          // cache hit (entro TTL) → niente spinner, niente rete
          const hit = this.listCache.get(key);
          const now = Date.now();
          if (hit && now - hit.ts < this.listTTLms) {
            return hit.stream$; // già shareReplay(1)
          }

          // cache miss → preparo richiesta HTTP + spinner
          this.loadingSubject.next(true);

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

          const stream$ = this.http
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
                  resetTerms: true, // server pagination: niente accumulo client
                };
              }),
              catchError((err) => {
                // abort/rapid-nav → non bloccare UX, restituisci stato precedente
                if (
                  err?.name === 'AbortError' ||
                  /aborted/i.test(err?.message ?? '')
                ) {
                  return of({
                    terms: this._currentTerms,
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
              finalize(() => this.loadingSubject.next(false)),
              shareReplay(1) // coalescing richieste identiche
            );

          // memorizza in cache (subito) per deduplicare richieste concorrenti
          this.listCache.set(key, { ts: now, stream$ });
          return stream$;
        })
      )
      .subscribe((data) => {
        // aggiorna lo stato e pubblica
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

  // ===== API per il componente (immutate) =====
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

  // ===== Streams esposti (immutati) =====
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

  // ====== Helpers privati ======
  private sameQuery(a: QueryState, b: QueryState): boolean {
    return (
      a.searchTerm === b.searchTerm &&
      a.selectedCategory === b.selectedCategory &&
      a.page === b.page &&
      a.resetTerms === b.resetTerms
    );
  }

  private makeKey(q: QueryState): string {
    // chiave deterministica per cache pagina/filtri
    return JSON.stringify({
      s: q.searchTerm || '',
      c: q.selectedCategory || '',
      p: q.page,
      ps: this.pageSize,
    });
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
}
