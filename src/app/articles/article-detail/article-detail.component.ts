import {
  Component,
  OnInit,
  OnDestroy,
  Inject,
  HostListener,
} from '@angular/core';
import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ArticleService, Article, Image } from '../../services/article.service';
import { MatIconModule } from '@angular/material/icon';
import { IngredientCardComponent } from '../../ingredients/ingredient-card/ingredient-card.component';
import { CocktailCardComponent } from '../../cocktails/cocktail-card/cocktail-card.component';
import { SidebarComponent } from '../../core/sidebar.component';
import { Meta, Title } from '@angular/platform-browser';
import { Renderer2, PLATFORM_ID } from '@angular/core';
import { env } from '../../config/env';
import { ArticleCardComponent } from '../article-card/article-card.component';
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';

@Component({
  selector: 'app-article-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatIconModule,
    IngredientCardComponent,
    CocktailCardComponent,
    SidebarComponent,
    ArticleCardComponent,
    DevAdsComponent,
  ],
  templateUrl: './article-detail.component.html',
  styleUrls: ['./article-detail.component.scss'],
})
export class ArticleDetailComponent implements OnInit, OnDestroy {
  article: Article | null = null;
  loading = true;
  error: string | null = null;
  private routeSub?: Subscription;

  // Responsive
  isMobile = false;
  private readonly isBrowser: boolean;

  // Preferenze immagine
  private supportsWebp = false;

  // "More from {Category}"
  firstCategory?: { name: string; slug?: string } | null = null;
  moreFromCategory: Article[] = [];

  // trackBy
  trackByArticleId = (_: number, item: Article) =>
    (item as any)?.id ?? (item as any)?.slug ?? _;

  constructor(
    private route: ActivatedRoute,
    private articleService: ArticleService,
    private title: Title,
    private meta: Meta,
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.checkScreenWidth(); // init client
      this.supportsWebp = this.checkWebpSupport();
    }
  }

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (slug) {
        this.fetchArticle(slug);
      } else {
        this.error = 'Articolo non trovato.';
        this.loading = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.removeJsonLd('article-jsonld');
    this.removeJsonLd('breadcrumb-jsonld');
  }

  // --- Resize listener (solo browser) ---
  @HostListener('window:resize')
  onResize(): void {
    if (this.isBrowser) this.checkScreenWidth();
  }

  private checkScreenWidth(): void {
    try {
      this.isMobile = this.isBrowser ? window.innerWidth <= 600 : false;
    } catch {
      this.isMobile = false;
    }
  }

  // ===== DATA LOAD =====
  private fetchArticle(slug: string): void {
    this.loading = true;
    this.moreFromCategory = [];
    this.firstCategory = null;

    this.articleService.getArticleBySlug(slug).subscribe({
      next: (data) => {
        this.article = data;
        if (!data) {
          this.error = 'Articolo non trovato.';
          this.loading = false;
          return;
        }

        this.fixArticleImages(data);
        this.applySeo(data);

        // Imposta prima categoria (se presente) e carica correlati
        const cat0 = (data.categories?.[0] as any) ?? null;
        this.firstCategory = cat0 ? { name: cat0.name, slug: cat0.slug } : null;

        this.loadMoreFromSameCocktail(data);

        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading article detail:', err);
        this.error = 'Unable to load the article details.';
        this.loading = false;
      },
    });
  }

  /** Carica articoli correlati in base al cocktail del corrente */
  private loadMoreFromSameCocktail(current: Article, limit = 4): void {
    const first = (current.related_cocktails ?? [])[0] as any;
    const cocktailId: number | undefined = first?.id ?? first?.documentId;

    if (!cocktailId) {
      this.moreFromCategory = [];
      this.firstCategory = null;
      return;
    }

    this.articleService
      .getArticlesByRelatedCocktailId(cocktailId, limit + 1)
      .subscribe({
        next: (list) => {
          const filtered = (list ?? [])
            .filter((a) => a.slug !== current.slug)
            .slice(0, limit);
          this.moreFromCategory = filtered;
          this.firstCategory = { name: first?.name || 'this cocktail' };
        },
        error: (err) => {
          console.error('Errore caricando correlati per cocktail:', err);
          this.moreFromCategory = [];
        },
      });
  }

  // ===== IMAGE URL FIX =====
  private fixSingleImage(image?: Image): void {
    if (!image?.url) return;
    if (!/^https?:\/\//i.test(image.url)) {
      image.url = `${env.apiBaseUrl ?? ''}${image.url}`;
    }
    if (image.formats) {
      for (const key in image.formats) {
        const f = (image.formats as any)[key];
        if (f?.url && !/^https?:\/\//i.test(f.url)) {
          f.url = `${env.apiBaseUrl ?? ''}${f.url}`;
        }
      }
    }
  }

  private fixArticleImages(article: Article): void {
    this.fixSingleImage(article.image);
    article.sections?.forEach((section) => this.fixSingleImage(section.image));
    article.related_cocktails?.forEach((c) => this.fixSingleImage(c.image));
    article.related_ingredients?.forEach((i) => this.fixSingleImage(i.image));
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

  /** Converte estensione nota in .webp mantenendo querystring */
  toWebp(url?: string | null): string | null {
    if (!url) return null;
    return url.replace(/\.(jpe?g|png)(\?.*)?$/i, '.webp$2');
  }

  /** Restituisce l’URL preferito (WebP se supportato) */
  getPreferred(originalUrl?: string | null): string | null {
    if (!originalUrl) return null;
    if (!this.supportsWebp) return originalUrl;
    const webp = this.toWebp(originalUrl);
    return webp || originalUrl;
  }

  /** Fallback automatico all’URL originale se la .webp fallisce */
  onImgError(evt: Event, originalUrl: string): void {
    const img = evt.target as HTMLImageElement | null;
    if (!img) return;
    // Evita loop: applica fallback una sola volta
    if ((img as any).__fallbackApplied) return;
    (img as any).__fallbackApplied = true;
    img.src = originalUrl;
  }

  // ===== SEO / META =====
  private applySeo(article: Article): void {
    const baseUrl =
      (typeof window !== 'undefined' && window.location?.origin) || '';

    const canonical = `${baseUrl}/articles/${article.slug}`;
    const title = article.title ?? 'Article';
    const description =
      article.introduction?.trim() ||
      (article.sections?.[0]?.content?.[0]?.children?.[0]?.text ?? '').slice(
        0,
        160
      ) ||
      'Explore our cocktail articles on Fizzando.';
    const ogImage =
      article.image?.formats?.medium?.url ||
      article.image?.formats?.large?.url ||
      article.image?.url ||
      undefined;

    // Title
    this.title.setTitle(`${title} | Fizzando`);

    // Meta
    this.setMetaTag('description', description);

    // Canonical
    this.setCanonical(canonical);

    // Open Graph
    this.setMetaProperty('og:title', `${title} | Fizzando`);
    this.setMetaProperty('og:description', description);
    this.setMetaProperty('og:type', 'article');
    this.setMetaProperty('og:url', canonical);
    if (ogImage) this.setMetaProperty('og:image', ogImage);
    this.setMetaProperty('og:site_name', 'Fizzando');

    // Twitter
    this.setMetaName(
      'twitter:card',
      ogImage ? 'summary_large_image' : 'summary'
    );
    this.setMetaName('twitter:title', `${title} | Fizzando`);
    this.setMetaName('twitter:description', description);
    if (ogImage) this.setMetaName('twitter:image', ogImage);

    // JSON-LD
    this.applyJsonLdArticle(article, canonical, ogImage, description, baseUrl);
    this.applyJsonLdBreadcrumb(article, canonical, baseUrl);
  }

  private setCanonical(url: string): void {
    const head = this.document.head;
    const prev = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (prev) head.removeChild(prev);

    const link = this.renderer.createElement('link');
    link.setAttribute('rel', 'canonical');
    link.setAttribute('href', url);
    this.renderer.appendChild(head, link);
  }

  private setMetaTag(name: string, content: string): void {
    if (!content) return;
    this.meta.updateTag({ name, content });
  }
  private setMetaProperty(property: string, content: string): void {
    if (!content) return;
    this.meta.updateTag({ property, content });
  }
  private setMetaName(name: string, content: string): void {
    if (!content) return;
    this.meta.updateTag({ name, content });
  }

  // ===== JSON-LD =====
  private applyJsonLdArticle(
    article: Article,
    canonical: string,
    ogImage: string | undefined,
    description: string,
    baseUrl: string
  ): void {
    const data: any = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.title ?? '',
      description,
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      image: ogImage ? [ogImage] : undefined,
      datePublished: article.publishedAt ?? undefined,
      dateModified: article.updatedAt ?? article.publishedAt ?? undefined,
      publisher: {
        '@type': 'Organization',
        name: 'Fizzando',
        logo: {
          '@type': 'ImageObject',
          url: `${baseUrl}/assets/logo-512.png`,
        },
      },
    };

    this.injectJsonLd('article-jsonld', data);
  }

  private applyJsonLdBreadcrumb(
    article: Article,
    canonical: string,
    baseUrl: string
  ): void {
    const firstCat = (article.categories?.[0] as any) ?? null;

    const items: any[] = [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${baseUrl}/` },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Articles',
        item: `${baseUrl}/articles`,
      },
    ];

    if (firstCat?.name) {
      items.push({
        '@type': 'ListItem',
        position: 3,
        name: firstCat.name,
        item: `${baseUrl}/articles/category/${firstCat.slug}`,
      });
      items.push({
        '@type': 'ListItem',
        position: 4,
        name: article.title ?? 'Article',
        item: canonical,
      });
    } else {
      items.push({
        '@type': 'ListItem',
        position: 3,
        name: article.title ?? 'Article',
        item: canonical,
      });
    }

    const data = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items,
    };

    this.injectJsonLd('breadcrumb-jsonld', data);
  }

  private injectJsonLd(id: string, data: unknown): void {
    this.removeJsonLd(id);
    const script = this.renderer.createElement('script');
    script.type = 'application/ld+json';
    script.id = id;
    script.text = JSON.stringify(data);
    this.renderer.appendChild(this.document.head, script);
  }

  private removeJsonLd(id: string): void {
    const prev = this.document.getElementById(id);
    if (prev) prev.remove();
  }
}
