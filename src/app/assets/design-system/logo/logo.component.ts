import {
  Component,
  Input,
  ChangeDetectionStrategy,
  HostBinding,
  HostListener,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

type LogoSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-logo',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './logo.component.html',
  styleUrls: ['./logo.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogoComponent implements OnDestroy {
  @Input() text = 'Fizzando';
  @Input() tagline = 'Make Better Cocktails'; // opzionale; rimuovi se non ti serve
  @Input() size: LogoSize = 'md';
  @Input() isHome = false; // <-- H1 in home, H2 altrove
  @Input() homeLink: string | any[] = ['/']; // path del link alla home

  @HostBinding('class.is-pressing')
  private isPressing = false;

  @HostBinding('class.is-bouncing')
  private isBouncing = false;

  private bounceTimeoutId: ReturnType<typeof setTimeout> | null = null;

  @HostListener('pointerdown')
  handlePointerDown(): void {
    this.clearBounce();
    this.isPressing = true;
  }

  @HostListener('pointerup')
  @HostListener('pointerleave')
  @HostListener('pointercancel')
  handlePointerRelease(): void {
    if (!this.isPressing) {
      return;
    }

    this.isPressing = false;
    this.startBounce();
  }

  ngOnDestroy(): void {
    this.clearBounce();
  }

  private startBounce(): void {
    this.isBouncing = true;
    this.bounceTimeoutId = setTimeout(() => {
      this.isBouncing = false;
      this.bounceTimeoutId = null;
    }, 320);
  }

  private clearBounce(): void {
    if (this.bounceTimeoutId) {
      clearTimeout(this.bounceTimeoutId);
      this.bounceTimeoutId = null;
    }
    this.isBouncing = false;
  }
}
