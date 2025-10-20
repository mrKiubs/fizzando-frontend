// src/app/app.component.ts
import { Component, PLATFORM_ID, inject } from '@angular/core';
import {
  Router,
  NavigationEnd,
  NavigationStart,
  RouterOutlet,
  RouterModule,
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
      // percorso senza animazioni
      transition('noanim <=> *', [
        style({ position: 'relative' }),
        query(':enter, :leave', [style({ opacity: 1, transform: 'none' })], {
          optional: true,
        }),
        query(':leave', [style({ display: 'none' })], { optional: true }),
      ]),

      // percorso animato
      transition(
        '* <=> *',
        [
          style({ position: 'relative' }),

          // layering
          query(':leave', [style({ zIndex: 1, pointerEvents: 'none' })], {
            optional: true,
          }),
          query(':enter', [style({ zIndex: 0 })], { optional: true }),

          // stato iniziale di :enter
          query(
            ':enter',
            [style({ opacity: 0, transform: 'translateY({{enterY}})' })],
            { optional: true }
          ),

          // animazioni in parallelo
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

      /* iOS compositing hints durante le route-anim */
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
export class AppComponent {
  private router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly viewportService = inject(ViewportService);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly document = inject(DOCUMENT);
  private readonly scroller = inject(ViewportScroller);

  private skipMotionNext = false;

  // Touch detection per parametri mobile
  protected readonly isTouch =
    this.isBrowser &&
    (navigator.maxTouchPoints > 0 ||
      /Android|iP(ad|hone|od)/i.test(navigator.userAgent));

  // Non spegniamo più le animazioni in base a prefers-reduced-motion
  protected readonly prefersReduced =
    this.isBrowser &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Effetti ambient sempre visibili
  protected readonly showAmbient = true;

  // stato animazione route (esposto per altri component via evento globale)
  public isRouteAnimating = false;

  constructor() {
    // intercetta start: flag per skip
    this.router.events
      .pipe(filter((e): e is NavigationStart => e instanceof NavigationStart))
      .subscribe(() => {
        const nav = this.router.getCurrentNavigation();
        const st = (nav?.extras?.state as any) || {};
        this.skipMotionNext = !!(st.suppressMotion || st.suppressScroll);
      });

    // pulizia flag su end
    let lastPath = '';
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const path = e.urlAfterRedirects.split('?')[0];
        const pathChanged = lastPath !== path;
        lastPath = path;
        if (!pathChanged) return;
        setTimeout(() => (this.skipMotionNext = false), 50);
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
    }
  }

  // segnale di START animazione (classe globale + CustomEvent)
  onRouteAnimStart() {
    if (!this.isBrowser) return;
    this.isRouteAnimating = true;
    const html = (this.document as Document).documentElement;
    html.classList.add('route-animating');
    window.dispatchEvent(new CustomEvent('route-anim', { detail: true }));
  }

  // dopo l'animazione: porta in alto e togli classe/evento
  onRouteAnimDone() {
    if (!this.isBrowser) return;

    this.isRouteAnimating = false;
    const html = (this.document as Document).documentElement;
    html.classList.remove('route-animating');
    window.dispatchEvent(new CustomEvent('route-anim', { detail: false }));

    if (this.router.url.includes('#')) return; // lascia gestire l'anchor
    this.scroller.scrollToPosition([0, 0]);
  }

  // Parametri animazione (sempre ON, con tuning mobile)
  get animParams() {
    const isMobile = this.isTouch;

    if (isMobile) {
      return {
        enterDuration: '280ms',
        enterDelay: '25ms',
        enterEasing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        leaveDuration: '180ms',
        leaveEasing: 'ease-out',
        enterY: '8px',
        leaveY: '-8px',
      };
    }

    return {
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
