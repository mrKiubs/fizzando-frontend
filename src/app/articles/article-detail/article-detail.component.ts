import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ArticleService, Article, Image } from '../../services/article.service';
import { MatIconModule } from '@angular/material/icon';
import { IngredientCardComponent } from '../../ingredients/ingredient-card/ingredient-card.component';
import { CocktailCardComponent } from '../../cocktails/cocktail-card/cocktail-card.component';
import { SidebarComponent } from '../../core/sidebar.component';

@Component({
  selector: 'app-article-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatIconModule,
    IngredientCardComponent,
    CocktailCardComponent,
    SidebarComponent,
  ],
  templateUrl: './article-detail.component.html',
  styleUrls: ['./article-detail.component.scss'],
})
export class ArticleDetailComponent implements OnInit, OnDestroy {
  article: Article | null = null;
  loading = true;
  error: string | null = null;

  private routeSub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private articleService: ArticleService
  ) {}

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (slug) {
        this.fetchArticle(slug);
      } else {
        this.error = 'Articolo non trovato.';
        this.loading = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  private fetchArticle(slug: string): void {
    this.loading = true;
    this.articleService.getArticleBySlug(slug).subscribe({
      next: (data) => {
        // 'data' qui è di tipo Article | null
        this.article = data;
        this.loading = false;
        if (!data) {
          this.error = 'Articolo non trovato.';
        }
      },
      error: (err) => {
        console.error('Errore nel caricamento del dettaglio articolo:', err);
        this.error = "Impossibile caricare i dettagli dell'articolo.";
        this.loading = false;
      },
    });
  }

  private fixSingleImage(image?: Image): void {
    if (!image) return;
    if (!image.url) return;
    if (!image.url.startsWith('http')) {
      image.url = `http://192.168.1.241:1337${image.url}`;
    }
    if (image.formats) {
      for (const key in image.formats) {
        const format = (image.formats as any)[key];
        if (format?.url && !format.url.startsWith('http')) {
          format.url = `http://192.168.1.241:1337${format.url}`;
        }
      }
    }
  }

  private fixArticleImages(article: Article): void {
    this.fixSingleImage(article.image);

    article.sections?.forEach((section) => {
      if (section.image) {
        this.fixSingleImage(section.image);
      }
    });

    article.related_cocktails?.forEach((cocktail) => {
      if (cocktail.image) {
        this.fixSingleImage(cocktail.image);
      }
    });

    article.related_ingredients?.forEach((ingredient) => {
      if (ingredient.image) {
        this.fixSingleImage(ingredient.image);
      }
    });
  }
}
