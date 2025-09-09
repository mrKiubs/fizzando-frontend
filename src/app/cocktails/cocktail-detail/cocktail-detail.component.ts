import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewInit,
  Renderer2,
  Inject,
  inject,
  NgZone,
  PLATFORM_ID,
  HostListener,
} from '@angular/core';
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
import { Subscription } from 'rxjs';
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';
import { AffiliateProductComponent } from '../../assets/design-system/affiliate-product/affiliate-product.component';
import { Title, Meta } from '@angular/platform-browser';
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
  detailSizes =
    '(max-width: 767px) calc(100vw - 32px), ' +
    '(max-width: 1199px) calc((100vw - 48px)/2), ' +
    '392px';
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

    if (this.isBrowser) this.checkScreenWidth();
  }

  // ===== Lifecycle =====
  ngOnInit(): void {
    // Se stai usando un resolver SSR
    const resolved = this.route.snapshot.data['cocktail'] as Cocktail | null;
    if (resolved) {
      this.cocktail = resolved;
      this.loading = false;
      this.setNavigationCocktails(this.cocktail.external_id);
      this.heroSrc = this.getCocktailImageUrl(this.cocktail);
      this.heroSrcset = this.getCocktailImageSrcset(this.cocktail);
      this.setSeoTagsAndSchema();
      this.loadSimilarCocktails();
      this.fetchRelatedArticles();
      this.unlockAdsWhenStable();
    }

    // Carica elenco (prev/next) + fallback client
    this.allCocktailsSubscription = this.cocktailService
      .getCocktails(1, 1000)
      .subscribe({
        next: (response) => {
          this.allCocktails = response.data.sort((a, b) =>
            a.name.localeCompare(b.name)
          );
          if (this.cocktail)
            this.setNavigationCocktails(this.cocktail.external_id);
          this.subscribeToRouteParams(!resolved);
        },
        error: () => {
          this.error = 'Could not load all cocktails for navigation.';
          this.subscribeToRouteParams(!resolved);
        },
      });
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
  private subscribeToRouteParams(shouldHandleFirst = true): void {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (!slug) {
        this.error = 'Cocktail slug not found.';
        this.loading = false;
        return;
      }

      if (!shouldHandleFirst) {
        shouldHandleFirst = true; // attiva per le successive
        return;
      }
      this.loadCocktailDetail(slug);
    });
  }

  loadCocktailDetail(slug: string): void {
    this.loading = true;
    this.error = null;
    this.similarCocktails = [];
    this.relatedWithAds = [];
    this.contentReady = false; // blocca ads tra una navigazione e l’altra
    this.cleanupSeo();

    const cached = this.allCocktails.find((c) => c.slug === slug);
    if (cached) {
      this.cocktail = cached;
      this.loading = false;
      this.setNavigationCocktails(this.cocktail.external_id);
      this.loadSimilarCocktails();
      this.fetchRelatedArticles();
      this.setSeoTagsAndSchema();
      this.unlockAdsWhenStable();
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
          this.heroSrc = this.getCocktailImageUrl(this.cocktail);
          this.heroSrcset = this.getCocktailImageSrcset(this.cocktail);
          this.setNavigationCocktails(this.cocktail.external_id);
          this.loadSimilarCocktails();
          this.fetchRelatedArticles();
          this.setSeoTagsAndSchema();
          this.unlockAdsWhenStable();
        },
        error: () => {
          this.error = 'Could not load cocktail details from API.';
          this.loading = false;
          this.contentReady = false;
        },
      });
  }

  private unlockAdsWhenStable(): void {
    if (!this.isBrowser) return;
    // Evita ExpressionChanged & garantisce che il contenuto principale sia in DOM
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        this.ngZone.run(() => (this.contentReady = true));
      });
    });
  }

  loadSimilarCocktails(): void {
    if (!this.cocktail) {
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
        imageUrl: this.getCocktailImageUrl(prev),
        slug: prev.slug,
      };
    }
    if (this.currentCocktailIndex < this.allCocktails.length - 1) {
      const next = this.allCocktails[this.currentCocktailIndex + 1];
      this.nextCocktail = {
        externalId: next.external_id,
        name: next.name,
        imageUrl: this.getCocktailImageUrl(next),
        slug: next.slug,
      };
    }
  }

  private fetchRelatedArticles(): void {
    if (!this.cocktail?.id) {
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
      return ingredientEntry.ingredient.image.url.startsWith('http')
        ? ingredientEntry.ingredient.image.url
        : env.apiUrl + ingredientEntry.ingredient.image.url;
    }
    return 'assets/no-image.png';
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

    const cocktailImageUrl = this.getCocktailImageUrl(this.cocktail);
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

    // Preload LCP hero (no duplicati)
    const existing = this.document.querySelector<HTMLLinkElement>(
      'link[rel="preload"][as="image"][data-preload-hero="1"]'
    );
    if (!existing && cocktailImageUrl) {
      const srcset = this.getCocktailImageSrcset(this.cocktail); // la tua funzione
      const sizes = this.detailSizes;

      const preload = this.renderer.createElement('link') as HTMLLinkElement;
      this.renderer.setAttribute(preload, 'rel', 'preload');
      this.renderer.setAttribute(preload, 'as', 'image');
      this.renderer.setAttribute(preload, 'fetchpriority', 'high');

      // Fallback (ok tenerlo)
      this.renderer.setAttribute(preload, 'href', cocktailImageUrl);

      // 🔑 fondamentali per immagini responsive:
      if (srcset) this.renderer.setAttribute(preload, 'imagesrcset', srcset);
      if (sizes) this.renderer.setAttribute(preload, 'imagesizes', sizes);

      this.renderer.setAttribute(preload, 'data-preload-hero', '1');
      this.renderer.appendChild(this.document.head, preload);
    }

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
      this.getCocktailImageUrl(cocktail) ||
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
}
