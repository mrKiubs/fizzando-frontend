import {
  Component,
  EventEmitter,
  Inject,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  ElementRef,
  PLATFORM_ID,
  AfterViewInit,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Subject, Subscription, forkJoin, of } from 'rxjs';
import {
  debounceTime,
  distinctUntilChanged,
  switchMap,
  catchError,
} from 'rxjs/operators';
import { CocktailService, Cocktail } from '../services/strapi.service';
import { IngredientService, Ingredient } from '../services/ingredient.service';

export interface SearchOverlayInertEvent {
  enable: boolean;
  except: HTMLElement | null;
}

@Component({
  selector: 'app-navbar-search',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule],
  templateUrl: './navbar-search.component.html',
  styleUrls: ['./navbar-search.component.scss'],
})
export class NavbarSearchComponent
  implements OnInit, OnDestroy, OnChanges, AfterViewInit
{
  @Input({ required: true }) open = false;
  @Output() closeRequested = new EventEmitter<void>();
  @Output() inertToggle = new EventEmitter<SearchOverlayInertEvent>();

  @ViewChild('overlayRoot') overlayRoot!: ElementRef<HTMLElement>;
  @ViewChild('overlaySearchInput')
  overlaySearchInput!: ElementRef<HTMLInputElement>;

  overlaySearchTerm = '';
  isSearchInputFocused = false;
  liveSearchLoading = false;
  liveCocktailResults: Cocktail[] = [];
  liveIngredientResults: Ingredient[] = [];

  private readonly searchTerms = new Subject<string>();
  private searchSubscription?: Subscription;
  private blurTimeout: any;
  private viewInitialized = false;
  private readonly isBrowser: boolean;

  constructor(
    private cocktailService: CocktailService,
    private ingredientService: IngredientService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    this.searchSubscription = this.searchTerms
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term: string) => {
          this.liveCocktailResults = [];
          this.liveIngredientResults = [];
          this.liveSearchLoading = false;

          if (term.length < 3 && !this.isSearchInputFocused) return of(null);
          if (term.length < 3) return of(null);

          this.liveSearchLoading = true;

          return forkJoin({
            cocktails: this.cocktailService
              .searchCocktailsByName(term)
              .pipe(catchError(() => of<Cocktail[]>([]))),
            ingredients: this.ingredientService
              .getIngredients(1, 10, term)
              .pipe(
                catchError(() =>
                  of({
                    data: [] as Ingredient[],
                    meta: {
                      pagination: {
                        page: 1,
                        pageSize: 0,
                        pageCount: 0,
                        total: 0,
                      },
                    },
                  })
                )
              ),
          }).pipe(catchError(() => of(null)));
        })
      )
      .subscribe((results) => {
        this.liveSearchLoading = false;
        if (results) {
          this.liveCocktailResults = results.cocktails;
          this.liveIngredientResults = results.ingredients.data;
        }
      });
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    if (this.open) {
      this.handleOpen();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewInitialized) return;
    if ('open' in changes) {
      if (this.open) {
        this.handleOpen();
      } else {
        this.handleClose();
      }
    }
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
    if (this.blurTimeout) clearTimeout(this.blurTimeout);
    this.inertToggle.emit({ enable: false, except: null });
  }

  onSearchTermChange(): void {
    this.searchTerms.next(this.overlaySearchTerm);
  }

  onSearchInputFocus(): void {
    if (this.blurTimeout) clearTimeout(this.blurTimeout);
    this.isSearchInputFocused = true;
    if (this.overlaySearchTerm.length >= 3) {
      this.searchTerms.next(this.overlaySearchTerm);
    }
  }

  onSearchInputBlur(): void {
    this.blurTimeout = setTimeout(() => {
      this.isSearchInputFocused = false;
    }, 150);
  }

  clearSearchTerm(event?: Event): void {
    if (event) event.stopPropagation();
    this.overlaySearchTerm = '';
    this.searchTerms.next('');
    this.clearSearchResults();
  }

  requestClose(): void {
    this.closeRequested.emit();
  }

  private handleOpen(): void {
    this.isSearchInputFocused = true;
    this.emitInert(true);
    this.focusInput();
  }

  private handleClose(): void {
    this.emitInert(false);
    this.resetState();
  }

  private emitInert(enable: boolean): void {
    const root = this.overlayRoot?.nativeElement ?? null;
    this.inertToggle.emit({ enable, except: enable ? root : null });
  }

  private focusInput(): void {
    if (!this.isBrowser) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = this.overlaySearchInput?.nativeElement;
        if (el) {
          el.focus({ preventScroll: true });
          el.select?.();
        }
      });
    });
  }

  private resetState(): void {
    this.isSearchInputFocused = false;
    this.overlaySearchTerm = '';
    this.searchTerms.next('');
    this.clearSearchResults();
  }

  private clearSearchResults(): void {
    this.liveCocktailResults = [];
    this.liveIngredientResults = [];
    this.liveSearchLoading = false;
  }
}
