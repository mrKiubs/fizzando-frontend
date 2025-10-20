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
  ViewportScroller, // 👈
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
            [
              style({
                opacity: 0,
                transform: 'translateY({{enterY}})',
              }),
            ],
            { optional: true }
          ),
          group([
            query(
              ':leave',
              [
                animate(
                  '{{leaveDuration}} {{leaveEasing}}',
                  style({
                    opacity: 0,
                    transform: 'translateY({{leaveY}})',
                  })
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
      class="app-main"
      [class.is-animating]="isAnimating"
      [@pageTransition]="{
        value: getRouteAnimationData(routerOutlet),
        params: animParams
      }"
      (@pageTransition.start)="onAnimStart()"
      (@pageTransition.done)="onAnimDone()"
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

      .app-main.is-animating {
        overflow: hidden;
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
  private readonly viewportScroller = inject(ViewportScroller); // 👈

  private skipMotionNext = false;
  protected isAnimating = false;

  protected readonly isTouch =
    this.isBrowser &&
    (navigator.maxTouchPoints > 0 ||
      /Android|iP(ad|hone|od)/i.test(navigator.userAgent));

  protected readonly prefersReduced =
    this.isBrowser &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  protected readonly showAmbient = !this.prefersReduced;

  // --- Scroll lock state
  private lockedScrollY = 0;

  constructor() {
    // 1) Disabilita *qualsiasi* ripristino scroll (browser/router)
    if (this.isBrowser) {
      this.viewportScroller.setHistoryScrollRestoration('manual'); // 👈 blocca il jump nativo
    }

    // Flag skip
    this.router.events
      .pipe(filter((e): e is NavigationStart => e instanceof NavigationStart))
      .subscribe(() => {
        const nav = this.router.getCurrentNavigation();
        const st = (nav?.extras?.state as any) || {};
        this.skipMotionNext = !!(st.suppressMotion || st.suppressScroll);
      });

    // Cleanup flag
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

  // ---------- ANIMATION HOOKS (fix anti "jump to top") ----------
  onAnimStart() {
    this.isAnimating = true;

    // Se stiamo saltando l'animazione, non bloccare nulla
    if (!this.isBrowser || this.skipMotionNext) return;

    // 1) cattura Y corrente
    this.lockedScrollY =
      window.scrollY || this.document.documentElement.scrollTop || 0;

    // 2) blocca visivamente lo scroll fissando il body al viewport
    const body = this.document.body as HTMLBodyElement;
    body.style.position = 'fixed';
    body.style.top = `-${this.lockedScrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
  }

  onAnimDone() {
    // 1) sblocca il body
    const body = this.document.body as HTMLBodyElement;
    body.style.position = '';
    body.style.top = '';
    body.style.left = '';
    body.style.right = '';
    body.style.width = '';

    // 2) resetta lo scroll: vai in cima SOLO se non è uno skip
    if (this.isBrowser && !this.skipMotionNext) {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: 'instant' as ScrollBehavior,
      }); // niente smooth qui
    }

    this.isAnimating = false;
  }
  // --------------------------------------------------------------

  get animParams() {
    const reduce = this.isTouch || this.prefersReduced;
    const isMobile = this.isTouch;

    if (reduce) {
      return {
        enterDuration: '180ms',
        enterDelay: '0ms',
        enterEasing: 'ease-out',
        leaveDuration: '120ms',
        leaveEasing: 'ease-out',
        enterY: '5px',
        leaveY: '-5px',
      };
    }

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
