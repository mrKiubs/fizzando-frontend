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
} from '@angular/core';
import {
  CommonModule,
  isPlatformBrowser,
  DOCUMENT,
  NgOptimizedImage,
} from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { forkJoin, Subscription, of } from 'rxjs';
import { DatePipe } from '@angular/common';
import { catchError, finalize, tap } from 'rxjs/operators';
import { env } from '../config/env';
import { Meta, Title } from '@angular/platform-browser';

// Services & types
import {
  CocktailService,
  Cocktail,
  StrapiImage,
  CocktailWithLayoutAndMatch,
} from '../services/strapi.service';
import { IngredientService, Ingredient } from '../services/ingredient.service';
import { ArticleService, Article } from '../services/article.service';

// Cards
import { CocktailCardComponent } from '../cocktails/cocktail-card/cocktail-card.component';
import { IngredientCardComponent } from '../ingredients/ingredient-card/ingredient-card.component';
import { ArticleCardComponent } from '../articles/article-card/article-card.component';
import { DevAdsComponent } from '../assets/design-system/dev-ads/dev-ads.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    RouterLink,
    CocktailCardComponent,
    IngredientCardComponent,
    ArticleCardComponent,
    DatePipe,
    DevAdsComponent,
    NgOptimizedImage, // immagini ottimizzate
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit, OnDestroy {
  allCocktails: Cocktail[] = [];
  featuredCocktails: CocktailWithLayoutAndMatch[] = [];
  latestCocktails: CocktailWithLayoutAndMatch[] = [];
  randomCocktail?: CocktailWithLayoutAndMatch;

  latestIngredients: Ingredient[] = [];
  latestArticles: Article[] = [];

  historyArticles: Article[] = [];
  techniquesArticles: Article[] = [];
  ingredientsArticles: Article[] = [];

  categoriesCount: Record<string, number> = {};
  topCocktailCategories: string[] = [];

  totalCocktails = 0;
  loading = true;
  error: string | null = null;

  isMobile = false;
  private dataSubscription?: Subscription;

  // SEO helpers
  private websiteScript?: HTMLScriptElement;
  private webpageScript?: HTMLScriptElement;
  private breadcrumbsScript?: HTMLScriptElement;

  // ---- Dependency Injection via inject() ----
  private cocktailService = inject(CocktailService);
  private ingredientService = inject(IngredientService);
  private articleService = inject(ArticleService);
  private meta = inject(Meta);
  private title = inject(Title);
  private renderer: Renderer2 = inject(Renderer2);
  private doc: Document = inject(DOCUMENT);
  private platformId: Object = inject(PLATFORM_ID);
  private readonly isBrowser: boolean = isPlatformBrowser(this.platformId);
  private cdr = inject(ChangeDetectorRef);
  // ------------------------------------------

  constructor() {
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
    this.applySeo(); // base SEO
  }

  ngOnDestroy(): void {
    this.dataSubscription?.unsubscribe();
    this.cleanupSeo();
  }

  loadDashboardData(): void {
    this.loading = true;
    this.error = null;

    // Riduciamo il carico: non 1000 ma 200 elementi per la home
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
        8,
        undefined,
        undefined,
        undefined,
        true,
        false
      ),
      articles: this.articleService.getLatestArticles(8),
      historyArticles: this.articleService.getArticlesByCategorySlug(
        'history',
        1,
        3
      ),
      techniquesArticles: this.articleService.getArticlesByCategorySlug(
        'techniques',
        1,
        3
      ),
      ingredientsArticles: this.articleService.getArticlesByCategorySlug(
        'ingredients',
        1,
        3
      ),
    })
      .pipe(
        tap(
          ({
            cocktailsResponse,
            ingredientsResponse,
            articles,
            historyArticles,
            techniquesArticles,
            ingredientsArticles,
          }) => {
            // Cocktails
            this.allCocktails = cocktailsResponse.data;
            this.totalCocktails =
              cocktailsResponse.meta?.pagination?.total ??
              this.allCocktails.length;

            this.featuredCocktails = this.allCocktails
              .slice(0, 10)
              .map((c) => ({ ...c, isTall: false, isWide: false }));

            this.latestCocktails = [...this.allCocktails]
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime()
              )
              .slice(0, 10)
              .map((c) => ({ ...c, isTall: false, isWide: false }));

            if (this.allCocktails.length > 0) {
              const randomIndex = Math.floor(
                Math.random() * this.allCocktails.length
              );
              this.randomCocktail = {
                ...this.allCocktails[randomIndex],
                isTall: false,
                isWide: false,
              };
            }

            // Cocktail categories (chips)
            this.categoriesCount = this.allCocktails.reduce((acc, cocktail) => {
              const cat = (cocktail.category || 'Unknown').trim();
              acc[cat] = (acc[cat] || 0) + 1;
              return acc;
            }, {} as Record<string, number>);

            this.topCocktailCategories = Object.entries(this.categoriesCount)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([name]) => name);

            // Ingredients & Articles
            this.latestIngredients = ingredientsResponse.data ?? [];
            this.latestArticles = articles ?? [];

            this.historyArticles = historyArticles?.data ?? [];
            this.techniquesArticles = techniquesArticles?.data ?? [];
            this.ingredientsArticles = ingredientsArticles?.data ?? [];
          }
        ),
        catchError((err) => {
          // eslint-disable-next-line no-console
          console.error('Dashboard load error:', err);
          this.error = 'Unable to load dashboard data. Please try again later.';
          return of(null);
        }),
        finalize(() => {
          this.loading = false;
          this.applySeo(true); // aggiorna description con conteggi
          this.cdr.markForCheck();
        })
      )
      .subscribe();
  }

  // ======== Immagini responsive / srcset ========
  getAbsoluteImageUrl(image: StrapiImage | null | undefined): string {
    if (!image?.url) {
      return 'https://placehold.co/360x360/e0e0e0/333333?text=No+Image';
    }
    return image.url.startsWith('http') ? image.url : env.apiUrl + image.url;
  }

  getBestImageUrl(image: StrapiImage | null | undefined, fallbackWidth = 360) {
    // Usa il formato più vicino tra quelli offerti da Strapi (thumbnail/small/medium/large)
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
      // prendi il più vicino al fallbackWidth
      const best = candidates.reduce((prev, cur) =>
        Math.abs(cur.w - fallbackWidth) < Math.abs(prev.w - fallbackWidth)
          ? cur
          : prev
      );
      return best.url.startsWith('http') ? best.url : env.apiUrl + best.url;
    }
    return this.getAbsoluteImageUrl(image);
  }

  getImageSrcSet(image: StrapiImage | null | undefined): string | null {
    const formats = (image as any)?.formats || null;
    if (!formats) return null;
    const parts: string[] = [];
    if (formats.thumbnail?.url && formats.thumbnail?.width) {
      parts.push(
        `${
          formats.thumbnail.url.startsWith('http')
            ? formats.thumbnail.url
            : env.apiUrl + formats.thumbnail.url
        } ${formats.thumbnail.width}w`
      );
    }
    if (formats.small?.url && formats.small?.width) {
      parts.push(
        `${
          formats.small.url.startsWith('http')
            ? formats.small.url
            : env.apiUrl + formats.small.url
        } ${formats.small.width}w`
      );
    }
    if (formats.medium?.url && formats.medium?.width) {
      parts.push(
        `${
          formats.medium.url.startsWith('http')
            ? formats.medium.url
            : env.apiUrl + formats.medium.url
        } ${formats.medium.width}w`
      );
    }
    if (formats.large?.url && formats.large?.width) {
      parts.push(
        `${
          formats.large.url.startsWith('http')
            ? formats.large.url
            : env.apiUrl + formats.large.url
        } ${formats.large.width}w`
      );
    }
    return parts.length ? parts.join(', ') : null;
  }

  // ======== trackBy per *ngFor (meno lavoro sul main-thread) ========
  trackByCocktail = (_: number, c: Cocktail | CocktailWithLayoutAndMatch) =>
    (c as any)?.id ?? (c as any)?.slug ?? _;
  trackByIngredient = (_: number, i: Ingredient) =>
    (i as any)?.id ?? (i as any)?.slug ?? _;
  trackByArticle = (_: number, a: Article) =>
    (a as any)?.id ?? (a as any)?.slug ?? _;
  trackByString = (_: number, s: string) => s ?? _;
  // ---------------- SEO / Schema.org ----------------
  private applySeo(updateDescWithCounts = false): void {
    const baseUrl =
      (this.isBrowser && typeof window !== 'undefined'
        ? window.location.origin
        : '') || '';

    const canonical = baseUrl ? `${baseUrl}/` : '/';
    const title = 'Fizzando — Cocktails, Ingredients & Articles';

    const parts: string[] = [
      'Explore cocktail recipes, ingredient profiles and practical guides',
    ];
    if (updateDescWithCounts && this.totalCocktails > 0) {
      parts.unshift(`Browse ${this.totalCocktails}+ cocktails`);
    }
    const description = parts.join('. ') + '.';

    // Title + meta
    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });

    // Canonical
    const head = this.doc.head;
    let linkEl = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!linkEl) {
      linkEl = this.renderer.createElement('link');
      this.renderer.setAttribute(linkEl, 'rel', 'canonical');
      this.renderer.appendChild(head, linkEl);
    }
    this.renderer.setAttribute(linkEl, 'href', canonical);

    // OG / Twitter
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:url', content: canonical });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:site_name', content: 'Fizzando' });

    this.meta.updateTag({ name: 'twitter:card', content: 'summary' });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });

    // JSON-LD
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
      name: 'Fizzando — Cocktails, Ingredients & Articles',
      description,
      url: canonical,
      inLanguage: 'en',
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
}
