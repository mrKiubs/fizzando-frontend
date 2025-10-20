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

        // ✅ conta SOLO lo state della navigazione corrente
        const suppress =
          !!nav?.extras?.state &&
          (nav.extras.state as any).suppressScroll === true;

        if (suppress) return;

        // ✅ esegui solo in browser (evita SSR) e usa DOCUMENT iniettato
        if (!this.isBrowser) return;

        // --- iOS-safe micro scroll ---
        const doScrollTop = () => {
          const doc = this.document as Document;
          const main = doc.querySelector('.app-main') as HTMLElement | null;

          const isScrollable = (el: HTMLElement | null) => {
            if (!el) return false;
            const s = getComputedStyle(el);
            return s.overflowY === 'auto' || s.overflowY === 'scroll';
          };

          const target: HTMLElement | Element = isScrollable(main)
            ? (main as HTMLElement)
            : doc.scrollingElement || doc.documentElement;

          const currentTop =
            target instanceof HTMLElement
              ? target.scrollTop
              : (doc.scrollingElement || doc.documentElement).scrollTop;

          const nudge = () => {
            if (target instanceof HTMLElement) {
              if (currentTop <= 4)
                target.scrollTo({ top: 1, left: 0, behavior: 'auto' });
              target.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            } else {
              const el = doc.scrollingElement || doc.documentElement;
              if (currentTop <= 4)
                el.scrollTo({ top: 1, left: 0, behavior: 'auto' });
              el.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            }
          };

          // doppio rAF: aspetta il paint della nuova route (critico su iOS Safari)
          const raf =
            (window as any).requestAnimationFrame?.bind(window) ||
            ((cb: any) => setTimeout(cb, 0));
          raf(() => raf(nudge));
        };

        // ⬅️ chiama la funzione al posto di viewportScroller.scrollToPosition([0,0])
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
