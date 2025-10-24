export type HubKind = 'method' | 'glass' | 'category' | 'alcoholic';

export interface HubItem {
  slug: string;
  label: string;
  count?: number;
}

export const HUB_CATALOG: Record<HubKind, HubItem[]> = {
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

/** Title-case per slug “non-alcoholic” → “Non Alcoholic” */
export function prettifySlug(value: string | undefined): string {
  if (!value) return '';
  return value
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/** Trova la label dal catalogo, altrimenti prettify */
export function labelBySlug(kind: HubKind, slug: string): string {
  return (
    HUB_CATALOG[kind]?.find((i) => i.slug === slug)?.label ?? prettifySlug(slug)
  );
}
