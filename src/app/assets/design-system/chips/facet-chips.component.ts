import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription, fromEvent } from 'rxjs';
import { auditTime } from 'rxjs/operators';
import { CocktailService } from '../../../services/strapi.service';
import { CocktailChipComponent } from './cocktail-chip.component';

type Kind = 'method' | 'glass' | 'category' | 'alcoholic';

@Component({
  selector: 'app-facet-chips',
  standalone: true,
  imports: [CommonModule, RouterLink, CocktailChipComponent],
  template: `
    <div class="hub-switcher__row">
      <div
        class="chips-scroll-wrapper"
        [class.chips-scroll-wrapper--overflow]="showArrows"
      >
        <!-- Prev -->
        <!-- Prev -->
        <button
          *ngIf="showArrows"
          type="button"
          class="scroll-button scroll-button--prev"
          (click)="onScrollButtonClick('left')"
          [disabled]="!canScrollLeft"
          [class.scroll-button--visible]="canScrollLeft"
          [attr.aria-label]="'Scroll ' + label + ' chips left'"
        >
          <span aria-hidden="true">‹</span>
        </button>

        <div #chipsContainer class="cocktail-chips-container chips-scroll">
          <app-cocktail-chip
            *ngFor="let lbl of displayItems; trackBy: trackByLabel"
            [label]="lbl"
            [count]="count(slug(lbl))"
            [active]="activeKind === kind && activeSlug === slug(lbl)"
            [variant]="kind"
            [slug]="slug(lbl)"
            [routerLink]="['/cocktails', kind, slug(lbl)]"
          ></app-cocktail-chip>
        </div>

        <!-- Next -->
        <button
          *ngIf="showArrows"
          type="button"
          class="scroll-button scroll-button--next"
          (click)="onScrollButtonClick('right')"
          [disabled]="!canScrollRight"
          [class.scroll-button--visible]="canScrollRight"
          [attr.aria-label]="'Scroll ' + label + ' chips right'"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .hub-switcher__row {
        display: flex;
        gap: 16px;
        align-items: center;
      }

      .hub-switcher__label {
        lex: 0 0 auto;
        color: #fff;
        font-size: 12px;
        min-width: 70px;
      }

      .chips-scroll-wrapper {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1 1 auto;
        min-width: 0;
        position: relative;
      }
      .cocktail-chips-container {
        display: flex;
        flex-wrap: nowrap;
        gap: 8px;
        overflow-x: auto;
        padding: 4px 0;
        scroll-behavior: smooth;
        -webkit-overflow-scrolling: touch;
        flex: 1 1 auto;
        min-width: 0;

        // Default per Firefox
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.2) transparent;

        // WebKit (mobile)
        &::-webkit-scrollbar {
          height: 4px; // 🔹 più fine (prima era 6–8px)
        }

        &::-webkit-scrollbar-track {
          background: transparent; // 🔹 invisibile
        }

        &::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2); // 🔹 bianco trasparente
          border-radius: 50px;
        }

        &::-webkit-scrollbar-thumb:hover {
          background: rgba(
            255,
            255,
            255,
            0.35
          ); // 🔹 leggera reazione all’hover (solo desktop)
        }
      }

      // Nascondi del tutto su desktop
      @media (min-width: 1024px) {
        .cocktail-chips-container {
          scrollbar-width: none;
          -ms-overflow-style: none;

          &::-webkit-scrollbar {
            width: 0;
            height: 0;
            display: none;
          }
        }
      }

      .cocktail-chips-container::-webkit-scrollbar {
        height: 6px;
      }

      .cocktail-chips-container::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.25);
        border-radius: 50px;
      }

      .cocktail-chips-container::-webkit-scrollbar-track {
        background: transparent;
      }

      .chips-scroll-wrapper--overflow .cocktail-chips-container {
        @media (min-width: 768px) {
          margin: 0px 38px;
        }
      }

      .cocktail-chip {
        display: inline-flex;
        align-items: center;
        padding: 4px 4px 4px 8px;
        border-radius: 50px;
        font-size: 0.8rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.5411764706);
        border: 1px solid rgba(255, 255, 255, 0.1);

        transition: all 0.2s ease-in-out;
        align-items: center;
        gap: 8px;

        &:hover {
          background-color: #00000019;
          color: white;
          border: 1px solid rgba(255, 255, 255, 0.851);
        }

        &.active {
          background-color: rgba(0, 123, 255, 0.1);
          border: 1px solid #fff;
          color: #fff;
          cursor: default;
        }

        &.category-chip {
          background-color: rgba(0, 123, 255, 0.1);
          border: 1px solid rgba(0, 123, 255, 0.2);

          &:hover {
            color: #fff;
            background-color: rgba(0, 123, 255, 0.8);
            border: 1px solid #ffffffab !important;
          }
        }

        &.method-chip {
          background-color: rgba(255, 193, 7, 0.1) !important;
          border: 1px solid rgba(255, 193, 7, 0.2) !important;

          &:hover {
            color: #fff;
            background-color: rgba(255, 193, 7, 0.8) !important;
            border: 1px solid #ffffffab !important;
          }
        }

        .method-chip {
          background-color: rgba(220, 53, 69, 0.1);
          border-color: rgba(220, 53, 69, 0.2);
        }
      }
      .scroll-button {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        cursor: pointer;
        transition: background 0.2s ease, border-color 0.2s ease,
          opacity 0.2s ease;
        flex: 0 0 auto;
        opacity: 0;
        pointer-events: none;
        z-index: 1;
      }

      .scroll-button--prev {
        left: 0;
      }

      .scroll-button--next {
        right: 0;
      }

      .scroll-button--visible {
        opacity: 1;
        pointer-events: auto;
      }

      .scroll-button:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.6);
      }

      .scroll-button:disabled {
        opacity: 0.35;
        cursor: default;
      }

      .scroll-button span[aria-hidden='true'] {
        font-size: 20px;
        line-height: 1;
      }

      @media (max-width: 768px) {
        .hub-switcher__row {
          flex-direction: column;
          align-items: flex-start;
          gap: 8px;
        }

        .chips-scroll-wrapper {
          width: 100%;
          gap: 0;
        }

        .cocktail-chips-container {
          width: 100%;
          padding: 0;
          gap: 6px;
          padding: 0 0 8px 0;
          margin: 0 0;
        }

        .scroll-button {
          display: none;
        }
      }

      .cocktail-key-info {
        margin-top: 8px;
      }

      .info-label {
        font-size: 12px;
        color: #fff;
        margin-bottom: 4px;
        font-weight: 500;
      }

      @mixin hide-scrollbar {
        // Firefox
        scrollbar-width: none;
        // IE/Edge legacy
        -ms-overflow-style: none;
        // WebKit (Chrome, Safari)
        &::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
          background: transparent;
        }
      }

      @media (min-width: 1024px) {
        .cocktail-chips-container,
        .chips-scroll {
          // (in caso tu la riusi altrove)
          @include hide-scrollbar;
        }
      }
      .chips-scroll {
        overflow: auto;
        -webkit-overflow-scrolling: touch; // non fa male anche su desktop Apple

        // Desktop: nasconde completamente la scrollbar
        @media (min-width: 1024px) {
          @include hide-scrollbar;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FacetChipsComponent
  implements OnChanges, OnDestroy, AfterViewInit
{
  @Input() label = '';
  @Input() kind: Kind = 'method';
  @Input() items: string[] = [];
  @Input() activeKind: Kind | 'root' = 'root';
  @Input() activeSlug = '';
  @Input() isActive = true;

  @Input() stopClickPropagation = false;

  /** Se passi una mappa, NIENTE chiamate; altrimenti calcola lui i contatori. */
  @Input() countsInput: Record<string, number | undefined> | null = null;

  @ViewChild('chipsContainer', { static: false })
  private chipsContainer?: ElementRef<HTMLDivElement>;

  showScrollControls = false;
  canScrollLeft = false;
  canScrollRight = false;

  private activeMovedToFront = false;

  // cache condivisa tra tutte le istanze (home/nav/footer)
  private static memo: Record<Kind, Record<string, number>> = {
    method: {},
    glass: {},
    category: {},
    alcoholic: {},
  };
  private local: Record<string, number | undefined> = {};
  private subscriptions: Subscription[] = [];

  private uiSubscriptions: Subscription[] = [];
  private scrollStateTimerId: ReturnType<typeof setTimeout> | null = null;
  private ensureActiveChipTimerId: ReturnType<typeof setTimeout> | null = null;
  private scrollObserversReady = false;
  private readonly isBrowser = typeof window !== 'undefined';
  private pendingScrollReset = false;

  displayItems: string[] = [];

  constructor(private api: CocktailService, private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['items'] || changes['activeSlug'] || changes['activeKind']) {
      this.updateDisplayItems();
    }

    if (changes['items'] || changes['countsInput'] || changes['kind']) {
      this.refreshCounts();
      this.scheduleScrollStateUpdate();
    }

    if (changes['activeSlug'] || changes['activeKind']) {
      const shouldForce =
        this.activeKind === this.kind && !!this.activeSlug?.length;
      this.scheduleEnsureActiveChipVisible(shouldForce);
    }

    if (changes['isActive']) {
      if (this.isActive) {
        this.scheduleScrollStateUpdate(120);
        this.scheduleEnsureActiveChipVisible(true);
      } else {
        this.clearEnsureActiveChipTimer();
      }
    }
  }

  ngAfterViewInit(): void {
    this.initScrollObservers();
    this.scheduleScrollStateUpdate();
    this.scheduleEnsureActiveChipVisible(true);
    if (this.pendingScrollReset) {
      this.resetScrollToStartSoon();
    }
  }

  ngOnDestroy(): void {
    this.clearSubscriptions();
    this.clearUiSubscriptions();
    this.clearScrollStateTimer();
    this.clearEnsureActiveChipTimer();
  }

  private updateDisplayItems(): void {
    const source = Array.isArray(this.items) ? [...this.items] : [];
    let movedActiveToFront = false;

    if (
      source.length &&
      this.activeKind === this.kind &&
      (this.activeSlug || '').length
    ) {
      const activeIndex = source.findIndex(
        (label) => this.slug(label) === this.activeSlug
      );

      if (activeIndex > 0) {
        const [activeLabel] = source.splice(activeIndex, 1);
        source.unshift(activeLabel);
        movedActiveToFront = true;
      }
    }

    this.activeMovedToFront = movedActiveToFront;

    const sameOrder =
      source.length === this.displayItems.length &&
      source.every((label, index) => this.displayItems[index] === label);

    if (!sameOrder) {
      this.displayItems = source;
      this.cdr.markForCheck();
    }

    if (movedActiveToFront) {
      this.pendingScrollReset = true;
      this.resetScrollToStartSoon();
    } else if (!source.length) {
      this.pendingScrollReset = false;
    }
  }

  private refreshCounts(): void {
    this.clearSubscriptions();

    if (!this.items?.length) {
      this.local = {};
      return;
    }
    // 1) Se hai passato countsInput, usiamo quelli e stop
    if (this.countsInput) {
      this.local = { ...this.countsInput };
      return;
    }

    // 2) Altrimenti: riempi da cache + fetcha solo i mancanti
    const cache = FacetChipsComponent.memo[this.kind];
    const prevLocal = this.local;
    const nextLocal: Record<string, number | undefined> = {};
    this.items.forEach((lbl) => {
      const s = this.slug(lbl);
      const cached = cache[s];
      nextLocal[s] = cached !== undefined ? cached : prevLocal[s];
    });
    this.local = nextLocal;

    const missing = this.items
      .map((lbl) => this.slug(lbl))
      .filter((s) => this.local[s] === undefined);

    if (!missing.length) return;

    // piccola helper per 1 richiesta (pageSize=1, leggiamo solo total)
    const ask = (label: string) =>
      this.kind === 'method'
        ? this.api.getCocktails(
            1,
            1,
            '',
            '',
            '',
            false,
            false,
            false,
            false,
            label,
            ''
          )
        : this.kind === 'glass'
        ? this.api.getCocktails(
            1,
            1,
            '',
            '',
            '',
            false,
            false,
            false,
            false,
            '',
            label
          )
        : this.kind === 'category'
        ? this.api.getCocktails(
            1,
            1,
            '',
            label,
            '',
            false,
            false,
            false,
            false,
            '',
            ''
          )
        : this.api.getCocktails(
            1,
            1,
            '',
            '',
            label,
            false,
            false,
            false,
            false,
            '',
            ''
          );

    // Concurrency semplice
    const queue = [...missing];
    const RUNNERS = 5;
    for (let k = 0; k < RUNNERS; k++) this.run(queue, ask);
  }

  private run(queue: string[], ask: (label: string) => any) {
    const next = () => {
      const slug = queue.shift();
      if (!slug) return;
      const label = this.items.find((l) => this.slug(l) === slug);
      if (!label) {
        next();
        return;
      }

      let sub: Subscription;

      sub = ask(label).subscribe({
        next: (res: any) => this.set(slug, res?.meta?.pagination?.total ?? 0),
        error: () => {
          this.set(slug, 0);
          // Ora 'sub' è accessibile qui
          this.removeSubscription(sub);
          next();
        },
        complete: () => {
          // E anche qui!
          this.removeSubscription(sub);
          next();
        },
      });
      this.subscriptions.push(sub);
    };
    next();
  }

  private set(slug: string, n: number) {
    this.local[slug] = n;
    FacetChipsComponent.memo[this.kind][slug] = n;

    this.cdr.detectChanges();
    this.scheduleScrollStateUpdate();
    this.scheduleEnsureActiveChipVisible();
  }

  onScrollButtonClick(direction: 'left' | 'right'): void {
    const el = this.chipsContainer?.nativeElement;
    if (!el) return;

    const scrollDistance = Math.max(el.clientWidth * 0.7, 200);
    el.scrollBy({
      left: direction === 'left' ? -scrollDistance : scrollDistance,
      behavior: 'smooth',
    });
    this.scheduleScrollStateUpdate();
    this.scheduleEnsureActiveChipVisible();
  }

  private clearSubscriptions(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
  }

  private removeSubscription(sub: Subscription) {
    this.subscriptions = this.subscriptions.filter((s) => s !== sub);
  }

  private clearUiSubscriptions(): void {
    this.uiSubscriptions.forEach((sub) => sub.unsubscribe());
    this.uiSubscriptions = [];
  }

  private initScrollObservers(): void {
    if (this.scrollObserversReady || !this.isBrowser) return;
    const el = this.chipsContainer?.nativeElement;
    if (!el) return;

    this.scrollObserversReady = true;

    this.uiSubscriptions.push(
      fromEvent(el, 'scroll')
        .pipe(auditTime(50))
        .subscribe(() => this.updateScrollState())
    );

    if (this.isBrowser) {
      this.uiSubscriptions.push(
        fromEvent(window, 'resize')
          .pipe(auditTime(150))
          .subscribe(() => this.updateScrollState())
      );
    }

    this.updateScrollState();
  }

  private resetScrollToStartSoon(): void {
    if (!this.isBrowser) {
      this.pendingScrollReset = false;
      return;
    }

    const container = this.chipsContainer?.nativeElement;
    if (!container) {
      return;
    }

    this.pendingScrollReset = false;
    requestAnimationFrame(() => {
      const target = this.chipsContainer?.nativeElement;
      if (!target) return;
      target.scrollTo({ left: 0, behavior: 'smooth' });
    });
  }

  private scheduleScrollStateUpdate(delay = 0): void {
    if (this.scrollStateTimerId !== null) {
      clearTimeout(this.scrollStateTimerId);
    }
    this.scrollStateTimerId = setTimeout(() => {
      this.scrollStateTimerId = null;
      this.updateScrollState();
    }, delay);
  }

  private clearScrollStateTimer(): void {
    if (this.scrollStateTimerId !== null) {
      clearTimeout(this.scrollStateTimerId);
      this.scrollStateTimerId = null;
    }
  }

  private updateScrollState(): void {
    if (!this.isBrowser) {
      this.showScrollControls = false;
      this.canScrollLeft = false;
      this.canScrollRight = false;
      this.cdr.markForCheck();
      return;
    }

    const el = this.chipsContainer?.nativeElement;
    if (!el) {
      this.showScrollControls = false;
      this.canScrollLeft = false;
      this.canScrollRight = false;
      this.cdr.markForCheck();
      return;
    }

    if (!this.isElementLaidOut(el)) {
      if (this.isActive) {
        this.scheduleScrollStateUpdate(120);
      }
      return;
    }

    const threshold = 8;
    const maxScrollLeft = Math.max(el.scrollWidth - el.clientWidth, 0);
    const hasOverflow = maxScrollLeft > threshold;
    const currentScroll = el.scrollLeft;

    this.showScrollControls = hasOverflow;
    this.canScrollLeft = hasOverflow && currentScroll > threshold;
    this.canScrollRight =
      hasOverflow && currentScroll < maxScrollLeft - threshold;
    this.cdr.markForCheck();
    if (hasOverflow) {
      this.scheduleEnsureActiveChipVisible();
    }
  }

  count(slug: string) {
    return this.local[slug];
  }
  trackByLabel = (_: number, v: string) => v;

  // slug compatibile col tuo toSlug
  slug(v: string): string {
    return (v || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '');
  }

  get showArrows(): boolean {
    return this.showScrollControls;
  }

  private scheduleEnsureActiveChipVisible(force = false): void {
    if (!this.isBrowser || !this.isActive) return;
    if (this.ensureActiveChipTimerId !== null) {
      clearTimeout(this.ensureActiveChipTimerId);
    }

    const delay = force ? 150 : 60;
    this.ensureActiveChipTimerId = setTimeout(() => {
      this.ensureActiveChipTimerId = null;
      this.ensureActiveChipVisible(force);
    }, delay);
  }

  private clearEnsureActiveChipTimer(): void {
    if (this.ensureActiveChipTimerId !== null) {
      clearTimeout(this.ensureActiveChipTimerId);
      this.ensureActiveChipTimerId = null;
    }
  }

  private ensureActiveChipVisible(force = false): void {
    if (!this.isBrowser || !this.isActive) return;

    const container = this.chipsContainer?.nativeElement;
    if (!container || !this.isElementLaidOut(container)) return;

    const activeChip = container.querySelector<HTMLElement>(
      '.cocktail-chip.active'
    );
    if (!activeChip) return;

    const padding = 16;
    const chipStart = activeChip.offsetLeft;
    const chipEnd = chipStart + activeChip.offsetWidth;
    const viewStart = container.scrollLeft;
    const viewEnd = viewStart + container.clientWidth;

    if (
      !force &&
      this.activeMovedToFront &&
      chipStart <= padding &&
      viewStart > chipStart + padding
    ) {
      return;
    }

    const shouldScroll =
      force || chipStart < viewStart + padding || chipEnd > viewEnd - padding;

    if (!shouldScroll) return;

    const target = Math.max(chipStart - padding, 0);
    container.scrollTo({ left: target, behavior: 'smooth' });
  }

  private isElementLaidOut(el: HTMLElement): boolean {
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  }
}
