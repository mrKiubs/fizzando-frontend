import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  HostListener,
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { CocktailCardComponent } from '../../cocktails/cocktail-card/cocktail-card.component';
import { Title, Meta } from '@angular/platform-browser';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';

import {
  CocktailService,
  CocktailWithLayoutAndMatch,
} from '../../services/strapi.service';
import {
  IngredientService,
  Ingredient,
} from '../../services/ingredient.service';
import { Subject, Subscription, Observable, of } from 'rxjs';
import {
  debounceTime,
  distinctUntilChanged,
  switchMap,
  map,
  startWith,
} from 'rxjs/operators';

import {
  trigger,
  state,
  style,
  transition,
  animate,
} from '@angular/animations';
import { env } from '../../config/env';
import { Renderer2 } from '@angular/core';

// 👇 componente ADV come nelle altre pagine
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';

interface FaqItemState {
  isExpanded: boolean;
}

@Component({
  selector: 'app-ingredient-search-cocktail-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    CocktailCardComponent,
    RouterLink,
    DevAdsComponent, // ✅ necessario per gli slot <app-dev-ads>
  ],
  templateUrl: './ingredient-search-cocktail-list.component.html',
  styleUrls: ['./ingredient-search-cocktail-list.component.scss'],
  animations: [
    trigger('faqAccordionAnimation', [
      state('void', style({ height: '0', opacity: 0, overflow: 'hidden' })),
      state(
        'collapsed',
        style({ height: '0', opacity: 0, overflow: 'hidden' })
      ),
      state('expanded', style({ height: '*', opacity: 1, overflow: 'hidden' })),
      transition('collapsed <=> expanded', [animate('0.3s ease-in-out')]),
      transition('void => expanded', [
        style({ height: '0', opacity: 0 }),
        animate('0.3s ease-in-out', style({ height: '*', opacity: 1 })),
      ]),
      transition('expanded => void', [
        style({ height: '*', opacity: 1 }),
        animate('0.3s ease-in-out', style({ height: '0', opacity: 0 })),
      ]),
    ]),
  ],
})
export class IngredientSearchCocktailListComponent
  implements OnInit, OnDestroy
{
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly renderer = inject(Renderer2);
  private readonly doc = inject(DOCUMENT) as Document;

  allIngredients: Ingredient[] = [];
  selectedIngredientIds: string[] = [];
  filteredIngredients: Ingredient[] = [];
  ingredientSearchTerm: string = '';

  perfectMatchCocktails: CocktailWithLayoutAndMatch[] = [];
  partialMatchCocktails: CocktailWithLayoutAndMatch[] = [];

  loadingIngredients = false;
  loadingCocktails = false;
  error: string | null = null;

  private ingredientsSearchTerms = new Subject<string>();
  private cocktailSearchTrigger = new Subject<string[]>();
  private subscriptions: Subscription[] = [];

  // ——— UI / ADV ———
  isMobile = false;
  adInterval = 6; // come nell’esempio: uno slot ogni 6 card
  fontsLoaded = true; // opzionale, se vuoi animazioni header coerenti

  // ——— SEO helpers ———
  private siteBaseUrl = '';
  private itemListSchemaScript?: HTMLScriptElement;
  private collectionSchemaScript?: HTMLScriptElement;
  private breadcrumbsSchemaScript?: HTMLScriptElement;
  private faqSchemaScript?: HTMLScriptElement;

  faqs: FaqItemState[] = [
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
  ];

  constructor(
    private cocktailService: CocktailService,
    private ingredientService: IngredientService,
    private titleService: Title,
    private metaService: Meta
  ) {
    if (typeof window !== 'undefined') {
      this.siteBaseUrl = window.location.origin;
      this.checkScreenWidth();
    }
  }

  // ========= LIFECYCLE =========
  ngOnInit(): void {
    this.setBaseSeo();
    this.loadAllIngredients();

    // Autocomplete locale
    this.subscriptions.push(
      this.ingredientsSearchTerms
        .pipe(
          startWith(''),
          debounceTime(200),
          distinctUntilChanged(),
          map((term) => term.trim().toLowerCase()),
          map((term) =>
            term
              ? this.allIngredients.filter((ingredient) =>
                  ingredient.name.toLowerCase().startsWith(term)
                )
              : this.allIngredients
          )
        )
        .subscribe((ingredients) => {
          this.filteredIngredients = ingredients;
        })
    );

    // Trigger ricerca cocktail + SEO dinamica
    this.subscriptions.push(
      this.cocktailSearchTrigger
        .pipe(
          debounceTime(300),
          distinctUntilChanged(
            (prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)
          ),
          switchMap((ids: string[]) => {
            this.loadingCocktails = true;
            this.perfectMatchCocktails = [];
            this.partialMatchCocktails = [];
            this.error = null;

            this.pushIdsToQuery(ids);

            if (ids.length === 0) {
              this.loadingCocktails = false;
              this.setDynamicSeo([], []);
              return of({ perfect: [], partial: [] });
            }

            const allPossibleMatches$: Observable<
              CocktailWithLayoutAndMatch[]
            > = this.cocktailService.getCocktailsByIngredientIds(ids, false);

            return allPossibleMatches$.pipe(
              map((allMatches) => {
                const perfect: CocktailWithLayoutAndMatch[] = [];
                const partial: CocktailWithLayoutAndMatch[] = [];

                allMatches.forEach((cocktail) => {
                  const matchedCount = cocktail.matchedIngredientCount || 0;
                  if (matchedCount === cocktail.ingredients_list.length) {
                    perfect.push(this.addLayoutProps(cocktail, matchedCount));
                  } else if (matchedCount > 0) {
                    partial.push(this.addLayoutProps(cocktail, matchedCount));
                  }
                });

                perfect.sort((a, b) =>
                  (a.name || '').localeCompare(b.name || '')
                );

                partial.sort((a, b) => {
                  if (
                    (b.matchedIngredientCount || 0) !==
                    (a.matchedIngredientCount || 0)
                  ) {
                    return (
                      (b.matchedIngredientCount || 0) -
                      (a.matchedIngredientCount || 0)
                    );
                  }
                  return (a.name || '').localeCompare(b.name || '');
                });

                return { perfect, partial };
              })
            );
          })
        )
        .subscribe({
          next: ({ perfect, partial }) => {
            this.perfectMatchCocktails = perfect;
            this.partialMatchCocktails = partial;
            this.loadingCocktails = false;
            this.setDynamicSeo(perfect, partial);
          },
          error: (err: any) => {
            console.error('Error loading cocktails by ingredients:', err);
            this.error = 'Unable to load cocktails. Please try again.';
            this.loadingCocktails = false;
            this.setDynamicSeo([], []);
          },
        })
    );

    // Leggo eventuale ?ids=...
    this.subscriptions.push(
      this.route.queryParamMap.subscribe((qp) => {
        const idsParam = (qp.get('ids') || '').trim();
        if (idsParam) {
          const ids = idsParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          if (
            JSON.stringify(ids) !== JSON.stringify(this.selectedIngredientIds)
          ) {
            this.selectedIngredientIds = ids;
            this.cocktailSearchTrigger.next(this.selectedIngredientIds);
          }
        } else {
          if (this.selectedIngredientIds.length === 0) {
            this.setDynamicSeo([], []);
          }
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.cleanupSeo();
  }

  // ========= RESPONSIVE =========
  @HostListener('window:resize')
  onResize(): void {
    this.checkScreenWidth();
  }
  private checkScreenWidth(): void {
    if (typeof window === 'undefined') return;
    this.isMobile = window.innerWidth <= 600;
  }

  // ========= DATA =========
  loadAllIngredients(): void {
    this.loadingIngredients = true;
    this.ingredientService.getIngredients(1, 1000).subscribe({
      next: (res) => {
        this.allIngredients = res.data;
        this.filteredIngredients = res.data;
        this.loadingIngredients = false;
      },
      error: (err: any) => {
        console.error('Error loading ingredients:', err);
        this.error = 'Unable to load ingredients list.';
        this.loadingIngredients = false;
      },
    });
  }

  // ========= UI =========
  onIngredientSearchTermChange(): void {
    this.ingredientsSearchTerms.next(this.ingredientSearchTerm);
  }

  toggleIngredientSelection(ingredientExternalId: string): void {
    const index = this.selectedIngredientIds.indexOf(ingredientExternalId);
    let updatedSelectedIds: string[];

    if (index > -1) {
      updatedSelectedIds = this.selectedIngredientIds.filter(
        (id) => id !== ingredientExternalId
      );
    } else {
      updatedSelectedIds = [
        ...this.selectedIngredientIds,
        ingredientExternalId,
      ];
    }

    this.selectedIngredientIds = updatedSelectedIds;
    this.cocktailSearchTrigger.next(this.selectedIngredientIds);
  }

  clearSelectedIngredients(): void {
    this.selectedIngredientIds = [];
    this.cocktailSearchTrigger.next([]);
    this.perfectMatchCocktails = [];
    this.partialMatchCocktails = [];
  }

  private addLayoutProps(
    cocktail: CocktailWithLayoutAndMatch,
    matchedCount?: number
  ): CocktailWithLayoutAndMatch {
    let isTall = cocktail.isTall || false;
    let isWide = cocktail.isWide || false;

    if (
      typeof cocktail.isTall === 'undefined' &&
      typeof cocktail.isWide === 'undefined'
    ) {
      const r = Math.random();
      if (r < 0.2) isTall = true;
      else if (r < 0.35) isWide = true;
    }

    return {
      ...cocktail,
      isTall,
      isWide,
      matchedIngredientCount: matchedCount,
    } as CocktailWithLayoutAndMatch;
  }

  getIngredientNameById(id: string): string {
    const ingredient = this.allIngredients.find((i) => i.external_id === id);
    return ingredient ? ingredient.name : id;
  }
  getIngredientById(id: string): Ingredient | undefined {
    return this.allIngredients.find((i) => i.external_id === id);
  }

  getIngredientImageUrlById(id: string): string {
    const ingredient = this.getIngredientById(id);
    if (ingredient && ingredient.image?.url) {
      if (ingredient.image.url.startsWith('http')) return ingredient.image.url;
      return env.apiUrl + ingredient.image.url;
    }
    return 'assets/no-image.png';
  }

  trackByIngredientId(_index: number, ingredient: Ingredient): string {
    return ingredient.external_id;
  }
  trackByCocktailId(
    _index: number,
    cocktail: CocktailWithLayoutAndMatch
  ): number {
    return cocktail.id;
  }

  toggleFaq(faqItem: FaqItemState): void {
    faqItem.isExpanded = !faqItem.isExpanded;
  }

  // ========= URL syncing =========
  private pushIdsToQuery(ids: string[]): void {
    const idsParam = ids.length ? ids.join(',') : null;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ids: idsParam },
      queryParamsHandling: 'merge',
      state: { suppressScroll: true },
      replaceUrl: true,
    });
  }

  // ========= SEO / JSON-LD =========
  private setBaseSeo(): void {
    const baseTitle = 'Find Cocktails by Ingredients | Fizzando';
    const baseDesc =
      'Select the ingredients you have and instantly discover cocktails you can make now, plus recipes that use some of your items.';

    this.titleService.setTitle(baseTitle);
    this.metaService.updateTag({ name: 'description', content: baseDesc });

    const canonicalAbs = this.getFullUrl(this.router.url || '/find-cocktail');
    this.setCanonicalLink(canonicalAbs);
    this.setOgTwitter({
      title: baseTitle,
      description: baseDesc,
      url: canonicalAbs,
      image: this.getDefaultOgImage(),
    });

    this.addJsonLdBreadcrumbs([
      { name: 'Home', url: this.getFullUrl('/') },
      { name: 'Find by Ingredients', url: canonicalAbs },
    ]);
    this.addJsonLdFaq();
  }

  private setDynamicSeo(
    perfect: CocktailWithLayoutAndMatch[],
    partial: CocktailWithLayoutAndMatch[]
  ): void {
    const names = this.selectedIngredientIds
      .map((id) => this.getIngredientNameById(id))
      .filter(Boolean);

    const selectionLabel = names.length
      ? `• ${names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''}`
      : '';

    const title =
      names.length > 0
        ? `Find by Ingredients ${selectionLabel} | Fizzando`
        : 'Find Cocktails by Ingredients | Fizzando';

    const descParts: string[] = [];
    if (names.length) descParts.push(`Selected: ${names.join(', ')}`);
    if (perfect.length || partial.length) {
      descParts.push(
        `Results: ${perfect.length} perfect match${
          perfect.length === 1 ? '' : 'es'
        }, ${partial.length} partial`
      );
    } else {
      descParts.push(
        'Select ingredients to discover cocktails you can make now and others for inspiration.'
      );
    }
    const description = this.truncate(descParts.join('. ') + '.', 158);

    this.titleService.setTitle(title);
    this.metaService.updateTag({ name: 'description', content: description });

    const canonicalAbs = this.getFullUrl(this.router.url || '/find-cocktail');
    this.setCanonicalLink(canonicalAbs);

    const ogImage =
      perfect[0]?.image?.formats?.thumbnail?.url ||
      partial[0]?.image?.formats?.thumbnail?.url ||
      this.getDefaultOgImage();
    this.setOgTwitter({
      title,
      description,
      url: canonicalAbs,
      image: ogImage.startsWith('http') ? ogImage : this.getFullUrl(ogImage),
    });

    const combined = [...perfect, ...partial];
    this.addJsonLdCollectionPage(
      title.replace(' | Fizzando', ''),
      description,
      canonicalAbs
    );
    this.addJsonLdItemList(combined, canonicalAbs);
  }

  private getDefaultOgImage(): string {
    return this.getFullUrl('/assets/og-default.png');
  }
  private getFullUrl(pathOrUrl: string): string {
    if (!this.siteBaseUrl) return pathOrUrl;
    return pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.siteBaseUrl}${
          pathOrUrl.startsWith('/') ? '' : '/'
        }${pathOrUrl}`;
  }
  private truncate(text: string, maxLen: number): string {
    if (!text) return '';
    return text.length <= maxLen
      ? text
      : text.slice(0, maxLen - 1).trimEnd() + '…';
  }

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
  private setOgTwitter(args: {
    title: string;
    description: string;
    url: string;
    image: string;
  }): void {
    this.metaService.updateTag({ property: 'og:title', content: args.title });
    this.metaService.updateTag({
      property: 'og:description',
      content: args.description,
    });
    this.metaService.updateTag({ property: 'og:url', content: args.url });
    this.metaService.updateTag({ property: 'og:type', content: 'website' });
    this.metaService.updateTag({ property: 'og:image', content: args.image });
    this.metaService.updateTag({
      property: 'og:site_name',
      content: 'Fizzando',
    });
    this.metaService.updateTag({
      name: 'twitter:card',
      content: 'summary_large_image',
    });
    this.metaService.updateTag({ name: 'twitter:title', content: args.title });
    this.metaService.updateTag({
      name: 'twitter:description',
      content: args.description,
    });
    this.metaService.updateTag({ name: 'twitter:image', content: args.image });
  }

  private addJsonLdItemList(
    cocktails: CocktailWithLayoutAndMatch[],
    pageAbsUrl: string
  ): void {
    const head = this.doc?.head;
    if (!head) return;
    this.cleanupJsonLdScript(this.itemListSchemaScript);
    const script = this.renderer.createElement('script');
    this.renderer.setAttribute(script, 'type', 'application/ld+json');
    this.renderer.setAttribute(script, 'id', 'ingredient-search-itemlist');

    const itemListId = pageAbsUrl + '#itemlist';
    const collectionId = pageAbsUrl + '#collection';
    const items = cocktails.map((c, idx) => {
      const url = this.getFullUrl(`/cocktails/${c.slug}`);
      const img =
        (c.image?.formats?.thumbnail?.url as string | undefined) ||
        this.getDefaultOgImage();
      return {
        '@type': 'ListItem',
        position: idx + 1,
        item: {
          '@type': 'Recipe',
          '@id': url,
          url,
          name: c.name,
          image: img.startsWith('http') ? img : this.getFullUrl(img),
          recipeCategory: 'Cocktail',
          brand: { '@type': 'Organization', name: 'Fizzando' },
        },
      };
    });

    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': itemListId,
      name: 'Find Cocktails by Ingredients',
      inLanguage: 'en',
      itemListOrder: 'https://schema.org/ItemListOrderDescending',
      numberOfItems: cocktails.length,
      url: pageAbsUrl,
      isPartOf: { '@id': collectionId },
      itemListElement: items,
    };

    this.renderer.appendChild(
      script,
      this.renderer.createText(JSON.stringify(itemList))
    );
    this.renderer.appendChild(head, script);
    this.itemListSchemaScript = script as HTMLScriptElement;
  }

  private addJsonLdCollectionPage(
    pageTitle: string,
    pageDescription: string,
    pageAbsUrl: string
  ): void {
    const head = this.doc?.head;
    if (!head) return;
    this.cleanupJsonLdScript(this.collectionSchemaScript);
    const coll = this.renderer.createElement('script');
    this.renderer.setAttribute(coll, 'type', 'application/ld+json');
    this.renderer.setAttribute(coll, 'id', 'ingredient-search-collection');

    const itemListId = pageAbsUrl + '#itemlist';
    const collectionId = pageAbsUrl + '#collection';

    const collectionPage = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': collectionId,
      name: pageTitle,
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
  }

  private addJsonLdBreadcrumbs(crumbs: { name: string; url: string }[]): void {
    const head = this.doc?.head;
    if (!head) return;
    this.cleanupJsonLdScript(this.breadcrumbsSchemaScript);
    const bc = this.renderer.createElement('script');
    this.renderer.setAttribute(bc, 'type', 'application/ld+json');
    this.renderer.setAttribute(bc, 'id', 'ingredient-search-breadcrumbs');

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

  private addJsonLdFaq(): void {
    const head = this.doc?.head;
    if (!head) return;
    this.cleanupJsonLdScript(this.faqSchemaScript);

    const script = this.renderer.createElement('script');
    this.renderer.setAttribute(script, 'type', 'application/ld+json');
    this.renderer.setAttribute(script, 'id', 'ingredient-search-faq');

    const faq = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'How does the "Find Your Cocktail" tool work?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Type your ingredients and select them; we show cocktails you can make now and others that use some of your items.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I select multiple ingredients?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes, select as many as you like. More ingredients yields more precise results.',
          },
        },
        {
          '@type': 'Question',
          name: 'What if I only have a few ingredients?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'You will likely see more partial matches for inspiration and future shopping.',
          },
        },
        {
          '@type': 'Question',
          name: 'How do I remove a selected ingredient?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Click the “x” on the chip or uncheck it in the suggestion list.',
          },
        },
      ],
    };

    this.renderer.appendChild(
      script,
      this.renderer.createText(JSON.stringify(faq))
    );
    this.renderer.appendChild(head, script);
    this.faqSchemaScript = script as HTMLScriptElement;
  }

  private cleanupJsonLdScript(ref?: HTMLScriptElement) {
    const head = this.doc?.head;
    if (!head || !ref) return;
    if (head.contains(ref)) this.renderer.removeChild(head, ref);
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
    if (head)
      head
        .querySelectorAll('link[rel="prev"], link[rel="next"]')
        .forEach((el) => this.renderer.removeChild(head, el));

    this.cleanupJsonLdScript(this.itemListSchemaScript);
    this.cleanupJsonLdScript(this.collectionSchemaScript);
    this.cleanupJsonLdScript(this.breadcrumbsSchemaScript);
    this.cleanupJsonLdScript(this.faqSchemaScript);
  }
}
