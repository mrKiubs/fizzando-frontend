import { Component, PLATFORM_ID, inject } from '@angular/core';
import {
  Router,
  NavigationEnd,
  RouterOutlet,
  RouterModule,
} from '@angular/router';
import {
  ViewportScroller,
  CommonModule,
  isPlatformBrowser,
} from '@angular/common';
import { filter } from 'rxjs/operators';
import {
  trigger,
  transition,
  style,
  animate,
  query, // <-- Importa query
  group, // <-- Importa group
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
  // All'interno del tuo @Component in AppComponent.ts
  animations: [
    trigger('routeAnimations', [
      transition(
        '* <=> *',
        [
          style({ position: 'relative' }),
          query(
            ':enter, :leave',
            [style({ position: 'absolute', inset: 0, width: '100%' })],
            { optional: true }
          ),

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
                  '{{duration}}',
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
                  '{{duration}}',
                  style({
                    opacity: 1,
                    transform: 'translateY(0)',
                  })
                ),
              ],
              { optional: true }
            ),
          ]),
        ],
        {
          params: {
            duration: '700ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            enterY: '64px',
            leaveY: '64px',
          },
        }
      ),
    ]),
  ],
  template: `
    <app-navbar></app-navbar>
    <main
      class="app-main"
      [@routeAnimations]="{
        value: getRouteAnimationData(routerOutlet),
        params: animParams
      }"
    >
      <router-outlet #routerOutlet="outlet"></router-outlet>
    </main>
    <app-footer></app-footer>
    <app-cocktail-bubbles></app-cocktail-bubbles>
  `,
  // styles: lascia pure i tuoi, vedi anche styles.scss sotto
})
export class AppComponent {
  private router = inject(Router);
  private viewportScroller = inject(ViewportScroller);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly viewportService = inject(ViewportService);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // 👉 params “mobile-safe”
  private readonly isTouch =
    this.isBrowser &&
    (navigator.maxTouchPoints > 0 ||
      /Android|iP(ad|hone|od)/i.test(navigator.userAgent));

  private readonly prefersReduced =
    this.isBrowser &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    if (this.isBrowser) {
      this.viewportScroller.setHistoryScrollRestoration('manual');
    }

    let lastPath = '';
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const path = e.urlAfterRedirects.split('?')[0];
        const pathChanged = lastPath !== path;
        lastPath = path;

        if (!pathChanged) return;
        const nav = this.router.getCurrentNavigation();

        const state =
          (nav?.extras?.state as any) ||
          (this.isBrowser ? window.history.state : {}) ||
          {};
        if (state.suppressScroll) return;

        this.viewportScroller.scrollToPosition([0, 0]);

      });
  }

  ngOnInit() {
    if (this.isBrowser) {
      this.viewportService.init();

      const htmlEl = document.querySelector('html') as HTMLElement;
      if ('fonts' in (document as any)) {
        (document as any).fonts.ready.finally(() =>
          htmlEl.classList.add('icons-ready')
        );
      } else {
        htmlEl.classList.add('icons-ready');
      }
    }
  }

  get animParams() {
    const reduce = this.isTouch || this.prefersReduced;
    return reduce
      ? { duration: '240ms ease-out', enterY: '24px', leaveY: '24px' }
      : {
          duration: '700ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          enterY: '64px',
          leaveY: '64px',
        };
  }

  getRouteAnimationData(outlet: RouterOutlet) {
    return (
      (outlet &&
        outlet.activatedRouteData &&
        outlet.activatedRouteData['animation']) ||
      'default'
    );
  }
}
