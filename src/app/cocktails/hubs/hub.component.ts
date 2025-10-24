import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  HubDataService,
  HubItem,
  HubKind,
} from '../../services/hub-data.service';

const HUB_TITLES: Record<HubKind, string> = {
  method: 'Browse Cocktails by Method - Fizzando',
  glass: 'Browse Cocktails by Glass - Fizzando',
  category: 'Browse Cocktails by Category - Fizzando',
  alcoholic: 'Browse Cocktails by Alcoholic Type - Fizzando',
};

const HUB_DESCRIPTIONS: Record<HubKind, string> = {
  method: 'Explore cocktails by method and jump into curated lists.',
  glass: 'Explore cocktails by glass and jump into curated lists.',
  category: 'Explore cocktails by category and jump into curated lists.',
  alcoholic: 'Explore cocktails by alcoholic type and jump into curated lists.',
};

const HUB_HEADINGS: Record<HubKind, string> = {
  method: 'Cocktail Methods',
  glass: 'Cocktail Glasses',
  category: 'Cocktail Categories',
  alcoholic: 'Alcoholic Profiles',
};

@Component({
  selector: 'app-hub',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './hub.component.html',
  styleUrl: './hub.component.scss',
})
export class HubComponent implements OnInit {
  hubKind!: HubKind;
  heading = '';
  items: HubItem[] = [];
  loading = true;
  error: string | null = null;

  private readonly route = inject(ActivatedRoute);
  private readonly hubData = inject(HubDataService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  ngOnInit(): void {
    const hub = this.route.snapshot.data['hub'] as HubKind | undefined;
    if (!hub) {
      this.error = 'Unable to determine the requested hub.';
      this.loading = false;
      return;
    }

    this.hubKind = hub;
    this.heading = HUB_HEADINGS[hub];
    this.setMetaForHub(hub);
    this.loadItems();
  }

  linkFor(item: HubItem): string[] {
    switch (this.hubKind) {
      case 'method':
        return ['/cocktails/method', item.slug];
      case 'glass':
        return ['/cocktails/glass', item.slug];
      case 'category':
        return ['/cocktails/category', item.slug];
      case 'alcoholic':
        return ['/cocktails/alcoholic', item.slug];
      default:
        return ['/'];
    }
  }

  private loadItems(): void {
    this.loading = true;
    this.error = null;

    this.hubData
      .getHubItems(this.hubKind)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (items) => {
          this.items = items ?? [];
          this.loading = false;
        },
        error: () => {
          this.items = [];
          this.loading = false;
          this.error =
            'We could not load this hub right now. Please try again later.';
        },
      });
  }

  private setMetaForHub(kind: HubKind): void {
    const title = HUB_TITLES[kind];
    const description = HUB_DESCRIPTIONS[kind];

    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
  }
}
