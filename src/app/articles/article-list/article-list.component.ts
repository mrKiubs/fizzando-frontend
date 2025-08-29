import {
  Component,
  OnInit,
  HostListener,
  Inject,
  OnDestroy,
  PLATFORM_ID,
  Renderer2,
} from '@angular/core';
import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ActivatedRoute,
  ParamMap,
  Router,
  RouterModule,
} from '@angular/router';
import { ArticleService, Article } from '../../services/article.service';
import { SidebarComponent } from '../../core/sidebar.component';
import { Meta, Title } from '@angular/platform-browser';
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';
import { ArticleCardComponent } from '../article-card/article-card.component';
import { env } from '../../config/env';
import { combineLatest, Subscription } from 'rxjs';

@Component({
  selector: 'app-article-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    SidebarComponent,
    DevAdsComponent,
    ArticleCardComponent,
  ],
  templateUrl: './article-list.component.html',
  styleUrls: ['./article-list.component.scss'],
})
export class ArticleListComponent implements OnInit, OnDestroy {
  // LIST DATA
  articles: Article[] = [];
  relatedArticles: Article[] = []; // ✅ usato dal template
  loading = false;
  error = '';

  // categoria
  categorySlug: string | null = null;
  categoryName = '';

  // SEO header
  mainTitle = '';
  subTitle = '';

  // PAGINAZIONE
  currentPage = 1;
  pageSize = 19;
  totalItems = 0;
  totalPages = 0;
  readonly paginationRange = 2;

  // ADS
  isMobile = false;
  readonly adEvery = 7;

  // SEO/Schema helpers
  private siteBaseUrl = '';
  private readonly isBrowser: boolean;

  private itemListSchemaScript?: HTMLScriptElement;
  private collectionSchemaScript?: HTMLScriptElement;
  private breadcrumbsSchemaScript?: HTMLScriptElement;

  private routeSub?: Subscription;

  constructor(
    private articleService: ArticleService,
    private route: ActivatedRoute,
    private router: Router,
    private metaService: Meta,
    private titleService: Title,
    private renderer: Renderer2,
    @Inject(DOCUMENT) private doc: Document,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      try {
        this.siteBaseUrl = window.location.origin;
      } catch {
        this.siteBaseUrl = '';
      }
    }
  }

  private pageDescriptions: {
    [key: string]: { title: string; description: string };
  } = {
    'all-articles': {
      title: 'All Articles & Guides',
      description:
        'Explore our comprehensive collection of articles and guides on the world of cocktails. Discover recipes, techniques, and insights.',
    },
    'default-category': {
      title: 'Articles & Guides',
      description:
        'Explore articles and guides on this specific topic. Dive into detailed insights and inspiring content.',
    },
  };

  ngOnInit() {
    this.checkScreenWidth();

    this.routeSub = combineLatest([
      this.route.paramMap,
      this.route.queryParams,
    ]).subscribe(([params, qp]: [ParamMap, any]) => {
      this.categorySlug = params.get('slug');
      this.currentPage = parseInt(qp['page'], 10) || 1;
      this.setupHeadersAndLoad();
    });
  }

  ngOnDestroy(): void {
    this.cleanupSeo();
    this.routeSub?.unsubscribe();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.checkScreenWidth();
  }

  private checkScreenWidth(): void {
    try {
      this.isMobile = window.innerWidth <= 600;
    } catch {
      this.isMobile = false;
    }
  }

  private setupHeadersAndLoad() {
    let currentInfo;
    let pageTitleSuffix = ' | Our Cocktail Guides';

    if (this.categorySlug) {
      this.categoryName = this.capitalizeSlug(this.categorySlug);
      currentInfo =
        this.pageDescriptions[this.categorySlug] ||
        this.pageDescriptions['default-category'];

      this.mainTitle = currentInfo.title;
      this.subTitle = `Category: ${this.categoryName} - ${currentInfo.description}`;
      pageTitleSuffix = ` | ${this.categoryName} Guides`;

      if (
        !this.pageDescriptions[this.categorySlug] &&
        this.categorySlug !== 'default-category'
      ) {
        this.subTitle = `Category: ${this.categoryName} - Explore articles and guides on this topic.`;
      }

      this.loadArticlesByCategory(
        this.categorySlug,
        this.currentPage,
        this.pageSize
      );
    } else {
      currentInfo = this.pageDescriptions['all-articles'];
      this.mainTitle = currentInfo.title;
      this.subTitle = currentInfo.description;
      this.loadAllArticles(this.currentPage, this.pageSize);
    }

    this.setPageMeta(
      this.mainTitleWithPage(this.mainTitle),
      this.subTitle,
      pageTitleSuffix
    );
  }

  // LOADERS
  loadAllArticles(page?: number, pageSize?: number) {
    const p = page ?? 1;
    const ps = pageSize ?? this.pageSize;

    this.loading = true;
    this.articleService.getArticles(p, ps).subscribe({
      next: (res) => {
        this.articles = res.data as Article[];
        this.totalItems = res.meta?.pagination?.total ?? 0;
        this.totalPages = res.meta?.pagination?.pageCount ?? 0;
        this.relatedArticles = this.pickRelated(this.articles, 6); // ✅ popola correlati
        this.loading = false;
        this.setSeoTagsAndSchemaList();
      },
      error: () => {
        this.error = 'Error loading articles.';
        this.loading = false;
        this.setPageMeta(
          'Error Loading Articles',
          'An error occurred while loading articles. Please try again later.',
          ' | Cocktail Guides'
        );
        this.relatedArticles = [];
        this.setSeoTagsAndSchemaList();
      },
    });
  }

  loadArticlesByCategory(slug: string, page?: number, pageSize?: number) {
    const p = page ?? 1;
    const ps = pageSize ?? this.pageSize;

    this.loading = true;
    this.articleService.getArticlesByCategorySlug(slug, p, ps).subscribe({
      next: (res) => {
        this.articles = res.data as Article[];
        this.totalItems = res.meta?.pagination?.total ?? 0;
        this.totalPages = res.meta?.pagination?.pageCount ?? 0;
        this.relatedArticles = this.pickRelated(this.articles, 6); // ✅ popola correlati
        this.loading = false;
        this.setSeoTagsAndSchemaList();
      },
      error: () => {
        this.error = 'Error loading articles for this category.';
        this.loading = false;
        const categoryDisplayName = this.capitalizeSlug(slug);
        this.setPageMeta(
          `Error Loading ${categoryDisplayName} Articles`,
          `An error occurred while loading articles for ${categoryDisplayName}. Please try again later.`,
          ` | ${categoryDisplayName} Guides`
        );
        this.relatedArticles = [];
        this.setSeoTagsAndSchemaList();
      },
    });
  }

  // Sceglie i correlati dalla lista corrente (semplice: primi N diversi)
  private pickRelated(list: Article[], max = 6): Article[] {
    if (!Array.isArray(list) || list.length === 0) return [];
    // se vuoi random: clona e mescola
    // const shuffled = [...list].sort(() => Math.random() - 0.5);
    // return shuffled.slice(0, max);
    return list.slice(0, Math.min(max, list.length));
  }

  // PAGINATORE
  goToPage(page: number) {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;

    this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { page },
        queryParamsHandling: 'merge',
      })
      .then(() => this.scrollToTop());
  }

  private scrollToTop(): void {
    if (!this.isBrowser) return;
    requestAnimationFrame(() => {
      try {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      } catch {
        window.scrollTo(0, 0);
      }
    });
  }

  buildUrlWithParams(patch: Record<string, string | number | null>): string {
    const path =
      this.router.url.split('?')[0] ||
      (this.categorySlug
        ? `/articles/category/${this.categorySlug}`
        : '/articles');

    const current = { ...this.route.snapshot.queryParams } as Record<
      string,
      any
    >;
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v === null) delete current[k];
      else current[k] = String(v);
    }
    const qs = new URLSearchParams(current as any).toString();
    return qs ? `${path}?${qs}` : path;
  }

  getVisiblePages(): number[] {
    const pages: number[] = [];
    const startPage = Math.max(2, this.currentPage - this.paginationRange);
    const endPage = Math.min(
      this.totalPages - 1,
      this.currentPage + this.paginationRange
    );
    for (let i = startPage; i <= endPage; i++) pages.push(i);
    return pages;
  }
  showFirstEllipsis(): boolean {
    return this.totalPages > 1 && this.currentPage > this.paginationRange + 1;
  }
  showLastEllipsis(): boolean {
    return (
      this.totalPages > 1 &&
      this.currentPage < this.totalPages - this.paginationRange
    );
  }

  // Utils
  getImageUrl(image?: { url?: string; formats?: any }): string {
    if (!image) return 'assets/images/placeholder_article.png';
    const url = image.formats?.thumbnail?.url ?? image.url ?? '';
    if (!url) return 'assets/images/placeholder_article.png';
    return url.startsWith('http') ? url : `${env.apiUrl}${url}`;
  }

  private getArticleImageUrl(a?: Article): string {
    if (!a) return this.getFullSiteUrl('/assets/og-default.png');
    if (a.imageUrl) {
      return a.imageUrl.startsWith('http')
        ? a.imageUrl
        : env.apiUrl + a.imageUrl;
    }
    return this.getImageUrl(a.image);
  }

  private capitalizeSlug(slug: string): string {
    return slug
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private mainTitleWithPage(base: string): string {
    return this.totalPages > 1
      ? `${base} (Page ${this.currentPage}${
          this.totalPages ? ' of ' + this.totalPages : ''
        })`
      : base;
  }

  private setPageMeta(title: string, description: string, suffix: string) {
    this.titleService.setTitle(`${title}${suffix}`);
    this.metaService.updateTag({ name: 'description', content: description });
  }

  trackByArticleId(_i: number, a: any) {
    return a.id ?? a.documentId ?? a.slug;
  }

  // Helpers URL assolute
  private getFullSiteUrl(pathOrUrl: string): string {
    if (!this.siteBaseUrl) return pathOrUrl;
    return pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.siteBaseUrl}${pathOrUrl}`;
  }

  private getCurrentPath(): string {
    return (
      this.router.url.split('?')[0] ||
      (this.categorySlug
        ? `/articles/category/${this.categorySlug}`
        : '/articles')
    );
  }

  // SEO dyn
  private buildDynamicTitle(): string {
    const base = this.categorySlug
      ? `${this.mainTitle || this.categoryName}`
      : `${this.mainTitle || 'Articles'}`;

    const pageSuffix =
      this.totalPages > 1
        ? ` (Page ${this.currentPage}${
            this.totalPages ? ' of ' + this.totalPages : ''
          })`
        : '';

    const brand = this.categorySlug
      ? ` | ${this.categoryName} Guides`
      : ' | Our Cocktail Guides';
    return `${base}${pageSuffix}${brand}`;
  }

  private truncate(text: string, maxLen: number): string {
    if (!text) return '';
    return text.length <= maxLen
      ? text
      : text.slice(0, maxLen - 1).trimEnd() + '…';
  }

  private buildDynamicDescription(): string {
    const parts: string[] = [];

    if (this.categorySlug) {
      parts.push(
        `Explore ${this.categoryName} articles and guides${
          this.totalItems ? ` (${this.totalItems} in archive)` : ''
        }`
      );
    } else {
      parts.push(
        this.totalItems
          ? `Browse ${this.totalItems} cocktail articles & guides`
          : 'Browse cocktail articles & guides'
      );
    }

    parts.push(
      'Discover recipes, techniques, history, innovation and more for enthusiasts and professionals'
    );

    return this.truncate(parts.join('. ') + '.', 158);
  }

  // Canonical / Prev / Next
  private setCanonicalLink(absUrl: string): void {
    const head = this.doc?.head;
    if (!head) return;

    let linkEl = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!linkEl) {
      linkEl = this.renderer.createElement('link');
      this.renderer.setAttribute(linkEl, 'rel', 'canonical');
      this.renderer.appendChild(head, linkEl);
    }
    this.renderer.setAttribute(linkEl, 'href', absUrl);
  }

  private setPrevNextLinks(
    prevAbs: string | null,
    nextAbs: string | null
  ): void {
    const head = this.doc?.head;
    if (!head) return;

    head
      .querySelectorAll('link[rel="prev"], link[rel="next"]')
      .forEach((el) => {
        this.renderer.removeChild(head, el);
      });

    if (prevAbs) {
      const prev = this.renderer.createElement('link');
      this.renderer.setAttribute(prev, 'rel', 'prev');
      this.renderer.setAttribute(prev, 'href', prevAbs);
      this.renderer.appendChild(head, prev);
    }
    if (nextAbs) {
      const next = this.renderer.createElement('link');
      this.renderer.setAttribute(next, 'rel', 'next');
      this.renderer.setAttribute(next, 'href', nextAbs);
      this.renderer.appendChild(head, next);
    }
  }

  // JSON-LD
  private cleanupJsonLdScript(ref?: HTMLScriptElement) {
    const head = this.doc?.head;
    if (!head || !ref) return;
    if (head.contains(ref)) {
      this.renderer.removeChild(head, ref);
    }
  }

  private addJsonLdItemList(): void {
    const head = this.doc?.head;
    if (!head) return;

    this.cleanupJsonLdScript(this.itemListSchemaScript);

    const script = this.renderer.createElement('script');
    this.renderer.setAttribute(script, 'type', 'application/ld+json');
    this.renderer.setAttribute(script, 'id', 'article-itemlist-schema');

    const pageAbsUrl = this.getFullSiteUrl(this.router.url);
    const itemListId = pageAbsUrl + '#itemlist';

    const startIndex = this.pageStart || 1;

    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': itemListId,
      name: this.mainTitle || 'Articles & Guides',
      inLanguage: 'en',
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      numberOfItems: this.totalItems,
      startIndex,
      url: pageAbsUrl,
      itemListElement: this.articles.map((a, i) => ({
        '@type': 'ListItem',
        position: startIndex + i,
        item: {
          '@type': 'Article',
          '@id': this.getFullSiteUrl(`/articles/${a.slug}`),
          url: this.getFullSiteUrl(`/articles/${a.slug}`),
          name: a.title,
          image: this.getArticleImageUrl(a),
        },
      })),
    };

    this.renderer.appendChild(
      script,
      this.renderer.createText(JSON.stringify(itemList))
    );
    this.renderer.appendChild(head, script);
    this.itemListSchemaScript = script as HTMLScriptElement;
  }

  private addJsonLdCollectionPageAndBreadcrumbs(
    pageTitle: string,
    pageDescription: string
  ): void {
    const head = this.doc?.head;
    if (!head) return;

    // CollectionPage
    this.cleanupJsonLdScript(this.collectionSchemaScript);
    const coll = this.renderer.createElement('script');
    this.renderer.setAttribute(coll, 'type', 'application/ld+json');
    this.renderer.setAttribute(coll, 'id', 'collectionpage-schema');

    const pageAbsUrl = this.getFullSiteUrl(this.router.url);
    const itemListId = pageAbsUrl + '#itemlist';
    const collectionPage = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: pageTitle.replace(/ \|.*$/, ''),
      description: pageDescription,
      url: pageAbsUrl,
      mainEntity: { '@id': itemListId },
    };
    this.renderer.appendChild(
      coll,
      this.renderer.createText(JSON.stringify(collectionPage))
    );
    this.renderer.appendChild(head, coll);
    this.collectionSchemaScript = coll as HTMLScriptElement;

    // BreadcrumbList
    this.cleanupJsonLdScript(this.breadcrumbsSchemaScript);
    const bc = this.renderer.createElement('script');
    this.renderer.setAttribute(bc, 'type', 'application/ld+json');
    this.renderer.setAttribute(bc, 'id', 'breadcrumbs-schema');

    const crumbs: Array<{ name: string; url: string }> = [
      { name: 'Home', url: this.getFullSiteUrl('/') },
      { name: 'Articles', url: this.getFullSiteUrl('/articles') },
    ];
    if (this.categorySlug) {
      crumbs.push({
        name: this.categoryName,
        url: this.getFullSiteUrl(`/articles/category/${this.categorySlug}`),
      });
    }

    const breadcrumbList = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        item: c.url,
      })),
    };
    this.renderer.appendChild(
      bc,
      this.renderer.createText(JSON.stringify(breadcrumbList))
    );
    this.renderer.appendChild(head, bc);
    this.breadcrumbsSchemaScript = bc as HTMLScriptElement;
  }

  // SEO: LIST
  private setSeoTagsAndSchemaList(): void {
    const title = this.buildDynamicTitle();
    const description = this.buildDynamicDescription();

    this.titleService.setTitle(title);
    this.metaService.updateTag({ name: 'description', content: description });

    const canonicalAbs = this.getFullSiteUrl(this.router.url);
    this.setCanonicalLink(canonicalAbs);

    const prevUrl =
      this.totalPages > 1 && this.currentPage > 1
        ? this.getFullSiteUrl(
            this.buildUrlWithParams({ page: this.currentPage - 1 })
          )
        : null;
    const nextUrl =
      this.totalPages > 1 && this.currentPage < this.totalPages
        ? this.getFullSiteUrl(
            this.buildUrlWithParams({ page: this.currentPage + 1 })
          )
        : null;
    this.setPrevNextLinks(prevUrl, nextUrl);

    const ogImage =
      this.articles.length > 0
        ? this.getArticleImageUrl(this.articles[0])
        : this.getFullSiteUrl('/assets/og-default.png');

    this.metaService.updateTag({ property: 'og:title', content: title });
    this.metaService.updateTag({
      property: 'og:description',
      content: description,
    });
    this.metaService.updateTag({ property: 'og:url', content: canonicalAbs });
    this.metaService.updateTag({ property: 'og:type', content: 'website' });
    this.metaService.updateTag({ property: 'og:image', content: ogImage });
    this.metaService.updateTag({
      property: 'og:site_name',
      content: 'Fizzando',
    });

    this.metaService.updateTag({
      name: 'twitter:card',
      content: 'summary_large_image',
    });
    this.metaService.updateTag({ name: 'twitter:title', content: title });
    this.metaService.updateTag({
      name: 'twitter:description',
      content: description,
    });
    this.metaService.updateTag({ name: 'twitter:image', content: ogImage });

    this.addJsonLdItemList();
    this.addJsonLdCollectionPageAndBreadcrumbs(title, description);
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

    const head = this.doc?.head;
    if (head) {
      head
        .querySelectorAll('link[rel="prev"], link[rel="next"]')
        .forEach((el) => {
          this.renderer.removeChild(head, el);
        });
    }

    this.cleanupJsonLdScript(this.itemListSchemaScript);
    this.cleanupJsonLdScript(this.collectionSchemaScript);
    this.cleanupJsonLdScript(this.breadcrumbsSchemaScript);
  }

  // Range visibile (1-based)
  get pageStart(): number {
    return this.totalItems > 0 ? (this.currentPage - 1) * this.pageSize + 1 : 0;
  }
  get pageEnd(): number {
    return this.totalItems > 0
      ? Math.min(this.currentPage * this.pageSize, this.totalItems)
      : 0;
  }
}
