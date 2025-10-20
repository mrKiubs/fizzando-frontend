import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeStyle } from '@angular/platform-browser';

type Variant = 'default' | 'category' | 'method' | 'glass' | 'alcoholic';

@Component({
  selector: 'app-cocktail-chip',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <a
      *ngIf="routerLink != null; else extOrBtn"
      class="cocktail-chip chip--link"
      [ngClass]="[
        'variant-' + variant,
        'slug-' + slugVal,
        active ? 'active' : '',
        count ? '' : 'no-count',
        transparent ? 'transparent' : ''
      ]"
      [attr.data-slug]="slugVal"
      [routerLink]="routerLink"
      [queryParams]="queryParams"
      [attr.aria-current]="active ? 'page' : null"
      [attr.aria-label]="ariaLabel"
      (click)="stopClickPropagation ? $event.stopPropagation() : null"
    >
      <span
        class="cocktail-chip__icon chip-ico"
        aria-hidden="true"
        [style.webkitMaskImage]="sanitizedMask"
        [style.maskImage]="sanitizedMask"
      ></span>

      <ng-content></ng-content>
      {{ label }}

      <span
        *ngIf="count !== undefined || showCountWhenUndefined"
        class="chip-count"
        [class.is-loading]="count === undefined"
      >
        {{ count === undefined ? '…' : count }}
      </span>
    </a>

    <ng-template #extOrBtn>
      <!-- HREF -->
      <a
        *ngIf="href; else btnTpl"
        class="cocktail-chip chip--link"
        [ngClass]="[
          'variant-' + variant,
          'slug-' + slugVal,
          active ? 'active' : '',
          transparent ? 'transparent' : ''
        ]"
        [attr.data-slug]="slugVal"
        [attr.href]="href"
        [attr.aria-current]="active ? 'page' : null"
        [attr.aria-label]="ariaLabel"
        (click)="stopClickPropagation ? $event.stopPropagation() : null"
      >
        <span
          class="cocktail-chip__icon chip-ico"
          aria-hidden="true"
          [style.webkitMaskImage]="sanitizedMask"
          [style.maskImage]="sanitizedMask"
        ></span>

        <ng-content></ng-content>
        {{ label }}

        <span
          *ngIf="count !== undefined || showCountWhenUndefined"
          class="chip-count"
          [class.is-loading]="count === undefined"
        >
          {{ count === undefined ? '…' : count }}
        </span>
      </a>

      <!-- BUTTON -->
      <ng-template #btnTpl>
        <button
          type="button"
          class="cocktail-chip chip--link"
          [ngClass]="[
            'variant-' + variant,
            'slug-' + slugVal,
            active ? 'active' : '',
            transparent ? 'transparent' : ''
          ]"
          [attr.data-slug]="slugVal"
          [attr.aria-pressed]="active"
          [attr.aria-label]="ariaLabel"
          (click)="
            stopClickPropagation ? $event.stopPropagation() : null;
            chipClick.emit()
          "
        >
          <span
            class="cocktail-chip__icon chip-ico"
            aria-hidden="true"
            [style.webkitMaskImage]="sanitizedMask"
            [style.maskImage]="sanitizedMask"
          ></span>

          <ng-content></ng-content>
          {{ label }}

          <span
            *ngIf="count !== undefined || showCountWhenUndefined"
            class="chip-count"
            [class.is-loading]="count === undefined"
          >
            {{ count === undefined ? '…' : count }}
          </span>
        </button>
      </ng-template>
    </ng-template>
  `,
  styles: [
    `
      .cocktail-chip.no-count {
        padding: 4px 8px 4px 8px;
      }
      .cocktail-chip:hover {
        background: #00000019;
        color: #fff;
        border-color: rgba(255, 255, 255, 0.85);
      }
      .cocktail-chip.active {
        background: rgba(0, 123, 255, 0.1);
        border-color: #fff;
        color: #fff;
        cursor: default;
      }

      .chip-count {
        opacity: 0.35;
        background: #ffffff1a;
        border-radius: 12px;
        font-size: 12px;
        padding: 0 4px;
        height: 24px;
        min-width: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .chip-count.is-loading {
        opacity: 0.45;
      }

      .chip-ico {
        width: 18px;
        height: 18px;
        display: inline-block;
        background-color: currentColor;
        mask: no-repeat center / contain;
        -webkit-mask: no-repeat center / contain;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CocktailChipComponent {
  /** Usa path relativo: compatibile con SSR/sub-path */
  private static readonly ICONS_BASE = 'assets/cips';

  constructor(private sanitizer: DomSanitizer) {}

  @Input({ required: true }) label!: string;
  @Input() count?: number;
  @Input() active = false;
  @Input() variant: Variant = 'default';
  @Input() slug?: string;
  @Input() transparent?: boolean = false;

  @Input() showCountWhenUndefined = true;

  // Link modes
  @Input() routerLink: any[] | string | null = null;
  @Input() queryParams: Record<string, any> | null = null;
  @Input() href: string | null = null;

  @Input() stopClickPropagation = false;

  @Output() chipClick = new EventEmitter<void>();

  /** Mappa variant/slug -> cartella/file */
  private static ICONS_MAP: Record<string, string> = {
    // ==== METHOD ====
    'method/built-in-glass': 'svg11/008-serve.svg',
    'method/shaken': 'svg13/006-shaker.svg',
    'method/stirred': 'svg11/025-bar stool.svg',
    'method/blended': 'svg11/007-blender.svg',
    'method/other': 'svg8/047-juice box.svg',
    'method/layered': 'svg13/034-b52.svg',
    'method/muddled': 'svg9/013-muddler.svg',
    'method/built-in-punch-bowl': 'svg7/028-punch bowl.svg',
    'method/heated': 'svg13/005-fire cocktail.svg',
    'method/infusion-aging': 'svg8/019-infused water.svg',
    'method/bomb-shot': 'svg13/007-shot.svg',

    // ==== GLASS ====
    'glass/cocktail-glass': 'svg13/048-martini.svg',
    'glass/highball-glass': 'svg13/045-gin tonic.svg',
    'glass/collins-glass': 'svg13/015-tom collins.svg',
    'glass/old-fashioned-glass': 'svg13/010-scotch.svg',
    'glass/shot-glass': 'svg13/007-shot.svg',
    'glass/coffee-mug': 'svg11/033-irish coffee.svg',
    'glass/whiskey-sour-glass': 'svg10/027-pisco sour.svg',
    'glass/hurricane-glass': 'svg13/040-tequila sunrise.svg',
    'glass/punch-bowl': 'svg7/028-punch bowl.svg',
    'glass/wine-glass': 'svg10/022-wine.svg',
    'glass/champagne-flute': 'svg10/018-champagne.svg',
    'glass/irish-coffee-glass': 'svg11/033-irish coffee.svg',
    'glass/pint-glass': 'svg11/024-beer cocktail.svg',
    'glass/beer-glass': 'svg11/024-beer cocktail.svg',
    'glass/pitcher': 'svg11/039-pitcher.svg',
    'glass/beer-mug': 'svg11/024-beer cocktail.svg',
    'glass/margarita-glass': 'svg11/047-margarita.svg',
    'glass/mason-jar': 'svg13/002-cocktail.svg',
    'glass/balloon-glass': 'svg13/039-brandy.svg',
    'glass/coupe-glass': 'svg13/047-manhattan.svg',
    'glass/cordial-glass': 'svg13/002-cocktail.svg',
    'glass/brandy-snifter': 'svg13/039-brandy.svg',
    'glass/nick-and-nora-glass': 'svg13/047-manhattan.svg',
    'glass/julep-cup': 'svg13/002-cocktail.svg',
    'glass/copper-mug': 'svg10/039-moscow mule.svg',

    // ==== CATEGORY ====
    'category/refreshing': 'svg11/038-soda.svg',
    'category/after-dinner': 'svg13/039-brandy.svg',
    'category/sour': 'svg10/027-pisco sour.svg',
    'category/tropical': 'svg13/009-pineapple.svg',
    'category/spirit-forward': 'svg13/048-martini.svg',
    'category/classic': 'svg13/048-martini.svg',
    'category/hot': 'svg13/005-fire cocktail.svg',
    'category/aperitif': 'svg10/040-aperol spritz.svg',
    'category/sparkling': 'svg10/018-champagne.svg',
    'category/flaming': 'svg13/005-fire cocktail.svg',
    'category/punch': 'svg11/027-punch.svg',
    'category/shot': 'svg13/007-shot.svg',
    'category/beer': 'svg11/024-beer cocktail.svg',
    'category/aromatic': 'svg8/033-herbal liquor.svg',
    'category/homemade-liqueur': 'svg8/019-infused water.svg',

    // ==== PROFILE ====
    'alcoholic/alcoholic': 'svg13/038-bottle.svg',
    'alcoholic/non-alcoholic': 'svg11/038-soda.svg',
    'alcoholic/optional-alcohol': 'svg11/006-glasses.svg',
  };

  get slugVal(): string {
    return this.slug ?? this.slugify(this.label);
  }

  get ariaLabel(): string {
    return this.count === undefined
      ? this.label
      : `${this.label} (${this.count})`;
  }

  /** URL finale dell'icona (con fallback) + encode per spazi/caratteri speciali */
  get iconUrl(): string {
    const key = `${this.variant}/${this.slugVal}`;
    const map = CocktailChipComponent.ICONS_MAP;
    const file =
      map[key] ??
      map[`${this.variant}/${this.labelToSlugForMap(this.label)}`] ??
      'svg13/002-cocktail.svg';

    const encoded = file.split('/').map(encodeURIComponent).join('/');
    return `${CocktailChipComponent.ICONS_BASE}/${encoded}`;
  }

  /** SafeStyle per evitare la sanitizzazione di Angular su mask-image:url(...) */
  get sanitizedMask(): SafeStyle {
    return this.sanitizer.bypassSecurityTrustStyle(`url("${this.iconUrl}")`);
  }

  private slugify(v: string): string {
    return (v || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '');
  }

  private labelToSlugForMap(v: string): string {
    return this.slugify(
      v
        .replace(/&/g, 'and')
        .replace(/\+/g, 'plus')
        .replace(/[,().]/g, ' ')
    );
  }
}
