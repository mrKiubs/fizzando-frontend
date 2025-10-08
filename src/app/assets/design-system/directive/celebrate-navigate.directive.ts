// app/directives/celebrate-navigate.directive.ts
import {
  Directive,
  HostListener,
  Input,
  NgZone,
  ElementRef,
  Renderer2,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { Router } from '@angular/router';
import { ConfettiBurstComponent } from '../confetti-burst/confetti-burst.component';

@Directive({
  selector: '[appCelebrateNavigate]',
  standalone: true,
})
export class CelebrateNavigateDirective implements OnInit, OnDestroy {
  @Input('appCelebrateNavigate') to!: string | any[];
  @Input() celebrateDelay = 10000; // ms
  @Input() celebrateOrigin: 'center' | 'top' | 'bottom' = 'bottom';
  @Input() celebrateTarget?: ConfettiBurstComponent;
  @Input() skipIfReducedMotion = false; // vuoi sempre il delay

  private navigating = false;
  private originalHref: string | null = null;
  private isAnchor = false;

  constructor(
    private router: Router,
    private zone: NgZone,
    private el: ElementRef<HTMLElement>,
    private renderer: Renderer2
  ) {}

  ngOnInit() {
    const el = this.el.nativeElement;

    // 1) Se è un <a>, neutralizza href per evitare navigazione nativa iOS
    this.isAnchor = el.tagName === 'A';
    if (this.isAnchor) {
      this.originalHref = el.getAttribute('href');
      if (this.originalHref) {
        // togli href (lo ripristiniamo a ngOnDestroy)
        this.renderer.removeAttribute(el, 'href');
        // facoltativo: mantenere aspetto cliccabile
        this.renderer.setStyle(el, 'cursor', 'pointer');
        this.renderer.setAttribute(el, 'role', 'link');
        this.renderer.setAttribute(el, 'tabindex', '0');
      }
    }

    // 2) Se è un <button> dentro un form, forza type="button"
    if (
      el.tagName === 'BUTTON' &&
      (el as HTMLButtonElement).type !== 'button'
    ) {
      this.renderer.setAttribute(el, 'type', 'button');
    }
  }

  ngOnDestroy() {
    // ripristina href se l’avevamo tolto
    if (this.isAnchor && this.originalHref != null) {
      this.renderer.setAttribute(
        this.el.nativeElement,
        'href',
        this.originalHref
      );
    }
  }

  @HostListener('click', ['$event'])
  onClick(ev: Event) {
    if (this.navigating) return;

    // *** blocca TUTTO subito ***
    if (typeof (ev as any).stopImmediatePropagation === 'function') {
      (ev as any).stopImmediatePropagation();
    }
    ev.stopPropagation();
    ev.preventDefault();

    const prefersReduced =
      this.skipIfReducedMotion &&
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Confetti (opzionale)
    if (!prefersReduced && this.celebrateTarget) {
      this.celebrateTarget.burst(this.celebrateOrigin);
    }

    this.navigating = true;

    // Usa il setTimeout globale, fuori da Angular, poi rientra
    this.zone.runOutsideAngular(() => {
      const delay = prefersReduced ? 0 : this.celebrateDelay;
      (window as any).setTimeout(() => {
        this.zone.run(() => {
          const nav = Array.isArray(this.to)
            ? this.router.navigate(this.to)
            : this.router.navigateByUrl(this.to as string);

          // indipendentemente dal risultato, sblocca
          Promise.resolve(nav).finally(() => (this.navigating = false));
        });
      }, delay);
    });

    // return false per sicurezza extra con alcuni handler Angular
    return false as unknown as void;
  }
}
