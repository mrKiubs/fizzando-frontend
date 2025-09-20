import {
  Component,
  Input,
  OnInit,
  HostListener,
  inject,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { trigger, style, animate, transition } from '@angular/animations';
import { env } from '../../config/env';
import {
  CocktailWithLayoutAndMatch,
  StrapiImage,
} from '../../services/strapi.service';

@Component({
  selector: 'app-cocktail-card',
  standalone: true,
  imports: [CommonModule, MatIconModule, RouterLink],
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
})
export class CocktailCardComponent implements OnInit {
  @Input() cocktail!: CocktailWithLayoutAndMatch;
  @Input() totalSelectedIngredientsCount = 0;
  @Input() lazyLoadImage = true;
  @Input() isLcp = false;

  /** Modalità banner per Article Detail (compatta, orizzontale) */
  @Input() asArticleBanner = false;
  /** Label in alto al banner */
  @Input() bannerLabel = 'This article is about';
  isMobile: boolean = false;
  mainIngredientsFormatted: string[] = [];
  public fontsLoaded = false;

  private apiUrl = env.apiUrl;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  constructor(private router: Router) {}

  ngOnInit(): void {
    if (this.cocktail?.ingredients_list) {
      this.mainIngredientsFormatted = this.cocktail.ingredients_list
        .map((item) => item.ingredient?.name)
        .filter((name): name is string => !!name)
        .slice(0, 3);
    }
    if (this.isBrowser && (document as any)?.fonts?.ready) {
      (document as any).fonts.ready.then(() => (this.fontsLoaded = true));
    } else if (this.isBrowser) {
      requestAnimationFrame(() => (this.fontsLoaded = true));
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

  // ------------------ IMG helpers comuni ------------------

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
  onCardImgError(evt: Event, jpgUrl: string): void {
    const img = evt.target as HTMLImageElement;
    if ((img as any).__fallbackApplied) return;
    (img as any).__fallbackApplied = true;
    img.srcset = '';
    img.src = jpgUrl;
  }

  // ------------------ IMG cocktail (card cover) ------------------

  srcsetFromFormatsJpg(img: StrapiImage | null | undefined): string {
    if (!img) return '';
    const f: any = img.formats || {};

    const candidates: Array<{ url?: string; w?: number }> = [
      { url: f?.thumbnail?.url, w: f?.thumbnail?.width ?? 150 },
      { url: f?.small?.url, w: f?.small?.width ?? 320 },
      { url: f?.medium?.url, w: f?.medium?.width ?? 640 },
      { url: f?.large?.url, w: f?.large?.width ?? 1024 },
      // 👉 originale con width reale (Strapi la fornisce)
      { url: img.url ?? undefined, w: (img as any)?.width },
    ];

    const parts = candidates
      .filter((c) => !!c.url && !!c.w && c.w! > 0)
      .sort((a, b) => a.w! - b.w!) // ordine crescente
      .map((c) => `${this.abs(c.url!)} ${c.w}w`);

    return Array.from(new Set(parts)).join(', ');
  }

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

  getCocktailCardImageUrl(image: StrapiImage | null | undefined): string {
    if (!image) return 'assets/no-image.png';
    const f: any = image.formats || {};
    const pick =
      f?.small?.url || f?.thumbnail?.url || f?.medium?.url || image.url;
    return pick ? this.abs(pick) : 'assets/no-image.png';
  }

  // ------------------ IMG ingredient (icone 20x20) ------------------

  /** Ritorna l’oggetto immagine Strapi dell’ingrediente (se esiste) */
  private getIngredientImageObj(ingredientName: string): StrapiImage | null {
    const found = this.cocktail?.ingredients_list?.find(
      (it) =>
        (it?.ingredient?.name || '').toLowerCase() ===
        (ingredientName || '').toLowerCase()
    );
    const img = (found as any)?.ingredient?.image;
    return img ?? null;
  }

  /** URL base (JPG/PNG) per l’icona 20x20. Preferisce: icon → thumbnail → small → original */
  getIngredientIconUrlJpg(ingredientName: string): string {
    const img = this.getIngredientImageObj(ingredientName);
    if (!img) return 'assets/no-image.png';
    const f: any = img.formats || {};
    const pick = f?.icon?.url || f?.thumbnail?.url || f?.small?.url || img.url;
    return pick ? this.abs(pick) : 'assets/no-image.png';
  }

  /** srcset JPG/PNG per icona. Usa width da Strapi, o stime (icon=40, thumbnail=150, …) */
  srcsetFromIngredientJpg(ingredientName: string): string {
    const img = this.getIngredientImageObj(ingredientName);
    if (!img) return '';
    const f: any = img.formats || {};
    const entries: Array<{ url?: string; w?: number; key?: string }> = [
      { url: f?.icon?.url, w: f?.icon?.width, key: 'icon' }, // se hai il formato icon
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

  /** srcset WebP per icona: estende/sostituisce estensione */
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

  // ------------------ ID ingrediente per router ------------------

  /** Restituisce l'ID per la route ingredient partendo dal nome mostrato */
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

  // ------------------ UI badges & icons ------------------

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

  /** Raccoglie i candidati da Strapi con le width reali (fallback su stime) */
  private getCandidates(
    img: StrapiImage | null | undefined
  ): Array<{ url: string; w: number }> {
    if (!img) return [];
    const f: any = img.formats || {};
    const rows: Array<{ url?: string; w?: number; key?: string }> = [
      { url: f?.thumbnail?.url, w: f?.thumbnail?.width, key: 'thumbnail' }, // ~150
      { url: f?.small?.url, w: f?.small?.width, key: 'small' }, // ~320/500
      { url: f?.medium?.url, w: f?.medium?.width, key: 'medium' }, // ~640/750
      { url: f?.large?.url, w: f?.large?.width, key: 'large' }, // ~1024
      // ❌ NIENTE img.url (originale) per evitare prelievi enormi
    ];
    return rows
      .filter((r) => !!r.url)
      .map((r) => ({
        url: this.abs(r.url!),
        w: r.w ?? this.extWidth(r.key || '') ?? 0,
      }))
      .filter((r) => r.w > 0)
      .sort((a, b) => a.w - b.w);
  }

  /** Crea un srcset JPG/PNG con candidati <= maxW (o il più piccolo) */
  srcsetMaxJpg(img: StrapiImage | null | undefined, maxW: number): string {
    const all = this.getCandidates(img);
    if (!all.length) return '';
    let pick = all.filter((c) => c.w <= maxW);
    if (!pick.length) pick = [all[0]]; // fallback al più piccolo
    return pick.map((c) => `${c.url} ${c.w}w`).join(', ');
  }

  /** Versione WebP coerente (stessa lista, stessa cap) */
  srcsetMaxWebp(img: StrapiImage | null | undefined, maxW: number): string {
    const all = this.getCandidates(img);
    if (!all.length) return '';
    let pick = all.filter((c) => c.w <= maxW);
    if (!pick.length) pick = [all[0]];
    return pick.map((c) => `${this.toWebp(c.url)} ${c.w}w`).join(', ');
  }
}
