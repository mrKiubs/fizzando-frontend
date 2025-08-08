// src/app/assets/design-system/ds-button/ds-button.component.ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ds-button', // Il selettore per usare il componente nell'HTML
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ds-button.component.html',
  styleUrls: ['./ds-button.component.scss'],
})
export class DsButtonComponent {
  // Rimosso @Input() buttonText: string = 'Il Mio Bottone';
  @Input() type: 'primary' | 'secondary' | 'glass' = 'primary';
  @Input() isIconOnly: boolean = false;
  @Input() size: 'normal' | 'little' = 'normal';
}
