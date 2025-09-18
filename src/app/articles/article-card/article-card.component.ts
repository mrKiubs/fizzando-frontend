import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Article } from '../../services/article.service';
import { env } from '../../config/env';

type CardArticle = Pick<
  Article,
  'slug' | 'title' | 'id' | 'documentId' | 'introduction'
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

  ngOnInit(): void {}

  private abs(url: string): string {
    return url.startsWith('http') ? url : `${env.apiUrl}${url}`;
  }

  getArticleDetailLink(): string[] {
    return ['/articles', this.article.slug];
  }
}
