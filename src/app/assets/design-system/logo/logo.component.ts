import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
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
export class LogoComponent {
  @Input() text = 'Fizzando';
  @Input() tagline = 'Make Better Cocktail'; // opzionale; rimuovi se non ti serve
  @Input() size: LogoSize = 'md';
  @Input() isHome = false; // <-- H1 in home, H2 altrove
  @Input() homeLink: string | any[] = ['/']; // path del link alla home
}
