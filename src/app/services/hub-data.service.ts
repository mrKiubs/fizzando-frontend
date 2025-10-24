import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { env } from '../config/env';

export type HubKind = 'method' | 'glass' | 'category' | 'alcoholic';

export interface HubItem {
  slug: string;
  label: string;
  count?: number;
}

@Injectable({ providedIn: 'root' })
export class HubDataService {
  private readonly apiBaseUrl =
    (env as { apiBaseUrl?: string }).apiBaseUrl ??
    (env as { apiBase?: string }).apiBase ??
    '';

  private readonly endpoints: Record<HubKind, string> = {
    method: `${this.apiBaseUrl}/hubs/methods`,
    glass: `${this.apiBaseUrl}/hubs/glasses`,
    category: `${this.apiBaseUrl}/hubs/categories`,
    alcoholic: `${this.apiBaseUrl}/hubs/alcoholic`,
  };

  private readonly fallbacks: Record<HubKind, HubItem[]> = {
    method: [
      { slug: 'shaken', label: 'Shaken', count: 128 },
      { slug: 'stirred', label: 'Stirred', count: 94 },
      { slug: 'built', label: 'Built', count: 76 },
    ],
    glass: [
      { slug: 'highball', label: 'Highball' },
      { slug: 'coupe', label: 'Coupe' },
      { slug: 'rocks', label: 'Rocks' },
    ],
    category: [
      { slug: 'classic', label: 'Classic' },
      { slug: 'contemporary', label: 'Contemporary' },
      { slug: 'tiki', label: 'Tiki' },
      { slug: 'aperitif', label: 'Aperitif' },
    ],
    alcoholic: [
      { slug: 'alcoholic', label: 'Alcoholic' },
      { slug: 'non-alcoholic', label: 'Non Alcoholic' },
      { slug: 'optional-alcohol', label: 'Optional Alcohol' },
    ],
  };

  constructor(private readonly http: HttpClient) {}

  getHubItems(kind: HubKind): Observable<HubItem[]> {
    const endpoint = this.endpoints[kind];
    const fallback = this.fallbacks[kind];

    return this.http.get<HubItem[] | { data: HubItem[] }>(endpoint).pipe(
      map((response) => this.unwrapResponse(response)),
      map((items) => (items.length ? items : fallback)),
      catchError(() => of(fallback.slice()))
    );
  }

  getLabelBySlug(kind: HubKind, slug: string): Observable<string> {
    const normalizedSlug = slug ?? '';
    return this.getHubItems(kind).pipe(
      map((items) => {
        const match = items.find((item) => item.slug === normalizedSlug);
        return match ? match.label : this.toTitleCase(normalizedSlug);
      }),
      catchError(() => of(this.toTitleCase(normalizedSlug)))
    );
  }

  private unwrapResponse(
    response: HubItem[] | { data?: HubItem[] | null }
  ): HubItem[] {
    if (Array.isArray(response)) {
      return response;
    }

    if (response && Array.isArray(response.data)) {
      return response.data;
    }

    return [];
  }

  private toTitleCase(value: string): string {
    if (!value) {
      return '';
    }

    return value
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
