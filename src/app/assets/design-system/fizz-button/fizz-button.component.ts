import {
  Component,
  Input,
  ViewChild,
  ElementRef,
  AfterViewInit,
  ChangeDetectionStrategy,
  HostBinding,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

export type FizzButtonSize = 'normal' | 'small';

@Component({
  selector: 'fizz-button',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './fizz-button.component.html',
  styleUrls: ['./fizz-button.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FizzButtonComponent implements AfterViewInit {
  @ViewChild('btn', { static: false }) btn?: ElementRef<
    HTMLButtonElement | HTMLAnchorElement
  >;

  @Input() disabled = false;
  @Input() size: FizzButtonSize = 'normal';
  @Input() responsive = false; // ⬅️ nuovo: full width se true

  // button-only
  private _type: 'button' | 'submit' | 'reset' = 'button';
  @Input() set type(v: 'button' | 'submit' | 'reset' | undefined) {
    this._type = v === 'submit' || v === 'reset' ? v : 'button';
  }
  get type() {
    return this._type;
  }

  // link (router o href)
  @Input() routerLink: string | any[] | undefined;
  @Input() queryParams: Record<string, any> | undefined;
  @Input() fragment: string | undefined;
  @Input() replaceUrl = false;
  @Input() state: Record<string, any> | undefined;

  @Input() href: string | undefined;
  @Input() target: string | undefined;
  @Input() rel: string | undefined;

  // form extras
  @Input() name: string | undefined;
  @Input() value: string | undefined;
  @Input() form: string | undefined;
  @Input() formaction: string | undefined;
  @Input() formenctype: string | undefined;
  @Input() formmethod: string | undefined;
  @Input() formtarget: string | undefined;
  @Input() formnovalidate = false;

  @Input() autofocus = false;

  @HostBinding('attr.aria-disabled') get ariaDisabled() {
    return String(this.disabled);
  }
  @HostBinding('style.display') hostDisplay = 'inline-block';
  @HostBinding('style.position') hostPosition = 'relative';
  @HostBinding('style.boxSizing') hostBoxSizing = 'border-box';

  get isLink(): boolean {
    return !this.disabled && (!!this.routerLink || !!this.href);
  }

  get computedRel(): string | null {
    if (this.rel) return this.rel;
    if (this.target === '_blank') return 'noopener noreferrer';
    return null;
  }

  ngAfterViewInit(): void {
    if (this.autofocus && !this.disabled)
      queueMicrotask(() => this.btn?.nativeElement.focus());
  }

  onMaybeDisabledClick(ev: Event) {
    if (this.disabled) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  focus(options?: FocusOptions) {
    this.btn?.nativeElement.focus(options);
  }
  click() {
    this.btn?.nativeElement.click();
  }
}
