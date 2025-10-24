import { CommonModule, DOCUMENT } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  Renderer2,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';

import { HUB_CATALOG, HubItem, HubKind } from './hub.catalog';
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';
// se usi anche altri DS components nella lista e vuoi riusarli qui, importali allo stesso modo
// import { AffiliateProductComponent } from '../../assets/design-system/affiliate-product/affiliate-product.component';
// import { FacetChipsComponent } from '../../assets/design-system/chips/facet-chips.component';

import { env } from '../../config/env'; // come in cocktail-list

type TextSeg =
  | { kind: 'text'; value: string; emphasis?: 'strong' }
  | {
      kind: 'routerLink';
      label: string;
      commands: any[];
      queryParams?: any;
      fragment?: string;
      emphasis?: 'strong';
    }
  | {
      kind: 'externalLink';
      label: string;
      href: string;
      target?: string;
      rel?: string;
      emphasis?: 'strong';
    };

interface KeyFeature {
  icon: string;
  title: string;
  segments: TextSeg[];
}
interface FaqEntry {
  question: string;
  answer: TextSeg[];
}

const HUB_TITLES: Record<HubKind, string> = {
  method: 'Browse Cocktails by Method - Fizzando',
  glass: 'Browse Cocktails by Glass - Fizzando',
  category: 'Browse Cocktails by Category - Fizzando',
  alcoholic: 'Browse Cocktails by Alcoholic Type - Fizzando',
};
const HUB_DESCRIPTIONS: Record<HubKind, string> = {
  method: 'Explore cocktails by method and jump into curated lists.',
  glass: 'Explore cocktails by glass and jump into curated lists.',
  category: 'Explore cocktails by category and jump into curated lists.',
  alcoholic: 'Explore cocktails by alcoholic type and jump into curated lists.',
};
const HUB_HEADINGS: Record<HubKind, string> = {
  method: 'Cocktail Methods',
  glass: 'Cocktail Glasses',
  category: 'Cocktail Categories',
  alcoholic: 'Alcoholic Profiles',
};
const HUB_H2: Record<HubKind, string> = {
  method: 'Techniques to mix, shake, stir and more',
  glass: 'Choose the right glass for the right serve',
  category: 'Families and flavor-forward collections',
  alcoholic: 'From non-alcoholic to full-strength',
};
const HUB_KEY_FEATURES: Record<HubKind, KeyFeature[]> = {
  method: [
    {
      icon: '🧊',
      title: 'Dilution & Texture',
      segments: [
        { kind: 'text', value: 'Shaking aerates and chills; ' },
        { kind: 'text', value: 'stirring', emphasis: 'strong' },
        { kind: 'text', value: ' dona chiarezza e setosità.' },
      ],
    },
    {
      icon: '⏱️',
      title: 'Speed of service',
      segments: [
        { kind: 'text', value: 'Built è rapido e minimale al banco.' },
      ],
    },
  ],
  glass: [
    {
      icon: '🥂',
      title: 'Aromi e temperatura',
      segments: [
        { kind: 'text', value: 'Il calice guida aroma e dispersione CO₂.' },
      ],
    },
    {
      icon: '🧊',
      title: 'Ghiaccio e diluizione',
      segments: [
        {
          kind: 'text',
          value: 'Rocks → sorsi lenti; Highball → effervescenza.',
        },
      ],
    },
  ],
  category: [
    {
      icon: '🍋',
      title: 'Sour & Sparkling',
      segments: [
        { kind: 'text', value: 'Acidità, zucchero e bollicine in equilibrio.' },
      ],
    },
    {
      icon: '🍹',
      title: 'Tropical & Punch',
      segments: [
        { kind: 'text', value: 'Stratificazioni e garnish scenografici.' },
      ],
    },
  ],
  alcoholic: [
    {
      icon: '0️⃣',
      title: 'Zero/Low-ABV',
      segments: [
        {
          kind: 'text',
          value: 'Alterna opzioni leggere senza sacrificare sapore.',
        },
      ],
    },
    {
      icon: '🥃',
      title: 'Full-strength',
      segments: [
        { kind: 'text', value: 'Classici stirred per profili spirit-forward.' },
      ],
    },
  ],
};
const HUB_FAQ: Record<HubKind, FaqEntry[]> = {
  method: [
    {
      question: 'Quando si scuote e quando si mescola?',
      answer: [
        { kind: 'text', value: 'Succhi/dairy → ' },
        { kind: 'text', value: 'shake', emphasis: 'strong' },
        { kind: 'text', value: '; solo spirito → ' },
        { kind: 'text', value: 'stir', emphasis: 'strong' },
        { kind: 'text', value: '.' },
      ],
    },
  ],
  glass: [
    {
      question: 'Perché il bicchiere cambia il gusto?',
      answer: [
        {
          kind: 'text',
          value:
            'Aroma, temperatura e diluizione percepita cambiano con la forma.',
        },
      ],
    },
  ],
  category: [
    {
      question: 'A cosa servono le categorie?',
      answer: [
        {
          kind: 'text',
          value: 'A trovare rapidamente lo stile giusto per umore/occasione.',
        },
      ],
    },
  ],
  alcoholic: [
    {
      question: 'Come scelgo il profilo alcolico?',
      answer: [
        {
          kind: 'text',
          value:
            'Parti da low-ABV per lunghe sessioni; alza il tenore per sorsi lenti.',
        },
      ],
    },
  ],
};

@Component({
  selector: 'app-hub',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatIconModule, // ← come cocktail-list
    DevAdsComponent, // ← come cocktail-list
    // AffiliateProductComponent,
    // FacetChipsComponent,
  ],
  templateUrl: './hub.component.html',
  styleUrls: ['./hub.component.scss'],
})
export class HubComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly renderer = inject(Renderer2);
  private readonly doc = inject(DOCUMENT);
  private siteUrl = '';
  pageH1 = '';
  pageH2 = '';
  pageDescription = '';

  hubKind!: HubKind;
  items: HubItem[] = [];

  selectedTab: HubKind = 'method';
  alcoholicOptions = ['Alcoholic', 'Non Alcoholic', 'Optional Alcohol'];

  loading = false;
  error: string | null = null;
  totalItems = 0;

  keyFeaturesHeading = 'Key insights for this hub';
  keyFeatures: KeyFeature[] = [];
  faqHeading = 'Frequently asked questions';
  faqEntries: FaqEntry[] = [];
  faqStates = signal<{ isExpanded: boolean }[]>([]);

  // search (stessa firma della lista)
  private _search = signal<string>('');
  searchTerm() {
    return this._search();
  }
  setSearch(v: string) {
    this._search.set(v);
  }
  onSearchInput(ev: Event) {
    const v = (ev.target as HTMLInputElement).value || '';
    this._search.set(v);
    // stesso comportamento della lista: se vuoi, naviga a /cocktails?q=
    // this.router.navigate(['/cocktails'], { queryParams: { q: v || null, page: 1 } });
  }

  ngOnInit(): void {
    // Calcolo robusto della siteUrl: preferisce env.apiBaseUrl, poi window.location.origin (se esiste), poi fallback vuoto
    const originFromDoc = this.doc?.defaultView?.location?.origin || '';
    this.siteUrl = stripTrailingSlash(originFromDoc || this.siteUrl || '');

    this.hubKind = (this.route.snapshot.data['hub'] as HubKind) ?? 'method';
    this.selectedTab = this.hubKind;

    this.pageH1 = HUB_HEADINGS[this.hubKind];
    this.pageH2 = HUB_H2[this.hubKind];
    this.pageDescription = HUB_DESCRIPTIONS[this.hubKind];

    const t = HUB_TITLES[this.hubKind],
      d = HUB_DESCRIPTIONS[this.hubKind];
    this.title.setTitle(t);
    this.meta.updateTag({ name: 'description', content: d });
    this.meta.updateTag({ property: 'og:title', content: t });
    this.meta.updateTag({ property: 'og:description', content: d });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ name: 'robots', content: 'index,follow' });

    this.upsertCanonical();

    this.items = HUB_CATALOG[this.hubKind] ?? [];
    this.totalItems = this.items.length;

    this.keyFeatures = HUB_KEY_FEATURES[this.hubKind] ?? [];
    this.faqEntries = HUB_FAQ[this.hubKind] ?? [];
    this.faqStates.set(this.faqEntries.map(() => ({ isExpanded: false })));

    this.upsertJsonLd();
  }

  ngOnDestroy(): void {
    this.removeJsonLd();
  }

  onTabsKeydown(e: KeyboardEvent) {
    const order: HubKind[] = ['method', 'glass', 'category', 'alcoholic'];
    const idx = order.indexOf(this.selectedTab);
    if (e.key === 'ArrowRight') {
      this.selectTab(order[(idx + 1) % order.length]);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      this.selectTab(order[(idx - 1 + order.length) % order.length]);
      e.preventDefault();
    }
  }
  selectTab(kind: HubKind) {
    this.selectedTab = kind;
    const dest = {
      method: ['/cocktails/methods'],
      glass: ['/cocktails/glasses'],
      category: ['/cocktails/categories'],
      alcoholic: ['/cocktails/alcoholic'],
    }[kind];
    this.router.navigate(dest);
  }

  getActiveFiltersText(): string {
    return 'No filters active';
  }

  toggleFaq(i: number) {
    const next = [...this.faqStates()];
    next[i] = { isExpanded: !next[i].isExpanded };
    this.faqStates.set(next);
  }

  linkFor(item: HubItem): string[] {
    switch (this.hubKind) {
      case 'method':
        return ['/cocktails/method', item.slug];
      case 'glass':
        return ['/cocktails/glass', item.slug];
      case 'category':
        return ['/cocktails/category', item.slug];
      case 'alcoholic':
        return ['/cocktails/alcoholic', item.slug];
    }
  }

  // ————— SEO helpers (come lista: usa this.siteUrl) —————
  private currentAbsoluteUrl(): string {
    const path = this.router.url.startsWith('/')
      ? this.router.url
      : `/${this.router.url}`;
    return `${this.siteUrl}${path}`;
  }

  private hubRootAbsoluteUrl(): string {
    const root = {
      method: '/cocktails/methods',
      glass: '/cocktails/glasses',
      category: '/cocktails/categories',
      alcoholic: '/cocktails/alcoholic',
    }[this.hubKind];
    return `${this.siteUrl}${root}`;
  }

  private upsertCanonical(): void {
    const head = this.doc.head as HTMLElement;
    const prev = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (prev) prev.remove();
    const link = this.renderer.createElement('link') as HTMLLinkElement;
    link.setAttribute('rel', 'canonical');
    link.setAttribute('href', this.currentAbsoluteUrl());
    this.renderer.appendChild(head, link);
  }
  private upsertJsonLd(): void {
    this.removeJsonLd();
    const script = this.renderer.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'ld-json-hub';
    script.text = JSON.stringify(this.buildJsonLd());
    this.renderer.appendChild(this.doc.head, script);
  }
  private removeJsonLd(): void {
    const prev = this.doc.getElementById('ld-json-hub');
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
  }
  private buildJsonLd() {
    const pageUrl = this.currentAbsoluteUrl();
    const hubUrl = this.hubRootAbsoluteUrl();
    const hubName = this.pageH1;
    const description = HUB_DESCRIPTIONS[this.hubKind];

    const breadcrumbs = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: `${this.siteUrl}/`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Cocktails',
          item: `${this.siteUrl}/cocktails`,
        },
        { '@type': 'ListItem', position: 3, name: hubName, item: hubUrl },
      ],
    };

    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${hubName} – Index`,
      numberOfItems: this.items.length,
      itemListElement: this.items.map((it, idx) => ({
        '@type': 'ListItem',
        position: idx + 1,
        url: `${this.siteUrl}${this.linkFor(it).join('/')}`,
        name: it.label,
      })),
    };

    const collectionPage = {
      '@context': 'https://schema.org',
      '@type': ['WebPage', 'CollectionPage'],
      name: hubName,
      url: pageUrl,
      description,
      isPartOf: { '@type': 'WebSite', name: 'Fizzando', url: this.siteUrl },
      about: { '@type': 'Thing', name: hubName },
    };

    return [collectionPage, breadcrumbs, itemList];
  }
}

function stripTrailingSlash(u: string): string {
  return u.endsWith('/') ? u.slice(0, -1) : u;
}
