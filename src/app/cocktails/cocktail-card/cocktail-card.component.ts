import {
  Component,
  Input,
  OnInit,
  HostListener,
  inject,
  signal,
  PLATFORM_ID,
  SimpleChanges,
  ChangeDetectionStrategy,
} from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { trigger, style, animate, transition } from '@angular/animations';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { env } from '../../config/env';
import {
  CocktailIngredientListItem,
  CocktailWithLayoutAndMatch,
  StrapiImage,
} from '../../services/strapi.service';
import { CocktailChipComponent } from '../../assets/design-system/chips/cocktail-chip.component';

type HighlightKind =
  | 'motto'
  | 'service'
  | 'family'
  | 'overlap'
  | 'method'
  | 'glass'
  | 'fallback';

type ActiveVariant =
  | 'glass'
  | 'method'
  | 'category'
  | 'alcoholic'
  | 'ingredient';

@Component({
  selector: 'app-cocktail-card',
  standalone: true,
  imports: [CommonModule, MatIconModule, RouterLink, CocktailChipComponent],
  templateUrl: './cocktail-card.component.html',
  styleUrls: ['./cocktail-card.component.scss'],
  animations: [
    trigger('cardAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(20px)' }),
        animate('300ms ease-out', style({ opacity: 1, transform: 'none' })),
      ]),
      transition(':leave', [
        animate(
          '200ms ease-in',
          style({ opacity: 0, transform: 'translateY(10px)' })
        ),
      ]),
    ]),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CocktailCardComponent implements OnInit {
  @Input() cocktail!: CocktailWithLayoutAndMatch;
  @Input() totalSelectedIngredientsCount = 0;
  @Input() lazyLoadImage = true;
  @Input() isLcp = false;

  /** CONTEXT: chi sta governando il listato? */
  @Input() activeVariant?: ActiveVariant;
  /** Per glass/method/category/alcoholic: passa lo slug normalizzato dell’elenco corrente */
  @Input() activeSlug?: string;
  /** Per ingredient lists: passa l'ID (o slug) dell’ingrediente corrente */
  @Input() activeIngredientId?: string | number;

  /** Modalità banner per Article Detail (compatta, orizzontale) */
  @Input() asArticleBanner = false;
  /** Label in alto al banner */
  @Input() bannerLabel = 'This article is about';

  @Input() priorityIngredientName?: string; // oppure priorityIngredientSlug/Id se preferisci

  isMobile = false;
  public fontsLoaded = false;
  mainIngredientsFormatted: string[] = [];

  @Input() headingContext: string | null = null;
  private apiUrl = env.apiUrl;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  @Input() showCorrelation = false;

  constructor(public router: Router) {}

  // ========================
  // Lifecycle
  // ========================
  ngOnInit(): void {
    this.computeMainIngredientsFormatted();

    if (this.isBrowser && (document as any)?.fonts?.ready) {
      (document as any).fonts.ready.then(() => (this.fontsLoaded = true));
    } else if (this.isBrowser) {
      requestAnimationFrame(() => (this.fontsLoaded = true));
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cocktail'] || changes['priorityIngredientName']) {
      this.computeMainIngredientsFormatted();
    }
  }

  @HostListener('click', ['$event'])
  onCardClick(event: MouseEvent): void {
    if (!this.isBrowser) return;
    const target = event.target as HTMLElement | null;
    const clickedLinkOrButton = !!(
      target &&
      (target.closest('a') || target.closest('button'))
    );
    const isMobile =
      typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
    if (isMobile && !clickedLinkOrButton) {
      this.router.navigate(['/cocktails', this.cocktail.slug]);
    }
  }

  // ========================
  // “Colpo d’occhio”: ordine di importanza
  // ========================

  /** 1) Se disponibile, mostra direttamente il motto generato dal service */
  get displayMotto(): string | null {
    const txt = this.cocktail?.similarityMeta?.motto;
    return (txt && String(txt).trim()) || null;
  }

  /**
   * 2) Highlight primario deterministico quando il motto non c’è.
   * Priority:
   *   motto > service(method+glass) > family(cat+abv) > overlap > method > glass > fallback
   */
  get primaryHighlight(): { kind: HighlightKind; text: string } | null {
    const sm: any = this.cocktail?.similarityMeta || {};
    if (!sm) return null;

    if (sm.method && sm.glass) {
      const method = this.cocktail?.preparation_type || 'Serve';
      const glass = this.cocktail?.glass || 'glass';
      return { kind: 'service', text: `Same serve · ${method} in ${glass}` };
    }
    if (sm.cat && sm.abvClass) {
      const cat = this.cocktail?.category || 'Cocktail';
      return { kind: 'family', text: `Same family · ${cat}` };
    }
    if ((sm.ingredientOverlap ?? 0) >= 0.45) {
      return { kind: 'overlap', text: 'Shared flavor profile' };
    }
    if (sm.method) {
      const method = this.cocktail?.preparation_type || 'Serve';
      return { kind: 'method', text: `Same making gesture · ${method}` };
    }
    if (sm.glass) {
      const glass = this.cocktail?.glass || 'glass';
      return { kind: 'glass', text: `Same glass · ${glass}` };
    }

    //  NIENTE fallback "Related": se non c’è nulla di significativo, non mostrare
    return null;
  }

  /** 3) Riassunto compatto se vuoi mostrarlo come micro-label alternativa */
  get displaySummary(): string {
    const sm: any = this.cocktail?.similarityMeta || {};
    const factors = [
      sm.method ? 1 : 0,
      sm.glass ? 1 : 0,
      sm.cat ? 1 : 0,
      sm.abvClass ? 1 : 0,
      (sm.ingredientOverlap ?? 0) > 0.25 ? 1 : 0,
    ];
    const hits = factors.reduce((a, b) => a + b, 0);
    return hits >= 4 ? 'Strong match' : hits >= 3 ? 'Good match' : 'Related';
  }

  /** 4) Badge N/M degli ingredienti, derivato dall’overlap pesato */
  ingredientBadge(sm: any): { hit: number; total: number } | null {
    const total = this.cocktail?.ingredients_list?.length || 0;
    if (!total) return null;
    const overlap = Math.max(0, Math.min(1, sm?.ingredientOverlap ?? 0));
    const hit = Math.max(1, Math.round(overlap * total));
    return { hit, total };
  }

  // ========================
  // IMG helpers comuni
  // ========================

  private abs(u?: string | null): string {
    if (!u) return '';
    return /^https?:\/\//i.test(u)
      ? u
      : `${this.apiUrl}${u.startsWith('/') ? '' : '/'}${u}`;
  }

  private toWebp(u?: string | null): string {
    if (!u) return '';
    if (u.startsWith('assets/') || /\.webp(\?|$)/i.test(u)) return u;
    return u.replace(/\.(jpe?g|png)(\?.*)?$/i, '.webp$2');
  }

  private extWidth(name: string): number | undefined {
    switch (name) {
      case 'icon':
        return 40;
      case 'thumbnail':
        return 150;
      case 'small':
        return 320;
      case 'medium':
        return 640;
      case 'large':
        return 1024;
      default:
        return undefined;
    }
  }

  /** Regola: preferisci medium; se manca, fallback in ordine */
  getCocktailCardImageUrl(image: StrapiImage | null | undefined): string {
    if (!image) return 'assets/no-image.png';
    const f: any = image.formats || {};
    const pick =
      f?.medium?.url ||
      image.url ||
      f?.large?.url ||
      f?.small?.url ||
      f?.thumbnail?.url ||
      'assets/no-image.png';
    return this.abs(pick);
  }

  /** Crea srcset JPG/PNG includendo anche l’originale */
  srcsetFromFormatsJpg(img: StrapiImage | null | undefined): string {
    if (!img) return '';
    const f: any = img.formats || {};
    const origW =
      (img as any)?.width ?? f?.large?.width ?? f?.medium?.width ?? 1200;

    const candidates: Array<{ url?: string; w?: number }> = [
      { url: f?.thumbnail?.url, w: f?.thumbnail?.width ?? 150 },
      { url: f?.small?.url, w: f?.small?.width ?? 320 },
      { url: f?.medium?.url, w: f?.medium?.width ?? 640 },
      { url: f?.large?.url, w: f?.large?.width ?? 1024 },
      { url: img.url ?? undefined, w: origW },
    ];

    const parts = candidates
      .filter((c) => !!c.url && !!c.w && c.w! > 0)
      .sort((a, b) => a.w! - b.w!)
      .map((c) => `${this.abs(c.url!)} ${c.w}w`);

    return Array.from(new Set(parts)).join(', ');
  }

  /** Versione WebP coerente */
  srcsetFromFormatsWebp(img: StrapiImage | null | undefined): string {
    const jpg = this.srcsetFromFormatsJpg(img);
    if (!jpg) return '';
    const out = jpg
      .split(',')
      .map((s) => {
        const m = s.trim().match(/^(\S+)\s+(\d+)w$/);
        if (!m) return '';
        const url = m[1];
        const w = m[2];
        return `${this.toWebp(url)} ${w}w`;
      })
      .filter(Boolean);
    return Array.from(new Set(out)).join(', ');
  }

  /** Handler errore immagine */
  onCardImgError(evt: Event): void {
    const el = evt.target as HTMLImageElement;
    if ((el as any).__fallbackApplied) return;
    (el as any).__fallbackApplied = true;
    el.srcset = '';
    el.src = this.getCocktailCardImageUrl(this.cocktail?.image);
  }

  // ========================
  // IMG ingredient (icone 20x20)
  // ========================

  private getIngredientImageObj(ingredientName: string): StrapiImage | null {
    const found = this.cocktail?.ingredients_list?.find(
      (it) =>
        (it?.ingredient?.name || '').toLowerCase() ===
        (ingredientName || '').toLowerCase()
    );
    const img = (found as any)?.ingredient?.image;
    return img ?? null;
  }

  getIngredientIconUrlJpg(ingredient: string | any): string {
    let ingredientName = '';
    let img: StrapiImage | null | undefined = null;

    if (typeof ingredient === 'string') {
      ingredientName = ingredient;
      img = this.getIngredientImageObj(ingredientName);
    } else {
      ingredientName = ingredient?.ingredient?.name ?? ingredient?.name ?? '';
      img =
        ingredient?.ingredient?.image ??
        ingredient?.image ??
        this.getIngredientImageObj(ingredientName);
    }

    if (!img) return 'assets/no-image.png';
    const f: any = img.formats || {};
    const pick = f?.icon?.url || f?.thumbnail?.url || f?.small?.url || img.url;
    return pick ? this.abs(pick) : 'assets/no-image.png';
  }

  srcsetFromIngredientJpg(ingredientName: string): string {
    const img = this.getIngredientImageObj(ingredientName);
    if (!img) return '';
    const f: any = img.formats || {};
    const entries: Array<{ url?: string; w?: number; key?: string }> = [
      { url: f?.icon?.url, w: f?.icon?.width, key: 'icon' },
      { url: f?.thumbnail?.url, w: f?.thumbnail?.width, key: 'thumbnail' },
      { url: f?.small?.url, w: f?.small?.width, key: 'small' },
    ];
    if (img.url) entries.push({ url: img.url, w: undefined });

    const parts = entries
      .filter((e) => !!e.url)
      .map((e) => {
        const url = this.abs(e.url!);
        const w = e.w ?? (e.key ? this.extWidth(e.key) : undefined);
        return w ? `${url} ${w}w` : `${url}`;
      });
    return Array.from(new Set(parts)).join(', ');
  }

  srcsetFromIngredientWebp(ingredientName: string): string {
    const jpg = this.srcsetFromIngredientJpg(ingredientName);
    if (!jpg) return '';
    const out = jpg
      .split(',')
      .map((s) => {
        const m = s.trim().match(/^(\S+)(?:\s+(\d+w))?$/);
        if (!m) return '';
        const url = m[1];
        const w = m[2] || '';
        return `${this.toWebp(url)}${w ? ' ' + w : ''}`.trim();
      })
      .filter(Boolean);
    return Array.from(new Set(out)).join(', ');
  }

  // ========================
  // ID ingrediente per router
  // ========================

  getIngredientId(ingredientName: string): string {
    const found = this.cocktail?.ingredients_list?.find(
      (item) =>
        (item?.ingredient?.name || '').toLowerCase() ===
        (ingredientName || '').toLowerCase()
    );
    const id =
      (found as any)?.ingredient?.external_id ??
      (found as any)?.ingredient?.slug ??
      null;
    return id ? String(id) : this.slugify(ingredientName || '');
  }

  private slugify(s: string): string {
    return (
      (s || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'ingredient'
    );
  }

  // ========================
  // UI badges & icons
  // ========================

  get matchedIngredientsBadgeText(): {
    desktop: string;
    mobile: string;
  } | null {
    if (
      !this.cocktail ||
      this.cocktail.matchedIngredientCount === undefined ||
      !this.cocktail.ingredients_list ||
      this.cocktail.matchedIngredientCount <= 0
    )
      return null;

    const isPerfect =
      this.cocktail.matchedIngredientCount ===
      this.cocktail.ingredients_list.length;

    return isPerfect
      ? { desktop: 'All ingredients covered!', mobile: '&#10003;' }
      : {
          desktop: `${this.cocktail.matchedIngredientCount} of ${this.cocktail.ingredients_list.length} ingredients`,
          mobile: '!',
        };
  }

  getPreparationIcon(type: string | undefined | null): string {
    if (!type) return '';
    switch ((type || '').toLowerCase()) {
      case 'shaken':
        return '🍸';
      case 'stirred':
        return '🥄';
      case 'built in glass':
        return '🥂';
      case 'blended':
        return '🥤';
      case 'layered':
        return '🌈';
      case 'muddled':
        return '🌿';
      case 'frozen':
        return '❄️';
      case 'throwing':
        return '💧';
      default:
        return '❓';
    }
  }

  getGlassIcon(glassType: string | undefined | null): string {
    if (!glassType) return '';
    switch (glassType) {
      case 'Highball glass':
      case 'Highball Glass':
      case 'Collins glass':
      case 'Collins Glass':
        return '🥤';
      case 'Cocktail glass':
      case 'Cocktail Glass':
      case 'Martini Glass':
      case 'Nick and Nora Glass':
        return '🍸';
      case 'Old-fashioned glass':
      case 'Whiskey glass':
      case 'Whiskey Glass':
      case 'Whiskey sour glass':
      case 'Cordial glass':
      case 'Pousse cafe glass':
        return '🥃';
      case 'Brandy snifter':
      case 'White wine glass':
      case 'Wine glass':
      case 'Wine Glass':
      case 'Balloon Glass':
        return '🍷';
      case 'Champagne flute':
      case 'Champagne Flute':
        return '🥂';
      case 'Shot glass':
        return '🍶';
      case 'Coffee mug':
      case 'Coffee Mug':
      case 'Irish coffee cup':
        return '☕';
      case 'Beer glass':
      case 'Beer Glass':
      case 'Beer mug':
      case 'Pilsner glass':
      case 'Pint glass':
        return '🍺';
      case 'Margarita glass':
      case 'Coupe glass':
      case 'Hurricane glass':
        return '🍹';
      case 'Jar':
      case 'Mason jar':
        return '🍯';
      case 'Punch bowl':
        return '🥣';
      case 'Copper Mug':
        return '🧉';
      default:
        return '🥛';
    }
  }

  // ========================
  // srcset “capped”
  // ========================

  private getCandidates(
    img: StrapiImage | null | undefined
  ): Array<{ url: string; w: number; key?: string }> {
    if (!img) return [];
    const f: any = img.formats || {};

    const origW =
      (img as any)?.width ?? f?.large?.width ?? f?.medium?.width ?? 1200;

    const rows: Array<{ url?: string; w?: number; key?: string }> = [
      {
        url: f?.thumbnail?.url,
        w: f?.thumbnail?.width ?? 150,
        key: 'thumbnail',
      },
      { url: f?.small?.url, w: f?.small?.width ?? 320, key: 'small' },
      { url: f?.medium?.url, w: f?.medium?.width ?? 640, key: 'medium' },
      { url: f?.large?.url, w: f?.large?.width ?? 1024, key: 'large' },
      { url: img.url ?? undefined, w: origW, key: 'original' },
    ];

    return rows
      .filter((r) => !!r.url)
      .map((r) => ({
        url: this.abs(r.url!),
        w: r.w ?? this.extWidth(r.key || '') ?? 0,
        key: r.key,
      }))
      .filter((r) => r.w > 0)
      .sort((a, b) => a.w - b.w);
  }

  srcsetMaxJpg(img: StrapiImage | null | undefined, maxW: number): string {
    const all = this.getCandidates(img);
    if (!all.length) return '';

    const hasMedium = all.some((c) => c.key === 'medium');
    const pick = hasMedium ? all.filter((c) => c.w <= maxW) : all;

    const list = pick.length ? pick : [all[0]];
    return list.map((c) => `${c.url} ${c.w}w`).join(', ');
  }

  srcsetMaxWebp(img: StrapiImage | null | undefined, maxW: number): string {
    const all = this.getCandidates(img);
    if (!all.length) return '';
    const hasMedium = all.some((c) => c.key === 'medium');
    const pick = hasMedium ? all.filter((c) => c.w <= maxW) : all;
    const list = pick.length ? pick : [all[0]];
    return list.map((c) => `${this.toWebp(c.url)} ${c.w}w`).join(', ');
  }

  // ========================
  // Breakpoint & mobile panel
  // ========================

  private _bo = inject(BreakpointObserver);
  isHandset = toSignal(
    this._bo.observe([Breakpoints.Handset]).pipe(map((r) => r.matches)),
    { initialValue: false }
  );

  mobileIngredientsPanelOpen = signal(false);
  toggleMobileIngredientsPanel() {
    this.mobileIngredientsPanelOpen.update((v) => !v);
  }

  // Due ingredienti sempre visibili (silo mobile-first)
  get _mobileInlineIngredients(): string[] {
    const list = (this.mainIngredientsFormatted ?? []) as string[];
    return list.slice(0, 2);
  }
  get _mobileMoreCount(): number {
    const list = (this.mainIngredientsFormatted ?? []) as string[];
    return Math.max(0, list.length - 2);
  }

  // TrackBy ingredienti
  trackByIngredient(index: number, ingredient: string): string {
    try {
      return this.getIngredientId(ingredient) || ingredient;
    } catch {
      return ingredient;
    }
  }

  public slugifySegment(v?: string | null, fallback = 'all'): string {
    const s = (v ?? '').trim();
    if (!s) return fallback;
    return s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  methodSlug(v?: string) {
    return (v || '').toLowerCase().replace(/\s+/g, '-');
  }
  glassSlug(v?: string) {
    return (v || '').toLowerCase().replace(/\s+/g, '-');
  }

  private computeMainIngredientsFormatted(): void {
    // Lista ingredienti come oggetti (Strapi): { ingredient: { name: string }, ... }
    const list = Array.isArray(this.cocktail?.ingredients_list)
      ? [...this.cocktail!.ingredients_list]
      : [];

    if (!list.length) {
      this.mainIngredientsFormatted = [];
      return;
    }

    const getName = (it: any) => (it?.ingredient?.name ?? '').trim();
    const norm = (s: string) => s.trim().toLowerCase();
    const pri = this.priorityIngredientName
      ? norm(this.priorityIngredientName)
      : null;

    const priority: any[] = [];
    const others: any[] = [];

    for (const ing of list) {
      const name = getName(ing);
      if (pri && name && norm(name) === pri) {
        priority.push(ing);
      } else {
        others.push(ing);
      }
    }

    const ordered = [...priority, ...others];

    this.mainIngredientsFormatted = Array.from(
      new Set(ordered.slice(0, 3).map(getName).filter(Boolean))
    );
  }

  isChipActive(
    variant: ActiveVariant,
    chipSlug: string | undefined | null
  ): boolean {
    if (!this.activeVariant || !chipSlug) return false;
    return this.activeVariant === variant && this.activeSlug === chipSlug;
  }

  isIngredientActive(ingredient: string): boolean {
    // Usa lo stesso metodo che usi per ricavare l’ID dell’ingrediente in card
    const id = this.getIngredientId(ingredient);
    return (
      this.activeVariant === 'ingredient' &&
      String(id) === String(this.activeIngredientId ?? '')
    );
  }
  private normalizeName(v: any): string {
    return (v ?? '').toString().trim().toLowerCase();
  }

  isPriorityIngredient(ing: any): boolean {
    // nel tuo template gli ingredienti sono stringhe ({{ ingredient }})
    return (
      !!this.priorityIngredientName &&
      this.normalizeName(ing) ===
        this.normalizeName(this.priorityIngredientName)
    );
  }
}
