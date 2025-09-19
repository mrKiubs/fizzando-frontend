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
import { concatMap } from 'rxjs/operators';
import {
  CommonModule,
  DOCUMENT,
  isPlatformBrowser,
  Location,
} from '@angular/common';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import {
  CocktailService,
  Cocktail,
  CocktailWithLayoutAndMatch,
} from '../../services/strapi.service';
import { MatIconModule } from '@angular/material/icon';
import { Observable, of, Subscription } from 'rxjs';
import { Title, Meta } from '@angular/platform-browser';

import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';
import { AffiliateProductComponent } from '../../assets/design-system/affiliate-product/affiliate-product.component';
import { ArticleService, Article } from '../../services/article.service';
import { ArticleCardComponent } from '../../articles/article-card/article-card.component';
import { CocktailCardComponent } from '../../cocktails/cocktail-card/cocktail-card.component';

import { env } from '../../config/env';

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
    AffiliateProductComponent,
    ArticleCardComponent,
    CocktailCardComponent,
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

  // ===== State =====
  cocktail: Cocktail | undefined;
  loading = true;
  error: string | null = null;

  allCocktails: Cocktail[] = [];
  currentCocktailIndex = -1;

  heroSrc = '';
  heroSrcset = '';

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

  similarCocktails: CocktailWithLayoutAndMatch[] = [];
  relatedArticles: Article[] = [];

  /** Array pronto per il template, con Ad intercalati */
  relatedWithAds: Array<CocktailWithLayoutAndMatch | AdSlot> = [];
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

      // 2) ❗ Defer NON-critiche dopo il paint (SOLO browser)
      this.runAfterFirstPaint(() => this.kickOffNonCritical());

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
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.allCocktailsSubscription?.unsubscribe();
    this.similarCocktailsSubscription?.unsubscribe();
    this.cocktailDetailSubscription?.unsubscribe();
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

    this.fetchAllCocktailsIndex();

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

      this.setNavigationCocktails(this.cocktail.external_id);

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
          this.loading = false;

          // hero + SEO
          this.heroSrc = this.getPreferred(
            this.getCocktailHeroUrl(this.cocktail)
          );
          this.heroSrcset = this.getCocktailImageSrcsetPreferred(this.cocktail);
          this.setSeoTagsAndSchema();

          // prev/next: se abbiamo già l’elenco lo aggiorniamo subito,
          // altrimenti lo calcoleremo quando l’indice arriva
          this.setNavigationCocktails(this.cocktail.external_id);

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
    this.similarCocktailsSubscription = this.cocktailService
      .getSimilarCocktails(this.cocktail)
      .subscribe({
        next: (res: Cocktail[]) => {
          this.similarCocktails = res as CocktailWithLayoutAndMatch[];
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
    const list = this.similarCocktails ?? [];
    const out: Array<CocktailWithLayoutAndMatch | AdSlot> = [];
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
    this.currentCocktailIndex = this.allCocktails.findIndex(
      (c) => c.external_id === currentExternalId
    );

    this.previousCocktail = null;
    this.nextCocktail = null;

    if (this.currentCocktailIndex > 0) {
      const prev = this.allCocktails[this.currentCocktailIndex - 1];
      this.previousCocktail = {
        externalId: prev.external_id,
        name: prev.name,
        imageUrl: this.getPreferred(this.getCocktailImageUrl(prev)),
        slug: prev.slug,
      };
    }
    if (this.currentCocktailIndex < this.allCocktails.length - 1) {
      const next = this.allCocktails[this.currentCocktailIndex + 1];
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

    const parts: string[] = [];
    if (img?.formats?.thumbnail?.url)
      parts.push(`${abs(img.formats.thumbnail.url)} 150w`);
    if (img?.formats?.small?.url)
      parts.push(`${abs(img.formats.small.url)} 320w`);
    if (img?.formats?.medium?.url)
      parts.push(`${abs(img.formats.medium.url)} 640w`);
    if (img?.formats?.large?.url)
      parts.push(`${abs(img.formats.large.url)} 1024w`);
    if (img?.url) parts.push(`${abs(img.url)} 1600w`);
    return parts.join(', ');
  }

  getCocktailImageSrcsetPreferred(cocktail?: Cocktail): string {
    const original = this.getCocktailImageSrcset(cocktail);
    if (!this.supportsWebp || !original) return original;

    const out = original
      .split(',')
      .map((entry) => {
        const [u, w] = entry.trim().split(/\s+/);
        const uw = this.toWebp(u);
        return `${uw} ${w || ''}`.trim();
      })
      .join(', ');
    return out || original;
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

  /** Scarica tutto l’indice cocktail paginando lato client (rispetta il maxPageSize di Strapi) */
  private fetchAllCocktailsIndex(): void {
    const PAGE_SIZE = 100; // sicuro per Strapi (se il tuo max è 250 puoi alzarlo)
    const collected: Cocktail[] = [];

    // prima pagina per sapere quante pagine totali servono
    const first$ = this.cocktailService.getCocktails(
      1,
      PAGE_SIZE,
      undefined,
      undefined,
      undefined,
      true,
      false
    );

    this.allCocktailsSubscription = first$.subscribe({
      next: (firstResp) => {
        collected.push(...firstResp.data);
        const totalPages = firstResp.meta?.pagination?.pageCount || 1;

        // se c'è solo 1 pagina siamo già a posto
        if (totalPages <= 1) {
          this.allCocktails = collected
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name));
          if (this.cocktail)
            this.setNavigationCocktails(this.cocktail.external_id);
          return;
        }

        // concatena sequenzialmente le restanti pagine: 2..N
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
                true,
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
              this.allCocktails = collected
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name));
              if (this.cocktail)
                this.setNavigationCocktails(this.cocktail.external_id);
            },
            error: () => {
              // anche se fallisce una pagina, usiamo quello che abbiamo
              this.allCocktails = collected
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name));
              if (this.cocktail)
                this.setNavigationCocktails(this.cocktail.external_id);
            },
          })
        );
      },
      error: () => {
        this.error = 'Could not load all cocktails for navigation.';
      },
    });
  }
}
