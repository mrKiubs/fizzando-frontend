// src/app/app.component.ts
import {
  Component,
  PLATFORM_ID,
  inject,
  OnDestroy,
  Inject,
  Type,
} from '@angular/core';
import {
  Router,
  NavigationEnd,
  NavigationStart,
  RouterOutlet,
  RouterModule,
  ActivatedRoute,
} from '@angular/router';
import {
  CommonModule,
  isPlatformBrowser,
  DOCUMENT,
  ViewportScroller,
} from '@angular/common';
import { filter } from 'rxjs/operators';
import {
  trigger,
  transition,
  style,
  animate,
  query,
  group,
} from '@angular/animations';

import { ViewportService } from './services/viewport.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [
    trigger('pageTransition', [
      transition('noanim <=> *', [
        style({ position: 'relative' }),
        query(':enter, :leave', [style({ opacity: 1, transform: 'none' })], {
          optional: true,
        }),
        query(':leave', [style({ display: 'none' })], { optional: true }),
      ]),
      transition(
        '* <=> *',
        [
          style({ position: 'relative' }),
          query(':leave', [style({ zIndex: 1, pointerEvents: 'none' })], {
            optional: true,
          }),
          query(':enter', [style({ zIndex: 0 })], { optional: true }),
          query(
            ':enter',
            [style({ opacity: 0, transform: 'translateY({{enterY}})' })],
            { optional: true }
          ),
          group([
            query(
              ':leave',
              [
                animate(
                  '{{leaveDuration}} {{leaveEasing}}',
                  style({ opacity: 0, transform: 'translateY({{leaveY}})' })
                ),
              ],
              { optional: true }
            ),
            query(
              ':enter',
              [
                animate(
                  '{{enterDuration}} {{enterDelay}} {{enterEasing}}',
                  style({ opacity: 1, transform: 'translateY(0)' })
                ),
              ],
              { optional: true }
            ),
          ]),
        ],
        {
          params: {
            enterDuration: '300ms',
            enterDelay: '50ms',
            enterEasing: 'cubic-bezier(0.17, 0.88, 0.32, 1.27)',
            leaveDuration: '200ms',
            leaveEasing: 'ease-out',
            enterY: '10px',
            leaveY: '-10px',
          },
        }
      ),
    ]),
  ],
})
export class AppComponent implements OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly viewportService = inject(ViewportService);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly document = inject(DOCUMENT);
  private readonly scroller = inject(ViewportScroller);

  private skipMotionNext = false;

  // Sheen/route state
  private sheenTimer: any = null;

  // Scroll-reactive bg speed (solo touch)
  private rafId: number | null = null;
  private lastY = 0;
  private lastT = 0;

  // iOS visualViewport fix
  private vvResizeHandler?: () => void;
  private isIOS = false;

  private navbarComponentRef?: Promise<Type<unknown>>;
  private footerComponentRef?: Promise<Type<unknown>>;
  private ambientComponentRef?: Promise<Type<unknown>>;

  protected readonly isTouch =
    this.isBrowser &&
    (navigator.maxTouchPoints > 0 ||
      /Android|iP(ad|hone|od)/i.test(navigator.userAgent));
  protected readonly prefersReduced =
    this.isBrowser &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  protected readonly showAmbient = true;

  constructor() {
    // Pre-cattura stato per eventuale “no motion” su questa navigazione
    this.router.events
      .pipe(filter((e): e is NavigationStart => e instanceof NavigationStart))
      .subscribe(() => {
        const nav = this.router.getCurrentNavigation();
        const st = (nav?.extras?.state as any) || {};
        this.skipMotionNext = !!(st.suppressMotion || st.suppressScroll);
      });

    // After NavEnd → tema + sheen (solo touch, preset Calm)
    let lastPath = '';
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        if (!this.isBrowser) return;

        const path = e.urlAfterRedirects.split('?')[0];
        const pathChanged = lastPath !== path;
        lastPath = path;

        const htmlElRef = (this.document as Document).documentElement;

        // A) Toggle classe tema da route.data.themeClass (deepest child)
        this.applyThemeClassFromRoute(htmlElRef);

        // B) Sheen “accent” durante la transizione — SOLO su touch
        const isCoarse =
          window.matchMedia?.('(pointer: coarse)')?.matches === true;
        if (isCoarse) {
          htmlElRef.classList.add('route-animating');
          clearTimeout(this.sheenTimer);
          this.sheenTimer = setTimeout(() => {
            htmlElRef.classList.remove('route-animating');
          }, 420);
        } else {
          htmlElRef.classList.remove('route-animating');
        }

        // C) reset flag “skipMotionNext” per la prossima
        if (pathChanged) setTimeout(() => (this.skipMotionNext = false), 50);
      });
  }

  ngOnInit() {
    if (!this.isBrowser) return;

    this.viewportService.init();

    const doc = this.document as Document;
    const htmlEl = doc.documentElement as HTMLElement;

    // Icon fonts ready → sblocco visibilità icone
    if ('fonts' in (doc as any)) {
      (doc as any).fonts.ready.finally(() =>
        htmlEl.classList.add('icons-ready')
      );
    } else {
      htmlEl.classList.add('icons-ready');
    }
    if ('fonts' in doc) {
      (doc as any).fonts.ready.then(() => {
        htmlEl.classList.add('wf-ready');
      });
    }

    // iOS 16+ toolbar dinamiche → sincronizza --app-vh con visualViewport
    this.setupIOSViewportFix();

    // CALM: scroll-reactive solo su device touch
    const isCoarse = window.matchMedia?.('(pointer: coarse)')?.matches === true;
    if (isCoarse) {
      this.lastY = window.scrollY;
      this.lastT = performance.now();
      window.addEventListener('scroll', this.onScroll, { passive: true });
    } else {
      // Desktop: fissa lo speed a 1 (nessun boost)
      htmlEl.style.setProperty('--bg-speed', '1');
    }
  }

  ngOnDestroy() {
    if (!this.isBrowser) return;

    // cleanup scroll listener & rAF
    window.removeEventListener('scroll', this.onScroll as any);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.sheenTimer) clearTimeout(this.sheenTimer);

    // Cleanup iOS listeners
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    if (this.isIOS && this.vvResizeHandler) {
      try {
        vv?.removeEventListener('resize', this.vvResizeHandler as any);
      } catch {}
      window.removeEventListener(
        'orientationchange',
        this.vvResizeHandler as any
      );
      window.removeEventListener('scroll', this.vvResizeHandler as any);
    }
  }

  // Aggiorna --bg-speed in base alla velocità di scroll (solo touch)
  private onScroll = () => {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      const now = performance.now();
      const y = window.scrollY;
      const dy = Math.abs(y - this.lastY);
      const dt = Math.max(16, now - this.lastT);
      const vel = Math.min(1, dy / dt / 0.8); // 0..1
      (this.document as Document).documentElement.style.setProperty(
        '--bg-speed',
        String(1 + vel * 0.4)
      );
      this.lastY = y;
      this.lastT = now;
      this.rafId = null;
    });
  };

  // Fix iOS: usa visualViewport.height per --app-vh quando cambiano le toolbar
  private setupIOSViewportFix() {
    const ua = navigator.userAgent || '';
    const isAppleTouch =
      /iP(hone|od|ad)/.test(ua) ||
      (ua.includes('Mac') && 'ontouchend' in document);

    const vv = (window as any).visualViewport as VisualViewport | undefined;
    this.isIOS = isAppleTouch && !!vv;

    if (!this.isIOS) return;

    const htmlEl = (this.document as Document).documentElement as HTMLElement;
    htmlEl.classList.add('ios-fixed');

    const updateVh = () => {
      const h = Math.round((vv!.height + Number.EPSILON) * 10) / 10;
      htmlEl.style.setProperty('--app-vh', `${h}px`);
    };

    // Primo set
    updateVh();

    // Listener coalescati
    const handler = () => requestAnimationFrame(updateVh);
    this.vvResizeHandler = handler;

    vv!.addEventListener('resize', handler as any, { passive: true } as any);
    window.addEventListener('orientationchange', handler as any, {
      passive: true,
    });
    // alcune versioni iOS aggiornano durante lo scroll
    window.addEventListener('scroll', handler as any, { passive: true });
  }

  // Applica classe tema definita nelle route data
  private applyThemeClassFromRoute(html: HTMLElement) {
    // rimuovi classi che iniziano con "theme-"
    for (const cls of Array.from(html.classList)) {
      if (cls.startsWith('theme-')) html.classList.remove(cls);
    }
    // trova la child più profonda con data.themeClass
    let r: any = this.route;
    let theme: string | undefined;
    while (r?.firstChild) r = r.firstChild;
    if (r?.snapshot?.data?.['themeClass']) {
      theme = r.snapshot.data['themeClass'];
    } else {
      r = this.route.firstChild;
      while (r) {
        theme = r.snapshot.data?.['themeClass'] ?? theme;
        r = r.firstChild;
      }
    }
    if (theme) html.classList.add(theme);
  }

  onRouteAnimStart() {
    if (!this.isBrowser) return;
    window.dispatchEvent(
      new CustomEvent<boolean>('route-anim', { detail: true })
    );
  }

  onRouteAnimDone() {
    if (!this.isBrowser) return;
    window.dispatchEvent(
      new CustomEvent<boolean>('route-anim', { detail: false })
    );

    // scroll-top only se non è un anchor link
    if (this.router.url.includes('#')) return;
    setTimeout(() => this.scroller.scrollToPosition([0, 0]), 0);
  }

  get animParams() {
    const isMobile = this.isTouch;
    return isMobile
      ? {
          enterDuration: '280ms',
          enterDelay: '25ms',
          enterEasing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          leaveDuration: '180ms',
          leaveEasing: 'ease-out',
          enterY: '8px',
          leaveY: '-8px',
        }
      : {
          enterDuration: '300ms',
          enterDelay: '50ms',
          enterEasing: 'cubic-bezier(0.17, 0.88, 0.32, 1.27)',
          leaveDuration: '200ms',
          leaveEasing: 'ease-out',
          enterY: '10px',
          leaveY: '-10px',
        };
  }

  getRouteAnimationData(outlet: RouterOutlet) {
    if (this.skipMotionNext) return 'noanim';
    const dataAnim = outlet?.activatedRouteData?.['animation'];
    if (dataAnim) return dataAnim;
    return this.router.url.split('?')[0] || 'default';
  }

  protected loadNavbar() {
    if (!this.navbarComponentRef) {
      this.navbarComponentRef = import('./core/navbar.component').then(
        (m) => m.NavbarComponent
      );
    }
    return this.navbarComponentRef;
  }

  protected loadFooter() {
    if (!this.footerComponentRef) {
      this.footerComponentRef = import('./core/footer.component').then(
        (m) => m.FooterComponent
      );
    }
    return this.footerComponentRef;
  }

  protected loadAmbient() {
    if (!this.ambientComponentRef) {
      this.ambientComponentRef = import(
        './assets/design-system/cocktail-bubbles/cocktail-bubbles.component'
      ).then((m) => m.CocktailBubblesComponent);
    }
    return this.ambientComponentRef;
  }
}
