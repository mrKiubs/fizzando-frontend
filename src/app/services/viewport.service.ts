import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, NgZone, PLATFORM_ID } from '@angular/core';

interface SafeAreaInsets {
  top: number;
  bottom: number;
}

const THROTTLE_MS = 80;
const IOS_SAFARI_MIN_VERSION = 26;

@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly isBrowser: boolean;
  private readonly shouldOverrideViewport: boolean;
  private rafId: number | null = null;
  private throttleTimer: number | null = null;
  private lastExecution = 0;
  private initialized = false;

  constructor(
    @Inject(PLATFORM_ID) platformId: object,
    @Inject(DOCUMENT) private readonly doc: Document,
    private readonly ngZone: NgZone
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.shouldOverrideViewport =
      this.isBrowser && this.detectIosSafari26Plus();
  }

  get isDynamicViewportTarget(): boolean {
    return this.shouldOverrideViewport;
  }

  init(): void {
    if (!this.isBrowser || this.initialized) {
      return;
    }

    this.initialized = true;
    this.ensureSafeAreaFallback();

    if (!this.shouldOverrideViewport) {
      return;
    }

    this.scheduleUpdate();

    const visualViewport = window.visualViewport;
    const handler = () => this.handleViewportEvent();

    this.ngZone.runOutsideAngular(() => {
      if (visualViewport) {
        visualViewport.addEventListener('resize', handler, { passive: true });
        visualViewport.addEventListener('scroll', handler, { passive: true });
      }

      window.addEventListener('orientationchange', handler, { passive: true });
      window.addEventListener('resize', handler, { passive: true });
    });
  }

  enableIOSFixedHeader(force: boolean): void {
    if (!this.isBrowser || !this.shouldOverrideViewport) {
      return;
    }

    const body = this.doc.body;
    const docEl = this.doc.documentElement;

    body.classList.toggle('ios-fixed', force);
    docEl.classList.toggle('ios-fixed', force);
  }

  private handleViewportEvent(): void {
    const now = Date.now();
    if (now - this.lastExecution < THROTTLE_MS) {
      if (this.throttleTimer !== null) {
        window.clearTimeout(this.throttleTimer);
      }

      this.throttleTimer = window.setTimeout(() => {
        this.lastExecution = Date.now();
        this.scheduleUpdate();
      }, THROTTLE_MS);
      return;
    }

    this.lastExecution = now;
    this.scheduleUpdate();
  }

  private scheduleUpdate(): void {
    if (!this.isBrowser) {
      return;
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.applyViewportMeasurements();
    });
  }

  private applyViewportMeasurements(): void {
    if (!this.shouldOverrideViewport) {
      return;
    }

    const docEl = this.doc.documentElement;
    const viewport = window.visualViewport;

    const viewportHeight =
      viewport?.height ?? window.innerHeight ?? docEl.clientHeight;
    docEl.style.setProperty('--app-vh', `${viewportHeight}px`);

    const safeArea = this.computeSafeAreaInsets(viewport);
    docEl.style.setProperty('--safe-top', `${safeArea.top}px`);
    docEl.style.setProperty('--safe-bottom', `${safeArea.bottom}px`);
  }

  private computeSafeAreaInsets(
    viewport: VisualViewport | undefined | null
  ): SafeAreaInsets {
    if (!viewport) {
      return {
        top: 0,
        bottom: 0,
      };
    }

    const scale = viewport.scale ?? 1;
    const offsetTop = viewport.offsetTop ?? 0;
    const pageTop = viewport.pageTop ?? 0;
    const topInset = Math.max(offsetTop, pageTop / scale, 0);
    const layoutHeight =
      window.innerHeight || this.doc.documentElement.clientHeight;
    const viewportHeight = viewport.height ?? layoutHeight;
    const bottomInset = Math.max(layoutHeight - viewportHeight - offsetTop, 0);

    return {
      top: topInset,
      bottom: bottomInset,
    };
  }

  private ensureSafeAreaFallback(): void {
    if (!this.isBrowser) {
      return;
    }

    const docEl = this.doc.documentElement;
    const supportsEnv =
      typeof CSS !== 'undefined' &&
      CSS.supports?.('top: env(safe-area-inset-top)');

    if (supportsEnv) {
      docEl.style.setProperty('--safe-top', 'env(safe-area-inset-top, 0px)');
      docEl.style.setProperty(
        '--safe-bottom',
        'env(safe-area-inset-bottom, 0px)'
      );
      return;
    }

    docEl.style.setProperty('--safe-top', '0px');
    docEl.style.setProperty('--safe-bottom', '0px');
  }

  private detectIosSafari26Plus(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    const nav = window.navigator;
    const platform = nav.platform ?? '';
    const userAgent = nav.userAgent ?? '';
    const docEl = this.doc?.documentElement as HTMLElement | null;

    const isIOS =
      /iP(hone|od|ad)/.test(platform) ||
      (userAgent.includes('Mac') && !!docEl && 'ontouchend' in docEl);

    const isSafari =
      /^((?!chrome|android).)*safari/i.test(userAgent) &&
      !userAgent.includes('CriOS');

    if (!isIOS || !isSafari) {
      return false;
    }

    const versionMatch = userAgent.match(/OS (\d+)_/i);
    const majorVersion = versionMatch
      ? parseInt(versionMatch[1], 10)
      : undefined;

    const hasVisualViewport = typeof window.visualViewport !== 'undefined';
    const supportsDynamicViewport =
      typeof CSS !== 'undefined' && CSS.supports?.('height: 100dvh');

    return (
      !!majorVersion &&
      majorVersion >= IOS_SAFARI_MIN_VERSION &&
      hasVisualViewport &&
      supportsDynamicViewport
    );
  }
}
