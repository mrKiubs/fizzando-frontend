import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CocktailService } from '../../../services/strapi.service';
import { CocktailChipComponent } from './cocktail-chip.component';

type Kind = 'method' | 'glass' | 'category' | 'alcoholic';

@Component({
  selector: 'app-facet-chips',
  standalone: true,
  imports: [CommonModule, RouterLink, CocktailChipComponent],
  template: `
    <div class="hub-switcher__row">
      <span class="hub-switcher__label">{{ label }}</span>
      <div class="cocktail-chips-container">
        <app-cocktail-chip
          *ngFor="let lbl of items; trackBy: trackByLabel"
          [label]="lbl"
          [count]="count(slug(lbl))"
          [active]="activeKind === kind && activeSlug === slug(lbl)"
          [variant]="kind"
          [slug]="slug(lbl)"
          [routerLink]="['/cocktails', kind, slug(lbl)]"
        >
        </app-cocktail-chip>
      </div>
    </div>
  `,
  styles: [
    `
      .cocktail-chips-container {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .cocktail-chip {
        display: inline-flex;
        align-items: center;
        padding: 4px 4px 4px 8px;
        border-radius: 50px;
        font-size: 0.8rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.5411764706);
        border: 1px solid rgba(255, 255, 255, 0.1);
        -webkit-backdrop-filter: blur(5px);
        backdrop-filter: blur(5px);
        transition: all 0.2s ease-in-out;
        align-items: center;
        gap: 8px;

        &:hover {
          background-color: #00000019;
          color: white;
          border: 1px solid rgba(255, 255, 255, 0.851);
        }

        &.active {
          background-color: rgba(0, 123, 255, 0.1);
          border: 1px solid #fff;
          color: #fff;
          cursor: default;
        }

        &.category-chip {
          background-color: rgba(0, 123, 255, 0.1);
          border: 1px solid rgba(0, 123, 255, 0.2);

          &:hover {
            color: #fff;
            background-color: rgba(0, 123, 255, 0.8);
            border: 1px solid #ffffffab !important;
          }
        }

        &.method-chip {
          background-color: rgba(255, 193, 7, 0.1) !important;
          border: 1px solid rgba(255, 193, 7, 0.2) !important;

          &:hover {
            color: #fff;
            background-color: rgba(255, 193, 7, 0.8) !important;
            border: 1px solid #ffffffab !important;
          }
        }

        .method-chip {
          background-color: rgba(220, 53, 69, 0.1);
          border-color: rgba(220, 53, 69, 0.2);
        }
      }

      .cocktail-key-info {
        margin-top: 8px;
      }

      .info-label {
        font-size: 12px;
        color: #fff;
        margin-bottom: 4px;
        font-weight: 500;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FacetChipsComponent implements OnInit {
  @Input() label = '';
  @Input() kind: Kind = 'method';
  @Input() items: string[] = [];
  @Input() activeKind: Kind | 'root' = 'root';
  @Input() activeSlug = '';

  @Input() stopClickPropagation = false;

  /** Se passi una mappa, NIENTE chiamate; altrimenti calcola lui i contatori. */
  @Input() countsInput: Record<string, number | undefined> | null = null;

  // cache condivisa tra tutte le istanze (home/nav/footer)
  private static memo: Record<Kind, Record<string, number>> = {
    method: {},
    glass: {},
    category: {},
    alcoholic: {},
  };
  private local: Record<string, number | undefined> = {};

  constructor(private api: CocktailService) {}

  ngOnInit(): void {
    // 1) Se hai passato countsInput, usiamo quelli e stop
    if (this.countsInput) {
      this.local = { ...this.countsInput };
      return;
    }

    // 2) Altrimenti: riempi da cache + fetcha solo i mancanti
    const cache = FacetChipsComponent.memo[this.kind];
    this.items.forEach((lbl) => {
      const s = this.slug(lbl);
      if (cache[s] !== undefined) this.local[s] = cache[s];
    });

    const missing = this.items
      .map((lbl) => this.slug(lbl))
      .filter((s) => this.local[s] === undefined);

    if (!missing.length) return;

    // piccola helper per 1 richiesta (pageSize=1, leggiamo solo total)
    const ask = (label: string) =>
      this.kind === 'method'
        ? this.api.getCocktails(
            1,
            1,
            '',
            '',
            '',
            false,
            false,
            false,
            false,
            label,
            ''
          )
        : this.kind === 'glass'
        ? this.api.getCocktails(
            1,
            1,
            '',
            '',
            '',
            false,
            false,
            false,
            false,
            '',
            label
          )
        : this.kind === 'category'
        ? this.api.getCocktails(
            1,
            1,
            '',
            label,
            '',
            false,
            false,
            false,
            false,
            '',
            ''
          )
        : this.api.getCocktails(
            1,
            1,
            '',
            '',
            label,
            false,
            false,
            false,
            false,
            '',
            ''
          );

    // Concurrency semplice
    const queue = [...missing];
    const RUNNERS = 5;
    for (let k = 0; k < RUNNERS; k++) this.run(queue, ask);
  }

  private run(queue: string[], ask: (label: string) => any) {
    const next = () => {
      const slug = queue.shift();
      if (!slug) return;
      const label = this.items.find((l) => this.slug(l) === slug)!;
      ask(label).subscribe({
        next: (res: any) => this.set(slug, res?.meta?.pagination?.total ?? 0),
        error: () => this.set(slug, 0),
        complete: () => next(),
      });
    };
    next();
  }

  private set(slug: string, n: number) {
    this.local[slug] = n;
    FacetChipsComponent.memo[this.kind][slug] = n; // salva in cache globale
  }

  count(slug: string) {
    return this.local[slug];
  }
  trackByLabel = (_: number, v: string) => v;

  // slug compatibile col tuo toSlug
  slug(v: string): string {
    return (v || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '');
  }
}
