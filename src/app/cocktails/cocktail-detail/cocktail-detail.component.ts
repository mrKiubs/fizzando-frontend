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
import { concatMap, map } from 'rxjs/operators';
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
import {} from 'rxjs/operators';
import {
  CocktailService,
  Cocktail,
  CocktailWithLayoutAndMatch,
} from '../../services/strapi.service';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin, Observable, of, Subscription } from 'rxjs';
import { Title, Meta } from '@angular/platform-browser';

import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';
import { AffiliateProductComponent } from '../../assets/design-system/affiliate-product/affiliate-product.component';
import { ArticleService, Article } from '../../services/article.service';
import { ArticleCardComponent } from '../../articles/article-card/article-card.component';
import { CocktailCardComponent } from '../../cocktails/cocktail-card/cocktail-card.component';

import { env } from '../../config/env';
import { SentenceBreaksDirective } from '../../assets/pipes/sentence-breaks.pipe';

type Highlightable = CocktailWithLayoutAndMatch & {
  primaryHighlight?: { text: string };
};
type RelatedCard = Highlightable;
// ======================
// Utils locali per affinare i correlati (no Strapi changes)
// ======================
const STOP_INGREDIENTS = new Set<string>([
  // basi molto comuni
  'vodka',
  'gin',
  'white rum',
  'light rum',
  'rum',
  'dark rum',
  'tequila',
  'whiskey',
  'bourbon',
  'scotch',
  'brandy',
  'cognac',
  // mixer generici
  'soda water',
  'club soda',
  'tonic water',
  'water',
  'ice',
  'crushed ice',
  // agrumi / succhi
  'lemon juice',
  'lime juice',
  'orange juice',
  'pineapple juice',
  'cranberry juice',
  'apple juice',
  // dolcificanti
  'simple syrup',
  'sugar syrup',
  'grenadine',
  'honey',
  'sugar',
  'brown sugar',
  // garnish comuni
  'mint',
  'mint leaves',
  'cherry',
  'maraschino cherry',
  'orange slice',
  'lemon slice',
  'lime slice',
  // bitters generici
  'angostura bitters',
  'bitters',
  // altro molto comune
  'whipped cream',
  'milk',
  'cream',
  'half and half',
  'egg white',
  'coffee',
  'espresso',
]);

function norm(s?: string | null): string {
  return (s || '').toLowerCase().trim();
}

type HasIngredientsList = {
  ingredients_list?: Array<{ ingredient?: { name?: string } }>;
};

function ingredientSet(c: HasIngredientsList): Set<string> {
  const out = new Set<string>();
  (c?.ingredients_list || []).forEach((it) => {
    const n = norm(it?.ingredient?.name);
    if (!n || STOP_INGREDIENTS.has(n)) return;
    out.add(n);
  });
  return out;
}

type WithHighlight<T> = T & {
  matchedIngredientCount?: number;
  primaryHighlight?: { text: string };
};

/**
 * Affina i correlati lato client:
 * - prima tiene quelli con ≥2 ingredienti distintivi in comune
 * - se vuoto, scende a ≥1
 * - ordina per overlap, poi alfabetico
 * - aggiunge un'etichetta (primaryHighlight) senza toccare i template
 */
function refineRelatedByIngredients<T extends HasIngredientsList>(
  current: T,
  candidates: T[],
  limit = 12
): Array<WithHighlight<T>> {
  const cur = ingredientSet(current);
  if (!cur.size || !candidates?.length) return [];

  const scored = candidates.map((c) => {
    const s = ingredientSet(c);
    let shared = 0;
    const reasons: string[] = [];
    s.forEach((n) => {
      if (cur.has(n)) {
        shared++;
        if (reasons.length < 2) reasons.push(n);
      }
    });
    return { c, shared, reasons };
  });

  // soglia adattiva
  let filtered = scored.filter((x) => x.shared >= 2);
  if (!filtered.length) filtered = scored.filter((x) => x.shared >= 1);

  filtered.sort(
    (a, b) =>
      b.shared - a.shared ||
      (norm((a.c as any).name) < norm((b.c as any).name) ? -1 : 1)
  );

  return filtered.slice(0, limit).map(({ c, shared, reasons }) => {
    const label =
      reasons.length >= 2
        ? `Shares ${reasons[0]} + ${reasons[1]}`
        : reasons.length === 1
        ? `Shares ${reasons[0]}`
        : `Good match`;
    return {
      ...(c as any),
      matchedIngredientCount: shared,
      primaryHighlight: { text: label },
    };
  });
}

interface ProductItem {
  title: string;
  imageUrl: string;
  price: string;
  link: string;
  showPlaceholder: boolean;
}

/** Slot pubblicitario per il loop "Related" */
interface AdSlot {
  isAd: true;
  id: string;
  kind: 'square' | 'banner';
}

@Component({
  selector: 'app-cocktail-detail',
  standalone: true,
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
  // ===== Platform / Zone =====
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly ngZone = inject(NgZone);
  private adjacentSub?: Subscription;

  @ViewChild('relatedSentinel') relatedSentinel!: ElementRef;
  private relatedLoaded = false;
  // ===== State =====
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

  /** ✅ Sblocca gli Ad solo quando i dati sono pronti e siamo nel browser */
  contentReady = false;

  /** ✅ Base URL assoluta per canonical/og:url in SSR */
  private siteBaseUrl = '';
  private cocktailSchemaScript: HTMLScriptElement | undefined;

  // ===== WEBP support & helpers =====
  private supportsWebp = false;

  // ===== Refs / listeners =====
  @ViewChild('affiliateCardList') affiliateCardList!: ElementRef;
  private wheelListenerCleanup?: () => void;

  // ===== Subs =====
  private routeSubscription?: Subscription;
  private allCocktailsSubscription?: Subscription;
  private similarCocktailsSubscription?: Subscription;
  private cocktailDetailSubscription?: Subscription;

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

  // ======================
  // Utilities (defer)
  // ======================
  /** Esegue la callback dopo il primo paint, solo in browser */
  private runAfterFirstPaint(cb: () => void): void {
    if (!this.isBrowser) return;
    this.ngZone.runOutsideAngular(() => {
      // rAF garantisce paint; setTimeout 0 sposta fuori dalla rAF
      requestAnimationFrame(() => setTimeout(() => cb(), 0));
    });
  }

  /** Sblocca gli ads dopo il primo paint */
  private unlockAdsWhenStable(): void {
    if (!this.isBrowser) return;
    this.runAfterFirstPaint(() => {
      this.ngZone.run(() => (this.contentReady = true));
    });
  }

  // ===== Lifecycle =====
  ngOnInit(): void {
    // 1) SSR/resolver: abbiamo già il cocktail → render immediato
    const resolved = this.route.snapshot.data['cocktail'] as Cocktail | null;
    if (resolved) {
      this.cocktail = resolved;
      this.loading = false;

      // hero + SEO
      this.heroSrc = this.getPreferred(this.getCocktailHeroUrl(this.cocktail));
      this.heroSrcset = this.getCocktailImageSrcsetPreferred(this.cocktail);
      this.setSeoTagsAndSchema();
      this.loadPrevNextBySlug(this.cocktail.slug);

      // 3) routing reattivo per navigazioni client-side
      this.subscribeToRouteParams(false);
      return;
    }

    // Fallback: nessun resolver → gestisci route subito (CSR/edge cases)
    this.subscribeToRouteParams(true);
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser || !this.affiliateCardList) return;
    const listElement = this.affiliateCardList.nativeElement as HTMLElement;

    // Scorrimento orizzontale con wheel fuori da Angular
    this.ngZone.runOutsideAngular(() => {
      const handler = (event: WheelEvent) => {
        event.preventDefault();
        listElement.scrollLeft += event.deltaY;
      };
      listElement.addEventListener('wheel', handler, { passive: false });
      this.wheelListenerCleanup = () =>
        listElement.removeEventListener('wheel', handler as any);
    });

    if (!this.isBrowser || !this.relatedSentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!this.relatedLoaded && entries.some((e) => e.isIntersecting)) {
          this.relatedLoaded = true;
          this.loadSimilarCocktails();
          io.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(this.relatedSentinel.nativeElement);
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.allCocktailsSubscription?.unsubscribe();
    this.similarCocktailsSubscription?.unsubscribe();
    this.cocktailDetailSubscription?.unsubscribe();
    this.adjacentSub?.unsubscribe();
    if (this.wheelListenerCleanup) this.wheelListenerCleanup();
    this.cleanupSeo();
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
        // la prima navigazione è già stata renderizzata dal resolver
        handleFirst = true;
        return;
      }
      this.loadCocktailDetail(slug);
    });
  }

  /** Avvia le richieste non critiche solo in browser e dopo il paint */
  private kickOffNonCritical(): void {
    if (!this.isBrowser) return;

    // A) Prev/Next: indice ordinato (usa in-memory cache del service)

    // B) Simili
    this.loadSimilarCocktails();

    // C) Articoli correlati
    this.fetchRelatedArticles();

    // D) Ads dopo paint
    this.unlockAdsWhenStable();
  }

  loadCocktailDetail(slug: string): void {
    this.loading = true;
    this.error = null;
    this.similarCocktails = [];
    this.relatedWithAds = [];
    this.contentReady = false; // blocca ads tra una navigazione e l’altra
    this.cleanupSeo();
    // Se abbiamo già l’indice in memoria, prova cache rapida per UX
    const cached = this.allCocktails.find((c) => c.slug === slug);
    if (cached) {
      this.cocktail = cached;
      this.loading = false;

      // hero + SEO
      this.heroSrc = this.getPreferred(this.getCocktailHeroUrl(this.cocktail));
      this.heroSrcset = this.getCocktailImageSrcsetPreferred(this.cocktail);
      this.setSeoTagsAndSchema();

      this.loadPrevNextBySlug(this.cocktail.slug);

      // non critiche, ma sempre deferite (browser)
      this.runAfterFirstPaint(() => this.kickOffNonCritical());
      return;
    }

    // Dettaglio dall’API
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
          //this.fetchAllCocktailsIndex();
          this.setNavigationCocktails(this.cocktail.external_id);
          this.loading = false;

          // hero + SEO
          this.heroSrc = this.getPreferred(
            this.getCocktailHeroUrl(this.cocktail)
          );
          this.heroSrcset = this.getCocktailImageSrcsetPreferred(this.cocktail);
          this.setSeoTagsAndSchema();

          // prev/next: se abbiamo già l’elenco lo aggiorniamo subito,
          // altrimenti lo calcoleremo quando l’indice arriva
          this.loadPrevNextBySlug(this.cocktail.slug);

          // non critiche deferite
          this.runAfterFirstPaint(() => this.kickOffNonCritical());
        },
        error: () => {
          this.error = 'Could not load cocktail details from API.';
          this.loading = false;
          this.contentReady = false;
        },
      });
  }

  loadSimilarCocktails(): void {
    if (!this.isBrowser || !this.cocktail) {
      this.similarCocktails = [];
      this.relatedWithAds = [];
      return;
    }

    const LIMIT = 21;
    const Q_PRIMARY = 9;
    const Q_SECONDARY = 5;

    const norm = (s?: string | null) => (s || '').toLowerCase().trim();
    const hasIng = (c: Cocktail, name: string) =>
      (c.ingredients_list || []).some(
        (it: any) => norm(it?.ingredient?.name) === norm(name)
      );

    const currentId = this.cocktail.id;
    const primaryName =
      this.cocktail.ingredients_list?.[0]?.ingredient?.name || null;
    const primaryId =
      this.cocktail.ingredients_list?.[0]?.ingredient?.external_id || null;
    const secondaryName =
      this.cocktail.ingredients_list?.[1]?.ingredient?.name || null;
    const secondaryId =
      this.cocktail.ingredients_list?.[1]?.ingredient?.external_id || null;

    const base$ = this.cocktailService.getSimilarCocktails(this.cocktail);
    const prim$ = primaryId
      ? this.cocktailService.getRelatedCocktailsForIngredient(primaryId)
      : of([]);
    const sec$ = secondaryId
      ? this.cocktailService.getRelatedCocktailsForIngredient(secondaryId)
      : of([]);

    this.similarCocktailsSubscription = forkJoin([
      base$,
      prim$,
      sec$,
    ]).subscribe({
      next: ([baseList, primList, secList]) => {
        const used = new Set<number>();
        const out: Highlightable[] = [];

        const push = (c: Cocktail | Highlightable, tag?: string) => {
          if (!c || c.id === currentId) return false;
          if (used.has(c.id)) return false;
          if (out.length >= LIMIT) return false;

          // Short pill (chip) for the UI
          const existing = (c as Highlightable).primaryHighlight;
          const pill = tag
            ? { text: `With ${tag}` }
            : existing || { text: 'Suggested match' };

          // Style reasons to inform the richer motto
          const styleReasons: string[] = [];
          if (
            this.cocktail?.preparation_type &&
            c.preparation_type === this.cocktail.preparation_type
          )
            styleReasons.push(c.preparation_type!);
          if (this.cocktail?.glass && c.glass === this.cocktail.glass)
            styleReasons.push(c.glass!);
          if (this.cocktail?.category && c.category === this.cocktail.category)
            styleReasons.push(c.category!);

          // Friendly, American-English motto for the card’s top line
          const motto = this.makeFriendlyMotto(this.cocktail!, c as Cocktail, {
            tagIngredient: tag || null,
            styleReasons,
          });

          const enriched = { ...(c as any) } as Highlightable & {
            matchLabel?: string;
            matchReason?: string;
            similarityMeta?: any;
          };

          enriched.primaryHighlight = pill; // pill/label (short)
          enriched.matchLabel = pill.text; // legacy support
          enriched.matchReason = pill.text; // legacy support
          enriched.similarityMeta = {
            ...(enriched.similarityMeta || {}),
            motto, // <-- card reads this (displayMotto)
          };

          out.push(enriched);
          used.add(enriched.id);
          return true;
        };

        // 1) 9 dal PRIMO ingrediente
        if (primaryName && primList?.length) {
          for (const c of primList as Cocktail[]) {
            if (out.length >= LIMIT) break;
            if (hasIng(c, primaryName)) push(c, primaryName);
            if (
              out.filter((x) => hasIng(x as Cocktail, primaryName)).length >=
              Q_PRIMARY
            )
              break;
          }
        }

        // 2) 5 dal SECONDO ingrediente
        if (secondaryName && secList?.length) {
          for (const c of secList as Cocktail[]) {
            if (out.length >= LIMIT) break;
            if (hasIng(c, secondaryName)) push(c, secondaryName);
            if (
              out.filter((x) => hasIng(x as Cocktail, secondaryName)).length >=
              Q_SECONDARY
            )
              break;
          }
        }

        // 3) Riempi col “base” già rankato (ingredienti/stile/abv…)
        const baseRanked = (baseList as CocktailWithLayoutAndMatch[]) ?? [];
        for (const c of baseRanked) {
          if (out.length >= LIMIT) break;

          const reasons: string[] = [];
          if (
            this.cocktail?.preparation_type &&
            c.preparation_type === this.cocktail.preparation_type
          )
            reasons.push(c.preparation_type!);
          if (this.cocktail?.glass && c.glass === this?.cocktail.glass)
            reasons.push(c.glass!);
          if (this.cocktail?.category && c.category === this.cocktail?.category)
            reasons.push(c.category!);

          const label = reasons.length
            ? { text: reasons.slice(0, 2).join(' · ') }
            : undefined;
          if (!used.has(c.id))
            push({ ...(c as any), primaryHighlight: label } as Highlightable);
        }

        // 4) Fallback: ricicla prim/sec
        if (out.length < LIMIT) {
          for (const c of primList as Cocktail[]) {
            if (out.length >= LIMIT) break;
            push(c, primaryName || undefined);
          }
        }
        if (out.length < LIMIT) {
          for (const c of secList as Cocktail[]) {
            if (out.length >= LIMIT) break;
            push(c, secondaryName || undefined);
          }
        }
        // 🔀 MIX: 2 dal primario, 1 dal base, 1 dal secondario, poi ripeti + riempi con resto
        const isPrim = (x: Highlightable) =>
          primaryName ? hasIng(x as Cocktail, primaryName) : false;
        const isSec = (x: Highlightable) =>
          secondaryName ? hasIng(x as Cocktail, secondaryName) : false;

        const primArr = out.filter(isPrim);
        const secArr = out.filter((x) => !isPrim(x) && isSec(x)); // evita duplicati tra prim/sec
        const baseArr = out.filter((x) => !isPrim(x) && !isSec(x)); // tutto il resto (base + filler)

        const mixed: Highlightable[] = [];
        const take = (arr: Highlightable[]) =>
          arr.length ? mixed.push(arr.shift()!) : null;

        // ciclo finché abbiamo roba e non superiamo LIMIT
        while (
          mixed.length < LIMIT &&
          (primArr.length || baseArr.length || secArr.length)
        ) {
          take(primArr);
          if (mixed.length >= LIMIT) break;

          take(baseArr);
          if (mixed.length >= LIMIT) break;

          take(primArr);
          if (mixed.length >= LIMIT) break;

          take(secArr);
          if (mixed.length >= LIMIT) break;

          // spezia con un altro base se c’è
          take(baseArr);
        }

        // se avanza spazio, svuota in ordine residuo
        [primArr, baseArr, secArr].forEach((arr) => {
          while (mixed.length < LIMIT && arr.length) take(arr);
        });

        // dedup by id (paranoia) e taglio
        const seenIds = new Set<number>();
        const finalList = mixed.filter((x) =>
          seenIds.has(x.id) ? false : (seenIds.add(x.id), true)
        );

        this.similarCocktails = finalList.slice(0, LIMIT);
        this.buildRelatedWithAds();
      },
      error: () => {
        this.similarCocktails = [];
        this.relatedWithAds = [];
      },
    });
  }

  /** Intercala un ad ogni N card, evitando ad in coda, con id stabili */
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

  /** trackBy per misto card/ad (id stabili) */
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

  // --- URL assoluti immagine cocktail/ingredienti (originali) ---
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

  /** URL thumbnail per miniature nav: thumbnail → small → original */
  getCocktailThumbUrl(cocktail?: Cocktail): string {
    const img: any = cocktail?.image;
    if (!img) return 'assets/no-image.png';

    const abs = (u?: string | null) =>
      u ? (u.startsWith('http') ? u : env.apiUrl + u) : '';

    if (img?.formats?.thumbnail?.url) return abs(img.formats.thumbnail.url); // ~150w
    if (img?.formats?.small?.url) return abs(img.formats.small.url); // ~320w
    if (img?.url) return abs(img.url); // fallback
    return 'assets/no-image.png';
  }

  // --- Preferenze WebP + fallback ---
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
    if (url.startsWith('assets/')) return url; // non toccare placeholder locali
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
        if (!m?.groups) return entry; // fallback safe
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

    // canonical
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

    // OG / Twitter
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

    // Rimuovi eventuale preload precedente
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

  /** Scarica tutto l’indice cocktail paginando lato client (rispetta il maxPageSize di Strapi) 
  private fetchAllCocktailsIndex(): void {
    const PAGE_SIZE = 100;
    const collected: Cocktail[] = [];

    this.indexReady = false;

    const first$ = this.cocktailService.getCocktails(
      1,
      PAGE_SIZE,
      undefined,
      undefined,
      undefined,
      true, // sort=slug:asc
      false
    );

    this.allCocktailsSubscription = first$.subscribe({
      next: (firstResp) => {
        const pageData: Cocktail[] = firstResp?.data || [];
        collected.push(...pageData);

        const totalPages = firstResp?.meta?.pagination?.pageCount || 1;

        // Caso 1 pagina: già pronto
        if (totalPages <= 1) {
          this.allCocktails = collected.slice(); // già ordinati dal backend
          this.indexReady = true;
          if (this.cocktail)
            this.setNavigationCocktails(this.cocktail.external_id);
          return;
        }

        // Catena sequenziale 2..N
        let chain$ = of(null as unknown);
        for (let p = 2; p <= totalPages; p++) {
          chain$ = (chain$ as Observable<unknown>).pipe(
            concatMap(() =>
              this.cocktailService.getCocktails(
                p,
                PAGE_SIZE,
                undefined,
                undefined,
                undefined,
                true, // sort=slug:asc
                false
              )
            )
          );
        }

        this.allCocktailsSubscription?.add(
          (chain$ as Observable<any>).subscribe({
            next: (resp) => {
              if (resp?.data) collected.push(...(resp.data as Cocktail[]));
            },
            complete: () => {
              this.allCocktails = collected; // già in ordine
              this.indexReady = true;
              if (this.cocktail)
                this.setNavigationCocktails(this.cocktail.external_id);
            },
            error: () => {
              this.allCocktails = collected; // usa parziale ma sblocca
              this.indexReady = true;
              if (this.cocktail)
                this.setNavigationCocktails(this.cocktail.external_id);
            },
          })
        );
      },
      error: () => {
        // Non bloccare la UI
        this.indexReady = true;
        // opz.: this.error = 'Could not load all cocktails for navigation.';
      },
    });
  }
*/
  /** Tipi pubblicitari centralizzati */
  getTopAdType(): 'mobile-banner' | 'leaderboard' {
    return this.isMobile ? 'mobile-banner' : 'leaderboard';
  }
  getBottomAdType(): 'mobile-banner' | 'leaderboard' {
    return this.isMobile ? 'mobile-banner' : 'leaderboard';
  }
  /** Nel loop related: mobile=mobile-banner, desktop=square */
  getLoopAdType(): 'mobile-banner' | 'square' {
    return this.isMobile ? 'mobile-banner' : 'square';
  }

  /** Classe slot: aggiunge la classe specifica per width fissa in CSS */
  adSlotClass(type: string): string {
    return `ad-slot ${type}`;
  }

  private loadPrevNextBySlug(slug: string): void {
    if (!slug) return;
    this.indexReady = false; // usiamo lo stesso flag per sbloccare la UI quando pronto

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

  // -- STOP set "snello" per non contare ingredienti troppo generici --
  private static readonly STOP = new Set([
    'vodka',
    'gin',
    'rum',
    'white rum',
    'light rum',
    'dark rum',
    'tequila',
    'whiskey',
    'whisky',
    'bourbon',
    'scotch',
    'lemon juice',
    'lime juice',
    'simple syrup',
    'sugar',
    'sugar syrup',
    'soda water',
    'club soda',
    'water',
    'ice',
    'orange juice',
  ]);

  private norm(s?: string | null) {
    return (s || '').toLowerCase().trim();
  }

  private distinctivesOf(c: Cocktail): string[] {
    const seen = new Set<string>();
    const firstTwo: string[] = [];
    const others: string[] = [];

    const pushIfNew = (name?: string | null, force = false) => {
      const n = this.norm(name);
      if (!n || seen.has(n)) return;
      if (force || !CocktailDetailComponent.STOP.has(n)) {
        seen.add(n);
        if (force) firstTwo.push(n);
        else others.push(n);
      }
    };

    const list = c?.ingredients_list || [];
    // 1) prendi SEMPRE i primi 2 ingredienti (forzati)
    for (let i = 0; i < Math.min(2, list.length); i++) {
      pushIfNew(list[i]?.ingredient?.name, true);
    }
    // 2) poi aggiungi gli altri (escludendo STOP)
    for (let i = 2; i < list.length; i++) {
      pushIfNew(list[i]?.ingredient?.name, false);
    }

    return [...firstTwo, ...others];
  }

  private countSharedWithSource(c: Cocktail, srcSet: Set<string>): number {
    let k = 0;
    (c?.ingredients_list || []).forEach((it: any) => {
      const n = this.norm(it?.ingredient?.name);
      if (n && srcSet.has(n)) k++;
    });
    return k;
  }

  private firstSharedKey(
    c: Cocktail,
    srcOrder: string[], // lista sorgente ordinata per priorità (1°, 2°, 3°...)
    srcSet: Set<string>
  ): string | null {
    // restituisce il "primo" ingrediente condiviso in base all'ordine del cocktail sorgente
    for (const key of srcOrder) {
      const has = (c?.ingredients_list || []).some(
        (it: any) => this.norm(it?.ingredient?.name) === key
      );
      if (has) return key;
    }
    return null;
  }
  // helper: applica un'etichetta se manca
  private setLabel(c: Highlightable, text: string) {
    if (!c.primaryHighlight?.text) c.primaryHighlight = { text };
  }

  // shuffle deterministica (semplificata) per non avere file incolonnati
  private seededShuffle<T>(arr: T[], seedStr: string): T[] {
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++)
      seed = (seed * 31 + seedStr.charCodeAt(i)) | 0;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      seed = (seed * 1664525 + 1013904223) | 0;
      const j = Math.abs(seed) % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private rebalanceByIngredient(
    ranked: Highlightable[],
    limit: number
  ): Highlightable[] {
    if (!this.cocktail) return ranked.slice(0, limit);

    // 1) distintivi in ordine (1°, 2°, 3°...)
    const srcOrder = this.distinctivesOf(this.cocktail);
    const srcSet = new Set(srcOrder);
    const first = srcOrder[0] || null;
    const second = srcOrder[1] || null;

    // 2) split strong / weak / filler
    const strong: Highlightable[] = [];
    const weak: Highlightable[] = [];
    const filler: Highlightable[] = [];

    ranked.forEach((c) => {
      const shared = this.countSharedWithSource(c, srcSet);
      if (shared >= 2) strong.push(c);
      else if (shared === 1) weak.push(c);
      else filler.push(c);
    });

    // 3) bucket deboli per ingrediente condiviso (rispettando priorità 1°, 2°, …)
    const buckets = new Map<string, Highlightable[]>();
    const pickKey = (c: Highlightable): string | null => {
      for (const k of srcOrder) {
        if (
          (c.ingredients_list || []).some(
            (it) => this.norm(it?.ingredient?.name) === k
          )
        )
          return k;
      }
      return null;
    };
    weak.forEach((c) => {
      const k = pickKey(c);
      if (!k) return;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(c);
    });

    // 4) shuffle leggero per evitare “fiumi di gin”
    const seed = this.cocktail.slug || String(this.cocktail.id || '');
    if (first && buckets.get(first))
      buckets.set(first, this.seededShuffle(buckets.get(first)!, seed + '|1'));
    if (second && buckets.get(second))
      buckets.set(
        second,
        this.seededShuffle(buckets.get(second)!, seed + '|2')
      );
    for (let i = 2; i < srcOrder.length; i++) {
      const k = srcOrder[i];
      if (buckets.get(k))
        buckets.set(
          k,
          this.seededShuffle(buckets.get(k)!, seed + '|' + (i + 1))
        );
    }
    const fillerShuffled = this.seededShuffle(filler, seed + '|F');

    const out: Highlightable[] = [];
    const used = new Set<number>();
    const push = (c: Highlightable) => {
      if (!used.has(c.id)) {
        out.push(c);
        used.add(c.id);
      }
    };

    // 5) prima i forti (≥2 ingredienti)
    for (const c of strong) {
      if (out.length >= limit) break;
      if (!c.primaryHighlight?.text) this.setLabel(c, 'Shares 2+ ingredients');
      push(c);
    }
    if (out.length >= limit) return out.slice(0, limit);

    // 6) round-robin 2:1 tra primo e secondo ingrediente
    const takeFrom = (key: string | null): boolean => {
      if (!key) return false;
      const arr = buckets.get(key);
      if (!arr?.length) return false;
      while (arr.length) {
        const c = arr.shift()!;
        if (used.has(c.id)) continue;
        this.setLabel(c, `Shares ${key}`);
        push(c);
        return true;
      }
      return false;
    };

    let picksSinceBreak = 0;
    while (
      out.length < limit &&
      (buckets.get(first || '')?.length || buckets.get(second || '')?.length)
    ) {
      if (takeFrom(first)) {
        picksSinceBreak++;
        if (out.length >= limit) break;
      }
      if (takeFrom(first)) {
        picksSinceBreak++;
        if (out.length >= limit) break;
      }
      if (takeFrom(second)) {
        picksSinceBreak++;
        if (out.length >= limit) break;
      }

      if (picksSinceBreak >= 3 && out.length < limit && fillerShuffled.length) {
        const f = fillerShuffled.shift()!;
        const reasons: string[] = [];
        if (
          this.cocktail.preparation_type &&
          f.preparation_type === this.cocktail.preparation_type
        )
          reasons.push(f.preparation_type!);
        if (this.cocktail.glass && f.glass === this.cocktail.glass)
          reasons.push(f.glass!);
        if (this.cocktail.category && f.category === this.cocktail.category)
          reasons.push(f.category!);
        if (reasons.length) this.setLabel(f, reasons.slice(0, 2).join(' · '));
        push(f);
        picksSinceBreak = 0;
      }
    }

    // 7) altri ingredienti (3°, 4°, …)
    for (let i = 2; i < srcOrder.length && out.length < limit; i++) {
      const k = srcOrder[i];
      const arr = buckets.get(k) || [];
      while (arr.length && out.length < limit) {
        const c = arr.shift()!;
        if (used.has(c.id)) continue;
        this.setLabel(c, `Shares ${k}`);
        push(c);
      }
    }

    // 8) riempi con filler
    while (out.length < limit && fillerShuffled.length) {
      const f = fillerShuffled.shift()!;
      if (used.has(f.id)) continue;
      const reasons: string[] = [];
      if (
        this.cocktail.preparation_type &&
        f.preparation_type === this.cocktail.preparation_type
      )
        reasons.push(f.preparation_type!);
      if (this.cocktail.glass && f.glass === this.cocktail.glass)
        reasons.push(f.glass!);
      if (this.cocktail.category && f.category === this.cocktail.category)
        reasons.push(f.category!);
      if (reasons.length) this.setLabel(f, reasons.slice(0, 2).join(' · '));
      push(f);
    }

    return out.slice(0, limit);
  }

  /** Genera un motto friendly/SEO per la card in base al motivo di correlazione */
  /** US-English, concise & editorial-friendly motto generator */
  private makeFriendlyMotto(
    source: Cocktail,
    candidate: Cocktail,
    opts?: {
      tagIngredient?: string | null;
      styleReasons?: string[];
    }
  ): string {
    const seed = (candidate.slug || String(candidate.id || '')).toLowerCase();
    const pick = (arr: string[]) => {
      let h = 0;
      for (let i = 0; i < seed.length; i++)
        h = (h * 31 + seed.charCodeAt(i)) | 0;
      return arr[Math.abs(h) % arr.length];
    };

    const name = candidate.name || 'This cocktail';
    const cat = (candidate.category || 'cocktail').toLowerCase();
    const meth = candidate.preparation_type || '';
    const glass = candidate.glass || '';
    const ingr = (candidate.ingredients_list || [])
      .map((i) => (i?.ingredient?.name || '').trim())
      .filter(Boolean);

    const service: string[] = [];
    if (meth) service.push(meth[0].toUpperCase() + meth.slice(1));
    if (glass) service.push(glass.toLowerCase());
    const serviceText = service.join(' · ');
    const twoKeyIngr = ingr.slice(0, 2).join(' + ');

    // 1) Ingredient-driven
    if (opts?.tagIngredient) {
      const tag = opts.tagIngredient;
      return pick([
        `Features ${tag} with a refined balance.`,
        `Built around ${tag}, subtle yet distinctive.`,
        `Highlights ${tag} in a classic style.`,
        `A ${cat} centered on ${tag}.`,
      ]);
    }

    // 2) Style-driven (method/glass/category)
    if (opts?.styleReasons?.length) {
      const style = opts.styleReasons.slice(0, 2).join(' · ');
      return pick([
        `Shares the same ${style} profile.`,
        `Similar ${style} composition.`,
        `Aligned in ${style} style.`,
        `Comparable build and presentation.`,
      ]);
    }

    // 3) Fallback with brief flavor tone
    if (twoKeyIngr) {
      return pick([
        `${twoKeyIngr} — a balanced ${cat}.`,
        `${twoKeyIngr}, refined and harmonious.`,
        `${twoKeyIngr} for a modern ${cat}.`,
        `Clean ${cat} built on ${twoKeyIngr}.`,
      ]);
    }

    // 4) Neutral fallback
    return pick([
      `A related ${cat} in similar style.`,
      `Another classic within the same family.`,
      `Comparable drink with matching character.`,
    ]);
  }
}
