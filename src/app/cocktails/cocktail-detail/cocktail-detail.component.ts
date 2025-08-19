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
  NgOptimizedImage, // ✅ per ottimizzare l'LCP image
} from '@angular/common';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import {
  CocktailService,
  Cocktail,
  CocktailWithLayoutAndMatch,
} from '../../services/strapi.service';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { CocktailCardComponent } from '../../cocktails/cocktail-card/cocktail-card.component';
import { env } from '../../config/env';
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';
import { AffiliateProductComponent } from '../../assets/design-system/affiliate-product/affiliate-product.component';
import { Title, Meta } from '@angular/platform-browser';

interface ProductItem {
  title: string;
  imageUrl: string;
  price: string;
  link: string;
  showPlaceholder: boolean;
}

@Component({
  selector: 'app-cocktail-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    RouterLink,
    CocktailCardComponent,
    DevAdsComponent,
    AffiliateProductComponent,
    NgOptimizedImage, // ✅
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

  cocktail: Cocktail | undefined;
  loading = true;
  error: string | null = null;
  allCocktails: Cocktail[] = [];
  currentCocktailIndex = -1;
  isMobile = false;
  private siteBaseUrl = '';
  private cocktailSchemaScript: HTMLScriptElement | undefined;

  @ViewChild('affiliateCardList') affiliateCardList!: ElementRef;
  private wheelListenerCleanup?: () => void;

  // ✅ Prodotti affiliate (una sola sezione in pagina)
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

  // Conservata per compatibilità eventuale, ma non usata nel template
  productListRobot: ProductItem[] = [
    {
      title: 'Bartesian Professional Cocktail Machine',
      imageUrl:
        'https://m.media-amazon.com/images/I/71cC176W+mL._AC_SX679_.jpg',
      price: '$50.00',
      link: 'https://amzn.to/4fowM9o',
      showPlaceholder: true,
    },
    {
      title: 'Ninja SLUSHi with RapidChill Technology',
      imageUrl:
        'https://m.media-amazon.com/images/I/71+w3aZtRjL._AC_SX679_.jpg',
      price: '$45.00',
      link: 'https://www.amazon.com/Riedel-Nick-Nora-Cocktail-Glasses/dp/B07R8B7L1V',
      showPlaceholder: true,
    },
    {
      title: 'U-Taste Frozen Drink Slushie Machine',
      imageUrl:
        'https://m.media-amazon.com/images/I/81yHM6bY8FL._AC_SX679_.jpg',
      price: '$24.74',
      link: 'https://www.amazon.com/Cocktail-Codex-Fundamentals-Formulas-Evolutions/dp/1607749714',
      showPlaceholder: true,
    },
    {
      title: 'Cordless Cocktail Making Machine',
      imageUrl:
        'https://m.media-amazon.com/images/I/61wQXalBIiL._AC_SX679_.jpg',
      price: '$269.99',
      link: 'https://www.amazon.com/Bartesian-Premium-Cocktail-Machine-Drinks/dp/B07T435M1S',
      showPlaceholder: true,
    },
    {
      title: 'bev by BLACK+DECKER Cocktail Machine and Drink Maker',
      imageUrl:
        'https://m.media-amazon.com/images/I/71BVCgOXD0L._AC_SX679_.jpg',
      price: '$39.95',
      link: 'https://www.amazon.com/Hella-Cocktail-Co-Bitters-Variety/dp/B08V5QY3Q7',
      showPlaceholder: true,
    },
  ];

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
    private location: Location
  ) {
    if (this.isBrowser) {
      this.checkScreenWidth();
      this.siteBaseUrl = window.location.origin;
    } else {
      this.siteBaseUrl = '';
    }
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
      this.wheelListenerCleanup = () => {
        listElement.removeEventListener('wheel', handler as any);
      };
    });
  }

  ngOnInit(): void {
    this.allCocktailsSubscription = this.cocktailService
      .getCocktails(1, 1000)
      .subscribe({
        next: (response) => {
          this.allCocktails = response.data.sort((a, b) =>
            a.name.localeCompare(b.name)
          );
          this.subscribeToRouteParams();
        },
        error: () => {
          this.error = 'Could not load all cocktails for navigation.';
          this.subscribeToRouteParams();
        },
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

  private subscribeToRouteParams(): void {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const cocktailSlug = params.get('slug');
      if (cocktailSlug) {
        this.loadCocktailDetail(cocktailSlug);
      } else {
        this.error = 'Cocktail slug not found.';
        this.loading = false;
      }
    });
  }

  loadCocktailDetail(slug: string): void {
    this.loading = true;
    this.error = null;
    this.similarCocktails = [];
    this.cleanupSeo();

    const cachedCocktail = this.allCocktails.find((c) => c.slug === slug);
    if (cachedCocktail) {
      this.cocktail = cachedCocktail;
      this.loading = false;
      this.setNavigationCocktails(this.cocktail.external_id);
      this.loadSimilarCocktails();
      this.setSeoTagsAndSchema();
    } else {
      this.cocktailDetailSubscription = this.cocktailService
        .getCocktailBySlug(slug)
        .subscribe({
          next: (res: Cocktail | null) => {
            if (!res) {
              this.error = 'Cocktail not found.';
              this.loading = false;
              return;
            }
            this.cocktail = res;
            this.loading = false;
            this.setNavigationCocktails(this.cocktail.external_id);
            this.loadSimilarCocktails();
            this.setSeoTagsAndSchema();
          },
          error: () => {
            this.error = 'Could not load cocktail details from API.';
            this.loading = false;
          },
        });
    }
  }

  loadSimilarCocktails(): void {
    if (!this.cocktail) {
      this.similarCocktails = [];
      return;
    }
    this.similarCocktailsSubscription = this.cocktailService
      .getSimilarCocktails(this.cocktail)
      .subscribe({
        next: (res: Cocktail[]) => {
          this.similarCocktails = res as CocktailWithLayoutAndMatch[];
        },
        error: () => {
          this.similarCocktails = [];
        },
      });
  }

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

  /** ✅ Uniforme al listato: 1 ad ogni 6 card (evita ad finale “di coda”) */
  getCocktailsAndAds(): any[] {
    const items: any[] = [];
    const len = this.similarCocktails.length;
    this.similarCocktails.forEach((cocktail, index) => {
      items.push(cocktail);
      if ((index + 1) % 6 === 0 && index < len - 1) {
        items.push({ isAd: true });
      }
    });
    return items;
  }

  isCocktail(item: any): boolean {
    return item && !item.isAd;
  }

  private getFullSiteUrl(path: string): string {
    return `${this.siteBaseUrl}${path}`;
  }

  private setSeoTagsAndSchema(): void {
    if (!this.cocktail) return;

    const cocktailName = this.cocktail.name;
    const cocktailDescription =
      this.cocktail.ai_description || this.cocktail.instructions;
    const cocktailImageUrl = this.getCocktailImageUrl(this.cocktail); // ✅ hero LCP
    const cocktailUrl = this.getFullSiteUrl(this.router.url);

    this.titleService.setTitle(`${cocktailName} | Fizzando`);
    this.metaService.updateTag({
      name: 'description',
      content: cocktailDescription,
    });

    const canonicalTag: HTMLLinkElement | null = this.document.querySelector(
      'link[rel="canonical"]'
    );
    if (canonicalTag) {
      canonicalTag.setAttribute('href', cocktailUrl);
    } else {
      const linkTag = this.renderer.createElement('link');
      this.renderer.setAttribute(linkTag, 'rel', 'canonical');
      this.renderer.setAttribute(linkTag, 'href', cocktailUrl);
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
    this.metaService.updateTag({ property: 'og:url', content: cocktailUrl });
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

    // ✅ PRELOAD hero LCP (evita duplicati)
    const existing = this.document.querySelector<HTMLLinkElement>(
      'link[rel="preload"][as="image"][data-preload-hero="1"]'
    );
    if (!existing && cocktailImageUrl) {
      const preload = this.renderer.createElement('link') as HTMLLinkElement;
      this.renderer.setAttribute(preload, 'rel', 'preload');
      this.renderer.setAttribute(preload, 'as', 'image');
      this.renderer.setAttribute(preload, 'href', cocktailImageUrl);
      this.renderer.setAttribute(
        preload,
        'imagesizes',
        '(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 33vw'
      );
      this.renderer.setAttribute(preload, 'data-preload-hero', '1');
      this.renderer.appendChild(this.document.head, preload);
    }

    this.addJsonLdSchema();
  }

  private addJsonLdSchema(): void {
    if (!this.cocktail) return;
    this.cleanupJsonLd();

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
      this.renderer.createText(
        JSON.stringify(this.generateCocktailSchema(this.cocktail))
      )
    );
    this.renderer.appendChild(this.document.head, this.cocktailSchemaScript);
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

    // ✅ rimuovi eventuale preload hero precedente
    const oldPreload = this.document.querySelector(
      'link[rel="preload"][as="image"][data-preload-hero="1"]'
    );
    if (oldPreload) {
      this.renderer.removeChild(this.document.head, oldPreload);
    }
  }

  private cleanupJsonLd(): void {
    const oldScript = this.document.getElementById('cocktail-schema');
    if (oldScript) {
      this.renderer.removeChild(this.document.head, oldScript);
    }
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
      description: cocktail.ai_description || cocktail.instructions,
      author: { '@type': 'Organization', name: 'Fizzando' },
      datePublished: cocktail.createdAt,
      recipeCategory: cocktail.category || 'Cocktail',
      recipeCuisine: 'Contemporary',
      keywords: [
        cocktail.category,
        cocktail.alcoholic,
        ...cocktail.ingredients_list.map((i: any) => i.ingredient.name),
      ]
        .filter(Boolean)
        .join(', '),
      recipeYield: '1 serving',
      totalTime: 'PT5M',
      nutrition: {
        '@type': 'NutritionInformation',
        calories: 'Approx 180 calories',
      },
      recipeIngredient: cocktail.ingredients_list.map((i: any) =>
        i.measure ? `${i.measure} ${i.ingredient.name}` : i.ingredient.name
      ),
      recipeInstructions: [
        { '@type': 'HowToStep', text: cocktail.instructions },
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
          text: `Alcohol Content: ${cocktail.ai_alcohol_content}`,
        },
      ].filter(Boolean),
      mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    };
  }
}
