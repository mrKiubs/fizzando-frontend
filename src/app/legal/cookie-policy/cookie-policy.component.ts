import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';

@Component({
  selector: 'app-cookie-policy',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './cookie-policy.component.html',
  styleUrls: ['./cookie-policy.component.scss'],
})
export class CookiePolicyComponent implements OnInit {
  constructor(private meta: Meta, private title: Title) {}

  ngOnInit(): void {
    this.title.setTitle('Cookie Policy | Fizzando');
    this.meta.updateTag({
      name: 'description',
      content:
        'Cookie Policy of Fizzando: types of cookies used (necessary, analytics, advertising), purposes, durations, and how to manage your preferences.',
    });
    this.meta.updateTag({
      property: 'og:title',
      content: 'Cookie Policy | Fizzando',
    });
    this.meta.updateTag({
      property: 'og:description',
      content:
        'Learn how Fizzando uses cookies (GA4, AdSense) and how to manage consent in compliance with EU laws.',
    });
    this.meta.updateTag({ name: 'robots', content: 'index, follow' });
  }
}
