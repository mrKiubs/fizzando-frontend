// src/app/components/article-card/article-card.component.ts

import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Article } from '../../services/article.service';

@Component({
  selector: 'app-article-card',
  standalone: true,
  imports: [CommonModule, MatIconModule, RouterLink],
  templateUrl: './article-card.component.html',
  styleUrls: ['./article-card.component.scss'],
})
export class ArticleCardComponent implements OnInit {
  /** Ora accettiamo solo slug, title, image e facoltativamente id per il trackBy */
  @Input() article!: Pick<Article, 'slug' | 'title' | 'image' | 'id'>;

  articleImageUrl = 'assets/images/placeholder_article.png';

  ngOnInit(): void {
    if (this.article.image?.url) {
      const url = this.article.image.url.startsWith('http')
        ? this.article.image.url
        : `http://192.168.1.241:1337${this.article.image.url}`;
      this.articleImageUrl = url;
    }
  }

  getArticleDetailLink(): string[] {
    return ['/articles', this.article.slug];
  }
}
