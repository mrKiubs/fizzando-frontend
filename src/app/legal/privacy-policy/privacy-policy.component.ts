import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './privacy-policy.component.html',
  styleUrls: ['./privacy-policy.component.scss'],
})
export class PrivacyPolicyComponent implements OnInit {
  constructor(private meta: Meta, private title: Title) {}

  ngOnInit(): void {
    this.title.setTitle('Privacy Policy | Fizzando');
    this.meta.updateTag({
      name: 'description',
      content:
        'Read the Privacy Policy of Fizzando: how we collect, use, and protect your data when browsing cocktail recipes and guides.',
    });
    this.meta.updateTag({
      property: 'og:title',
      content: 'Privacy Policy | Fizzando',
    });
    this.meta.updateTag({
      property: 'og:description',
      content:
        'Learn how Fizzando handles your data responsibly with full compliance to EU GDPR.',
    });
    this.meta.updateTag({
      name: 'robots',
      content: 'index, follow',
    });
  }
}
