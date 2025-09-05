import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';

@Component({
  selector: 'app-terms-conditions',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './terms-conditions.component.html',
  styleUrls: ['./terms-conditions.component.scss'],
})
export class TermsConditionsComponent implements OnInit {
  constructor(private meta: Meta, private title: Title) {}

  ngOnInit(): void {
    this.title.setTitle('Terms & Conditions | Fizzando');
    this.meta.updateTag({
      name: 'description',
      content:
        'Terms & Conditions for using Fizzando. Learn about permitted use, intellectual property, liability limitations, and advertising/affiliate disclosures.',
    });
    this.meta.updateTag({
      property: 'og:title',
      content: 'Terms & Conditions | Fizzando',
    });
    this.meta.updateTag({
      property: 'og:description',
      content:
        'Read Fizzando’s Terms & Conditions: permitted use, IP, liability, ads/affiliates and governing law.',
    });
    this.meta.updateTag({ name: 'robots', content: 'index, follow' });
  }
}
