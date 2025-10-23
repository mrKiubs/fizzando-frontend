// src/app/app.component.ts
import {
  Component,
  PLATFORM_ID,
  inject,
  OnDestroy,
  Inject,
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

import { NavbarComponent } from './core/navbar.component';
import { CocktailBubblesComponent } from './assets/design-system/cocktail-bubbles/cocktail-bubbles.component';
import { FooterComponent } from './core/footer.component';
import { ViewportService } from './services/viewport.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    NavbarComponent,
    RouterOutlet,
    RouterModule,
    CocktailBubblesComponent,
    FooterComponent,
  ],
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
  template: `
    <app-navbar></app-navbar>

    <!-- Riflessi glass (conic) -->
    <div class="page-caustics" aria-hidden="true"></div>

    <!-- Micro-noise anti-banding -->
    <div class="page-noise" aria-hidden="true"></div>

    <main
      class="app-main allow-route-anim"
      [@.disabled]="false"
      [@pageTransition]="{
        value: getRouteAnimationData(routerOutlet),
        params: animParams
      }"
      (@pageTransition.start)="onRouteAnimStart()"
      (@pageTransition.done)="onRouteAnimDone()"
    >
      <router-outlet #routerOutlet="outlet"></router-outlet>
    </main>

    @defer (on idle) {
    <app-footer></app-footer>
    } @placeholder {
    <footer class="app-footer-placeholder" aria-hidden="true"></footer>
    } @if (showAmbient) { @defer (on idle) {
    <app-cocktail-bubbles></app-cocktail-bubbles>
    } @placeholder {
    <div class="cocktail-bubbles-placeholder" aria-hidden="true"></div>
    } }
  `,
  styles: [
    `
      @use './assets/style/main.scss' as *;

      .app-main.allow-route-anim > * {
        will-change: transform, opacity;
        -webkit-backface-visibility: hidden;
        transform: translateZ(0);
      }
      .app-footer-placeholder {
        display: block;
        min-height: 120px;
        width: 100%;
      }
      .cocktail-bubbles-placeholder {
        position: fixed;
        inset: auto 0 0 0;
        height: 0;
      }
    `,
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

  // --- NEW: sheen/route state
  private sheenTimer: any = null;

  // --- NEW: scroll-reactive bg speed
  private rafId: number | null = null;
  private lastY = 0;
  private lastT = 0;

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

    // --- NEW: after NavEnd → theme class + route-animating sheen
    let lastPath = '';
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const path = e.urlAfterRedirects.split('?')[0];
        const pathChanged = lastPath !== path;
        lastPath = path;

        if (!this.isBrowser) return;

        const html = (this.document as Document).documentElement;

        // A) Toggle classe tema da route.data.themeClass (deepest child)
        this.applyThemeClassFromRoute(html);

        // B) Sheen “accent” durante la transizione
        html.classList.add('route-animating');
        clearTimeout(this.sheenTimer);
        this.sheenTimer = setTimeout(() => {
          html.classList.remove('route-animating');
        }, 450); // allinea alla tua enterDuration+delay

        // C) reset flag “skipMotionNext” per la prossima
        if (pathChanged) setTimeout(() => (this.skipMotionNext = false), 50);
      });
  }

  ngOnInit() {
    if (this.isBrowser) {
      this.viewportService.init();

      const doc = this.document as Document;
      const htmlEl = doc.documentElement as HTMLElement;

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

      // --- CALM: attiva la reattività allo sfondo SOLO su device touch
      const isCoarse =
        window.matchMedia?.('(pointer: coarse)')?.matches === true;
      const htmlElRef = (this.document as Document).documentElement;

      if (isCoarse) {
        htmlElRef.classList.add('route-animating');
        clearTimeout(this.sheenTimer);
        this.sheenTimer = setTimeout(() => {
          htmlElRef.classList.remove('route-animating');
        }, 420);
      } else {
        // desktop: nessun flash extra
        htmlElRef.classList.remove('route-animating');
      }
    }
  }

  ngOnDestroy() {
    if (!this.isBrowser) return;
    window.removeEventListener('scroll', this.onScroll as any);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.sheenTimer) clearTimeout(this.sheenTimer);
  }

  // --- NEW: aggiorna --bg-speed in base alla velocità di scroll
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
        1 + vel * 0.4 + ''
      );
      this.lastY = y;
      this.lastT = now;
      this.rafId = null;
    });
  };

  // --- NEW: applica classe tema definita nelle route data
  private applyThemeClassFromRoute(html: HTMLElement) {
    // rimuovi classi esistenti che iniziano con "theme-"
    // (evita accumulo quando cambi pagina)
    for (const cls of Array.from(html.classList)) {
      if (cls.startsWith('theme-')) html.classList.remove(cls);
    }

    // cerca la child route più profonda con data.themeClass
    let r: any = this.route;
    let theme: string | undefined;
    while (r?.firstChild) r = r.firstChild;
    if (r?.snapshot?.data?.['themeClass']) {
      theme = r.snapshot.data['themeClass'];
    } else {
      // fallback: risali nel tree originale se necessario
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
    // segnale soft per componenti che vogliono “sincronizzarsi”
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
}
