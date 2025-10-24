import { CommonModule } from '@angular/common';
import {
  ActivatedRoute,
  ActivatedRouteSnapshot,
  NavigationEnd,
  PRIMARY_OUTLET,
  Router,
  RouterModule,
  UrlSegment,
} from '@angular/router';
import { Component, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { filter, map, startWith } from 'rxjs/operators';
import { HubKind, labelBySlug } from '../../../cocktails/hubs/hub.catalog';

interface BreadcrumbDefinition {
  url: string[];
  label: string;
}

interface BreadcrumbViewModel {
  url: string[];
  label: string;
  isLast: boolean;
}

interface HubSlugContext {
  kind: HubKind;
  slug: string;
}

@Component({
  selector: 'app-breadcrumbs',
  standalone: true,
  imports: [RouterModule, CommonModule],
  templateUrl: './breadcrumbs.component.html',
  styleUrls: ['./breadcrumbs.component.scss'],
})
export class BreadcrumbsComponent implements OnInit {
  @Output() linkClicked = new EventEmitter<void>();

  breadcrumbs$!: Observable<BreadcrumbViewModel[]>;

  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);

  private readonly hubCrumbs: Record<
    HubKind,
    { link: string[]; label: string; urlKey: string }
  > = {
    method: {
      link: ['/', 'cocktails', 'methods'],
      label: 'Methods',
      urlKey: '/cocktails/methods',
    },
    glass: {
      link: ['/', 'cocktails', 'glasses'],
      label: 'Glasses',
      urlKey: '/cocktails/glasses',
    },
    category: {
      link: ['/', 'cocktails', 'categories'],
      label: 'Categories',
      urlKey: '/cocktails/categories',
    },
    alcoholic: {
      link: ['/', 'cocktails', 'alcoholic'],
      label: 'Alcoholic',
      urlKey: '/cocktails/alcoholic',
    },
  };

  ngOnInit(): void {
    this.breadcrumbs$ = this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(new NavigationEnd(0, this.router.url, this.router.url)),
      map(() => this.buildDefinitions(this.activatedRoute.root)),
      map((definitions) => this.toViewModels(definitions))
    );
  }

  private toViewModels(defs: BreadcrumbDefinition[]): BreadcrumbViewModel[] {
    return defs.map((d, i) => ({
      url: d.url,
      label: d.label,
      isLast: i === defs.length - 1,
    }));
  }

  onLinkClicked(): void {
    this.linkClicked.emit();
  }

  private buildDefinitions(route: ActivatedRoute): BreadcrumbDefinition[] {
    const breadcrumbs: BreadcrumbDefinition[] = [{ url: ['/'], label: 'Home' }];
    let current: ActivatedRoute | null = route;
    const accumulated: string[] = [];

    while (current) {
      const child: ActivatedRoute | undefined = current.children.find(
        (c: ActivatedRoute) => c.outlet === PRIMARY_OUTLET
      );
      if (!child) {
        break;
      }

      current = child;
      const snapshot = child.snapshot;
      const routeSegments = snapshot.url
        .map((segment: UrlSegment) => segment.path)
        .filter(Boolean);
      if (routeSegments.length) {
        accumulated.push(...routeSegments);
      }

      const hubSlug = this.extractHubSlug(snapshot);
      if (hubSlug) {
        const hubInfo = this.hubCrumbs[hubSlug.kind];
        if (hubInfo && !this.hasBreadcrumbForUrl(breadcrumbs, hubInfo.urlKey)) {
          breadcrumbs.push({ url: hubInfo.link, label: hubInfo.label });
        }

        const slugUrl = this.buildRouterLink(accumulated);
        const slugLabel = labelBySlug(hubSlug.kind, hubSlug.slug);
        breadcrumbs.push({ url: slugUrl, label: slugLabel });
        continue;
      }

      const label = this.resolveLabel(snapshot, routeSegments);
      if (!label) {
        continue;
      }

      const urlKey = this.buildUrlKey(accumulated);
      if (
        (accumulated.length === 0 &&
          typeof label === 'string' &&
          this.isHomeLabel(label)) ||
        this.hasBreadcrumbForUrl(breadcrumbs, urlKey)
      ) {
        continue;
      }

      breadcrumbs.push({ url: this.buildRouterLink(accumulated), label });
    }

    return breadcrumbs;
  }

  private resolveDefinitions(
    defs: BreadcrumbDefinition[]
  ): Observable<BreadcrumbViewModel[]> {
    if (!defs.length) return of([]);
    const vms = defs.map((d, i) => ({
      url: d.url,
      label: d.label,
      isLast: i === defs.length - 1,
    }));
    return of(vms);
  }

  private extractHubSlug(
    snapshot: ActivatedRouteSnapshot
  ): HubSlugContext | null {
    const params = snapshot.params;
    const data = snapshot.data as { hub?: HubKind };

    const mappings: Array<{ param: string; kind: HubKind }> = [
      { param: 'methodSlug', kind: 'method' },
      { param: 'glassSlug', kind: 'glass' },
      { param: 'categorySlug', kind: 'category' },
      { param: 'alcoholicSlug', kind: 'alcoholic' },
    ];

    for (const mapping of mappings) {
      const slug = params[mapping.param];
      if (slug) {
        const kind = data.hub ?? mapping.kind;
        return { kind, slug };
      }
    }

    return null;
  }

  private resolveLabel(
    snapshot: ActivatedRouteSnapshot,
    routeSegments: string[]
  ): string | null {
    const data = snapshot.data as { breadcrumb?: string };
    const params = snapshot.params as Record<string, string | undefined>;

    if (data.breadcrumb) {
      return data.breadcrumb;
    }

    if (params['slug']) {
      return this.prettifySlug(params['slug']);
    }

    if (params['externalId']) {
      return this.prettifySlug(params['externalId']);
    }

    if (params['id']) {
      return `${params['id']}`;
    }

    if (routeSegments.length) {
      return this.prettifySlug(routeSegments[routeSegments.length - 1]);
    }

    return null;
  }

  private buildRouterLink(segments: string[]): string[] {
    return segments.length ? ['/', ...segments] : ['/'];
  }

  private buildUrlKey(segments: string[]): string {
    return segments.length ? `/${segments.join('/')}` : '/';
  }

  private hasBreadcrumbForUrl(
    breadcrumbs: BreadcrumbDefinition[],
    urlKey: string
  ): boolean {
    return breadcrumbs.some(
      (breadcrumb) => this.buildUrlKeyForLink(breadcrumb.url) === urlKey
    );
  }

  private buildUrlKeyForLink(link: string[]): string {
    if (!link.length) {
      return '';
    }

    if (link.length === 1 && link[0] === '/') {
      return '/';
    }

    const segments = link[0] === '/' ? link.slice(1) : link;
    return segments.length ? `/${segments.join('/')}` : '/';
  }

  private isHomeLabel(label: string): boolean {
    return label.trim().toLowerCase() === 'home';
  }

  private prettifySlug(value: string | undefined): string {
    if (!value) {
      return '';
    }

    return value
      .split(/[-_\s]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
