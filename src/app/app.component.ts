import { Component, inject } from '@angular/core';
import {
  Router,
  NavigationEnd,
  RouterOutlet,
  RouterModule,
} from '@angular/router';
import { ViewportScroller, CommonModule } from '@angular/common';
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
      transition('* <=> *', [
        style({ position: 'relative' }),
        query(
          ':enter, :leave',
          [
            style({
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
            }),
          ],
          { optional: true }
        ),
        query(
          ':enter',
          [
            style({
              opacity: 0,
              transform: 'translateY(100px)', // Inizia 100px più in basso, invisibile
            }),
          ],
          { optional: true }
        ),
        group([
          query(
            ':leave',
            [
              animate(
                '800ms ease-out',
                style({ opacity: 0, transform: 'translateY(100px)' }) // Scivola in basso e svanisce
              ),
            ],
            { optional: true }
          ),
          query(
            ':enter',
            [
              animate(
                '800ms ease-out',
                style({ opacity: 1, transform: 'translateY(0)' }) // Scivola verso l'alto e appare
              ),
            ],
            { optional: true }
          ),
        ]),
      ]),
    ]),
  ],
  template: `
    <app-navbar></app-navbar>
    <main
      class="app-main"
      [@routeAnimations]="getRouteAnimationData(routerOutlet)"
    >
      <router-outlet #routerOutlet="outlet"></router-outlet>
    </main>
    <app-footer></app-footer>
    <app-cocktail-bubbles></app-cocktail-bubbles>
  `,
  styles: [
    `
      .app-main {
        padding: 16px;
        display: block;
        position: relative; /* Importante per il posizionamento assoluto */
        overflow: hidden; /* Nasconde l'overflow durante la transizione */
      }
      @media (max-width: 600px) {
        .app-main {
          padding: 8px;
        }
      }
    `,
  ],
})
export class AppComponent {
  private router = inject(Router);
  private viewportScroller = inject(ViewportScroller);

  constructor() {
    this.viewportScroller.setHistoryScrollRestoration('manual'); // ⬅️ importantissimo

    let lastPath = '';
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const path = e.urlAfterRedirects.split('?')[0];
        const pathChanged = lastPath !== path;
        lastPath = path;

        if (!pathChanged) return; // stesso /cocktails, solo query → NIENTE TOP

        const isBrowser = typeof window !== 'undefined';
        const nav = this.router.getCurrentNavigation();
        const state =
          (nav?.extras?.state as any) ||
          (isBrowser ? window.history.state : null) ||
          {};

        if (state.suppressScroll) return; // rispetta soppressione

        this.viewportScroller.scrollToPosition([0, 0]); // cambio pagina “vera”
      });
  }

  getRouteAnimationData(outlet: RouterOutlet) {
    // Puoi mantenere questo metodo così com'è, dato che il cambio di stringa triggera l'animazione * <=> *
    // oppure semplificarlo se non hai bisogno di stati specifici per altre animazioni.
    // Se vuoi semplificare, potresti fare:
    // return outlet?.isActivated ? outlet.activatedRoute.snapshot.url.join('/') : '';
    // o semplicemente una stringa costante se non ti interessano i dati di animazione per il trigger
    return (
      (outlet &&
        outlet.activatedRouteData &&
        outlet.activatedRouteData['animation']) ||
      'default'
    );
  }
}
