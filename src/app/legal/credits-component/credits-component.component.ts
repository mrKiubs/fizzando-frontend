import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';

@Component({
  selector: 'app-credits',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: 'credits-component.component.html',
  styleUrls: ['./credits-component.component.scss'],
})
export class CreditsComponent implements OnInit {
  constructor(private meta: Meta, private title: Title) {}

  ngOnInit(): void {
    this.title.setTitle('Credits | Fizzando');
    this.meta.updateTag({
      name: 'description',
      content:
        'Data and image attributions for Fizzando, including TheCocktailDB Premium API and open-source libraries.',
    });
    this.meta.updateTag({
      property: 'og:title',
      content: 'Credits | Fizzando',
    });
    this.meta.updateTag({
      property: 'og:description',
      content:
        'Acknowledgments for data sources, images, tools, and libraries used by Fizzando.',
    });
    this.meta.updateTag({ name: 'robots', content: 'index, follow' });
  }
}
