// src/app/services/glossary.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  BehaviorSubject,
  ReplaySubject,
  of,
  from,
  EMPTY,
} from 'rxjs';
import {
  map,
  tap,
  catchError,
  switchMap,
  distinctUntilChanged,
  debounceTime,
  finalize,
  concatMap,
  reduce,
  startWith,
  shareReplay,
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

  // ====== micro-cache GET (params-keyed) ======
  private reqCache = new Map<string, { t: number; obs: Observable<any> }>();
  private readonly REQ_TTL_MS = 30_000;

  // ====== categories cache (mem + localStorage) ======
  private readonly CAT_LS_KEY = 'glossary_categories_v1';
  private readonly CAT_LS_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  private readonly CAT_PAGE_SIZE = 200;

  // Dati della pagina corrente
  public termsSubject = new ReplaySubject<{
    terms: GlossaryTerm[];
    total: number;
    currentPage: number;
    resetTerms: boolean;
  }>(1);

  // Loading pilotato dal servizio
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
    // warm categories (leggero e cache-izzato)
    this.warmCategories().subscribe();

    // stream principale
    this.queryParamsTrigger
      .pipe(
        debounceTime(150), // <- evita spam durante la digitazione
        distinctUntilChanged(
          (a, b) =>
            a.searchTerm === b.searchTerm &&
            a.selectedCategory === b.selectedCategory &&
            a.page === b.page &&
            a.resetTerms === b.resetTerms
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
              params.searchTerm.trim()
            );
          }

          return this.getWithCache<StrapiResponse>(
            this.apiUrl,
            httpParams
          ).pipe(
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
                // abort "legittimi" (HMR/rapid nav)
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

  // ======= CATEGORIES (senza pageSize=10000) =======
  private warmCategories(): Observable<void> {
    // 1) prova localStorage (TTL 24h)
    const lsOk = typeof window !== 'undefined' && !!window.localStorage;
    if (lsOk) {
      try {
        const raw = localStorage.getItem(this.CAT_LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            t: number;
            cats: string[];
          };
          if (
            Array.isArray(parsed.cats) &&
            Date.now() - parsed.t < this.CAT_LS_TTL_MS
          ) {
            this.allUniqueCategoriesSubject.next(
              parsed.cats.slice().sort((a, b) => a.localeCompare(b))
            );
            return of(void 0);
          }
        }
      } catch {}
    }

    // 2) fetch paginato molto leggero: solo fields=category
    const firstParams = new HttpParams()
      .set('fields[0]', 'category')
      .set('sort', 'category:asc')
      .set('pagination[pageSize]', String(this.CAT_PAGE_SIZE))
      .set('pagination[page]', '1')
      .set('pagination[withCount]', 'true');

    return this.getWithCache<StrapiResponse>(this.apiUrl, firstParams).pipe(
      switchMap((first) => {
        const pageCount = first?.meta?.pagination?.pageCount ?? 1;
        const firstCats = this.extractCategories(first);

        if (pageCount <= 1) {
          const cats = Array.from(firstCats).sort((a, b) => a.localeCompare(b));
          this.allUniqueCategoriesSubject.next(cats);
          if (lsOk) {
            try {
              localStorage.setItem(
                this.CAT_LS_KEY,
                JSON.stringify({ t: Date.now(), cats })
              );
            } catch {}
          }
          return of(void 0);
        }

        // pagine successive in SEQUENZA (no burst), fino a max 50 pagine
        const pages = Array.from(
          { length: Math.min(pageCount, 50) - 1 },
          (_, i) => i + 2
        );

        return from(pages).pipe(
          concatMap((p) => {
            const params = new HttpParams()
              .set('fields[0]', 'category')
              .set('sort', 'category:asc')
              .set('pagination[pageSize]', String(this.CAT_PAGE_SIZE))
              .set('pagination[page]', String(p))
              .set('pagination[withCount]', 'false');
            return this.getWithCache<StrapiResponse>(this.apiUrl, params);
          }),
          map((res) => this.extractCategories(res)),
          startWith(firstCats),
          reduce((acc, set) => {
            set.forEach((c) => acc.add(c));
            return acc;
          }, new Set<string>()),
          tap((set) => {
            const cats = Array.from(set).sort((a, b) => a.localeCompare(b));
            this.allUniqueCategoriesSubject.next(cats);
            if (lsOk) {
              try {
                localStorage.setItem(
                  this.CAT_LS_KEY,
                  JSON.stringify({ t: Date.now(), cats })
                );
              } catch {}
            }
          }),
          map(() => void 0),
          catchError((err) => {
            console.error('Error fetching categories (paged):', err);
            // fallback: nessuna categoria
            this.allUniqueCategoriesSubject.next([]);
            return of(void 0);
          })
        );
      }),
      catchError((err) => {
        console.error('Error fetching first categories page:', err);
        this.allUniqueCategoriesSubject.next([]);
        return of(void 0);
      })
    );
  }

  private extractCategories(response: StrapiResponse): Set<string> {
    const out = new Set<string>();
    (response?.data ?? []).forEach((item) => {
      const c = item.attributes?.category ?? item.category;
      if (c) out.add(String(c));
    });
    return out;
  }

  // ===== Streams esposti =====
  getCategories(): Observable<string[]> {
    return this.allUniqueCategoriesSubject.pipe(
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
      )
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

  // ===== util =====
  private getWithCache<T>(url: string, params: HttpParams): Observable<T> {
    const key = `${url}?${params.toString()}`;
    const hit = this.reqCache.get(key);
    const now = Date.now();
    if (hit && now - hit.t < this.REQ_TTL_MS) return hit.obs as Observable<T>;
    const obs = this.http.get<T>(url, { params }).pipe(shareReplay(1));
    this.reqCache.set(key, { t: now, obs });
    return obs;
  }
}
