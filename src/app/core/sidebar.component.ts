import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
interface Category {
  name: string;
  slug: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit {
  categories: Category[] = [];

  constructor() {}

  ngOnInit(): void {
    // Questo è l'array completo delle categorie Strapi
    this.categories = [
      { name: 'Advanced Mixology', slug: 'advanced-mixology' },
      { name: 'Bartending Techniques', slug: 'bartending-techniques' },
      { name: 'Best 3 Cocktails', slug: 'best-3-cocktails' },
      { name: 'Classic Cocktails', slug: 'classic-cocktails' },
      { name: 'Cocktail Ingredients', slug: 'cocktail-ingredients' },
      { name: 'Cocktail Innovation', slug: 'cocktail-innovation' },
      { name: 'Drink History', slug: 'drink-history' },
      { name: 'Easy Cocktail Recipes', slug: 'easy-cocktail-recipes' },
      { name: 'Exotic Sips', slug: 'exotic-sips' },
      { name: 'Famous Aperitifs', slug: 'famous-aperitifs' },
      { name: 'Food Pairings', slug: 'food-pairings' },
      { name: 'Glassware Guide', slug: 'glassware-guide' },
      { name: 'Home Bar Essentials', slug: 'home-bar-essentials' },
      { name: 'Mocktails & Zero Proof', slug: 'mocktails-and-zero-proof' },
      { name: 'Non-Alcoholic Drinks', slug: 'non-alcoholic-drinks' },
      { name: 'Party Drinks', slug: 'party-drinks' },
      { name: 'Seasonal Drinks', slug: 'seasonal-drinks' },
      { name: 'Spirits Guide', slug: 'spirits-guide' },
      { name: 'Summer Cocktails', slug: 'summer-cocktails' },
      { name: 'Tropical Drinks', slug: 'tropical-drinks' },
      { name: 'Winter Warmers', slug: 'winter-warmers' },
    ];
  }
}
