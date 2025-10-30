import {
  Component,
  EventEmitter,
  Injector,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  ViewContainerRef,
  ComponentRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { SearchOverlayInertEvent } from './navbar-search.component';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-navbar-search-host',
  standalone: true,
  imports: [CommonModule],
  template: '<ng-container #vc></ng-container>',
})
export class NavbarSearchHostComponent implements OnChanges, OnDestroy {
  @Input() open = false;
  @Output() closeRequested = new EventEmitter<void>();
  @Output() inertToggle = new EventEmitter<SearchOverlayInertEvent>();

  @ViewChild('vc', { read: ViewContainerRef, static: true })
  private vc!: ViewContainerRef;

  private componentRef?: ComponentRef<any>;
  private loadPromise?: Promise<void>;
  private subs: Subscription[] = [];

  constructor(private injector: Injector) {}

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (!this.componentRef) {
      await this.ensureComponent();
    }
    if (this.componentRef) {
      this.componentRef.instance.open = this.open;
      this.componentRef.changeDetectorRef.detectChanges();
    }
  }

  ngOnDestroy(): void {
    this.componentRef?.destroy();
    this.componentRef = undefined;
    this.subs.forEach((s) => s.unsubscribe());
    this.subs = [];
  }

  private async ensureComponent(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = import('./navbar-search.component').then(
        ({ NavbarSearchComponent }) => {
          this.componentRef = this.vc.createComponent(NavbarSearchComponent, {
            injector: this.injector,
          });
          this.subs.push(
            this.componentRef.instance.closeRequested.subscribe(() =>
              this.closeRequested.emit()
            )
          );
          this.subs.push(
            this.componentRef.instance.inertToggle.subscribe((event: any) =>
              this.inertToggle.emit(event)
            )
          );
          this.componentRef.instance.open = this.open;
        }
      );
    }
    return this.loadPromise;
  }
}
