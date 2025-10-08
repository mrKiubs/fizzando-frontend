import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

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
        active ? 'active' : ''
      ]"
      [attr.data-slug]="slugVal"
      [routerLink]="routerLink"
      [queryParams]="queryParams"
      [attr.aria-current]="active ? 'page' : null"
      [attr.aria-label]="ariaLabel"
      (click)="stopClickPropagation ? $event.stopPropagation() : null"
    >
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
          active ? 'active' : ''
        ]"
        [attr.data-slug]="slugVal"
        [attr.href]="href"
        [attr.aria-current]="active ? 'page' : null"
        [attr.aria-label]="ariaLabel"
        (click)="stopClickPropagation ? $event.stopPropagation() : null"
      >
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
            active ? 'active' : ''
          ]"
          [attr.data-slug]="slugVal"
          [attr.aria-pressed]="active"
          [attr.aria-label]="ariaLabel"
          (click)="
            stopClickPropagation ? $event.stopPropagation() : null;
            chipClick.emit()
          "
        >
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
      .cocktail-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px 4px 4px 8px;
        border-radius: 50px;
        font-size: 0.8rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.54);
        border: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        transition: all 0.2s ease-in-out;
        text-decoration: none;
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

      .variant-category {
        background: rgba(0, 123, 255, 0.1);
        border-color: rgba(0, 123, 255, 0.2);
      }
      .variant-category:hover {
        background: rgba(0, 123, 255, 0.8);
        color: #fff;
        border-color: #ffffffab;
      }
      .variant-method {
        background: rgba(255, 193, 7, 0.1);
        border-color: rgba(255, 193, 7, 0.2);
      }
      .variant-method:hover {
        background: rgba(255, 193, 7, 0.8);
        color: #fff;
        border-color: #ffffffab;
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
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CocktailChipComponent {
  @Input({ required: true }) label!: string;
  @Input() count?: number; // undefined => "…"
  @Input() active = false;
  @Input() variant: 'default' | 'category' | 'method' | 'glass' | 'alcoholic' =
    'default';
  @Input() slug?: string;

  @Input() showCountWhenUndefined = true;

  // Link modes
  @Input() routerLink: any[] | string | null = null;
  @Input() queryParams: Record<string, any> | null = null;
  @Input() href: string | null = null;

  // ✅ AGGIUNTA RICHIESTA
  @Input() stopClickPropagation = false;

  @Output() chipClick = new EventEmitter<void>();

  get slugVal(): string {
    return this.slug ?? this.slugify(this.label);
  }
  get ariaLabel(): string {
    return this.count === undefined
      ? this.label
      : `${this.label} (${this.count})`;
  }

  private slugify(v: string): string {
    return (v || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '');
  }
}
