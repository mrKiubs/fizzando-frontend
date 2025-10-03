import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  Renderer2,
  inject,
  PLATFORM_ID,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ApplicationRef,
  NgZone,
  AfterViewInit,
  ElementRef,
  ViewChild,
} from '@angular/core';
import {
  CommonModule,
  isPlatformBrowser,
  DOCUMENT,
  NgOptimizedImage,
} from '@angular/common';
import { Router } from '@angular/router';

import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { forkJoin, Subscription, of } from 'rxjs';
import { DatePipe } from '@angular/common';
import { catchError, finalize, tap, filter, take } from 'rxjs/operators';
import { env } from '../config/env';
import { Meta, Title } from '@angular/platform-browser';
import { HttpClient, HttpParams } from '@angular/common/http';
// ✅ TransferState/makeStateKey stanno in @angular/core su Angular 18/19
import { makeStateKey, TransferState } from '@angular/core';

// Services & types
import {
  CocktailService,
  Cocktail,
  StrapiImage,
  CocktailWithLayoutAndMatch,
} from '../services/strapi.service';
import { IngredientService, Ingredient } from '../services/ingredient.service';
import { GlossaryCardComponent } from '../glossary/glossary-card/glossary-card.component';
import { GlossaryTerm } from '../services/glossary.service';

// Cards
import { CocktailCardComponent } from '../cocktails/cocktail-card/cocktail-card.component';
import { IngredientCardComponent } from '../ingredients/ingredient-card/ingredient-card.component';
import { DevAdsComponent } from '../assets/design-system/dev-ads/dev-ads.component';
import { LogoComponent } from '../assets/design-system/logo/logo.component';
import { ConfettiBurstComponent } from '../assets/design-system/confetti-burst/confetti-burst.component';

interface StrapiGlossaryResponse {
  data: Array<{
    id: number;
    attributes?: {
      term?: string;
      slug?: string;
      category?: string;
      description?: string;
    };
  }>;
  meta: {
    pagination: {
      total: number;
      page: number;
      pageSize: number;
      pageCount: number;
    };
  };
}

// ===== Tipi per TransferState =====
type DashboardPayload = {
  cocktailsResponse: any;
  ingredientsResponse: any;
  glossaryResponse: StrapiGlossaryResponse;
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    RouterLink,
    CocktailCardComponent,
    IngredientCardComponent,
    GlossaryCardComponent,
    DatePipe,
    DevAdsComponent,
    NgOptimizedImage,
    LogoComponent,
    ConfettiBurstComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit, OnDestroy, AfterViewInit {
  // ===== DATA =====
  allCocktails: Cocktail[] = [];
  featuredCocktails: CocktailWithLayoutAndMatch[] = [];
  latestCocktails: CocktailWithLayoutAndMatch[] = [];
  randomCocktail?: CocktailWithLayoutAndMatch;

  latestIngredients: Ingredient[] = [];

  categoriesCount: Record<string, number> = {};
  topCocktailCategories: string[] = [];

  randomGlossaryTerms: GlossaryTerm[] = [];

  totalCocktails = 0;
  loading = true;
  error: string | null = null;

  // ===== PLATFORM / CD =====
  private platformId: Object = inject(PLATFORM_ID);
  private readonly isBrowser: boolean = isPlatformBrowser(this.platformId);
  private cdr = inject(ChangeDetectorRef);
  private renderer: Renderer2 = inject(Renderer2);
  private doc: Document = inject(DOCUMENT);
  private appRef = inject(ApplicationRef);
  private zone = inject(NgZone);

  // ===== SERVICES =====
  private cocktailService = inject(CocktailService);
  private ingredientService = inject(IngredientService);
  private http = inject(HttpClient);
  private meta = inject(Meta);
  private title = inject(Title);

  // ===== TransferState (anti-flicker SSR → client) =====
  private state = inject(TransferState);
  private readonly DASHBOARD_DATA =
    makeStateKey<DashboardPayload>('dashboard-data-v2');

  // ===== VIEW / RESPONSIVE =====
  isMobile = false;
  @ViewChild('carouselRoot', { static: false })
  carouselRoot?: ElementRef<HTMLElement>;

  // SEO helpers
  private websiteScript?: HTMLScriptElement;
  private webpageScript?: HTMLScriptElement;
  private breadcrumbsScript?: HTMLScriptElement;

  // Preload handle per random LCP
  private preloadRandomLink?: HTMLLinkElement;

  // Subscriptions
  private dataSubscription?: Subscription;

  private preconnectAdded = false;
  private addPreconnectToBackendOnce(): void {
    if (!this.isBrowser || this.preconnectAdded) return;
    try {
      const href = (env.apiUrl || '').replace(/\/$/, '');
      if (!href) return;
      const link = this.renderer.createElement('link') as HTMLLinkElement;
      this.renderer.setAttribute(link, 'rel', 'preconnect');
      this.renderer.setAttribute(link, 'href', href);
      this.renderer.setAttribute(link, 'crossorigin', '');
      this.renderer.appendChild(this.doc.head, link);
      this.preconnectAdded = true;
    } catch {}
  }
  // ===== Ads gating (SSR-safe) =====
  /** Mostra gli Ad solo quando i dati sono pronti e siamo nel browser */
  contentReady = false;

  @ViewChild(ConfettiBurstComponent) confetti?: ConfettiBurstComponent;
  @ViewChild('cotdBox', { static: false }) cotdBox?: ElementRef<HTMLElement>; // 👈 nuovo
  private cotdIO?: IntersectionObserver; // 👈 nuovo
  private cotdLastBurst = 0;
  constructor(private router: Router) {
    if (this.isBrowser) this.checkScreenWidth();
  }

  @HostListener('window:resize')
  onResize() {
    if (this.isBrowser) this.checkScreenWidth();
  }

  private checkScreenWidth() {
    try {
      this.isMobile = window.innerWidth <= 600;
    } catch {
      this.isMobile = false;
    }
  }

  ngOnInit() {
    this.loadDashboardData();
    this.applySeo();

    if (this.isBrowser) {
      this.isMobile = window.matchMedia('(max-width: 768px)').matches;
      this.addPreconnectToBackendOnce();
    }
  }

  ngAfterViewInit(): void {
    // Avvia autoplay solo quando l'app è stabile (fix NG0506)
    this.appRef.isStable.pipe(filter(Boolean), take(1)).subscribe(() => {
      if (!this.isBrowser) return;
      this.setupCarouselVisibilityObserver();
      this.startAutoplay(); // parte fuori da Angular
      this.setupCotdObserver();
    });
  }

  ngOnDestroy(): void {
    this.stopAutoplay();
    this.carouselObserver?.disconnect();
    this.dataSubscription?.unsubscribe();
    this.cleanupSeo();
    //this.removeRandomImagePreload();
    this.cotdIO?.disconnect();
  }

  // ======== helpers ========
  private sampleArray<T>(arr: T[], count: number): T[] {
    if (!Array.isArray(arr) || arr.length === 0) return [];
    if (count >= arr.length) return [...arr];
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, count);
  }

  // ✅ random deterministico → stessa scelta su SSR e client
  private hash(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  private pickDeterministic<T>(arr: T[], seed: string): T | undefined {
    if (!arr?.length) return undefined;
    return arr[this.hash(seed) % arr.length];
  }

  // ======== Load ========
  loadDashboardData(): void {
    this.loading = true;
    this.error = null;

    // 1) lato client: se SSR ha già popolato TransferState → niente refetch, niente rimbalzo
    const cached = this.state.hasKey(this.DASHBOARD_DATA)
      ? this.state.get(this.DASHBOARD_DATA, {} as DashboardPayload)
      : null;

    if (cached) {
      this.hydrateFromData(cached);
      return this.finishLoad();
    }

    // 2) nessuna cache → fetch come prima
    const ING_POOL = 32;
    const GLO_POOL = 40;

    const baseUrl = (env.apiUrl || '').replace(/\/$/, '');
    const glossaryUrl = `${baseUrl}/api/glossary-terms`;

    const glossaryParams = new HttpParams()
      .set('pagination[pageSize]', String(GLO_POOL))
      .set('fields[0]', 'term')
      .set('fields[1]', 'slug')
      .set('fields[2]', 'category')
      .set('fields[3]', 'description')
      .set('sort', 'term:asc');

    this.dataSubscription = forkJoin({
      cocktailsResponse: this.cocktailService.getCocktails(
        1,
        200,
        undefined,
        undefined,
        undefined,
        true,
        false
      ),
      ingredientsResponse: this.ingredientService.getIngredients(
        1,
        ING_POOL,
        undefined,
        undefined,
        undefined,
        true,
        false
      ),
      glossaryResponse: this.http
        .get<StrapiGlossaryResponse>(glossaryUrl, { params: glossaryParams })
        .pipe(
          catchError((err) => {
            console.error('Glossary fetch error (dashboard):', err);
            return of<StrapiGlossaryResponse>({
              data: [],
              meta: {
                pagination: { total: 0, page: 1, pageSize: 0, pageCount: 0 },
              },
            });
          })
        ),
    })
      .pipe(
        tap((payload) => {
          // ✅ salviamo in TransferState **solo lato server** (così il client lo riusa in hydration)
          if (!this.isBrowser) {
            this.state.set(this.DASHBOARD_DATA, payload as DashboardPayload);
          }
          this.hydrateFromData(payload as DashboardPayload);
        }),
        catchError((err) => {
          console.error('Dashboard load error:', err);
          this.error = 'Unable to load dashboard data. Please try again later.';
          return of(null);
        }),
        finalize(() => {
          this.finishLoad();
        })
      )
      .subscribe();
  }

  private hydrateFromData({
    cocktailsResponse,
    ingredientsResponse,
    glossaryResponse,
  }: DashboardPayload): void {
    // === COCKTAILS ===
    this.allCocktails = cocktailsResponse?.data ?? [];
    this.totalCocktails =
      cocktailsResponse?.meta?.pagination?.total ?? this.allCocktails.length;

    // ✅ Random cocktail deterministico giornaliero (niente rimbalzo)
    if (this.allCocktails.length > 0) {
      const seed = 'home-' + new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
      const picked = this.pickDeterministic(this.allCocktails, seed);
      if (picked) {
        this.randomCocktail = {
          ...picked,
          isTall: false,
          isWide: false,
        };
        // Preload (browser-side, ok così)
        //const preloadUrl = this.getBestImageUrl(this.randomCocktail.image, 360);
        //this.addRandomImagePreload(preloadUrl);
      }
    }

    // Featured (random 8)
    this.featuredCocktails = this.sampleArray(this.allCocktails, 8).map(
      (c) => ({
        ...c,
        isTall: false,
        isWide: false,
      })
    );

    // Latest
    this.latestCocktails = [...this.allCocktails]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 10)
      .map((c) => ({ ...c, isTall: false, isWide: false }));

    // Categories → top chip
    this.categoriesCount = this.allCocktails.reduce((acc, cocktail) => {
      const cat = (cocktail.category || 'Unknown').trim();
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    this.topCocktailCategories = Object.entries(this.categoriesCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name]) => name);

    // INGREDIENTS (random 8)
    const ingPool = ingredientsResponse?.data ?? [];
    this.latestIngredients = this.sampleArray(ingPool, 8);

    // GLOSSARY (random 4)
    const mappedGlossary: GlossaryTerm[] = (glossaryResponse?.data ?? []).map(
      (item: any) => ({
        id: item.id,
        term: item.attributes?.term ?? item.term ?? 'No Term Provided',
        slug: item.attributes?.slug ?? item.slug ?? '',
        category: item.attributes?.category ?? item.category ?? 'Uncategorized',
        description:
          item.attributes?.description ??
          item.description ??
          'No description provided.',
      })
    );
    this.randomGlossaryTerms = this.sampleArray(mappedGlossary, 4);
  }

  private finishLoad(): void {
    this.loading = false;
    this.applySeo(true);
    this.unlockAdsWhenStable(); // ✅ sblocca ads solo ora
    this.cdr.markForCheck();
  }

  // ======== Ads unlock (SSR-safe) ========
  private unlockAdsWhenStable(): void {
    if (!this.isBrowser) return;
    // Evita ExpressionChanged & garantisce che il contenuto sia in DOM
    this.zone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        this.zone.run(() => {
          this.contentReady = true;
          this.cdr.markForCheck();
        });
      });
    });
  }

  // ======== Preload LCP image ========
  private addRandomImagePreload(url: string) {
    try {
      if (!this.isBrowser || !url) return;
      //this.removeRandomImagePreload();
      const link = this.renderer.createElement('link') as HTMLLinkElement;
      this.renderer.setAttribute(link, 'rel', 'preload');
      this.renderer.setAttribute(link, 'as', 'image');
      this.renderer.setAttribute(link, 'href', url);
      (link as any).id = 'preload-random-image';
      this.renderer.appendChild(this.doc.head, link);
      this.preloadRandomLink = link;
    } catch {
      /* no-op */
    }
  }

  private removeRandomImagePreload() {
    try {
      const prev =
        this.preloadRandomLink ||
        this.doc.head.querySelector<HTMLLinkElement>('#preload-random-image');
      if (prev) {
        this.renderer.removeChild(this.doc.head, prev);
        this.preloadRandomLink = undefined;
      }
    } catch {
      /* no-op */
    }
  }

  // ======== Immagini responsive / srcset ========
  getAbsoluteImageUrl(image: StrapiImage | null | undefined): string {
    if (!image?.url)
      return 'https://placehold.co/360x360/e0e0e0/333333?text=No+Image';
    return image.url.startsWith('http') ? image.url : env.apiUrl + image.url;
  }

  getBestImageUrl(image: StrapiImage | null | undefined, fallbackWidth = 360) {
    const formats = (image as any)?.formats || {};
    const candidates: Array<{ w: number; url: string }> = [];
    if (formats?.thumbnail?.url && formats?.thumbnail?.width)
      candidates.push({
        w: formats.thumbnail.width,
        url: formats.thumbnail.url,
      });
    if (formats?.small?.url && formats?.small?.width)
      candidates.push({ w: formats.small.width, url: formats.small.url });
    if (formats?.medium?.url && formats?.medium?.width)
      candidates.push({ w: formats.medium.width, url: formats.medium.url });
    if (formats?.large?.url && formats?.large?.width)
      candidates.push({ w: formats.large.width, url: formats.large.url });

    if (candidates.length) {
      const best = candidates.reduce((prev, cur) =>
        Math.abs(cur.w - fallbackWidth) < Math.abs(prev.w - fallbackWidth)
          ? cur
          : prev
      );
      return best.url.startsWith('http') ? best.url : env.apiUrl + best.url;
    }
    return this.getAbsoluteImageUrl(image);
  }

  getImageSrcSet(image: StrapiImage | null | undefined): string {
    const formats = (image as any)?.formats || null;
    if (!formats) return ''; // <- mai null

    const toAbs = (url: string) =>
      url?.startsWith('http') ? url : env.apiUrl + url;

    const parts: string[] = [];

    if (formats.thumbnail?.url && formats.thumbnail?.width) {
      parts.push(`${toAbs(formats.thumbnail.url)} ${formats.thumbnail.width}w`);
    }
    if (formats.small?.url && formats.small?.width) {
      parts.push(`${toAbs(formats.small.url)} ${formats.small.width}w`);
    }
    if (formats.medium?.url && formats.medium?.width) {
      parts.push(`${toAbs(formats.medium.url)} ${formats.medium.width}w`);
    }
    if (formats.large?.url && formats.large?.width) {
      parts.push(`${toAbs(formats.large.url)} ${formats.large.width}w`);
    }

    // Angular richiede una lista "comma-separated" con descrittori "w" o "x"
    return parts.join(', ');
  }

  // ======== trackBy ========
  trackByCocktail = (_: number, c: Cocktail | CocktailWithLayoutAndMatch) =>
    (c as any)?.id ?? (c as any)?.slug ?? _;
  trackByIngredient = (_: number, i: Ingredient) =>
    (i as any)?.id ?? (i as any)?.slug ?? _;
  trackByString = (_: number, s: string) => s ?? _;
  trackByGlossary = (_: number, g: GlossaryTerm) => g?.id ?? g?.slug ?? _;

  // ======== SEO / Schema.org ========
  private applySeo(updateDescWithCounts = false): void {
    const baseUrl =
      (this.isBrowser && typeof window !== 'undefined'
        ? window.location.origin
        : '') || '';
    const canonical = baseUrl ? `${baseUrl}/` : '/';
    const title = 'Fizzando — Make Better Cocktails';

    const parts: string[] = [
      'Explore cocktail recipes, ingredient profiles and practical guides',
      'Check out Fizzando’s Cocktail of the Day',
    ];
    if (updateDescWithCounts && this.totalCocktails > 0)
      parts.unshift(`Browse ${this.totalCocktails}+ cocktails`);
    const description = parts.join('. ') + '.';

    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });

    const head = this.doc.head;
    let linkEl = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!linkEl) {
      linkEl = this.renderer.createElement('link');
      this.renderer.setAttribute(linkEl, 'rel', 'canonical');
      this.renderer.appendChild(head, linkEl);
    }
    this.renderer.setAttribute(linkEl, 'href', canonical);

    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:url', content: canonical });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:site_name', content: 'Fizzando' });

    this.meta.updateTag({ name: 'twitter:card', content: 'summary' });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });

    this.injectJsonLd('website-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Fizzando',
      url: canonical,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${canonical}cocktails?search={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    });
    this.injectJsonLd('webpage-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Fizzando — Make Better Cocktails',
      description,
      url: canonical,
      inLanguage: 'en',
      hasPart: {
        '@type': 'CreativeWork',
        name: 'Fizzando’s Cocktail of the Day',
      },
    });
    this.injectJsonLd('breadcrumbs-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: canonical },
      ],
    });
  }

  private injectJsonLd(id: string, data: unknown): void {
    const head = this.doc.head;
    const prev = head.querySelector<HTMLScriptElement>(`#${id}`);
    if (prev) this.renderer.removeChild(head, prev);

    const script = this.renderer.createElement('script');
    this.renderer.setAttribute(script, 'type', 'application/ld+json');
    this.renderer.setAttribute(script, 'id', id);
    this.renderer.appendChild(
      script,
      this.renderer.createText(JSON.stringify(data))
    );
    this.renderer.appendChild(head, script);

    if (id === 'website-jsonld') this.websiteScript = script;
    if (id === 'webpage-jsonld') this.webpageScript = script;
    if (id === 'breadcrumbs-jsonld') this.breadcrumbsScript = script;
  }

  private cleanupSeo(): void {
    this.meta.removeTag("property='og:title'");
    this.meta.removeTag("property='og:description'");
    this.meta.removeTag("property='og:url'");
    this.meta.removeTag("property='og:type'");
    this.meta.removeTag("property='og:site_name'");
    this.meta.removeTag("name='twitter:card'");
    this.meta.removeTag("name='twitter:title'");
    this.meta.removeTag("name='twitter:description'");

    const head = this.doc.head;
    ['website-jsonld', 'webpage-jsonld', 'breadcrumbs-jsonld'].forEach((id) => {
      const el = head.querySelector(`#${id}`);
      if (el) this.renderer.removeChild(head, el);
    });
  }

  // =======================
  // ===== CAROUSEL 👇 =====
  // =======================
  currentSlide = 0;
  readonly slidesCount = 4;
  readonly autoplayMs = 6000;
  private autoplayId: number | null = null;
  isAnimating = true;
  private touchStartX = 0;
  private carouselObserver?: IntersectionObserver;

  // === Progress bar (sync con autoplay) ===
  progressPct = 0;
  private progressId: number | null = null;
  private slideStartTs = 0;

  private startProgress() {
    if (this.progressId != null) return;
    this.slideStartTs = Date.now();

    this.zone.runOutsideAngular(() => {
      this.progressId = window.setInterval(() => {
        const elapsed = Date.now() - this.slideStartTs;
        const pct = Math.min(100, (elapsed / this.autoplayMs) * 100);
        this.zone.run(() => {
          this.progressPct = pct;
          this.cdr.markForCheck();
        });
      }, 80);
    });
  }

  private stopProgress() {
    if (this.progressId != null) {
      clearInterval(this.progressId);
      this.progressId = null;
    }
  }

  private resetProgress() {
    this.progressPct = 0;
    this.slideStartTs = Date.now();
  }

  private startAutoplay() {
    if (!this.isBrowser || this.autoplayId != null || this.autoplayMs <= 0)
      return;

    // progress bar
    this.resetProgress();
    this.startProgress();

    this.zone.runOutsideAngular(() => {
      this.autoplayId = window.setInterval(() => {
        this.zone.run(() => this.nextSlide(true));
      }, this.autoplayMs);
    });
  }

  private stopAutoplay() {
    if (this.autoplayId != null) {
      clearInterval(this.autoplayId);
      this.autoplayId = null;
    }
    this.stopProgress();
  }

  private restartAutoplay() {
    this.stopAutoplay();
    this.startAutoplay();
  }

  private setupCarouselVisibilityObserver() {
    if (!this.isBrowser || !this.carouselRoot?.nativeElement) return;
    this.carouselObserver?.disconnect();
    this.carouselObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries.some(
          (e) => e.isIntersecting && e.intersectionRatio > 0
        );
        if (visible) this.startAutoplay();
        else this.stopAutoplay();
      },
      { threshold: [0, 0.1] }
    );
    this.carouselObserver.observe(this.carouselRoot.nativeElement);
  }

  pauseCarousel() {
    this.stopAutoplay();
  }
  resumeCarousel() {
    this.startAutoplay();
  }

  nextSlide(fromAuto = false) {
    this.isAnimating = true;
    this.currentSlide = (this.currentSlide + 1) % this.slidesCount;

    // reset progress su ogni cambio
    this.resetProgress();

    if (!fromAuto) this.restartAutoplay();
    setTimeout(() => (this.isAnimating = false), 520);
    this.cdr.markForCheck();
  }

  prevSlide() {
    this.isAnimating = true;
    this.currentSlide =
      (this.currentSlide - 1 + this.slidesCount) % this.slidesCount;

    // reset progress
    this.resetProgress();

    this.restartAutoplay();
    setTimeout(() => (this.isAnimating = false), 520);
    this.cdr.markForCheck();
  }

  goToSlide(i: number) {
    if (i < 0 || i >= this.slidesCount || i === this.currentSlide) return;
    this.isAnimating = true;
    this.currentSlide = i;

    // reset progress
    this.resetProgress();

    this.restartAutoplay();
    setTimeout(() => (this.isAnimating = false), 400);
    this.cdr.markForCheck();
  }

  onCarouselKeydown(ev: KeyboardEvent) {
    if (ev.key === 'ArrowRight') {
      this.nextSlide();
      ev.preventDefault();
    } else if (ev.key === 'ArrowLeft') {
      this.prevSlide();
      ev.preventDefault();
    } else if (ev.key === ' ') {
      if (this.autoplayId != null) this.pauseCarousel();
      else this.resumeCarousel();
      ev.preventDefault();
    }
  }

  onTouchStart(e: TouchEvent) {
    this.touchStartX = e.changedTouches[0]?.clientX ?? 0;
  }

  onTouchEnd(e: TouchEvent) {
    const dx = (e.changedTouches[0]?.clientX ?? 0) - this.touchStartX;
    if (Math.abs(dx) > 40) dx > 0 ? this.prevSlide() : this.nextSlide();
  }

  getSmallestUrl(image: any): string {
    const f = image?.formats || {};
    const toAbs = (u: string) => (u?.startsWith('http') ? u : env.apiUrl + u);
    // priorità: thumbnail → small → medium → large → originale
    return toAbs(
      f.thumbnail?.url ||
        f.small?.url ||
        f.medium?.url ||
        f.large?.url ||
        image?.url ||
        ''
    );
  }

  burstConfetti(origin: 'center' | 'top' | 'bottom' = 'center') {
    this.confetti?.burst(origin);
  }

  // === NEW: osserva l'entrata in scena del box (mobile/scroll) ===
  private setupCotdObserver() {
    if (!this.isBrowser || !this.cotdBox?.nativeElement) return;

    // Evita doppi burst troppo ravvicinati
    const COOLDOWN_MS = 1500;

    this.cotdIO?.disconnect();
    this.cotdIO = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;

        const now = Date.now();
        const visible = e.isIntersecting && e.intersectionRatio >= 0.6; // ~60% visibile
        if (visible && now - this.cotdLastBurst > COOLDOWN_MS) {
          this.cotdLastBurst = now;
          this.burstConfetti('center');
        }
      },
      { threshold: [0, 0.6] }
    );

    this.cotdIO.observe(this.cotdBox.nativeElement);
  }

  celebrateAndGo(ev: Event, to: any[], delay = 480) {
    ev.preventDefault();
    ev.stopPropagation();

    // Accessibilità: rispetta prefers-reduced-motion
    const prefersReduced =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!prefersReduced) {
      this.confetti?.burst('bottom'); // puoi regolare il punto
    }

    setTimeout(() => this.router.navigate(to), prefersReduced ? 0 : delay);
  }
}
