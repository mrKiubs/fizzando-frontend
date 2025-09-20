import { Component, Input, isDevMode, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

type AdType =
  | 'leaderboard'
  | 'large-leaderboard'
  | 'banner'
  | 'skyscraper'
  | 'wide-skyscraper'
  | 'half-page'
  | 'medium-rectangle'
  | 'large-rectangle'
  | 'mobile-banner'
  | 'mobile-leaderboard'
  | 'square'
  | 'small-square'
  | 'responsive';

@Component({
  selector: 'app-dev-ads',
  templateUrl: './dev-ads.component.html',
  styleUrls: ['./dev-ads.component.scss'],
  standalone: true,
  imports: [CommonModule],
})
export class DevAdsComponent {
  @Input() type: AdType = 'responsive';

  /** opzionali: se vuoi forzare le altezze senza toccare il tipo */
  @Input() desktopHeight?: number;
  @Input() mobileHeight?: number;

  isDev = isDevMode();
  heightPx = 90;

  private readonly H: Record<AdType, { desktop: number; mobile: number }> = {
    leaderboard: { desktop: 90, mobile: 50 },
    'large-leaderboard': { desktop: 90, mobile: 50 },
    banner: { desktop: 60, mobile: 50 },
    skyscraper: { desktop: 600, mobile: 250 },
    'wide-skyscraper': { desktop: 600, mobile: 250 },
    'half-page': { desktop: 600, mobile: 250 },
    'medium-rectangle': { desktop: 250, mobile: 250 },
    'large-rectangle': { desktop: 280, mobile: 280 },
    'mobile-banner': { desktop: 90, mobile: 90 },
    'mobile-leaderboard': { desktop: 50, mobile: 50 },
    square: { desktop: 250, mobile: 250 },
    'small-square': { desktop: 200, mobile: 200 },
    responsive: { desktop: 100, mobile: 50 },
  };

  ngOnInit() {
    this.computeHeight();
  }
  @HostListener('window:resize') onResize() {
    this.computeHeight();
  }

  private computeHeight() {
    const mobile = typeof window !== 'undefined' && window.innerWidth <= 700;
    const base = this.H[this.type] ?? this.H['responsive'];
    this.heightPx = mobile
      ? this.mobileHeight ?? base.mobile
      : this.desktopHeight ?? base.desktop;
  }
}
