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
} from '@angular/core';
import { catchError, map } from 'rxjs/operators';
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
};

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
      // Lancia subito le non-critiche (non blocca il paint)
      this.runAfterFirstPaint(() => this.kickOffNonCritical());
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

  // helper: aggiunge in “out” rispettando limiti / esclusioni
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
    if (cid == (currentId as any)) return false; // evita self anche se string/number
    if (used.has(cid)) return false;
    if (out.length >= opts.limit) return false;

    const pill = opts.tag
      ? { text: `With ${opts.tag}` }
      : (cand as any).primaryHighlight || { text: 'Suggested match' };

    // mini “styleReasons” come prima
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
    // NON imporre qui il motto: lo rigeneriamo alla fine con offset
    enriched.similarityMeta = { ...(enriched.similarityMeta || {}) };

    out.push(enriched);
    used.add(cid);
    return true;
  }

  loadSimilarCocktails(): void {
    if (!this.isBrowser || !this.cocktail) {
      this.similarCocktails = [];
      this.relatedWithAds = [];
      return;
    }

    const LIMIT = 21;
    const MIN = 8; // minimo “dignitoso” prima dei fallback
    const Q_PRIMARY = 9;
    const Q_SECONDARY = 5;

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

    // richieste “safe”
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

    forkJoin([base$, prim$, sec$]).subscribe({
      next: async ([baseList, primList, secList]) => {
        const used = new Set<string | number>();
        const out: Highlightable[] = [];
        const push = (c: Cocktail | Highlightable, tag?: string) =>
          this.pushCandidate(out, used, currentId, c, {
            tag,
            source: this.cocktail!,
            limit: LIMIT,
          });

        // 1) fino a 9 dal primo ingrediente
        if (primaryName && primList?.length) {
          for (const c of primList) {
            if (hasIng(c, primaryName)) push(c, primaryName);
            if (
              out.filter((x) => hasIng(x as Cocktail, primaryName)).length >=
              Q_PRIMARY
            )
              break;
            if (out.length >= LIMIT) break;
          }
        }

        // 2) fino a 5 dal secondo
        if (secondaryName && secList?.length) {
          for (const c of secList) {
            if (hasIng(c, secondaryName)) push(c, secondaryName);
            if (
              out.filter((x) => hasIng(x as Cocktail, secondaryName)).length >=
              Q_SECONDARY
            )
              break;
            if (out.length >= LIMIT) break;
          }
        }

        // 3) base rankato (con pill “style” se coincide)
        const baseRanked = (baseList as CocktailWithLayoutAndMatch[]) ?? [];
        for (const c of baseRanked) {
          if (out.length >= LIMIT) break;

          const reasons: string[] = [];
          if (
            this.cocktail?.preparation_type &&
            c.preparation_type === this.cocktail.preparation_type
          )
            reasons.push(c.preparation_type!);
          if (this.cocktail?.glass && c.glass === this.cocktail.glass)
            reasons.push(c.glass!);
          if (this.cocktail?.category && c.category === this.cocktail.category)
            reasons.push(c.category!);

          const label = reasons.length
            ? { text: reasons.slice(0, 2).join(' · ') }
            : undefined;
          const withLabel = label
            ? ({ ...(c as any), primaryHighlight: label } as Highlightable)
            : (c as any);
          push(withLabel);
        }

        // 4) riempitivi “largheggianti” (togliendo il vincolo hasIng)
        if (out.length < LIMIT && primList?.length) {
          for (const c of primList) {
            if (out.length >= LIMIT) break;
            push(c, primaryName || undefined);
          }
        }
        if (out.length < LIMIT && secList?.length) {
          for (const c of secList) {
            if (out.length >= LIMIT) break;
            push(c, secondaryName || undefined);
          }
        }

        // -------- Fallback robusti --------

        // Fallback A: se sotto soglia MIN, prova più ingredienti (fino a 5) in parallelo
        if (out.length < MIN && ingList.length) {
          const extraIds = ingList
            .map((i: any) => i?.external_id)
            .filter(Boolean)
            .slice(0, 5) as string[];

          if (extraIds.length) {
            const extra$ = forkJoin(
              extraIds.map((id) =>
                this.safeList$(
                  this.cocktailService.getRelatedCocktailsForIngredient(id)
                )
              )
            );
            const extraGroups = await firstValueFrom(extra$);
            for (const group of extraGroups) {
              for (const c of group) {
                if (out.length >= LIMIT) break;
                push(c);
              }
              if (out.length >= LIMIT) break;
            }
          }
        }

        // Fallback B: ancora pochi? usa prev/next dello slug (se disponibili) come “mini correlati”
        if (out.length < MIN && this.cocktail?.slug) {
          try {
            const adj = await firstValueFrom(
              this.cocktailService.getAdjacentCocktailsBySlug(
                this.cocktail.slug
              )
            );
            if (adj?.prev) push(adj.prev);
            if (adj?.next) push(adj.next);
          } catch {
            // silenzioso: niente crash se fallisce
          }
        }

        // dedup rigoroso
        const seen = new Set<string | number>();
        const finalList = out.filter((x: any) => {
          const id = x?.id as any;
          if (id == null) return false;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });

        // --- SOLO TESTI: diversifica H3 e ammorbidisci le pill senza toccare l'ordine ---

        const s = this.cocktail!;
        const baseName = s?.ingredients_list?.[0]?.ingredient?.name || '';
        const norm = (x?: string | null) => (x || '').toLowerCase().trim();

        const diversified = finalList.slice(0, LIMIT).map((cand, idx) => {
          // segnali “di stile” calcolati live (no _mottoMeta)
          const sameMethod =
            !!s.preparation_type &&
            cand.preparation_type === s.preparation_type;
          const sameGlass = !!s.glass && cand.glass === s.glass;
          const sameCat = !!s.category && cand.category === s.category;
          const candHasBase =
            !!baseName &&
            (cand as any).ingredients_list?.some(
              (it: any) => norm(it?.ingredient?.name) === norm(baseName)
            );

          // rotazione “umana”: cerco il tipo migliore e, se ripetuto, ruoto sugli altri idonei
          const typePool: Array<
            | 'base'
            | 'service'
            | 'family'
            | 'methodOnly'
            | 'glassOnly'
            | 'overlap'
            | 'flavor'
            | 'fallback'
          > = [];

          if (candHasBase) typePool.push('base');
          if (sameMethod && sameGlass) typePool.push('service');
          if (sameCat) typePool.push('family');
          if (sameMethod) typePool.push('methodOnly');
          if (sameGlass) typePool.push('glassOnly');
          // sempre disponibili come “variazione di stile”
          typePool.push('overlap', 'flavor', 'fallback');

          // scegli un tipo, ma ruota in base all’indice per evitare blocchi monotoni
          const type = typePool[idx % typePool.length];

          // ingredienti per le variabili del template
          const firstIngr =
            (cand as any).ingredients_list?.[0]?.ingredient?.name || '';
          const seed = `${s.slug}::${
            (cand as any).slug || (cand as any).id
          }::${idx}`;

          const motto = this.cocktailService.buildCorrelationMotto(
            {
              type,
              key: firstIngr,
              base: baseName,
              method: (
                cand.preparation_type ||
                s.preparation_type ||
                ''
              ).trim(),
              glass: (cand.glass || s.glass || '').trim(),
              category: (cand.category || s.category || 'Cocktail').trim(),
            },
            seed,
            idx
          );

          // Ammorbidisci pill ripetitive “With Gin” → varia leggermente il testo se identico
          const pill = (cand as any).primaryHighlight?.text || '';
          let newPill = pill;
          if (/^With\s+/i.test(pill)) {
            const tag = pill.replace(/^With\s+/i, '').trim();
            const synonyms = [
              `With ${tag}`,
              `${tag} forward`,
              `Showcases ${tag}`,
              `${tag}-led`,
              `Built on ${tag}`,
              `Centered on ${tag}`,
            ];
            newPill = synonyms[idx % synonyms.length];
          }

          return {
            ...cand,
            primaryHighlight: newPill
              ? { text: newPill }
              : (cand as any).primaryHighlight,
            similarityMeta: { ...(cand.similarityMeta || {}), motto },
          } as typeof cand;
        });

        this.similarCocktails = diversified;
        this.buildRelatedWithAds();

        // se davvero è rimasto vuoto, tenta un'ultima volta solo “base”
        if (!this.similarCocktails.length && this.cocktail) {
          try {
            const baseOnly = await firstValueFrom(
              this.safeList$(
                this.cocktailService.getSimilarCocktails(this.cocktail)
              )
            );
            this.similarCocktails = (baseOnly || []).slice(0, LIMIT) as any;
            this.buildRelatedWithAds();
          } catch {
            // ignora
          }
        }
      },
      error: () => {
        // fallback totale ma “non muto”: metti prev/next se li hai
        const mini: Highlightable[] = [];
        if (this.previousCocktail) {
          mini.push({
            ...(this.previousCocktail as any),
            id: this.previousCocktail.externalId,
          } as any);
        }
        if (this.nextCocktail) {
          mini.push({
            ...(this.nextCocktail as any),
            id: this.nextCocktail.externalId,
          } as any);
        }
        this.similarCocktails = mini;
        this.relatedWithAds = mini;
      },
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
