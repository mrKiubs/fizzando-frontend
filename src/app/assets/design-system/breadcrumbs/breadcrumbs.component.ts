import { Component, OnInit, Output, EventEmitter } from '@angular/core';
import {
  ActivatedRoute,
  Router,
  NavigationEnd,
  RouterModule,
  Data,
  PRIMARY_OUTLET,
} from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  filter,
  distinctUntilChanged,
  map,
  startWith,
  shareReplay,
} from 'rxjs/operators';
import { Observable } from 'rxjs';

interface Breadcrumb {
  displayIcon?: string;
  displayText: string;
  url: string;
}

const ROOT_ICONS: Record<string, string> = {
  '': '🏠',
  cocktails: '🍸',
  ingredients: '🍋',
  glossary: '📚',
  quiz: '❓',
  articles: '📄',
  'find-cocktail': '🔎',
};

const FILTER_ICONS: Record<string, string> = {
  category: '📂',
  type: '📂',
  alcoholic: '🍸',
  nonalcoholic: '🧃',
  page: '📄', // Aggiunto un'icona generica per la pagina
};

@Component({
  selector: 'app-breadcrumbs',
  standalone: true,
  imports: [RouterModule, CommonModule],
  templateUrl: './breadcrumbs.component.html',
  styleUrls: ['./breadcrumbs.component.scss'],
})
export class BreadcrumbsComponent implements OnInit {
  breadcrumbs$!: Observable<Breadcrumb[]>;
  @Output() linkClicked = new EventEmitter<void>();

  constructor(private router: Router, private activatedRoute: ActivatedRoute) {}

  ngOnInit(): void {
    this.breadcrumbs$ = this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(new NavigationEnd(0, this.router.url, this.router.url)),
      map(() => this.generateBreadcrumbs(this.activatedRoute.root)),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      shareReplay(1)
    );
  }

  private normalizeText(text: string | undefined): string {
    return (text || '').trim().toLowerCase();
  }

  private getLevelFromUrl(url: string): number {
    // Conta i segmenti senza query params
    return url.split('?')[0].split('/').filter(Boolean).length;
  }

  // Questo metodo non dovrebbe più essere strettamente necessario con la nuova logica,
  // ma lo manteniamo per sicurezza se la logica di `generateBreadcrumbs` dovesse cambiare.
  private removeDuplicateLinkBreadcrumbs(
    breadcrumbs: Breadcrumb[]
  ): Breadcrumb[] {
    const result: Breadcrumb[] = [];

    for (let i = 0; i < breadcrumbs.length; i++) {
      const current = breadcrumbs[i];
      const next = breadcrumbs[i + 1];

      if (next) {
        const currentLevel = this.getLevelFromUrl(current.url);
        const nextLevel = this.getLevelFromUrl(next.url);

        // Se current ha link (url non vuoto), next è allo stesso livello,
        // e next non ha link o ha lo stesso url, skip current
        if (
          current.url &&
          nextLevel === currentLevel &&
          (!next.url || next.url === current.url)
        ) {
          // Skip breadcrumb con link duplicato al livello
          continue;
        }
      }

      result.push(current);
    }

    return result;
  }

  private generateBreadcrumbs(route: ActivatedRoute): Breadcrumb[] {
    const breadcrumbs: Breadcrumb[] = [];
    let currentRoute: ActivatedRoute | null = route;
    let accumulatedUrl = '';

    breadcrumbs.push({
      displayIcon: ROOT_ICONS[''] || '',
      displayText: 'Home',
      url: '/',
    });

    while (currentRoute) {
      const primaryChild: ActivatedRoute | undefined =
        currentRoute.children.find((child) => child.outlet === PRIMARY_OUTLET);
      if (!primaryChild) break;

      currentRoute = primaryChild;
      const snapshot = currentRoute.snapshot;
      const routeURLSegments = snapshot.url.map((segment) => segment.path);
      const path = routeURLSegments.join('/');

      const hasQueryParams = Object.keys(snapshot.queryParams).length > 0;

      // Se è un segmento vuoto, non creare un breadcrumb di percorso, ma continua ad accumulare l'URL.
      // Se ci sono query params su un path vuoto (es. /?param=value), li gestirà il blocco successivo.
      if (!path) {
        if (!hasQueryParams) {
          continue;
        }
      } else {
        accumulatedUrl += `/${path}`;
      }

      const data: Data = snapshot.data; // Corretto: `snapshot.data` non `snapshot.snapshot.data`
      const params = snapshot.params;
      let displayIcon: string | undefined;
      let displayText: string | undefined;
      const rootSegment = routeURLSegments[0] || '';
      const predefinedIcon = ROOT_ICONS[rootSegment];

      // Determina il testo e l'icona del breadcrumb
      if (data['breadcrumb']) {
        const rawLabel = data['breadcrumb'] as string;
        if (rawLabel.replace(/^\W*/, '').toLowerCase() === 'home') {
          displayText = undefined;
        } else if (predefinedIcon && rawLabel.startsWith(predefinedIcon)) {
          displayIcon = predefinedIcon;
          displayText = rawLabel.substring(predefinedIcon.length).trim();
        } else {
          displayIcon = predefinedIcon;
          displayText = rawLabel;
        }
      } else if (path) {
        displayIcon = predefinedIcon;
        displayText = this.prettyLabel(rootSegment || path);
      }

      // Override per slug, id, externalId: no icona, testo formattato
      if (params['slug']) {
        displayText = this.slugToTitle(params['slug']);
        displayIcon = undefined;
      } else if (params['externalId']) {
        displayText = this.prettifySlug(params['externalId']);
        displayIcon = undefined;
      } else if (params['id']) {
        displayText = `${params['id']}`;
        displayIcon = undefined;
      }

      // Aggiungi il breadcrumb del percorso (senza query params)
      if (displayText) {
        // Evita di aggiungere breadcrumb di percorso se c'è già un breadcrumb per questo URL
        // Questo gestisce il caso di path: '' con breadcrumb data
        if (!breadcrumbs.some((b) => b.url === accumulatedUrl)) {
          breadcrumbs.push({
            displayIcon,
            displayText,
            url: accumulatedUrl,
          });
        }
      }

      // Aggiungi breadcrumb per i filtri, se ci sono
      if (hasQueryParams) {
        const sortedQueryKeys = Object.keys(snapshot.queryParams).sort();
        let queryStringSoFar = '';
        for (const key of sortedQueryKeys) {
          const val = snapshot.queryParams[key];
          if (!val) continue;

          queryStringSoFar += `${queryStringSoFar ? '&' : ''}${key}=${val}`;
          const filterUrl = `${accumulatedUrl}?${queryStringSoFar}`;
          const filterIcon = FILTER_ICONS[key.toLowerCase()] || '📁';

          // Usa prettyLabel per formattare il testo del filtro, inclusi i numeri di pagina
          const filterText = this.prettyLabel(val, key);

          const isFilterBreadcrumbPresent = breadcrumbs.some(
            (b) => b.url === filterUrl && b.displayText === filterText
          );
          if (!isFilterBreadcrumbPresent) {
            breadcrumbs.push({
              displayIcon: filterIcon,
              displayText: filterText,
              url: filterUrl,
            });
          }
        }
      }
    }

    // `removeDuplicateLinkBreadcrumbs` non è più strettamente necessario
    // con la logica attuale, ma puoi mantenerlo se preferisci una passata finale.
    return this.removeDuplicateLinkBreadcrumbs(breadcrumbs);
  }

  private slugToTitle(slug: string): string {
    return slug
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private prettyLabel(val: string, key?: string): string {
    // Gestione specifica per il parametro 'page'
    if (key && key.toLowerCase() === 'page') {
      return `page ${val} of 32`;
    }
    // Gestione specifica per il parametro 'alcoholic'
    if (key && key.toLowerCase() === 'alcoholic') {
      if (val.toLowerCase() === 'true') return 'Alcolico';
      if (val.toLowerCase() === 'false') return 'Non Alcoholic';
    }
    // Gestione per valori booleani generici
    if (val.toLowerCase() === 'true') return 'Sì';
    if (val.toLowerCase() === 'false') return 'No';
    // Formattazione generica per slug (es. "citrus-juices" -> "Citrus Juices")
    return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  onLinkClicked(): void {
    this.linkClicked.emit();
  }

  private prettifySlug(val: string | null | undefined): string {
    if (!val) return '';
    return val
      .replace(/[-_]+/g, ' ') // trattini/underscore → spazio
      .replace(/\s+/g, ' ') // spazi multipli → singolo
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase()); // Title Case
  }
}
