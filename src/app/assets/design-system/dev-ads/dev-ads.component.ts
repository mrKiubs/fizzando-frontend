import { Component, Input, isDevMode } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dev-ads',
  templateUrl: './dev-ads.component.html',
  styleUrls: ['./dev-ads.component.scss'],
  standalone: true,
  imports: [CommonModule],
})
export class DevAdsComponent {
  @Input() type:
    | 'leaderboard' // Banner orizzontale grande, 728x90 px, classico header
    | 'large-leaderboard' // Banner orizzontale extra large, 970x90 px, visibile su desktop
    | 'banner' // Banner orizzontale medio, 468x60 px, formato classico
    | 'skyscraper' // Banner verticale stretto, 120x600 px, laterale
    | 'wide-skyscraper' // Banner verticale largo, 160x600 px, laterale più visibile
    | 'half-page' // Banner grande verticale, 300x600 px, impatto forte
    | 'medium-rectangle' // Riquadro medio, 300x250 px, formato versatile e molto usato
    | 'large-rectangle' // Riquadro grande, 336x280 px, simile al precedente ma più grande
    | 'mobile-banner' // Banner orizzontale per mobile, 320x100 px
    | 'mobile-leaderboard' // Banner mobile più piccolo, 320x50 px, adatto in cima o fondo pagina
    | 'square' // Quadrato grande, 250x250 px, formato quadrato classico
    | 'small-square' // Quadrato piccolo, 200x200 px, meno invasivo
    | 'responsive' = 'responsive'; // Banner che si adatta automaticamente alla larghezza del contenitore

  isDev = isDevMode();
}
