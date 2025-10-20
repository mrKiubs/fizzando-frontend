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
import { MatIconModule } from '@angular/material/icon';
import { forkJoin, Observable, of, Subscription } from 'rxjs';
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
  private adjacentSub?: Subscription;

  // route-anim (emesso da AppComponent)
  routeAnimating = false;
  private routeAnimUnsub?: () => void;

  @ViewChild('relatedSentinel') relatedSentinel!: ElementRef;
  private relatedLoaded = false;

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

  contentReady = false; // sblocca ads solo quando tutto ok

  private siteBaseUrl = '';
  private cocktailSchemaScript: HTMLScriptElement | undefined;

  private supportsWebp = false;

  @ViewChild('affiliateCardList') affiliateCardList!: ElementRef;
  private wheelListenerCleanup?: () => void;

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

  // utils (defer)
  private runAfterFirstPaint(cb: () => void): void {
    if (!this.isBrowser) return;
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => setTimeout(() => cb(), 0));
    });
  }
  private unlockAdsWhenStable(): void {
    if (!this.isBrowser) return;
    this.runAfterFirstPaint(() => {
      this.ngZone.run(() => (this.contentReady = true));
    });
  }

  // ===== Lifecycle =====
  ngOnInit(): void {
    // ascolta lo stato animazione pagina
    if (this.isBrowser) {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent<boolean>).detail;
        this.routeAnimating = !!detail;
      };
      window.addEventListener('route-anim', handler as EventListener);
      this.routeAnimUnsub = () =>
        window.removeEventListener('route-anim', handler as EventListener);
    }

    // resolver SSR
    const resolved = this.route.snapshot.data['cocktail'] as Cocktail | null;
    if (resolved) {
      this.cocktail = resolved;
      this.loading = false;

      this.heroSrc = this.getPreferred(this.getCocktailHeroUrl(this.cocktail));
      this.heroSrcset = this.getCocktailImageSrcsetPreferred(this.cocktail);
      this.setSeoTagsAndSchema();
      this.loadPrevNextBySlug(this.cocktail.slug);

      this.subscribeToRouteParams(false);
      return;
    }

    // fallback CSR
    this.subscribeToRouteParams(true);
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser || !this.affiliateCardList) return;
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
    if (this.routeAnimUnsub) this.routeAnimUnsub();
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
        handleFirst = true;
        return;
      }
      this.loadCocktailDetail(slug);
    });
  }

  private kickOffNonCritical(): void {
    if (!this.isBrowser) return;
    this.loadSimilarCocktails();
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
          this.setNavigationCocktails(this.cocktail.external_id);
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

          const existing = (c as Highlightable).primaryHighlight;
          const pill = tag
            ? { text: `With ${tag}` }
            : existing || { text: 'Suggested match' };

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

          const motto = this.makeFriendlyMotto(this.cocktail!, c as Cocktail, {
            tagIngredient: tag || null,
            styleReasons,
          });

          const enriched = { ...(c as any) } as Highlightable & {
            matchLabel?: string;
            matchReason?: string;
            similarityMeta?: any;
          };

          enriched.primaryHighlight = pill;
          enriched.matchLabel = pill.text;
          enriched.matchReason = pill.text;
          enriched.similarityMeta = {
            ...(enriched.similarityMeta || {}),
            motto,
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

        // 3) Riempi col base
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

        // 4) Fallback
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

        // Mix 2:1 prim/base/sec
        const isPrim = (x: Highlightable) =>
          primaryName ? hasIng(x as Cocktail, primaryName) : false;
        const isSec = (x: Highlightable) =>
          secondaryName ? hasIng(x as Cocktail, secondaryName) : false;

        const primArr = out.filter(isPrim);
        const secArr = out.filter((x) => !isPrim(x) && isSec(x));
        const baseArr = out.filter((x) => !isPrim(x) && !isSec(x));

        const mixed: Highlightable[] = [];
        const take = (arr: Highlightable[]) =>
          arr.length ? mixed.push(arr.shift()!) : null;

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
          take(baseArr);
        }

        [primArr, baseArr, secArr].forEach((arr) => {
          while (mixed.length < LIMIT && arr.length) take(arr);
        });

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

  // ====== AD helpers (mancavano) ======
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

  // ====== Prev/Next by slug (mancava) ======
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
