import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, ParamMap, RouterModule } from '@angular/router';
import { ArticleService, Article } from '../../services/article.service';
import { SidebarComponent } from '../../core/sidebar.component';
import { Meta, Title } from '@angular/platform-browser';
import { DevAdsComponent } from '../../assets/design-system/dev-ads/dev-ads.component';

@Component({
  selector: 'app-article-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CommonModule,
    SidebarComponent,
    DevAdsComponent,
  ],
  templateUrl: './article-list.component.html',
  styleUrls: ['./article-list.component.scss'],
})
export class ArticleListComponent implements OnInit {
  articles: Article[] = [];
  loading = false;
  error = '';

  categorySlug: string | null = null;
  categoryName: string = '';

  mainTitle: string = '';
  subTitle: string = '';

  // Mappa delle descrizioni per i titoli H1 e i paragrafi descrittivi (H2 impliciti)
  private pageDescriptions: {
    [key: string]: { title: string; description: string };
  } = {
    'all-articles': {
      title: 'All Articles & Guides',
      description:
        'Explore our comprehensive collection of articles and guides on the world of cocktails. Discover recipes, techniques, and insights.',
    },
    'advanced-mixology': {
      title: 'Advanced Mixology',
      description:
        'Dive deeper into cocktail artistry. Find articles and guides on advanced mixology techniques, complex recipes, and innovative concepts.',
    },
    'bartending-techniques': {
      title: 'Bartending Techniques',
      description:
        'Elevate your craft with our essential bartending techniques. Learn to shake, stir, muddle, and garnish like a professional.',
    },
    'best-3-cocktails': {
      title: 'Best 3 Cocktails',
      description:
        'Discover the top 3 essential cocktails every enthusiast should know and master. Find recipes, history, and expert tips.',
    },
    'classic-cocktails': {
      title: 'Classic Cocktails',
      description:
        'Journey through the golden age of mixology. Explore articles and guides on classic cocktails, their origins, and authentic recipes.',
    },
    'cocktail-ingredients': {
      title: 'Cocktail Ingredients',
      description:
        'Understand the building blocks of great drinks. Our articles and guides cover spirits, liqueurs, bitters, and fresh components for your bar.',
    },
    'cocktail-innovation': {
      title: 'Cocktail Innovation',
      description:
        'Stay ahead of the curve. Explore articles and guides on cocktail innovation, featuring new trends, experimental ingredients, and groundbreaking ideas.',
    },
    'drink-history': {
      title: 'Drink History',
      description:
        'Uncover the fascinating past of your favorite beverages. Our articles and guides delve into the origins and evolution of cocktails worldwide.',
    },
    'easy-cocktail-recipes': {
      title: 'Easy Cocktail Recipes',
      description:
        'Start mixing today! Find articles and guides with easy cocktail recipes perfect for beginners, offering simple steps to delicious and approachable drinks.',
    },
    'exotic-sips': {
      title: 'Exotic Sips',
      description:
        'Embark on a flavorful journey. Our articles and guides on exotic sips feature unique ingredients and vibrant cocktails from around the world.',
    },
    'famous-aperitifs': {
      title: 'Famous Aperitifs',
      description:
        'Discover the art of the aperitif. Our articles and guides explore their history and recipes, perfect for stimulating the palate before a meal.',
    },
    'food-pairings': {
      title: 'Cocktail & Food Pairings',
      description:
        'Elevate your dining experience. Explore articles and guides on cocktail and food pairings to find the perfect drink to complement your favorite dishes.',
    },
    'glassware-guide': {
      title: 'Glassware Guide',
      description:
        'Understand the importance of presentation. Our articles and guides offer a complete overview of cocktail glassware, ensuring you pick the perfect vessel for every drink.',
    },
    'home-bar-essentials': {
      title: 'Home Bar Essentials',
      description:
        'Set up your ultimate home bar. Our articles and guides on home bar essentials cover must-have spirits, tools, and accessories for aspiring mixologists.',
    },
    'mocktails-and-zero-proof': {
      title: 'Mocktails & Zero-Proof Drinks',
      description:
        'Enjoy amazing flavors without alcohol. Find articles and guides on refreshing mocktails and zero-proof drinks, perfect for any occasion.',
    },
    'non-alcoholic-drinks': {
      title: 'Non-Alcoholic Drinks',
      description:
        'Discover a wide range of delightful non-alcoholic drinks. Our articles and guides provide recipes and ideas for refreshing beverages for all tastes.',
    },
    'party-drinks': {
      title: 'Party Drinks',
      description:
        'Plan your next celebration with ease. Explore articles and guides on party drinks, offering simple, batch-friendly recipes to impress your guests.',
    },
    'seasonal-drinks': {
      title: 'Seasonal Drinks',
      description:
        'Sip on the flavors of the year. Our articles and guides on seasonal drinks feature fresh and creative cocktail recipes perfect for spring, summer, autumn, and winter.',
    },
    'spirits-guide': {
      title: 'Spirits Guide',
      description:
        'Deepen your knowledge of spirits. Our articles and guides cover whiskey, gin, rum, vodka, tequila, and more, for informed cocktail creation.',
    },
    'summer-cocktails': {
      title: 'Summer Cocktails',
      description:
        'Beat the heat with vibrant sips. Find articles and guides on delicious summer cocktails, perfect for sunny afternoons and breezy evenings.',
    },
    'tropical-drinks': {
      title: 'Tropical Drinks',
      description:
        'Transport yourself to a sunny getaway. Our articles and guides on tropical drinks bring exotic flavors and vibrant recipes straight to your glass.',
    },
    'winter-warmers': {
      title: 'Winter Warmers',
      description:
        'Curl up with comforting sips. Explore articles and guides on winter warmers, featuring spiced, rich, and cozy cocktail recipes for the colder months.',
    },
    // Fallback generico per slug non trovati
    'default-category': {
      title: 'Articles & Guides',
      description:
        'Explore articles and guides on this specific topic. Dive into detailed insights and inspiring content.',
    },
  };

  constructor(
    private articleService: ArticleService,
    private route: ActivatedRoute,
    private metaService: Meta,
    private titleService: Title
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe((params: ParamMap) => {
      this.categorySlug = params.get('slug');

      let currentInfo;
      let pageTitleSuffix = ' | Our Cocktail Guides'; // Suffisso per il titolo del browser

      if (this.categorySlug) {
        this.categoryName = this.capitalizeSlug(this.categorySlug);
        currentInfo =
          this.pageDescriptions[this.categorySlug] ||
          this.pageDescriptions['default-category'];

        // Se è una categoria, rendiamo il titolo più esplicito come sottocategoria
        this.mainTitle = currentInfo.title; // Titolo pulito della categoria
        this.subTitle = `Category: ${this.categoryName} - ${currentInfo.description}`; // Descrizione che indica la categoria
        pageTitleSuffix = ` | ${this.categoryName} Guides`; // Suffisso per il titolo del browser in categoria

        // Fallback per categoria non trovata nella mappa, ma con slug esistente
        if (
          !this.pageDescriptions[this.categorySlug] &&
          this.categorySlug !== 'default-category'
        ) {
          this.subTitle = `Category: ${this.categoryName} - Explore articles and guides on this topic.`;
        }

        this.loadArticlesByCategory(this.categorySlug);
      } else {
        // --- CORREZIONE QUI: Chiama loadAllArticles() quando non c'è slug ---
        currentInfo = this.pageDescriptions['all-articles'];
        this.mainTitle = currentInfo.title;
        this.subTitle = currentInfo.description;
        this.loadAllArticles(); // <--- AGGIUNTA QUESTA RIGA
      }

      // Imposta i meta tag della pagina per SEO
      this.setPageMeta(this.mainTitle, this.subTitle, pageTitleSuffix);
    });
  }

  loadAllArticles() {
    this.loading = true;
    this.articleService.getArticles(1, 10).subscribe({
      next: (res) => {
        this.articles = res.data as Article[];
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Error loading articles.';
        this.loading = false;
        this.setPageMeta(
          'Error Loading Articles',
          'An error occurred while loading articles. Please try again later.',
          ' | Cocktail Guides'
        );
      },
    });
  }

  loadArticlesByCategory(slug: string) {
    this.loading = true;
    this.articleService.getArticlesByCategorySlug(slug).subscribe({
      next: (res) => {
        this.articles = res.data as Article[];
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Error loading articles for this category.';
        this.loading = false;
        const categoryDisplayName = this.capitalizeSlug(slug);
        this.setPageMeta(
          `Error Loading ${categoryDisplayName} Articles`,
          `An error occurred while loading articles for ${categoryDisplayName}. Please try again later.`,
          ` | ${categoryDisplayName} Guides`
        );
      },
    });
  }

  getImageUrl(image?: { url?: string; formats?: any }): string {
    if (!image) return 'assets/images/placeholder_article.png';

    const url = image.formats?.thumbnail?.url ?? image.url ?? '';

    if (!url) return 'assets/images/placeholder_article.png';

    return url.startsWith('http') ? url : `http://192.168.1.241:1337${url}`;
  }

  private capitalizeSlug(slug: string): string {
    return slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Funzione per impostare i meta tag della pagina, con suffisso dinamico
  private setPageMeta(title: string, description: string, suffix: string) {
    this.titleService.setTitle(`${title}${suffix}`);
    this.metaService.updateTag({ name: 'description', content: description });
  }
}
