import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  imports: [CommonModule],
  selector: 'app-affiliate-product',
  templateUrl: './affiliate-product.component.html',
  styleUrls: ['./affiliate-product.component.scss'],
})
export class AffiliateProductComponent {
  @Input() title: string = '';
  @Input() imageUrl: string = '';
  @Input() price: string = '';
  @Input() link: string = '';
  @Input() showPlaceholder: boolean = true; // true = stile dev, false = stile Amazon reale
}
