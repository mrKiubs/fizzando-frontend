import {
  AfterViewInit,
  Directive,
  ElementRef,
  OnDestroy,
  Renderer2,
  inject,
} from '@angular/core';

@Directive({
  selector: 'img[appLazyImageFade]',
  standalone: true,
})
export class LazyImageFadeDirective implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLImageElement>);
  private readonly renderer = inject(Renderer2);
  private unlisteners: Array<() => void> = [];

  ngAfterViewInit(): void {
    const img = this.elementRef.nativeElement;

    this.renderer.addClass(img, 'lazy-image-fade');

    if (img.complete && img.naturalWidth > 0) {
      this.markLoaded();
      return;
    }

    this.unlisteners.push(
      this.renderer.listen(img, 'load', () => this.markLoaded()),
      this.renderer.listen(img, 'error', () => this.markLoaded())
    );
  }

  private markLoaded(): void {
    this.renderer.addClass(
      this.elementRef.nativeElement,
      'lazy-image-fade--loaded'
    );
    this.destroyListeners();
  }

  private destroyListeners(): void {
    if (this.unlisteners.length) {
      for (const unlisten of this.unlisteners) {
        try {
          unlisten();
        } catch {
          // no-op
        }
      }
      this.unlisteners = [];
    }
  }

  ngOnDestroy(): void {
    this.destroyListeners();
  }
}
