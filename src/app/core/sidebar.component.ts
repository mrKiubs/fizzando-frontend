import { Component, OnInit, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DevAdsComponent } from '../assets/design-system/dev-ads/dev-ads.component';

interface Category {
  name: string;
  slug: string;
  count?: number; // articoli nella categoria (opzionale)
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, DevAdsComponent],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent implements OnInit {
  private router = inject(Router);

  // tutte le categorie (con eventuale count se lo avrai da API)
  readonly categories = signal<Category[]>([]);

  // model della select
  selectedSlug = '';

  // top 5 per popolazione, fallback alfabetico se count mancante
  readonly topFive = computed(() => {
    const list = [...this.categories()];
    const haveCounts = list.some((c) => typeof c.count === 'number');

    return list
      .sort((a, b) => {
        if (haveCounts) {
          const ca = a.count ?? 0;
          const cb = b.count ?? 0;
          if (cb !== ca) return cb - ca; // discendente
        }
        return a.name.localeCompare(b.name);
      })
      .slice(0, 5);
  });

  ngOnInit(): void {
    // Fallback statico: puoi sostituire (o arricchire) con count quando lo avrai da Strapi
    const all: Category[] = [
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

    // Esempio: se in futuro avrai un dizionario {slug: count} da Strapi, valorizza qui i count
    // const counts: Record<string, number> = {...};
    // all.forEach(c => c.count = counts[c.slug] ?? 0);

    this.categories.set(all);
  }

  trackBySlug = (_: number, item: Category) => item.slug;

  goTo(slug: string) {
    if (!slug) return;
    this.router.navigate(['/articles/category', slug]).then(() => {
      // scroll to top per UX coerente
      if (typeof window !== 'undefined')
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    });
  }

  onSelectChange(slug: string) {
    this.goTo(slug);
  }
}
