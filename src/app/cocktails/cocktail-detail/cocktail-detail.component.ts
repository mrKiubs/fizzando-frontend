// src/app/cocktails/cocktail-detail/cocktail-detail.component.ts
import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewInit,
  Renderer2,
  Inject,
  NgZone,
  PLATFORM_ID,
  HostListener,
  inject,
  TransferState,
  makeStateKey,
} from '@angular/core';
import { catchError, map, take } from 'rxjs/operators';
import {
  CommonModule,
  DOCUMENT,
  NgOptimizedImage,
  isPlatformBrowser,
  Location,
} from '@angular/common';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom, forkJoin, Observable, of, Subscription } from 'rxjs';
import { Title, Meta } from '@angular/platform-browser';

import {
  CocktailService,
  Cocktail,
  CocktailWithLayoutAndMatch,
} from '../../services/strapi.service';
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';
import { ArticleService, Article } from '../../services/article.service';
import { ArticleCardComponent } from '../../articles/article-card/article-card.component';
import { CocktailCardComponent } from '../../cocktails/cocktail-card/cocktail-card.component';
import { env } from '../../config/env';
import { SentenceBreaksDirective } from '../../assets/pipes/sentence-breaks.pipe';

type Highlightable = CocktailWithLayoutAndMatch & {
  primaryHighlight?: { text: string };
  headingContext?: string | null;
};
const RELATED_TS_KEY = (slug: string) =>
  makeStateKey<Highlightable[]>(`rel:${slug}`);

interface AdSlot {
  isAd: true;
  id: string;
  kind: 'square' | 'banner';
}

@Component({
  selector: 'app-cocktail-detail',
  standalone: true,
  // NOTA: niente OnPush qui, per stabilità
  imports: [
    CommonModule,
    MatIconModule,
    RouterLink,
    DevAdsComponent,
    ArticleCardComponent,
    CocktailCardComponent,
    NgOptimizedImage,
    SentenceBreaksDirective,
  ],
  templateUrl: './cocktail-detail.component.html',
  styleUrls: ['./cocktail-detail.component.scss'],
})
export class CocktailDetailComponent
  implements OnInit, OnDestroy, AfterViewInit
{
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly ngZone = inject(NgZone);
  private readonly ts = inject(TransferState);

  @ViewChild('relatedSentinel') relatedSentinel!: ElementRef;
  private relatedLoaded = false;
  private io?: IntersectionObserver;
  private relatedFallbackTimer?: any;

  cocktail: Cocktail | undefined;
  loading = true;
  error: string | null = null;

  allCocktails: Cocktail[] = [];
  currentCocktailIndex = -1;

  heroSrc = '';
  heroSrcset = '';
  indexReady = false;
  previousCocktail: {
    externalId: string;
    name: string;
    imageUrl: string;
    slug: string;
  } | null = null;
  nextCocktail: {
    externalId: string;
    name: string;
    imageUrl: string;
    slug: string;
  } | null = null;

  similarCocktails: Highlightable[] = [];
  relatedWithAds: Array<Highlightable | AdSlot> = [];
  relatedArticles: Article[] = [];

  private readonly AD_EVERY = 6;
  isMobile = false;
  contentReady = false;

  private siteBaseUrl = '';
  private cocktailSchemaScript: HTMLScriptElement | undefined;

  private supportsWebp = false;

  @ViewChild('affiliateCardList') affiliateCardList!: ElementRef;
  private wheelListenerCleanup?: () => void;

  private routeSubscription?: Subscription;
  private similarCocktailsSubscription?: Subscription;
  private cocktailDetailSubscription?: Subscription;
  private adjacentSub?: Subscription;

  private _bo = inject(BreakpointObserver);
  isHandset = toSignal(
    this._bo.observe([Breakpoints.Handset]).pipe(map((r) => r.matches)),
    { initialValue: false }
  );

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cocktailService: CocktailService,
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document,
    private titleService: Title,
    private metaService: Meta,
    private location: Location,
    private articleService: ArticleService
  ) {
    this.siteBaseUrl = (env as any)?.siteUrl
      ? (env as any).siteUrl
      : this.isBrowser
      ? window.location.origin
      : '';

    if (this.isBrowser) {
      this.checkScreenWidth();
      this.supportsWebp = this.checkWebpSupport();
    }
  }

  // ===== Lifecycle =====
  ngOnInit(): void {
    // SSR resolver pronto?
    const resolved = this.route.snapshot.data['cocktail'] as Cocktail | null;
    if (resolved) {
      this.cocktail = resolved;
      this.loading = false;

      this.heroSrc = this.getPreferred(this.getCocktailHeroUrl(this.cocktail));
      this.heroSrcset = this.getCocktailImageSrcsetPreferred(this.cocktail);
      this.setSeoTagsAndSchema();
      this.loadPrevNextBySlug(this.cocktail.slug);
      this.subscribeToRouteParams(false);

      // === Nuovo: correlati lato SSR + TransferState ===
      const key = RELATED_TS_KEY(this.cocktail.slug);
      if (!this.ts.hasKey(key)) {
        // SSR: genera correlati e memorizza
        this.buildSimilarListSSR(this.cocktail).then((rel) => {
          const withHeadings = this.applyHeadingContext(rel);
          this.similarCocktails = withHeadings;
          this.buildRelatedWithAds();
          this.ts.set(key, withHeadings);
        });
      } else {
        // CSR: recupera correlati dal TransferState
        const rel = this.ts.get<Highlightable[]>(key, []);
        const withHeadings = this.applyHeadingContext(rel);
        this.similarCocktails = withHeadings;
        this.buildRelatedWithAds();
      }

      // Non-critiche (ads + articoli)
      this.runAfterFirstPaint(() => {
        this.fetchRelatedArticles();
        this.unlockAdsWhenStable();
      });
      return;
    }

    // Fallback CSR
    this.subscribeToRouteParams(true);
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    // Scroll orizzontale “wheel” per lista affiliati (se presente in DOM)
    if (this.affiliateCardList?.nativeElement) {
      const listElement = this.affiliateCardList.nativeElement as HTMLElement;
      this.ngZone.runOutsideAngular(() => {
        const handler = (event: WheelEvent) => {
          event.preventDefault();
          listElement.scrollLeft += event.deltaY;
        };
        listElement.addEventListener('wheel', handler, { passive: false });
        this.wheelListenerCleanup = () =>
          listElement.removeEventListener('wheel', handler as any);
      });
    }

    // Lazy correlati con IO + fallback timer
    if (this.relatedSentinel?.nativeElement) {
      this.io = new IntersectionObserver(
        (entries) => {
          if (!this.relatedLoaded && entries.some((e) => e.isIntersecting)) {
            this.relatedLoaded = true;
            this.loadSimilarCocktails();
            this.io?.disconnect();
            clearTimeout(this.relatedFallbackTimer);
          }
        },
        { rootMargin: '200px' }
      );
      this.io.observe(this.relatedSentinel.nativeElement);

      // Fallback: se il sentinel non entra presto, carica comunque
      this.relatedFallbackTimer = setTimeout(() => {
        if (!this.relatedLoaded) {
          this.relatedLoaded = true;
          this.loadSimilarCocktails();
          this.io?.disconnect();
        }
      }, 800);
    }
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.similarCocktailsSubscription?.unsubscribe();
    this.cocktailDetailSubscription?.unsubscribe();
    this.adjacentSub?.unsubscribe();
    if (this.wheelListenerCleanup) this.wheelListenerCleanup();
    if (this.io) this.io.disconnect();
    clearTimeout(this.relatedFallbackTimer);
    this.cleanupSeo();
  }

  private async ensureHydratedCocktail(): Promise<void> {
    if (!this.cocktail?.slug) return;

    const needsHydration =
      !Array.isArray(this.cocktail.ingredients_list) ||
      this.cocktail.ingredients_list.length === 0 ||
      !this.cocktail.image?.url;

    if (!needsHydration) return;

    try {
      const fresh = await firstValueFrom(
        this.cocktailService.getCocktailBySlug(this.cocktail.slug)
      );
      if (fresh) {
        this.cocktail = fresh;
        // aggiorna hero/srcset se servono
        this.heroSrc = this.getPreferred(
          this.getCocktailHeroUrl(this.cocktail)
        );
        this.heroSrcset = this.getCocktailImageSrcsetPreferred(this.cocktail);
        this.setSeoTagsAndSchema();
      }
    } catch {
      // non bloccare la pagina se l'idratazione fallisce
    }
  }

  // ===== Helpers defer =====
  private runAfterFirstPaint(cb: () => void): void {
    if (!this.isBrowser) return;
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => setTimeout(() => cb(), 0));
    });
  }

  private unlockAdsWhenStable(): void {
    if (!this.isBrowser) return;
    this.runAfterFirstPaint(() => (this.contentReady = true));
  }

  // ===== Routing/Data =====
  private subscribeToRouteParams(handleFirst: boolean): void {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (!slug) {
        this.error = 'Cocktail slug not found.';
        this.loading = false;
        return;
      }
      if (!handleFirst) {
        handleFirst = true;
        return;
      }
      this.loadCocktailDetail(slug);
    });
  }

  private async kickOffNonCritical(): Promise<void> {
    if (!this.isBrowser) return;

    // 1) assicurati di avere una cocktail “completa”
    await this.ensureHydratedCocktail();

    // 2) calcola i correlati subito (anche se il sentinel non è entrato)
    if (!this.relatedLoaded) this.relatedLoaded = true;
    this.loadSimilarCocktails();

    // 3) fallback: se dopo un attimo sono ancora vuoti, riprova una volta
    setTimeout(() => {
      if (!this.similarCocktails?.length) {
        this.loadSimilarCocktails();
      }
    }, 700);

    // 4) resto delle non-critiche
    this.fetchRelatedArticles();
    this.unlockAdsWhenStable();
  }

  loadCocktailDetail(slug: string): void {
    this.loading = true;
    this.error = null;
    this.similarCocktails = [];
    this.relatedWithAds = [];
    this.contentReady = false;
    this.cleanupSeo();

    const cached = this.allCocktails.find((c) => c.slug === slug);
    if (cached) {
      this.cocktail = cached;
      this.loading = false;

      this.heroSrc = this.getPreferred(this.getCocktailHeroUrl(this.cocktail));
      this.heroSrcset = this.getCocktailImageSrcsetPreferred(this.cocktail);
      this.setSeoTagsAndSchema();
      this.loadPrevNextBySlug(this.cocktail.slug);

      this.runAfterFirstPaint(() => this.kickOffNonCritical());
      return;
    }

    this.cocktailDetailSubscription = this.cocktailService
      .getCocktailBySlug(slug)
      .subscribe({
        next: (res: Cocktail | null) => {
          if (!res) {
            this.error = 'Cocktail not found.';
            this.loading = false;
            this.contentReady = false;
            return;
          }
          this.cocktail = res;
          this.loading = false;

          this.heroSrc = this.getPreferred(
            this.getCocktailHeroUrl(this.cocktail)
          );
          this.heroSrcset = this.getCocktailImageSrcsetPreferred(this.cocktail);
          this.setSeoTagsAndSchema();
          this.loadPrevNextBySlug(this.cocktail.slug);

          this.runAfterFirstPaint(() => this.kickOffNonCritical());
        },
        error: () => {
          this.error = 'Could not load cocktail details from API.';
          this.loading = false;
          this.contentReady = false;
        },
      });
  }

  // helper: “safe” observable che non fa fallire forkJoin/combine
  private safeList$<T>(
    obs: Observable<T[] | null | undefined>
  ): Observable<T[]> {
    return obs.pipe(
      map((v) => (Array.isArray(v) ? v : [])),
      catchError(() => of([]))
    );
  }

  /**
   * Deterministically sort candidate lists so SSR builds always emit the same HTML.
   * This prevents Strapi’s natural order from shuffling related cards between runs.
   */
  private sortCandidates<
    T extends { slug?: string; external_id?: string; id?: any }
  >(list: readonly T[]): T[] {
    return [...(list ?? [])].sort((a, b) => {
      const slugA = String((a as any)?.slug || '').toLowerCase();
      const slugB = String((b as any)?.slug || '').toLowerCase();
      const slugDiff = slugA.localeCompare(slugB);
      if (slugDiff !== 0) return slugDiff;
      const idA = String((a as any)?.external_id || (a as any)?.id || '');
      const idB = String((b as any)?.external_id || (b as any)?.id || '');
      return idA.localeCompare(idB);
    });
  }

  /** Pseudo-shuffle deterministico per ruotare la lista in base allo slug */
  private pseudoShuffle<T>(list: readonly T[], seed: string): T[] {
    const arr = [...list];
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = (h * 31 + seed.charCodeAt(i)) | 0;
    }
    const offset = Math.abs(h) % (arr.length || 1);
    return arr.slice(offset).concat(arr.slice(0, offset));
  }

  // helper: hash string → int
  private _hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // helper: pick deterministico su un array
  private _pick<T>(arr: T[], seed: string): T {
    if (!arr.length) throw new Error('empty pick');
    return arr[this._hash(seed) % arr.length];
  }

  // helper: costruisce una pill NON monotona
  private _makeVariedPill(tag: string, seed: string): { text: string } {
    const forms = [
      `With ${tag}`,
      `${tag} forward`,
      `Showcases ${tag}`,
      `${tag}-led`,
      `Built on ${tag}`,
      `Centered on ${tag}`,
      `Driven by ${tag}`,
    ];
    return { text: this._pick(forms, seed) };
  }

  // helper: seed di coppia source↔candidate
  private _pairSeed(source?: Cocktail, cand?: any, extra = ''): string {
    const a = (source?.slug || source?.id || '').toString().toLowerCase();
    const b = (cand?.slug || cand?.id || '').toString().toLowerCase();
    return `${a}::${b}::${extra}`;
  }

  // === SOSTITUISCI il metodo pushCandidate con questo ===
  private pushCandidate(
    out: Highlightable[],
    used: Set<string | number>,
    currentId: string | number,
    cand: Cocktail | Highlightable,
    opts: {
      tag?: string;
      source?: Cocktail; // this.cocktail
      limit: number;
    }
  ) {
    if (!cand) return false;
    const cid = (cand as any).id as string | number | undefined;
    if (cid == null) return false;
    if (cid == (currentId as any)) return false; // evita self
    if (used.has(cid)) return false;
    if (out.length >= opts.limit) return false;

    const seed = this._pairSeed(opts.source, cand);

    // pill variabile se abbiamo un “tag” (ingrediente), altrimenti conserva eventuale pill esistente
    const pill = opts.tag
      ? this._makeVariedPill(opts.tag, seed)
      : (cand as any).primaryHighlight || { text: 'Suggested match' };

    const s = opts.source;
    const styleReasons: string[] = [];
    if (s?.preparation_type && cand.preparation_type === s.preparation_type)
      styleReasons.push(cand.preparation_type!);
    if (s?.glass && cand.glass === s.glass) styleReasons.push(cand.glass!);
    if (s?.category && cand.category === s.category)
      styleReasons.push(cand.category!);

    const enriched = { ...(cand as any) } as Highlightable & {
      matchLabel?: string;
      matchReason?: string;
      similarityMeta?: any;
    };
    enriched.primaryHighlight = pill;
    enriched.matchLabel = pill.text;
    enriched.matchReason = pill.text;
    enriched.similarityMeta = { ...(enriched.similarityMeta || {}) };

    out.push(enriched);
    used.add(cid);
    return true;
  }

  private processRelatedLists(
    baseList: Cocktail[],
    primList: Cocktail[],
    secList: Cocktail[]
  ) {
    if (!this.cocktail) {
      this.similarCocktails = [];
      this.relatedWithAds = [];
      return;
    }

    // — Parametri di quota/mix —
    const LIMIT = 21;
    const MIN = 8;
    const Q_PRIMARY = 8; // fino a 8 dal 1° ingrediente
    const Q_SECONDARY = 6; // fino a 6 dal 2° ingrediente
    const Q_STYLE = 7; // fino a 7 per “stile” (metodo/vetro/categoria)

    const norm = (s?: string | null) => (s || '').toLowerCase().trim();
    const hasIng = (c: Cocktail, name: string) =>
      (c?.ingredients_list || []).some(
        (it: any) => norm(it?.ingredient?.name) === norm(name)
      );

    const ingList = (this.cocktail.ingredients_list || [])
      .map((x) => x?.ingredient)
      .filter(Boolean);
    const primary = ingList[0] || null;
    const secondary = ingList[1] || null;
    const primaryName = (primary?.name || '').trim();
    const secondaryName = (secondary?.name || '').trim();

    const used = new Set<string | number>();
    const out: Highlightable[] = [];
    const push = (c: Cocktail | Highlightable, tag?: string) =>
      this.pushCandidate(out, used, this.cocktail!.id as any, c, {
        tag,
        source: this.cocktail!,
        limit: LIMIT,
      });

    // 1) Prepara liste candidate (ordinamento stabile + pseudo-shuffle per variare)
    const primCandidates = this.pseudoShuffle(
      this.sortCandidates(primList).filter((c) =>
        primaryName ? hasIng(c, primaryName) : true
      ),
      this.cocktail.slug || String(this.cocktail.id)
    );

    const secCandidates = this.pseudoShuffle(
      this.sortCandidates(secList).filter((c) =>
        secondaryName ? hasIng(c, secondaryName) : true
      ),
      (this.cocktail.slug || String(this.cocktail.id)) + '-b'
    );

    const styleCandidates = this.pseudoShuffle(
      this.sortCandidates(baseList),
      (this.cocktail.slug || String(this.cocktail.id)) + '-style'
    );

    // 2) Prendi quote iniziali (senza superare disponibilità)
    const take = <T>(arr: T[], n: number) =>
      arr.length > n ? arr.slice(0, n) : [...arr];

    const primPicked = take(primCandidates, Q_PRIMARY);
    const secPicked = take(secCandidates, Q_SECONDARY);
    const styPicked = take(styleCandidates, Q_STYLE);

    // 3) Interleave a blocchi (prim/sec/style) per evitare cluster monotoni
    const interleave = <T>(lists: T[][], max: number) => {
      const res: T[] = [];
      let i = 0;
      while (res.length < max) {
        let pushed = false;
        for (const lst of lists) {
          const item = lst[i];
          if (item !== undefined) {
            res.push(item);
            if (res.length >= max) break;
            pushed = true;
          }
        }
        if (!pushed) break;
        i++;
      }
      return res;
    };

    const mixedSeed = `${this.cocktail.slug || this.cocktail.id}-mix`;
    const mixed = this.pseudoShuffle(
      interleave([primPicked, secPicked, styPicked], LIMIT * 2), // overfetch, poi dedup
      mixedSeed
    );

    // 4) Riempie out rispettando tag ingrediente quando presente
    for (const c of mixed) {
      if (out.length >= LIMIT) break;
      const tag =
        primaryName && hasIng(c as Cocktail, primaryName)
          ? primaryName
          : secondaryName && hasIng(c as Cocktail, secondaryName)
          ? secondaryName
          : undefined;
      push(c as Cocktail, tag);
    }

    // 5) Se sotto MIN, toppa con altri “style”
    if (out.length < MIN && styleCandidates.length) {
      for (const c of styleCandidates) {
        if (out.length >= LIMIT) break;
        push(c as Cocktail);
      }
    }

    // 6) Dedup per ID
    const seen = new Set<string | number>();
    let unique = out.filter((x: any) => {
      const id = x?.id as any;
      if (id == null) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // 7) Round-robin alfabetico per evitare “AAAA… BBBB…”
    const byLetter: Record<string, Highlightable[]> = {};
    for (const c of unique) {
      const letter = (c.name?.[0] || '?').toUpperCase();
      (byLetter[letter] ||= []).push(c);
    }
    const letters = Object.keys(byLetter).sort();
    const rr: Highlightable[] = [];
    let cursor = 0;
    while (rr.length < unique.length) {
      const letter = letters[cursor % letters.length];
      const item = byLetter[letter].shift();
      if (item) rr.push(item);
      cursor++;
      if (letters.every((l) => byLetter[l].length === 0)) break;
    }

    // 8) Taglia a LIMIT
    unique = rr.slice(0, LIMIT);

    // 9) Applica heading/motto e costruisci array con slot ads
    this.similarCocktails = this.applyHeadingContext(unique);
    this.buildRelatedWithAds();

    // 10) Se ancora vuoto, fallback minimo dallo “style”
    if (!this.similarCocktails.length && styleCandidates.length) {
      const fb = styleCandidates.slice(
        0,
        Math.min(LIMIT, 6)
      ) as any as Highlightable[];
      this.similarCocktails = this.applyHeadingContext(fb);
      this.buildRelatedWithAds();
    }
  }

  private async buildSimilarListSSR(
    source: Cocktail
  ): Promise<Highlightable[]> {
    const base$ = this.safeList$(
      this.cocktailService.getSimilarCocktails(source)
    );
    const [baseList] = await firstValueFrom(forkJoin([base$]));

    // Ordine deterministico, stessi motti di buildSimilarity
    const sorted = this.sortCandidates(baseList || []);
    const limit = 12;

    const diversified = sorted.slice(0, limit).map((cand, idx) => {
      const seed = `${source.slug ?? source.id}::${
        (cand as any).slug ?? (cand as any).id
      }`;
      const type = this.cocktailService.resolveRelationKind(
        source,
        cand as CocktailWithLayoutAndMatch,
        ['base', 'family', 'methodOnly', 'glassOnly', 'fallback']
      );
      const motto = this.cocktailService.buildCorrelationMotto(
        {
          type,
          key: cand.name,
          base: source.name,
          method: cand.preparation_type || source.preparation_type || '',
          glass: cand.glass || source.glass || '',
          category: cand.category || source.category || 'Cocktail',
        },
        seed.toLowerCase()
      );
      return {
        ...(cand as any),
        similarityMeta: { motto, relationKind: type },
      } as Highlightable;
    });
    return this.applyHeadingContext(diversified);
  }

  loadSimilarCocktails(): void {
    if (!this.isBrowser || !this.cocktail) {
      this.similarCocktails = [];
      this.relatedWithAds = [];
      return;
    }

    const LIMIT = 21;
    const MIN = 8;
    const Q_PRIMARY = 8;
    const Q_SECONDARY = 6;
    const Q_STYLE = 7;

    const norm = (s?: string | null) => (s || '').toLowerCase().trim();
    const hasIng = (c: Cocktail, name: string) =>
      (c.ingredients_list || []).some(
        (it: any) => norm(it?.ingredient?.name) === norm(name)
      );

    const currentId = this.cocktail.id as any;
    const ingList = (this.cocktail.ingredients_list || [])
      .map((x) => x?.ingredient)
      .filter(Boolean);
    const primary = ingList[0] || null;
    const secondary = ingList[1] || null;
    const primaryName = primary?.name || null;
    const primaryId = primary?.external_id || null;
    const secondaryName = secondary?.name || null;
    const secondaryId = secondary?.external_id || null;

    // richieste parallele
    const base$ = this.safeList$(
      this.cocktailService.getSimilarCocktails(this.cocktail)
    );
    const prim$ = primaryId
      ? this.safeList$(
          this.cocktailService.getRelatedCocktailsForIngredient(primaryId)
        )
      : of([]);
    const sec$ = secondaryId
      ? this.safeList$(
          this.cocktailService.getRelatedCocktailsForIngredient(secondaryId)
        )
      : of([]);

    forkJoin([base$, prim$, sec$])
      .pipe(take(1))
      .subscribe(([baseList, primList, secList]) => {
        this.ngZone.runOutsideAngular(() => {
          this.ngZone.run(() => {
            try {
              this.processRelatedLists(baseList, primList, secList);
            } catch (err) {
              console.error('Error building related cocktails', err);
            }
          });
        });
      });
  }

  private buildRelatedWithAds(): void {
    const list: Highlightable[] = this.similarCocktails ?? [];
    const out: Array<Highlightable | AdSlot> = [];
    list.forEach((c, i) => {
      out.push(c);
      const isLast = i === list.length - 1;
      if ((i + 1) % this.AD_EVERY === 0 && !isLast) {
        out.push({ isAd: true, id: `ad-rel-${i}`, kind: 'square' });
      }
    });
    this.relatedWithAds = out;
  }

  // === SOSTITUISCI il metodo applyHeadingContext con questo ===
  private applyHeadingContext(list: Highlightable[]): Highlightable[] {
    const total = list?.length || 0;
    if (!total) return [];

    const cocktailName = (this.cocktail?.name || '').trim();
    const usedHeadings = new Set<string>();

    const safe = (s?: string | null) => (typeof s === 'string' ? s.trim() : '');

    return list.map((item, idx) => {
      // 1) motto preferito: generato per la COPPIA (source↔candidate)
      const pairSeed = this._pairSeed(this.cocktail, item);
      const inferredKind = this.cocktailService?.resolveRelationKind?.(
        this.cocktail as Cocktail,
        item as CocktailWithLayoutAndMatch,
        [
          'base',
          'service',
          'family',
          'overlap',
          'methodOnly',
          'glassOnly',
          'flavor',
          'fallback',
        ]
      );

      const mottoFromSvc =
        this.cocktailService?.buildCorrelationMotto?.(
          {
            type: inferredKind || 'fallback',
            key:
              (item as any)?.ingredients_list?.[0]?.ingredient?.name ||
              (this.cocktail?.ingredients_list?.[0]?.ingredient?.name ?? ''),
            base: this.cocktail?.ingredients_list?.[0]?.ingredient?.name || '',
            method: (
              item.preparation_type ||
              this.cocktail?.preparation_type ||
              ''
            ).trim(),
            glass: (item.glass || this.cocktail?.glass || '').trim(),
            category: (
              item.category ||
              this.cocktail?.category ||
              'Cocktail'
            ).trim(),
          },
          pairSeed
        ) || '';

      // 2) fallback “amichevole” (non usa la pill “With …”)
      const mottoFriendly =
        safe(mottoFromSvc) ||
        this.makeFriendlyMotto(this.cocktail as Cocktail, item as any);

      // 3) heading base + motto (NON usiamo la pill per evitare ripetizioni)
      const parts: string[] = [`Related cocktail ${idx + 1} of ${total}`];
      if (cocktailName) parts.push(`for ${cocktailName}`);
      if (safe(mottoFriendly)) parts.push(safe(mottoFriendly));

      let heading = parts.join(' · ');

      // 4) anti-collisione: se esiste già un heading uguale, applica una variante deterministica
      if (usedHeadings.has(heading)) {
        const variants = [
          `${heading} · Alt.`,
          `${heading} · Variant`,
          `${heading} · Another pick`,
        ];
        heading = this._pick(variants, pairSeed);
      }
      usedHeadings.add(heading);

      // 5) torna l’item arricchito (motto sempre presente per sicurezza lato template)
      return {
        ...item,
        headingContext: heading,
        similarityMeta: {
          ...(item.similarityMeta || {}),
          motto: mottoFriendly,
        },
      } as Highlightable;
    });
  }

  trackByRelated = (_: number, item: any) =>
    item?.isAd ? item.id : item?.slug ?? item?.id ?? _;

  setNavigationCocktails(currentExternalId: string): void {
    if (!this.allCocktails?.length) return;

    const curId = String(currentExternalId);
    let idx = this.allCocktails.findIndex(
      (c) => String(c.external_id) === curId
    );

    if (idx === -1 && this.cocktail?.slug) {
      const currentSlug = (this.cocktail.slug || '').toLowerCase();
      idx = this.allCocktails.findIndex(
        (c) => (c.slug || '').toLowerCase() === currentSlug
      );
    }

    this.currentCocktailIndex = idx;
    this.previousCocktail = null;
    this.nextCocktail = null;
    if (idx <= -1) return;

    if (idx > 0) {
      const prev = this.allCocktails[idx - 1];
      this.previousCocktail = {
        externalId: prev.external_id,
        name: prev.name,
        imageUrl: this.getPreferred(this.getCocktailImageUrl(prev)),
        slug: prev.slug,
      };
    }
    if (idx < this.allCocktails.length - 1) {
      const next = this.allCocktails[idx + 1];
      this.nextCocktail = {
        externalId: next.external_id,
        name: next.name,
        imageUrl: this.getPreferred(this.getCocktailImageUrl(next)),
        slug: next.slug,
      };
    }
  }

  private fetchRelatedArticles(): void {
    if (!this.isBrowser || !this.cocktail?.id) {
      this.relatedArticles = [];
      return;
    }
    this.articleService
      .getArticlesByRelatedCocktailId(this.cocktail.id, 6)
      .subscribe({
        next: (list) => (this.relatedArticles = list),
        error: () => (this.relatedArticles = []),
      });
  }

  // ===== UI helpers =====
  goBack(): void {
    this.location.back();
  }

  // --- IMG utils ---
  getCocktailImageUrl(cocktail: Cocktail | undefined): string {
    if (cocktail?.image?.url) {
      return cocktail.image.url.startsWith('http')
        ? cocktail.image.url
        : env.apiUrl + cocktail.image.url;
    }
    return 'assets/no-image.png';
  }
  getIngredientImageUrl(ingredientEntry: any): string {
    if (ingredientEntry?.ingredient?.image?.url) {
      const raw = ingredientEntry.ingredient.image.url.startsWith('http')
        ? ingredientEntry.ingredient.image.url
        : env.apiUrl + ingredientEntry.ingredient.image.url;
      return raw;
    }
    return 'assets/no-image.png';
  }
  getCocktailThumbUrl(cocktail?: Cocktail): string {
    const img: any = cocktail?.image;
    if (!img) return 'assets/no-image.png';
    const abs = (u?: string | null) =>
      u ? (u.startsWith('http') ? u : env.apiUrl + u) : '';
    if (img?.formats?.thumbnail?.url) return abs(img.formats.thumbnail.url);
    if (img?.formats?.small?.url) return abs(img.formats.small.url);
    if (img?.url) return abs(img.url);
    return 'assets/no-image.png';
  }

  private checkWebpSupport(): boolean {
    try {
      const canvas = document.createElement('canvas');
      if (!!(canvas.getContext && canvas.getContext('2d'))) {
        const data = canvas.toDataURL('image/webp');
        return data.indexOf('data:image/webp') === 0;
      }
      return false;
    } catch {
      return false;
    }
  }
  toWebp(url?: string | null): string {
    if (!url) return '';
    if (url.startsWith('assets/')) return url;
    return url.replace(/\.(jpe?g|png)(\?.*)?$/i, '.webp$2');
  }
  getPreferred(originalUrl?: string | null): string {
    if (!originalUrl) return '';
    if (!this.supportsWebp) return originalUrl;
    return this.toWebp(originalUrl) || originalUrl;
  }
  onImgError(evt: Event, originalUrl: string): void {
    const img = evt.target as HTMLImageElement | null;
    if (!img) return;
    if ((img as any).__fallbackApplied) return;
    (img as any).__fallbackApplied = true;
    img.src = originalUrl;
    img.removeAttribute('srcset');
  }
  onImgErrorWithSrcset(
    evt: Event,
    originalSrc: string,
    originalSrcset: string
  ): void {
    const img = evt.target as HTMLImageElement | null;
    if (!img) return;
    if ((img as any).__fallbackApplied) return;
    (img as any).__fallbackApplied = true;
    img.srcset = originalSrcset || '';
    img.src = originalSrc;
  }
  getCocktailImageSrcset(cocktail?: Cocktail): string {
    const img: any = cocktail?.image;
    if (!img) return '';
    const abs = (u?: string | null) =>
      u ? (u.startsWith('http') ? u : env.apiUrl + u) : '';
    const entries: Array<[string, number]> = [];
    if (img?.formats?.thumbnail?.url)
      entries.push([abs(img.formats.thumbnail.url), 150]);
    if (img?.formats?.small?.url)
      entries.push([abs(img.formats.small.url), 320]);
    if (img?.formats?.medium?.url)
      entries.push([abs(img.formats.medium.url), 640]);
    if (img?.formats?.large?.url)
      entries.push([abs(img.formats.large.url), 1024]);
    if (img?.url) entries.push([abs(img.url), 1600]);
    return entries
      .filter(([u, w]) => !!u && !!w)
      .map(([u, w]) => `${u.trim()} ${w}w`)
      .join(', ');
  }
  getCocktailImageSrcsetPreferred(cocktail?: Cocktail): string {
    const original = this.getCocktailImageSrcset(cocktail);
    if (!this.supportsWebp || !original) return original;
    return original
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const m = entry.match(/^(?<url>\S+)\s+(?<w>\d+)w$/);
        if (!m?.groups) return entry;
        const url = this.toWebp(m.groups['url']);
        return `${url} ${m.groups['w']}w`;
      })
      .join(', ');
  }
  getCocktailHeroUrl(cocktail?: Cocktail): string {
    const img: any = cocktail?.image;
    if (!img) return 'assets/no-image.png';
    const abs = (u?: string | null) =>
      u ? (u.startsWith('http') ? u : env.apiUrl + u) : '';
    const original =
      (img?.formats?.medium?.url && abs(img.formats.medium.url)) ||
      (img?.formats?.large?.url && abs(img.formats.large.url)) ||
      (img?.url && abs(img.url)) ||
      (img?.formats?.small?.url && abs(img.formats.small.url)) ||
      'assets/no-image.png';
    return original;
  }

  @HostListener('window:resize')
  onResize(): void {
    this.checkScreenWidth();
  }
  checkScreenWidth(): void {
    this.isMobile = this.isBrowser ? window.innerWidth <= 768 : false;
  }

  private getFullSiteUrl(path: string): string {
    return `${this.siteBaseUrl}${path}`;
  }

  // ===== SEO =====
  private setSeoTagsAndSchema(): void {
    if (!this.cocktail) return;

    const cocktailName = this.cocktail.name;
    const cocktailDescription = (
      this.cocktail.ai_description ||
      this.cocktail.instructions ||
      ''
    )
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);

    const cocktailImageUrl = this.getPreferred(
      this.getCocktailImageUrl(this.cocktail)
    );
    const cocktailUrl = this.getFullSiteUrl(this.router.url);

    this.titleService.setTitle(`${cocktailName} | Fizzando`);

    this.metaService.removeTag("name='description'");
    this.metaService.updateTag(
      { name: 'description', content: cocktailDescription },
      "name='description'"
    );

    const canonicalHref = cocktailUrl || this.router.url;
    const canonicalTag = this.document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]'
    );
    if (canonicalTag) {
      canonicalTag.setAttribute('href', canonicalHref);
    } else {
      const linkTag = this.renderer.createElement('link');
      this.renderer.setAttribute(linkTag, 'rel', 'canonical');
      this.renderer.setAttribute(linkTag, 'href', canonicalHref);
      this.renderer.appendChild(this.document.head, linkTag);
    }

    this.metaService.updateTag({ property: 'og:title', content: cocktailName });
    this.metaService.updateTag({
      property: 'og:description',
      content: cocktailDescription,
    });
    this.metaService.updateTag({
      property: 'og:image',
      content: cocktailImageUrl,
    });
    this.metaService.updateTag({ property: 'og:url', content: canonicalHref });
    this.metaService.updateTag({ property: 'og:type', content: 'article' });
    this.metaService.updateTag({
      property: 'og:site_name',
      content: 'Fizzando',
    });

    this.metaService.updateTag({
      name: 'twitter:card',
      content: 'summary_large_image',
    });
    this.metaService.updateTag({
      name: 'twitter:title',
      content: cocktailName,
    });
    this.metaService.updateTag({
      name: 'twitter:description',
      content: cocktailDescription,
    });
    this.metaService.updateTag({
      name: 'twitter:image',
      content: cocktailImageUrl,
    });

    this.addJsonLdSchema();
  }

  private addJsonLdSchema(): void {
    if (!this.cocktail) return;
    this.cleanupJsonLd();

    const schema = this.generateCocktailSchema(this.cocktail);
    this.cocktailSchemaScript = this.renderer.createElement('script');
    this.renderer.setAttribute(
      this.cocktailSchemaScript,
      'id',
      'cocktail-schema'
    );
    this.renderer.setAttribute(
      this.cocktailSchemaScript,
      'type',
      'application/ld+json'
    );
    this.renderer.appendChild(
      this.cocktailSchemaScript,
      this.renderer.createText(JSON.stringify(schema))
    );
    this.renderer.appendChild(this.document.head, this.cocktailSchemaScript);
  }

  private cleanupSeo(): void {
    this.metaService.removeTag("name='description'");
    this.metaService.removeTag("property='og:title'");
    this.metaService.removeTag("property='og:description'");
    this.metaService.removeTag("property='og:image'");
    this.metaService.removeTag("property='og:url'");
    this.metaService.removeTag("property='og:type'");
    this.metaService.removeTag("property='og:site_name'");
    this.metaService.removeTag("name='twitter:card'");
    this.metaService.removeTag("name='twitter:title'");
    this.metaService.removeTag("name='twitter:description'");
    this.metaService.removeTag("name='twitter:image'");
    this.cleanupJsonLd();

    const oldPreload = this.document.querySelector(
      'link[rel="preload"][as="image"][data-preload-hero="1"]'
    );
    if (oldPreload) this.renderer.removeChild(this.document.head, oldPreload);
  }

  private cleanupJsonLd(): void {
    const oldScript = this.document.getElementById('cocktail-schema');
    if (oldScript) this.renderer.removeChild(this.document.head, oldScript);
  }

  generateCocktailSchema(cocktail: any): any {
    const pageUrl = this.getFullSiteUrl(`/cocktails/${cocktail.slug}`);
    const imageUrl =
      this.getPreferred(this.getCocktailImageUrl(cocktail)) ||
      this.getFullSiteUrl('assets/no-image.png');

    return {
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: cocktail.name,
      image: [imageUrl],
      description: (cocktail.ai_description || cocktail.instructions || '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300),
      author: { '@type': 'Organization', name: 'Fizzando' },
      datePublished: cocktail.createdAt,
      recipeCategory: cocktail.category || 'Cocktail',
      recipeCuisine: 'Contemporary',
      keywords: [
        cocktail.category,
        cocktail.alcoholic,
        ...(cocktail.ingredients_list || []).map(
          (i: any) => i.ingredient?.name
        ),
      ]
        .filter(Boolean)
        .join(', '),
      recipeYield: '1 serving',
      totalTime: 'PT5M',
      nutrition: {
        '@type': 'NutritionInformation',
        calories: 'Approx 180 calories',
      },
      recipeIngredient: (cocktail.ingredients_list || []).map((i: any) =>
        i.measure ? `${i.measure} ${i.ingredient?.name}` : i.ingredient?.name
      ),
      recipeInstructions: [
        {
          '@type': 'HowToStep',
          text: (cocktail.instructions || '').replace(/\s+/g, ' ').trim(),
        },
      ],
      comment: [
        cocktail.ai_pairing && {
          '@type': 'Comment',
          text: `Pairing: ${cocktail.ai_pairing}`,
        },
        cocktail.ai_presentation && {
          '@type': 'Comment',
          text: `Presentation: ${cocktail.ai_presentation}`,
        },
        cocktail.ai_origin && {
          '@type': 'Comment',
          text: `Origin: ${cocktail.ai_origin}`,
        },
        cocktail.ai_occasion && {
          '@type': 'Comment',
          text: `Occasion: ${cocktail.ai_occasion}`,
        },
        cocktail.ai_sensory_description && {
          '@type': 'Comment',
          text: `Sensory: ${cocktail.ai_sensory_description}`,
        },
        cocktail.ai_personality && {
          '@type': 'Comment',
          text: `Personality: ${cocktail.ai_personality}`,
        },
        cocktail.ai_variations && {
          '@type': 'Comment',
          text: `Variations: ${cocktail.ai_variations}`,
        },
        cocktail.ai_alcohol_content && {
          '@type': 'Comment',
          text: `Alcohol Content: ~${cocktail.ai_alcohol_content}`,
        },
      ].filter(Boolean),
      mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    };
  }

  // ====== AD helpers ======
  getTopAdType(): 'mobile-banner' | 'leaderboard' {
    return this.isMobile ? 'mobile-banner' : 'leaderboard';
  }
  getBottomAdType(): 'mobile-banner' | 'leaderboard' {
    return this.isMobile ? 'mobile-banner' : 'leaderboard';
  }
  getLoopAdType(): 'mobile-banner' | 'square' {
    return this.isMobile ? 'mobile-banner' : 'square';
  }
  adSlotClass(type: string): string {
    return `ad-slot ${type}`;
  }

  // ====== Prev/Next by slug ======
  private loadPrevNextBySlug(slug: string): void {
    if (!slug) return;
    this.indexReady = false;

    this.adjacentSub?.unsubscribe();
    this.adjacentSub = this.cocktailService
      .getAdjacentCocktailsBySlug(slug)
      .subscribe({
        next: (res: { prev: Cocktail | null; next: Cocktail | null }) => {
          const { prev, next } = res;
          this.previousCocktail = prev
            ? {
                externalId: prev.external_id,
                name: prev.name,
                imageUrl: this.getPreferred(this.getCocktailImageUrl(prev)),
                slug: prev.slug,
              }
            : null;

          this.nextCocktail = next
            ? {
                externalId: next.external_id,
                name: next.name,
                imageUrl: this.getPreferred(this.getCocktailImageUrl(next)),
                slug: next.slug,
              }
            : null;

          this.indexReady = true;
        },
        error: () => {
          this.previousCocktail = null;
          this.nextCocktail = null;
          this.indexReady = true;
        },
      });
  }

  // Motto helper
  private makeFriendlyMotto(
    source: Cocktail,
    candidate: Cocktail,
    opts?: { tagIngredient?: string | null; styleReasons?: string[] }
  ): string {
    const seed = (candidate.slug || String(candidate.id || '')).toLowerCase();
    const pick = (arr: string[]) => {
      let h = 0;
      for (let i = 0; i < seed.length; i++)
        h = (h * 31 + seed.charCodeAt(i)) | 0;
      return arr[Math.abs(h) % arr.length];
    };

    const cat = (candidate.category || 'cocktail').toLowerCase();
    const ingr = (candidate.ingredients_list || [])
      .map((i) => (i?.ingredient?.name || '').trim())
      .filter(Boolean);
    const twoKeyIngr = ingr.slice(0, 2).join(' + ');

    if (opts?.tagIngredient) {
      const tag = opts.tagIngredient;
      return pick([
        `Features ${tag} with a refined balance.`,
        `Built around ${tag}, subtle yet distinctive.`,
        `Highlights ${tag} in a classic style.`,
        `A ${cat} centered on ${tag}.`,
      ]);
    }

    if (opts?.styleReasons?.length) {
      const style = opts.styleReasons.slice(0, 2).join(' · ');
      return pick([
        `Shares the same ${style} profile.`,
        `Similar ${style} composition.`,
        `Aligned in ${style} style.`,
        `Comparable build and presentation.`,
      ]);
    }

    if (twoKeyIngr) {
      return pick([
        `${twoKeyIngr} — a balanced ${cat}.`,
        `${twoKeyIngr}, refined and harmonious.`,
        `${twoKeyIngr} for a modern ${cat}.`,
        `Clean ${cat} built on ${twoKeyIngr}.`,
      ]);
    }

    return pick([
      `A related ${cat} in similar style.`,
      `Another classic within the same family.`,
      `Comparable drink with matching character.`,
    ]);
  }
}
