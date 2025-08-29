import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Article } from '../../services/article.service';
import { env } from '../../config/env';

type CardArticle = Pick<
  Article,
  'slug' | 'title' | 'image' | 'id' | 'documentId' | 'introduction' | 'imageUrl'
>;

@Component({
  selector: 'app-article-card',
  standalone: true,
  imports: [CommonModule, MatIconModule, RouterLink],
  templateUrl: './article-card.component.html',
  styleUrls: ['./article-card.component.scss'],
})
export class ArticleCardComponent implements OnInit {
  @Input() article!: CardArticle;
  /** Se true, questa card è candidata a LCP (prima in lista) */
  @Input() priority = false;

  articleImageUrl = 'assets/images/placeholder_article.png';
  srcset = '';
  // Grid: mobile 1 col (100vw), tablet 2 col (~50vw), desktop col ~239px
  sizes = '(max-width: 600px) 100vw, (max-width: 1024px) 50vw, 239px';

  ngOnInit(): void {
    // 1) Se il service ha già calcolato l’URL, usa quello
    if (this.article?.imageUrl) {
      this.articleImageUrl = this.article.imageUrl;
    } else {
      // 2) Per la card usa il formato più piccolo utile: thumbnail → small → medium → original
      const f = (this.article?.image as any)?.formats;
      const src =
        f?.thumbnail?.url ??
        f?.small?.url ??
        f?.medium?.url ??
        (this.article as any)?.image?.url;
      if (src) this.articleImageUrl = this.abs(src);
    }

    // 3) Srcset con larghezze REALI (w descriptor)
    const f = (this.article?.image as any)?.formats;
    const entries: string[] = [];
    if (f?.thumbnail?.url && f?.thumbnail?.width)
      entries.push(`${this.abs(f.thumbnail.url)} ${f.thumbnail.width}w`);
    if (f?.small?.url && f?.small?.width)
      entries.push(`${this.abs(f.small.url)} ${f.small.width}w`);
    if (f?.medium?.url && f?.medium?.width)
      entries.push(`${this.abs(f.medium.url)} ${f.medium.width}w`);
    this.srcset = entries.join(', ');
  }

  private abs(url: string): string {
    return url.startsWith('http') ? url : `${env.apiUrl}${url}`;
  }

  getArticleDetailLink(): string[] {
    return ['/articles', this.article.slug];
  }
}
