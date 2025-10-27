// src/app/ingredients/ingredient-card/ingredient-card.component.ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Ingredient, StrapiImage } from '../../services/ingredient.service';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { trigger, style, animate, transition } from '@angular/animations';
import { env } from '../../config/env';

@Component({
  selector: 'app-ingredient-card',
  standalone: true,
  imports: [CommonModule, MatIconModule, RouterLink],
  templateUrl: './ingredient-card.component.html',
  styleUrls: ['./ingredient-card.component.scss'],
  animations: [
    trigger('cardAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(20px)' }),
        animate('300ms ease-out', style({ opacity: 1, transform: 'none' })),
      ]),
      transition(':leave', [
        animate(
          '200ms ease-in',
          style({ opacity: 0, transform: 'translateY(10px)' })
        ),
      ]),
    ]),
  ],
})
export class IngredientCardComponent {
  @Input() ingredient!: Ingredient;
  @Input() lazyLoadImage: boolean = true;
  @Input() priority = false;

  private apiUrl = env.apiUrl;

  getIngredientId(ingredient: Ingredient): string {
    return ingredient.external_id || String(ingredient.id);
  }

  /** URL assoluto sicuro */
  private makeAbsoluteUrl(url?: string | null): string | undefined {
    if (!url) return undefined;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    const base = this.apiUrl.endsWith('/')
      ? this.apiUrl.slice(0, -1)
      : this.apiUrl;
    const rel = url.startsWith('/') ? url : `/${url}`;
    return `${base}${rel}`;
  }

  /** Cambia estensione in .webp mantenendo eventuale querystring */
  private toWebp(url?: string): string | undefined {
    if (!url) return undefined;
    return url.replace(/\.(jpe?g|png)(\?.*)?$/i, '.webp$2');
  }

  /** Scegli l'immagine “piccola” più adatta (small → thumbnail → url) */
  private pickSmall(image?: StrapiImage | null): string | undefined {
    if (!image) return undefined;
    return (
      this.makeAbsoluteUrl(image.formats?.small?.url) ||
      this.makeAbsoluteUrl(image.formats?.thumbnail?.url) ||
      this.makeAbsoluteUrl(image.url)
    );
  }

  /** Sorgente WebP singola (per <source>) */
  webpSrc(image?: StrapiImage | null): string | undefined {
    const small = this.pickSmall(image);
    return this.toWebp(small);
  }

  /** Fallback JPG/PNG singolo (per <img> o <source>) */
  jpgSrc(image?: StrapiImage | null): string {
    return this.pickSmall(image) || 'assets/no-image.png';
  }

  /** URL <img> finale (fallback assoluto) */
  getIngredientCardImageUrl(image: StrapiImage | null | undefined): string {
    return this.jpgSrc(image);
  }

  // --- Helpers per i link ai filtri (no service, no regex nel template) ---
  private slugify(val: string): string {
    return (val || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  /** Link alla lista filtrata per categoria (type) */
  get typeParams(): Record<string, string | number> {
    const t = this.ingredient?.ingredient_type || '';
    const slug = this.slugify(t);
    // se non c'è categoria, non passo il filtro
    return slug ? { type: slug, page: 1 } : { page: 1 };
  }

  /** Link alla lista filtrata per stato alcolico */
  get alcParams(): Record<string, string | number> {
    const flag = this.ingredient?.isAlcoholic;
    if (flag === undefined || flag === null) return { page: 1 };
    // usa la chiave che legge la tua pagina /ingredients (di solito 'alcoholic')
    return { alcoholic: flag ? 'true' : 'false', page: 1 };
  }
}
