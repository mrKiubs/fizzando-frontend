// app/directives/celebrate-navigate.directive.ts
import { Directive, HostListener, Input, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ConfettiBurstComponent } from '../confetti-burst/confetti-burst.component';

@Directive({
  selector: '[appCelebrateNavigate]',
  standalone: true,
})
export class CelebrateNavigateDirective {
  @Input('appCelebrateNavigate') to!: string | any[]; // rotta o UrlTree
  @Input() celebrateDelay = 750; // ms
  @Input() celebrateOrigin: 'center' | 'top' | 'bottom' = 'bottom';
  @Input() celebrateTarget?: ConfettiBurstComponent; // riferimento al componente confetti
  @Input() skipIfReducedMotion = true;

  private navigating = false;

  constructor(private router: Router, private zone: NgZone) {}

  @HostListener('click', ['$event'])
  onClick(ev: Event) {
    // Evita doppie esecuzioni (click sintetico dopo touch, ecc.)
    if (this.navigating) return;

    // Rispetta prefers-reduced-motion (accessibilità)
    const prefersReduced =
      this.skipIfReducedMotion &&
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    ev.preventDefault();
    ev.stopPropagation();

    // Avvia confetti se consentito
    if (!prefersReduced && this.celebrateTarget) {
      this.celebrateTarget.burst(this.celebrateOrigin);
    }

    this.navigating = true;
    this.zone.runOutsideAngular(() => {
      setTimeout(
        () => {
          this.zone.run(() => {
            // Naviga manualmente
            Array.isArray(this.to)
              ? this.router
                  .navigate(this.to)
                  .finally(() => (this.navigating = false))
              : this.router
                  .navigateByUrl(this.to as string)
                  .finally(() => (this.navigating = false));
          });
        },
        prefersReduced ? 0 : this.celebrateDelay
      );
    });
  }
}
