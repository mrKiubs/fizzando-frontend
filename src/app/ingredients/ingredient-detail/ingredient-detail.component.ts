import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  HostListener,
  Inject,
  Renderer2,
  inject,
} from '@angular/core';
import {
  CommonModule,
  DOCUMENT,
  isPlatformBrowser,
  NgOptimizedImage,
} from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { Subscription } from 'rxjs';

import {
  IngredientService,
  Ingredient,
} from '../../services/ingredient.service';
import { CocktailService, Cocktail } from '../../services/strapi.service';

import { MatIconModule } from '@angular/material/icon';
import { CocktailCardComponent } from '../../cocktails/cocktail-card/cocktail-card.component';
import { FormatAbvPipe } from '../../assets/pipes/format-abv.pipe';
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';
import { AffiliateProductComponent } from '../../assets/design-system/affiliate-product/affiliate-product.component';
import { env } from '../../config/env';

export interface IngredientDetail extends Ingredient {
  relatedCocktails?: Cocktail[];
}

interface ProductItem {
  title: string;
  imageUrl: string;
  price: string;
  link: string;
  showPlaceholder: boolean;
}

/** Modello “slim” per la nav prev/next */
type NavIngredient = {
  id: number | string;
  slug: string;
  externalId?: string | number;
  name: string;
  imageUrl?: string | null;
};

@Component({
  selector: 'app-ingredient-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    CocktailCardComponent,
    RouterLink,
    FormatAbvPipe,
    DevAdsComponent,
    AffiliateProductComponent,
    NgOptimizedImage,
  ],
  templateUrl: './ingredient-detail.component.html',
  styleUrls: ['./ingredient-detail.component.scss'],
})
export class IngredientDetailComponent
  implements OnInit, OnDestroy, AfterViewInit
{
  // --- runtime/env
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // --- stato principale
  ingredient: IngredientDetail | null = null;
  loading = true;
  error: string | null = null;
  contentReady = false;

  /** Track the first cocktail to prioritize its hero image (LCP). */
  firstRelatedCocktailSlug: string | null = null;
  firstRelatedCocktailId: number | null = null;

  // --- dataset completo (per nav & SEO)
  private allIngredients: Ingredient[] = [];

  // --- navigazione prev/next su lista ORDINATA PER SLUG
  private allBySlug: NavIngredient[] = [];
  public previousIngredient?: NavIngredient;
  public nextIngredient?: NavIngredient;
  private currentSlug = '';

  // --- responsive/seo
  isMobile = false;
  private siteBaseUrl = '';
  private schemaScript?: HTMLScriptElement;

  // --- affiliate
  @ViewChild('affiliateCardList') affiliateCardList!: ElementRef;
  private wheelCleanup?: () => void;

  productList: ProductItem[] = [
    {
      title: 'Libbey Mixologist 9-Piece Cocktail Set',
      imageUrl:
        'https://m.media-amazon.com/images/I/71MYEP67w2S._AC_SY879_.jpg',
      price: '$50.00',
      link: 'https://amzn.to/4fowM9o',
      showPlaceholder: true,
    },
    {
      title: 'Riedel Nick and Nora Cocktail Glasses, Set of 2',
      imageUrl:
        'https://m.media-amazon.com/images/I/61wIAjM9apL._AC_SX522_.jpg',
      price: '$45.00',
      link: 'https://www.amazon.com/Riedel-Nick-Nora-Cocktail-Glasses/dp/B07R8B7L1V',
      showPlaceholder: true,
    },
    {
      title: 'YARRAMATE 8Pcs 24oz Hybrid Insulated Cocktail Shaker',
      imageUrl:
        'https://m.media-amazon.com/images/I/71NZMAbpEjL._AC_SX679_.jpg',
      price: '$24.74',
      link: 'https://www.amazon.com/Cocktail-Codex-Fundamentals-Formulas-Evolutions/dp/1607749714',
      showPlaceholder: true,
    },
    {
      title: 'Bartesian Professional Cocktail Machine',
      imageUrl:
        'https://m.media-amazon.com/images/I/81YFuyY5xVL._AC_SX679_.jpg',
      price: '$269.99',
      link: 'https://www.amazon.com/Bartesian-Premium-Cocktail-Machine-Drinks/dp/B07T435M1S',
      showPlaceholder: true,
    },
    {
      title: 'BARE BARREL® Mixology Bartender Kit Bar Set',
      imageUrl:
        'https://m.media-amazon.com/images/I/81L4vmLO+KL._AC_SX679_.jpg',
      price: '$39.95',
      link: 'https://www.amazon.com/Hella-Cocktail-Co-Bitters-Variety/dp/B08V5QY3Q7',
      showPlaceholder: true,
    },
  ];

  // --- WEBP preferenza
  private supportsWebp = false;

  // --- subscriptions
  private routeSubscription?: Subscription;
  private allIngredientsSubscription?: Subscription;
  private relatedCocktailsSubscription?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private ingredientService: IngredientService,
    private cocktailService: CocktailService,
    private titleService: Title,
    private metaService: Meta,
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document
  ) {
    if (this.isBrowser) {
      this.siteBaseUrl = window.location.origin;
      this.isMobile = window.innerWidth <= 768;
      this.supportsWebp = this.checkWebpSupport();
    }
  }

  // === lifecycle ============================================================

  ngOnInit(): void {
    // 1) Carica elenco completo (cache del service consentita)
    this.allIngredientsSubscription = this.ingredientService
      .getIngredients(1, 1000, undefined, undefined, undefined, true)
      .subscribe({
        next: (response) => {
          this.allIngredients = response.data || [];
          // costruisci indice ordinato per slug
          this.allBySlug = this.sortBySlug(
            this.allIngredients.map((it) => this.mapToNav(it))
          );
          // 2) poi sincronizza con la route
          this.subscribeToRouteParams();
        },
        error: (err) => {
          console.error('Error loading all ingredients:', err);
          // anche se fallisce, proviamo comunque a leggere la route e caricare il singolo
          this.subscribeToRouteParams();
        },
      });
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    // scroll orizzontale con wheel (come cocktail-detail)
    const listEl = this.affiliateCardList?.nativeElement as
      | HTMLElement
      | undefined;
    if (!listEl) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      listEl.scrollLeft += e.deltaY;
    };
    listEl.addEventListener('wheel', handler, { passive: false });
    this.wheelCleanup = () => listEl.removeEventListener('wheel', handler);
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.allIngredientsSubscription?.unsubscribe();
    this.relatedCocktailsSubscription?.unsubscribe();
    if (this.wheelCleanup) this.wheelCleanup();
    this.cleanupSeo();
  }

  // === router / data ========================================================

  private subscribeToRouteParams(): void {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const externalId = params.get('externalId');
      if (!externalId) {
        this.error = 'Ingredient ID not provided.';
        this.loading = false;
        return;
      }
      this.loadIngredientDetails(externalId);
    });
  }

  private loadIngredientDetails(externalId: string): void {
    this.loading = true;
    this.error = null;
    this.contentReady = false;
    this.firstRelatedCocktailSlug = null;
    this.firstRelatedCocktailId = null;
    this.cleanupSeo(); // pulisci meta/ld+json precedenti

    // prova cache allIngredients
    const cached = this.allIngredients.find(
      (i) => String(i.external_id) === String(externalId)
    );
    if (cached) {
      this.ingredient = { ...(cached as IngredientDetail) };
      this.currentSlug = this.safeSlugFromIngredient(cached);
      this.computeNeighbors(); // ← calcolo prev/next su allBySlug
      this.setSeoTagsAndSchema();
      this.unlockAdsWhenStable();
      this.loadRelatedCocktails(externalId);
      return;
    }

    // fallback fetch diretto singolo
    this.ingredientService.getIngredientByExternalId(externalId).subscribe({
      next: (res) => {
        if (!res) {
          this.error = 'Ingredient not found.';
          this.loading = false;
          return;
        }
        this.ingredient = { ...(res as IngredientDetail) };
        this.currentSlug = this.safeSlugFromIngredient(res as Ingredient);

        // se per qualsiasi motivo non avevamo l’indice, costruiscilo best-effort
        if (!this.allBySlug.length) {
          const single = this.mapToNav(res as Ingredient);
          this.allBySlug = this.sortBySlug([single]);
        }

        this.computeNeighbors(); // ← calcolo prev/next
        this.setSeoTagsAndSchema();
        this.unlockAdsWhenStable();
        this.loadRelatedCocktails(externalId);
      },
      error: (err) => {
        console.error('Error fetching ingredient directly:', err);
        this.error = 'Unable to load ingredient details.';
        this.loading = false;
        this.unlockAdsWhenStable();
      },
    });
  }

  private loadRelatedCocktails(externalId: string): void {
    this.relatedCocktailsSubscription = this.cocktailService
      .getRelatedCocktailsForIngredient(externalId)
      .subscribe({
        next: (list) => {
          if (this.ingredient) this.ingredient.relatedCocktails = list;
          const first = list?.length ? list[0] : null;
          this.firstRelatedCocktailSlug = first?.slug ?? null;
          this.firstRelatedCocktailId =
            typeof first?.id === 'number' ? first.id : null;
          this.loading = false;
        },
        error: (err) => {
          console.error('Error fetching related cocktails:', err);
          this.error = 'Could not load related cocktails.';
          this.loading = false;
          this.unlockAdsWhenStable();
        },
      });
  }

  // === NAV prev/next (ordinata per SLUG, stabile) ==========================

  /** Conversione Ingredient → NavIngredient */
  private mapToNav(it: Ingredient): NavIngredient {
    return {
      id: (it as any).id ?? it.external_id ?? it.slug ?? it.name,
      slug: this.safeSlugFromIngredient(it),
      externalId: it.external_id ?? undefined,
      name: it.name ?? '',
      imageUrl: it.image?.url ?? null,
    };
  }

  /** Slug sicuro: preferisci .slug, poi external_id, poi name (slugificato) */
  private safeSlugFromIngredient(it: Ingredient): string {
    const raw =
      (it as any).slug ||
      (typeof it.external_id !== 'undefined' ? String(it.external_id) : '') ||
      it.name ||
      '';
    return this.slugify(raw);
  }

  /** Sort stabile per slug (case-insensitive, numeric) */
  private sortBySlug(arr: NavIngredient[]): NavIngredient[] {
    return arr.slice().sort((a, b) =>
      a.slug.localeCompare(b.slug, 'en', {
        sensitivity: 'base',
        numeric: true,
      })
    );
  }

  /** Calcola prev/next sulla lista globale ordinata per slug */
  private computeNeighbors(): void {
    this.previousIngredient = undefined;
    this.nextIngredient = undefined;
    if (!this.currentSlug || !this.allBySlug.length) return;

    const idx = this.allBySlug.findIndex((x) => x.slug === this.currentSlug);
    if (idx === -1) return;

    const prevIdx = idx > 0 ? idx - 1 : -1;
    const nextIdx = idx < this.allBySlug.length - 1 ? idx + 1 : -1;

    this.previousIngredient =
      prevIdx >= 0 ? this.allBySlug[prevIdx] : undefined;
    this.nextIngredient = nextIdx >= 0 ? this.allBySlug[nextIdx] : undefined;
  }

  // === Navigazione UI =======================================================

  goBack(): void {
    if (this.isBrowser) window.history.back();
  }

  // === IMG utilities (URL assoluti + WebP preferenza + fallback) ===========

  /** URL originale assoluto (qualsiasi formato disponibile) */
  getIngredientImageUrl(ing: Ingredient | undefined): string {
    if (ing?.image?.url) {
      return ing.image.url.startsWith('http')
        ? ing.image.url
        : env.apiUrl + ing.image.url;
    }
    return 'assets/no-image.png';
  }

  /** Preferisci thumbnail/small/medium per l’hero (≈100x100) con fallback all’originale */
  getIngredientHeroUrl(ing?: Ingredient | null): string {
    const img: any = ing?.image;
    if (!img) return 'assets/no-image.png';

    const abs = (u?: string | null) =>
      u ? (u.startsWith('http') ? u : env.apiUrl + u) : '';

    if (img?.formats?.thumbnail?.url) return abs(img.formats.thumbnail.url);
    if (img?.formats?.small?.url) return abs(img.formats.small.url);
    if (img?.formats?.medium?.url) return abs(img.formats.medium.url);
    if (img?.url) return abs(img.url);
    return 'assets/no-image.png';
  }

  /** Thumbnail per i bottoni Prev/Next: thumbnail → small → original */
  getIngredientThumbUrl(ing?: Ingredient | null): string {
    const img: any = ing?.image;
    if (!img) return 'assets/no-image.png';

    const abs = (u?: string | null) =>
      u ? (u.startsWith('http') ? u : env.apiUrl + u) : '';

    if (img?.formats?.thumbnail?.url) return abs(img.formats.thumbnail.url); // ~150w
    if (img?.formats?.small?.url) return abs(img.formats.small.url); // ~320w
    if (img?.url) return abs(img.url);
    return 'assets/no-image.png';
  }

  /** Rileva supporto WebP (client-only) */
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

  /** Converte in .webp mantenendo querystring (non su assets locali) */
  private toWebp(url?: string | null): string {
    if (!url) return '';
    if (url.startsWith('assets/')) return url;
    return url.replace(/\.(jpe?g|png)(\?.*)?$/i, '.webp$2');
  }

  /** Restituisce l’URL preferito (webp se supportato, altrimenti originale) */
  getPreferred(originalUrl?: string | null): string {
    if (!originalUrl) return '';
    if (!this.supportsWebp) return originalUrl;
    return this.toWebp(originalUrl) || originalUrl;
  }

  /** Fallback automatico all’URL originale quando la .webp fallisce */
  onImgError(evt: Event, originalUrl: string): void {
    const img = evt.target as HTMLImageElement | null;
    if (!img) return;
    if ((img as any).__fallbackApplied) return; // evita loop
    (img as any).__fallbackApplied = true;
    img.src = originalUrl;
    img.removeAttribute('srcset'); // pulizia eventuale
  }

  // === misc ================================================================

  getRelatedCocktailImageUrl(cocktail: Cocktail): string {
    if (cocktail?.image?.url) {
      return cocktail.image.url.startsWith('http')
        ? cocktail.image.url
        : env.apiUrl + cocktail.image.url;
    }
    return 'assets/no-image.png';
  }

  trackByCocktailId(_index: number, c: Cocktail): number {
    return c.id;
  }

  getCocktailsAndAds(): any[] {
    const items: any[] = [];
    const list = this.ingredient?.relatedCocktails || [];
    list.forEach((c, i) => {
      items.push(c);
      if ((i + 1) % 6 === 0 && i < list.length - 1) {
        items.push({ isAd: true });
      }
    });
    return items;
  }

  isCocktailItem(item: any): boolean {
    return item && !item.isAd;
  }

  private getFullSiteUrl(path: string): string {
    const p = path.startsWith('/') ? path : '/' + path;
    return `${this.siteBaseUrl}${p}`;
  }

  // === responsive ===========================================================

  @HostListener('window:resize')
  onResize(): void {
    this.isMobile = this.isBrowser ? window.innerWidth <= 768 : false;
  }

  // === SEO / JSON-LD ========================================================

  private setSeoTagsAndSchema(): void {
    if (!this.ingredient) return;

    const name = this.ingredient.name;
    const desc =
      this.ingredient.ai_common_uses ||
      this.ingredient.ai_flavor_profile ||
      this.ingredient.description_from_cocktaildb ||
      `${name} ingredient details, uses and profile.`;

    // Usa l'hero (piccolo ma sicuro) con preferenza WebP
    const imageUrl = this.getPreferred(
      this.getIngredientHeroUrl(this.ingredient)
    );
    const pageUrl = this.getFullSiteUrl(
      `/ingredients/${this.ingredient.external_id}`
    );

    // <title> + meta description
    this.titleService.setTitle(`${name} | Fizzando`);
    this.metaService.updateTag({ name: 'description', content: desc });

    // canonical
    let canonical = this.document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]'
    );
    if (!canonical) {
      canonical = this.renderer.createElement('link');
      this.renderer.setAttribute(canonical, 'rel', 'canonical');
      this.renderer.appendChild(this.document.head, canonical);
    }
    this.renderer.setAttribute(canonical, 'href', pageUrl);

    // OpenGraph / Twitter
    this.metaService.updateTag({ property: 'og:title', content: name });
    this.metaService.updateTag({
      property: 'og:description',
      content: desc,
    });
    this.metaService.updateTag({ property: 'og:image', content: imageUrl });
    this.metaService.updateTag({ property: 'og:url', content: pageUrl });
    this.metaService.updateTag({ property: 'og:type', content: 'article' });
    this.metaService.updateTag({
      property: 'og:site_name',
      content: 'Fizzando',
    });

    this.metaService.updateTag({
      name: 'twitter:card',
      content: 'summary_large_image',
    });
    this.metaService.updateTag({ name: 'twitter:title', content: name });
    this.metaService.updateTag({
      name: 'twitter:description',
      content: desc,
    });
    this.metaService.updateTag({ name: 'twitter:image', content: imageUrl });

    // Preload hero se utile all’LCP
    const existing = this.document.querySelector<HTMLLinkElement>(
      'link[rel="preload"][as="image"][data-preload-hero="1"]'
    );
    if (!existing && imageUrl) {
      const preload = this.renderer.createElement('link') as HTMLLinkElement;
      this.renderer.setAttribute(preload, 'rel', 'preload');
      this.renderer.setAttribute(preload, 'as', 'image');
      this.renderer.setAttribute(preload, 'href', imageUrl);
      this.renderer.setAttribute(
        preload,
        'imagesizes',
        '(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 33vw'
      );
      this.renderer.setAttribute(preload, 'data-preload-hero', '1');
      this.renderer.appendChild(this.document.head, preload);
    }

    // JSON-LD
    this.addJsonLdSchema();
  }

  private addJsonLdSchema(): void {
    if (!this.ingredient) return;
    this.cleanupJsonLd();

    this.schemaScript = this.renderer.createElement('script');
    this.renderer.setAttribute(this.schemaScript, 'id', 'ingredient-schema');
    this.renderer.setAttribute(
      this.schemaScript,
      'type',
      'application/ld+json'
    );
    this.renderer.appendChild(
      this.schemaScript,
      this.renderer.createText(
        JSON.stringify(this.generateIngredientSchema(this.ingredient))
      )
    );
    this.renderer.appendChild(this.document.head, this.schemaScript);
  }

  private generateIngredientSchema(ing: IngredientDetail): any {
    const pageUrl = this.getFullSiteUrl(`/ingredients/${ing.external_id}`);
    const imageUrl =
      this.getPreferred(this.getIngredientHeroUrl(ing)) ||
      this.getFullSiteUrl('assets/no-image.png');

    const additionalProps: any[] = [];
    if (typeof (ing as any).isAlcoholic === 'boolean') {
      additionalProps.push({
        '@type': 'PropertyValue',
        name: 'Alcoholic',
        value: (ing as any).isAlcoholic ? 'Alcoholic' : 'Non-Alcoholic',
      });
    }
    if ((ing as any).ai_alcohol_content) {
      additionalProps.push({
        '@type': 'PropertyValue',
        name: 'Alcohol Content',
        value: (ing as any).ai_alcohol_content,
      });
    }
    if (ing.ingredient_type) {
      additionalProps.push({
        '@type': 'PropertyValue',
        name: 'Ingredient Type',
        value: ing.ingredient_type,
      });
    }

    const description =
      (ing as any).ai_common_uses ||
      (ing as any).ai_flavor_profile ||
      ing.description_from_cocktaildb ||
      `${ing.name} ingredient details.`;

    return {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: ing.name,
      image: [imageUrl],
      description,
      brand: { '@type': 'Organization', name: 'Fizzando' },
      url: pageUrl,
      additionalProperty: additionalProps,
      mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    };
  }

  private cleanupSeo(): void {
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
    if (oldPreload) {
      this.renderer.removeChild(this.document.head, oldPreload);
    }
  }

  private cleanupJsonLd(): void {
    const old = this.document.getElementById('ingredient-schema');
    if (old) this.renderer.removeChild(this.document.head, old);
  }

  /** Esegue cb dopo il primo paint (solo browser) */
  private runAfterFirstPaint(cb: () => void) {
    if (!this.isBrowser) return;
    requestAnimationFrame(() => setTimeout(cb, 0));
  }

  /** Sblocca gli ads quando il contenuto è stabile */
  private unlockAdsWhenStable(): void {
    if (!this.isBrowser) return;
    this.runAfterFirstPaint(() => {
      this.contentReady = true;
    });
  }

  /** Mappa classi width per lo slot (usa le tue regole .ad-slot.*) */
  adSlotClass(type: string): string {
    return `ad-slot ${type}`;
  }

  getTopBannerType(): 'mobile-banner' | 'leaderboard' {
    return this.isMobile ? 'mobile-banner' : 'leaderboard';
  }
  getGridAdType(): 'mobile-banner' | 'square' {
    return this.isMobile ? 'mobile-banner' : 'square';
  }
  getBottomBannerType(): 'mobile-banner' | 'leaderboard' {
    return this.isMobile ? 'mobile-banner' : 'leaderboard';
  }

  // === utils ===============================================================

  private slugify(s: string): string {
    const base =
      (s || '')
        .toString()
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '') || '';
    return (
      base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ingredient'
    );
  }
}
