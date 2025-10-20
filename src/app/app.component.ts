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
  DOCUMENT,
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
      @use './assets/style/main.scss' as *; // Assicurati che il percorso sia corretto

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
  // styles: lascia pure i tuoi, vedi anche styles.scss sotto
})
export class AppComponent {
  private router = inject(Router);
  private viewportScroller = inject(ViewportScroller);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly viewportService = inject(ViewportService);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly document = inject(DOCUMENT);

  // 👉 params “mobile-safe”
  protected readonly isTouch =
    this.isBrowser &&
    (navigator.maxTouchPoints > 0 ||
      /Android|iP(ad|hone|od)/i.test(navigator.userAgent));

  protected readonly prefersReduced =
    this.isBrowser &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  protected readonly showAmbient = !this.prefersReduced;

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

        // SOLO lo state della navigazione corrente
        const suppress =
          !!nav?.extras?.state &&
          (nav.extras.state as any).suppressScroll === true;
        if (suppress) return;

        if (!this.isBrowser) return;

        const doScrollTop = () => {
          const doc = this.document as Document;

          // 🔎 Candidati comuni nelle tue viste
          const candidates: (Element | null)[] = [
            doc.querySelector('.app-main'),
            doc.querySelector('.detail-wrapper'),
            doc.querySelector('.ingredient-detail-wrapper'),
            doc.querySelector('.list-wrapper'),
            doc.scrollingElement || doc.documentElement,
          ];

          const isScrollable = (el: Element | null) => {
            if (!el || !(el instanceof HTMLElement)) return false;
            const s = getComputedStyle(el);
            const canScroll =
              s.overflowY === 'auto' ||
              s.overflowY === 'scroll' ||
              s.overflowY === 'overlay';
            return canScroll && el.scrollHeight > el.clientHeight;
          };

          // Primo scrollable valido, altrimenti fallback al documento
          const target =
            (candidates.find(isScrollable) as HTMLElement | null) ||
            (doc.scrollingElement as HTMLElement) ||
            (doc.documentElement as HTMLElement);

          const before = target.scrollTop;

          const nudge = () => {
            // 👇 nudge “forte” per test su iPhone. Quando confermi che si vede, riporta 24→1.
            if (before <= 4)
              target.scrollTo({ top: 24, left: 0, behavior: 'auto' });
            target.scrollTo({ top: 0, left: 0, behavior: 'auto' });

            // LOG diagnostico: verifica container e valori
            console.log('[scrollTop]', {
              path,
              target:
                (target as HTMLElement).className ||
                (target as HTMLElement).tagName,
              before,
              after: target.scrollTop,
            });
          };

          const raf = window.requestAnimationFrame.bind(window);
          raf(() => raf(nudge));
        };

        doScrollTop();
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
      ? { duration: '220ms ease-out', enterY: '16px', leaveY: '16px' }
      : {
          duration: '420ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          enterY: '40px',
          leaveY: '40px',
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
