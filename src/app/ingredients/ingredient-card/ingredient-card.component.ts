// src/app/ingredients/ingredient-card/ingredient-card.component.ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Ingredient, StrapiImage } from '../../services/ingredient.service'; // Importa StrapiImage
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import {
  trigger,
  state,
  style,
  animate,
  transition,
} from '@angular/animations';
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
  @Input() lazyLoadImage: boolean = true; // <--- NUOVO INPUT
  @Input() priority = false;
  private apiUrl = env.apiUrl;

  getIngredientId(ingredient: Ingredient): string {
    return ingredient.external_id || ingredient.id.toString();
  }

  // Questo metodo è già buono, ma lo rinomino per chiarezza
  getIngredientCardImageUrl(image: StrapiImage | null | undefined): string {
    if (!image) return 'assets/no-image.png';
    // Priorità: small, thumbnail, poi url principale
    const url =
      image.formats?.small?.url || image.formats?.thumbnail?.url || image.url;
    // Assicurati che il servizio abbia già reso l'URL assoluto, altrimenti aggiungi qui la logica
    // Se il tuo IngredientService.processIngredientImage già rende gli URL assoluti, questo è ok.
    return url || 'assets/no-image.png';
  }
}
