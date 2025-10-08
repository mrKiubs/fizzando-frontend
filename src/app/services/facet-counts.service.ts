import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { TransferState, makeStateKey } from '@angular/core';
import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { Observable, of, defer, shareReplay } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { CocktailService } from '../services/strapi.service';

export type FacetKind = 'method' | 'glass' | 'category' | 'alcoholic';

@Injectable({ providedIn: 'root' })
export class FacetCountsService {
  private cache = new Map<string, Observable<number>>();
  private readonly ts = inject(TransferState);
  private readonly platformId = inject(PLATFORM_ID);

  constructor(private api: CocktailService) {}

  private key(kind: FacetKind, slug: string) {
    return `${kind}:${slug}`;
  }
  private tsKey(kind: FacetKind, slug: string) {
    // TransferState key deve essere stabile e string-only
    return makeStateKey<number>(`FACET_COUNT__${kind}__${slug}`);
  }

  /** Chiamata reale all’API, 1x (pageSize=1; leggiamo solo total) */
  private ask(kind: FacetKind, slug: string) {
    switch (kind) {
      case 'method':
        return this.api.getCocktails(
          1,
          1,
          '',
          '',
          '',
          false,
          false,
          false,
          false,
          slug,
          ''
        );
      case 'glass':
        return this.api.getCocktails(
          1,
          1,
          '',
          '',
          '',
          false,
          false,
          false,
          false,
          '',
          slug
        );
      case 'category':
        return this.api.getCocktails(
          1,
          1,
          '',
          slug,
          '',
          false,
          false,
          false,
          false,
          '',
          ''
        );
      case 'alcoholic':
        return this.api.getCocktails(
          1,
          1,
          '',
          '',
          slug,
          false,
          false,
          false,
          false,
          '',
          ''
        );
    }
  }

  /** API pubblica: legge prima da TransferState/cache, poi (se serve) fetcha una volta */
  getCount(kind: FacetKind, slug: string): Observable<number> {
    const k = this.key(kind, slug);
    const hit = this.cache.get(k);
    if (hit) return hit;

    const stateKey = this.tsKey(kind, slug);

    // 1) Se siamo in CSR e TransferState ha già il valore → usalo e pulisci
    if (isPlatformBrowser(this.platformId) && this.ts.hasKey(stateKey)) {
      const v = this.ts.get(stateKey, 0);
      this.ts.remove(stateKey); // libera memoria
      const obs = of(v).pipe(shareReplay(1));
      this.cache.set(k, obs);
      return obs;
    }

    // 2) Altrimenti facciamo la richiesta (SSR o CSR), con caching Rx
    const obs = defer(() => this.ask(kind, slug)).pipe(
      map((res: any) => Number(res?.meta?.pagination?.total ?? 0)),
      catchError(() => of(0)),
      map((n) => {
        // In SSR scriviamo nel TransferState (il browser lo leggerà senza rifare la fetch)
        if (isPlatformServer(this.platformId)) {
          this.ts.set(stateKey, n);
        }
        return n;
      }),
      shareReplay(1)
    );

    this.cache.set(k, obs);
    return obs;
  }

  /** (Opzionale) Prefetch batch per liste, utile a ridurre ancora le subscribe nei figli */
  prefetch(kind: FacetKind, slugs: string[]): void {
    for (const s of Array.from(new Set(slugs))) {
      this.getCount(kind, s).subscribe(); // si auto-cacherà e in SSR popolerà il TransferState
    }
  }
}
