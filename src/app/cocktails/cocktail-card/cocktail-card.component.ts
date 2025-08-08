import { Component, Input, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';

import { trigger, style, animate, transition } from '@angular/animations';
import { env } from '../../config/env';
import {
  Cocktail,
  CocktailWithLayoutAndMatch,
  StrapiImage,
} from '../../services/strapi.service';

@Component({
  selector: 'app-cocktail-card',
  standalone: true,
  imports: [CommonModule, MatIconModule, RouterLink],
  templateUrl: './cocktail-card.component.html',
  styleUrls: ['./cocktail-card.component.scss'],
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
export class CocktailCardComponent implements OnInit {
  @Input() cocktail!: CocktailWithLayoutAndMatch;
  @Input() totalSelectedIngredientsCount: number = 0;
  @Input() lazyLoadImage: boolean = true;

  mainIngredientsFormatted: string[] = [];

  private apiUrl = env.apiUrl;

  constructor(private router: Router) {}

  ngOnInit(): void {
    if (this.cocktail && this.cocktail.ingredients_list) {
      this.mainIngredientsFormatted = this.cocktail.ingredients_list
        .map((item) => item.ingredient?.name)
        .filter((name) => name) as string[];

      this.mainIngredientsFormatted = this.mainIngredientsFormatted.slice(0, 3);
    }
  }

  @HostListener('click', ['$event'])
  onCardClick(event: MouseEvent): void {
    if (
      window.innerWidth <= 768 &&
      !(
        event.target instanceof HTMLElement &&
        (event.target.closest('a') || event.target.closest('button'))
      )
    ) {
      this.router.navigate(['/cocktails', this.cocktail.slug]);
    }
  }

  getIngredientId(ingredientName: string): string {
    const ingredient = this.cocktail.ingredients_list.find(
      (item) => item.ingredient?.name === ingredientName
    );
    return ingredient?.ingredient?.external_id || ingredientName;
  }

  getPreparationIcon(type: string | undefined | null): string {
    if (!type) {
      return '';
    }
    switch (type.toLowerCase()) {
      case 'shaken':
        return '🍸';
      case 'stirred':
        return '🥄';
      case 'built in glass':
        return '🥂';
      case 'blended':
        return '🥤';
      case 'layered':
        return '🌈';
      case 'muddled':
        return '🌿';
      case 'frozen':
        return '❄️';
      case 'throwing':
        return '💧';
      case 'other':
      default:
        return '❓';
    }
  }

  getGlassIcon(glassType: string | undefined | null): string {
    if (!glassType) {
      return '';
    }
    switch (glassType) {
      case 'Highball glass':
      case 'Collins glass':
      case 'Collins Glass':
        return '🥤';
      case 'Cocktail glass':
      case 'Cocktail Glass':
      case 'Martini Glass':
        return '🍸';
      case 'Old-fashioned glass':
      case 'Whiskey glass':
      case 'Whiskey sour glass':
      case 'Pousse cafe glass':
        return '🥃';
      case 'Brandy snifter':
      case 'White wine glass':
        return '🍷';
      case 'Champagne flute':
        return '🥂';
      case 'Shot glass':
        return '🍶';
      case 'Coffee mug':
      case 'Coffee Mug':
      case 'Irish coffee cup':
        return '☕';
      case 'Beer glass':
      case 'Beer Glass':
      case 'Beer mug':
      case 'Pilsner glass':
        return '🍺';
      case 'Margarita glass':
      case 'Coupe glass':
        return '🍹';
      case 'Hurricane glass':
        return '🍹';
      case 'Jar':
        return '🍯';
      case 'Wine glass':
      case 'Wine Glass':
        return '🍷';
      case 'Pint glass':
        return '🍺';
      case 'Balloon Glass':
        return '🍷';
      case 'Cordial glass':
        return '🥃';
      case 'Whiskey Glass':
        return '🥃';
      case 'Champagne Flute':
        return '🥂';
      case 'Highball Glass':
        return '🥤';
      case 'Mason jar':
        return '🍯';
      case 'Punch bowl':
        return '🥣';
      case 'Copper Mug':
        return '🧉';
      case 'Nick and Nora Glass':
        return '🍸';
      default:
        return '🥛';
    }
  }

  private makeAbsoluteUrl(
    baseUrl: string,
    url: string | null | undefined
  ): string {
    if (!url) {
      return '';
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    const cleanedBaseUrl = baseUrl.endsWith('/')
      ? baseUrl.slice(0, -1)
      : baseUrl;
    const cleanedUrl = url.startsWith('/') ? url : `/${url}`;
    return `${cleanedBaseUrl}${cleanedUrl}`;
  }

  getCocktailCardImageSrcset(image: StrapiImage | null | undefined): string {
    if (!image || !image.formats) {
      return '';
    }

    const sources: string[] = [];
    const baseUrl = this.apiUrl;

    if (
      image.formats.thumbnail &&
      image.formats.thumbnail.url &&
      image.formats.thumbnail.width
    ) {
      const absoluteThumbnailUrl = this.makeAbsoluteUrl(
        baseUrl,
        image.formats.thumbnail.url
      );
      sources.push(`${absoluteThumbnailUrl} ${image.formats.thumbnail.width}w`);
    }

    if (
      image.formats.small &&
      image.formats.small.url &&
      image.formats.small.width
    ) {
      const absoluteSmallUrl = this.makeAbsoluteUrl(
        baseUrl,
        image.formats.small.url
      );
      sources.push(`${absoluteSmallUrl} ${image.formats.small.width}w`);
    }

    return sources.join(', ');
  }

  getCocktailCardImageUrl(image: StrapiImage | null | undefined): string {
    if (!image) {
      return 'assets/no-image.png';
    }

    const relativeOrAbsoluteUrl =
      image.formats?.small?.url || image.formats?.thumbnail?.url || image.url;

    if (!relativeOrAbsoluteUrl) {
      return 'assets/no-image.png';
    }

    return this.makeAbsoluteUrl(this.apiUrl, relativeOrAbsoluteUrl);
  }

  get matchedIngredientsBadgeText(): {
    desktop: string;
    mobile: string;
  } | null {
    if (
      !this.cocktail ||
      this.cocktail.matchedIngredientCount === undefined ||
      !this.cocktail.ingredients_list ||
      this.cocktail.matchedIngredientCount <= 0
    ) {
      return null;
    }

    const isPerfectMatch =
      this.cocktail.matchedIngredientCount ===
      this.cocktail.ingredients_list.length;

    if (isPerfectMatch) {
      return {
        desktop: 'All ingredients covered!',
        mobile: '&#10003;',
      };
    } else {
      return {
        desktop: `${this.cocktail.matchedIngredientCount} of ${this.cocktail.ingredients_list.length} ingredients`,
        mobile: '!',
      };
    }
  }
}
