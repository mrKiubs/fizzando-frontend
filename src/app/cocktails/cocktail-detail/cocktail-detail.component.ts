import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewInit,
  Renderer2,
  Inject,
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
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
import { HostListener } from '@angular/core';
import { AffiliateProductComponent } from '../../assets/design-system/affiliate-product/affiliate-product.component';
import { Title, Meta } from '@angular/platform-browser';

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
  ],
  templateUrl: './cocktail-detail.component.html',
  styleUrls: ['./cocktail-detail.component.scss'],
})
export class CocktailDetailComponent
  implements OnInit, OnDestroy, AfterViewInit
{
  cocktail: Cocktail | undefined;
  loading = true;
  error: string | null = null;
  allCocktails: Cocktail[] = [];
  currentCocktailIndex: number = -1;
  isMobile: boolean = false;
  private siteBaseUrl: string = '';
  private cocktailSchemaScript: HTMLScriptElement | undefined;

  @ViewChild('affiliateCardList') affiliateCardList!: ElementRef;
  productList = [
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
  productListRobot = [
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
  private routeSubscription: Subscription | undefined;
  private allCocktailsSubscription: Subscription | undefined;
  private similarCocktailsSubscription: Subscription | undefined;
  private cocktailDetailSubscription: Subscription | undefined;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cocktailService: CocktailService,
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document,
    private titleService: Title,
    private metaService: Meta
  ) {
    this.checkScreenWidth();
    this.siteBaseUrl = window.location.origin;
  }

  ngAfterViewInit(): void {
    if (this.affiliateCardList) {
      const listElement = this.affiliateCardList.nativeElement;
      listElement.addEventListener('wheel', (event: WheelEvent) => {
        event.preventDefault();
        listElement.scrollLeft += event.deltaY;
      });
    }
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
        error: (err: any) => {
          console.error('Error loading all cocktails for navigation:', err);
          this.error = 'Could not load all cocktails for navigation.';
          this.subscribeToRouteParams();
        },
      });
  }

  ngOnDestroy(): void {
    if (this.routeSubscription) {
      this.routeSubscription.unsubscribe();
    }
    if (this.allCocktailsSubscription) {
      this.allCocktailsSubscription.unsubscribe();
    }
    if (this.similarCocktailsSubscription) {
      this.similarCocktailsSubscription.unsubscribe();
    }
    if (this.cocktailDetailSubscription) {
      this.cocktailDetailSubscription.unsubscribe();
    }
    // Pulizia completa dei meta tag e dello schema JSON-LD
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
    this.cleanupSeo(); // Pulisci i tag precedenti prima di caricare i nuovi dati

    const cachedCocktail = this.allCocktails.find((c) => c.slug === slug);
    if (cachedCocktail) {
      this.cocktail = cachedCocktail;
      this.loading = false;
      this.setNavigationCocktails(this.cocktail.external_id);
      this.loadSimilarCocktails();
      // Genera e inietta tutti gli elementi SEO
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
            // Genera e inietta tutti gli elementi SEO
            this.setSeoTagsAndSchema();
          },
          error: (err: any) => {
            console.error('Error loading cocktail details from API:', err);
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
        error: (err: any) => {
          console.error('Error loading similar cocktails:', err);
          this.similarCocktails = [];
        },
      });
  }

  setNavigationCocktails(currentExternalId: string): void {
    if (!this.allCocktails || this.allCocktails.length === 0) {
      console.warn('allCocktails not loaded, navigation might be incomplete.');
      return;
    }
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
    window.history.back();
  }

  getCocktailImageUrl(cocktail: Cocktail | undefined): string {
    if (cocktail && cocktail.image?.url) {
      if (cocktail.image.url.startsWith('http')) {
        return cocktail.image.url;
      }
      return env.apiUrl + cocktail.image.url;
    }
    return 'assets/no-image.png';
  }

  getIngredientImageUrl(ingredientEntry: any): string {
    if (ingredientEntry?.ingredient?.image?.url) {
      if (ingredientEntry.ingredient.image.url.startsWith('http')) {
        return ingredientEntry.ingredient.image.url;
      }
      return env.apiUrl + ingredientEntry.ingredient.image.url;
    }
    return 'assets/no-image.png';
  }

  @HostListener('window:resize', ['$event'])
  onResize(): void {
    this.checkScreenWidth();
  }

  checkScreenWidth(): void {
    this.isMobile = window.innerWidth <= 768;
  }

  getCocktailsAndAds(): any[] {
    const items: any = [];
    this.similarCocktails.forEach((cocktail, index) => {
      items.push(cocktail);
      if ((index + 1) % 4 === 0) {
        items.push({ isAd: true });
      }
    });
    return items;
  }

  isCocktail(item: any): boolean {
    return !item.isAd;
  }

  private getFullSiteUrl(path: string): string {
    return `${this.siteBaseUrl}${path}`;
  }

  private setSeoTagsAndSchema(): void {
    if (!this.cocktail) {
      return;
    }

    const cocktailName = this.cocktail.name;
    const cocktailDescription =
      this.cocktail.ai_description || this.cocktail.instructions;
    const cocktailImageUrl = this.getCocktailImageUrl(this.cocktail);
    const cocktailUrl = this.getFullSiteUrl(this.router.url);

    // Imposta il titolo della pagina
    this.titleService.setTitle(`${cocktailName} | Fizzando`);

    // Imposta la meta description per il SEO
    this.metaService.updateTag({
      name: 'description',
      content: cocktailDescription,
    });

    // Imposta il Canonical URL per prevenire problemi di contenuti duplicati
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

    // Imposta i meta tag Open Graph (per social media)
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

    // Imposta i meta tag Twitter Card (per Twitter)
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

    // Aggiungi lo schema JSON-LD
    this.addJsonLdSchema();
  }

  private addJsonLdSchema(): void {
    if (!this.cocktail) {
      return;
    }
    // Rimuove lo schema precedente se esiste
    this.cleanupJsonLd();

    // Crea il nuovo script
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
    // Pulisci i meta tag dinamici
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

    // Pulisci lo schema JSON-LD
    this.cleanupJsonLd();
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
      author: {
        '@type': 'Organization',
        name: 'Fizzando',
      },
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
      recipeIngredient: cocktail.ingredients_list.map((i: any) => {
        return i.measure
          ? `${i.measure} ${i.ingredient.name}`
          : i.ingredient.name;
      }),
      recipeInstructions: [
        {
          '@type': 'HowToStep',
          text: cocktail.instructions,
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
          text: `Alcohol Content: ${cocktail.ai_alcohol_content}`,
        },
      ].filter(Boolean),
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': pageUrl,
      },
    };
  }
}
