import {
  Directive,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  Renderer2,
} from '@angular/core';
import { ViewportService } from '../services/viewport.service';

type StickyStrategy = 'sticky' | 'fixed';

@Directive({
  selector: '[appStickyHeader]',
  standalone: true,
})
export class StickyHeaderDirective implements OnInit, OnDestroy {
  private strategy: StickyStrategy = 'sticky';

  constructor(
    private readonly viewportService: ViewportService,
    private readonly renderer: Renderer2,
    private readonly elRef: ElementRef<HTMLElement>
  ) {}

  @Input('appStickyHeader')
  set appStickyHeader(value: StickyStrategy | '' | boolean | null | undefined) {
    if (value === 'fixed' || value === true) {
      this.strategy = 'fixed';
    } else {
      this.strategy = 'sticky';
    }

    this.applyStrategy();
  }

  ngOnInit(): void {
    this.viewportService.init();
    this.applyStrategy();
  }

  ngOnDestroy(): void {
    this.viewportService.enableIOSFixedHeader(false);
    this.renderer.removeClass(this.elRef.nativeElement, 'ios-fixed');
  }

  private applyStrategy(): void {
    const useFixed =
      this.strategy === 'fixed' && this.viewportService.isDynamicViewportTarget;

    this.viewportService.enableIOSFixedHeader(useFixed);

    if (useFixed) {
      this.renderer.addClass(this.elRef.nativeElement, 'ios-fixed');
    } else {
      this.renderer.removeClass(this.elRef.nativeElement, 'ios-fixed');
    }
  }
}
