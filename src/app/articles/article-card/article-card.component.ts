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

  articleImageUrl = 'assets/images/placeholder_article.png';
  // opzionale: per srcset responsive
  srcset = '';
  sizes = '(max-width: 600px) 100vw, (max-width: 1024px) 50vw, 33vw';

  ngOnInit(): void {
    // 1) se il service ha già calcolato l’URL giusto per la card, usa quello
    if (this.article?.imageUrl) {
      this.articleImageUrl = this.article.imageUrl;
    } else {
      // 2) fallback locale se arriva un Article senza imageUrl
      const img = this.article?.image;
      if (img) {
        const small =
          img.formats?.small?.url ??
          img.formats?.thumbnail?.url ??
          img.formats?.medium?.url ??
          img.url;

        if (small) {
          this.articleImageUrl = small.startsWith('http')
            ? small
            : `${env.apiUrl}${small}`;
        }
      }
    }

    // 3) (opzionale) costruisco la srcset per dare al browser più scelta
    const f = this.article?.image?.formats;
    const entries: string[] = [];
    if (f?.thumbnail?.url) entries.push(this.abs(f.thumbnail.url) + ' 245w');
    if (f?.small?.url) entries.push(this.abs(f.small.url) + ' 500w');
    if (f?.medium?.url) entries.push(this.abs(f.medium.url) + ' 750w');
    // volendo puoi aggiungere anche large/original se presenti
    this.srcset = entries.join(', ');
  }

  private abs(url: string): string {
    return url.startsWith('http') ? url : `${env.apiUrl}${url}`;
  }

  getArticleDetailLink(): string[] {
    return ['/articles', this.article.slug];
  }
}
