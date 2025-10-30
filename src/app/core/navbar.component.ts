import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  inject,
  PLATFORM_ID,
  ViewChild,
  ElementRef,
  Renderer2,
} from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import {
  Router,
  ActivatedRoute,
  RouterModule,
  NavigationEnd,
} from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { GlossaryService } from '../services/glossary.service';
import { BreadcrumbsComponent } from '../assets/design-system/breadcrumbs/breadcrumbs.component';
import { LogoComponent } from '../assets/design-system/logo/logo.component';
import { StickyHeaderDirective } from '../directives/sticky-header.directive';
import { NavbarSearchHostComponent } from './navbar-search-host.component';
import { FormsModule } from '@angular/forms';

interface SearchInertEvent {
  enable: boolean;
  except: HTMLElement | null;
}

@Component({
  selector: 'app-navbar',
  standalone: true,
  host: { ngSkipHydration: 'true' },
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    BreadcrumbsComponent,
    LogoComponent,
    StickyHeaderDirective,
    NavbarSearchHostComponent,
  ],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  @ViewChild('overlayRoot') overlayRoot!: ElementRef<HTMLElement>;
  @ViewChild('menuToggle') menuToggleBtn!: ElementRef<HTMLButtonElement>;

  isMenuOpen = false;
  isSearchOpen = false;
  isScrolled = false;
  selectedCocktailCategory = '';
  selectedIngredientType = '';
  selectedArticleCategory = '';
  selectedGlossaryCategory = '';
  glossaryCategories: string[] = [];
  activeGlossaryCategoryInUrl = '';
  activeCocktailCategoryInUrl = '';
  activeIngredientTypeInUrl = '';
  activeArticleCategoryInUrl = '';

  isHome = true;

  private routerSubscription?: Subscription;
  private lastFocused: HTMLElement | null = null;
  private readonly TRANSITION_MS = 200;
  private searchOverlayEl: HTMLElement | null = null;
  private preserveInertFromSearch = false;

  private modifiedInertEls = new Set<HTMLElement>();
  private inertContainerEl: HTMLElement | null = null;
  overlaySearchTerm = '';
  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private glossaryService: GlossaryService,
    private renderer: Renderer2
  ) {}

  ngOnInit(): void {
    const url0 = this.router.url.split('?')[0] || '/';
    this.isHome = url0 === '/';

    // categorie Glossary (dinamiche)
    this.glossaryService.getCategories().subscribe({
      next: (cats) => (this.glossaryCategories = cats || []),
      error: () => (this.glossaryCategories = []),
    });

    this.routerSubscription = this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd => event instanceof NavigationEnd
        )
      )
      .subscribe(() => {
        const currentUrl = this.router.url;
        const urlParts = currentUrl.split('?');
        this.isHome = urlParts[0] === '/' || urlParts[0] === '';
        const urlParams = new URLSearchParams(urlParts[1] || '');

        if (urlParts[0].includes('/cocktails')) {
          this.selectedCocktailCategory = urlParams.get('category') || '';
          this.activeCocktailCategoryInUrl = this.selectedCocktailCategory;
        } else {
          this.selectedCocktailCategory = '';
          this.activeCocktailCategoryInUrl = '';
        }

        if (urlParts[0].includes('/ingredients')) {
          this.selectedIngredientType = urlParams.get('type') || '';
          this.activeIngredientTypeInUrl = this.selectedIngredientType;
        } else {
          this.selectedIngredientType = '';
          this.activeIngredientTypeInUrl = '';
        }

        if (urlParts[0].includes('/articles')) {
          this.selectedArticleCategory = urlParams.get('category') || '';
          this.activeArticleCategoryInUrl = this.selectedArticleCategory;
        } else {
          this.selectedArticleCategory = '';
          this.activeArticleCategoryInUrl = '';
        }
        if (urlParts[0].includes('/glossary')) {
          this.selectedGlossaryCategory = urlParams.get('category') || '';
          this.activeGlossaryCategoryInUrl = this.selectedGlossaryCategory;
        } else {
          this.selectedGlossaryCategory = '';
          this.activeGlossaryCategoryInUrl = '';
        }
        if (this.isMenuOpen) this.closeMenu();
        if (this.isSearchOpen) this.closeSearch();
      });
    // live search (SOLO cocktail/ingredienti)
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.setBackgroundInert(false);
    if (this.isBrowser) {
      document.body.style.overflow = '';
    }
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (!this.isBrowser) return;
    const y =
      (typeof window !== 'undefined' && window.pageYOffset) ||
      (typeof document !== 'undefined' &&
        document.documentElement?.scrollTop) ||
      0;
    this.isScrolled = y > 0;
  }

  @HostListener('document:keydown', ['$event'])
  handleGlobalKeydown(e: KeyboardEvent): void {
    if (e.key === '/' && !this.isMenuOpen && !this.isSearchOpen) {
      const ae = document.activeElement as HTMLElement | null;
      const isTyping =
        !!ae &&
        (ae.tagName === 'INPUT' ||
          ae.tagName === 'TEXTAREA' ||
          ae.isContentEditable);
      if (!isTyping) {
        e.preventDefault();
        this.openSearch();
        return;
      }
    }

    if (!(this.isMenuOpen || this.isSearchOpen)) return;

    if (e.key === 'Escape') {
      if (this.isMenuOpen) this.closeMenu();
      if (this.isSearchOpen) this.closeSearch();
      return;
    }

    if (e.key === 'Tab') {
      const root = this.getActiveOverlayRoot();
      const focusables = this.getFocusableIn(root || null);
      if (!focusables.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  private async waitAfterTransition(ms = this.TRANSITION_MS): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getFocusableIn(
    rootEl: HTMLElement | null | undefined
  ): HTMLElement[] {
    if (!rootEl) return [];
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return Array.from(rootEl.querySelectorAll<HTMLElement>(selectors)).filter(
      (el) => this.isFocusableElement(el)
    );
  }

  private isFocusableElement(el: HTMLElement): boolean {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    if (el.tabIndex >= 0) return true;

    const nodeName = el.nodeName.toLowerCase();
    switch (nodeName) {
      case 'a':
      case 'area':
        return !!(el as HTMLAnchorElement).href;
      case 'input':
      case 'select':
      case 'textarea':
      case 'button':
        return !(el as HTMLInputElement | HTMLButtonElement).disabled;
      case 'iframe':
        return true;
      default:
        return false;
    }
  }

  private getActiveOverlayRoot(): HTMLElement | null {
    if (this.isMenuOpen && this.overlayRoot?.nativeElement) {
      return this.overlayRoot.nativeElement;
    }
    if (this.isSearchOpen && this.searchOverlayEl) {
      return this.searchOverlayEl;
    }
    return null;
  }

  // in classe (se non li hai già)
  private setBackgroundInert(
    enable: boolean,
    exceptEl?: HTMLElement | null
  ): void {
    if (!this.isBrowser) return;

    const headerEl = document.querySelector(
      'header.app-header'
    ) as HTMLElement | null;

    const clearInert = () => {
      if (this.modifiedInertEls.size) {
        this.modifiedInertEls.forEach((el) => {
          this.renderer.removeAttribute(el, 'inert');
          this.renderer.removeAttribute(el, 'aria-hidden');
        });
        this.modifiedInertEls.clear();
      }
      this.inertContainerEl = null;
    };

    if (!enable) {
      clearInert();
      return;
    }
    if (!exceptEl) {
      return;
    }
    clearInert();

    const container = exceptEl.parentElement as HTMLElement | null;
    if (!container) return;
    this.inertContainerEl = container;

    const children = Array.from(container.children) as HTMLElement[];

    children.forEach((el) => {
      // non toccare overlay attivo
      if (el === exceptEl) return;

      // non toccare il header né un blocco che lo contenga
      if (headerEl && (el === headerEl || el.contains(headerEl))) return;

      // applica inert solo agli altri fratelli
      this.renderer.setAttribute(el, 'inert', '');
      this.renderer.setAttribute(el, 'aria-hidden', 'true');
      this.modifiedInertEls.add(el);
    });
  }

  async toggleMenu(): Promise<void> {
    // se la Search è aperta, chiudila prima e mantieni inert durante lo switch
    if (this.isSearchOpen) {
      await this.closeSearch(true);
    }

    this.isMenuOpen = !this.isMenuOpen;
    if (this.isBrowser) {
      document.body.style.overflow = this.isMenuOpen ? 'hidden' : '';
    }

    if (this.isMenuOpen) {
      this.overlaySearchTerm = '';
      this.clearSearchResults();

      this.lastFocused = document.activeElement as HTMLElement;

      // attiva inert puntando al nuovo overlay
      this.setBackgroundInert(true, this.overlayRoot?.nativeElement || null);

      // focus al primo focusable nel menu dopo il frame
      setTimeout(() => {
        const first = this.getFocusableIn(
          this.overlayRoot?.nativeElement || null
        )[0];
        first?.focus?.();
      }, 0);
    } else {
      await this.closeMenu();
    }
  }

  async closeMenu(preserveInert = false): Promise<void> {
    this.isMenuOpen = false;
    if (this.isBrowser) {
      document.body.style.overflow = '';
    }

    await this.waitAfterTransition();

    if (!preserveInert) {
      this.setBackgroundInert(false);
      (this.menuToggleBtn?.nativeElement ?? this.lastFocused)?.focus?.();
      this.lastFocused = null;
    }
  }

  async toggleSearch(): Promise<void> {
    if (this.isMenuOpen) {
      await this.closeMenu(true);
    }

    const next = !this.isSearchOpen;
    this.isSearchOpen = next;

    if (this.isBrowser) {
      document.body.style.overflow = next ? 'hidden' : '';
    }

    if (next) {
      this.lastFocused = document.activeElement as HTMLElement;
    } else {
      await this.closeSearch();
    }
  }

  openSearch(): void {
    if (!this.isSearchOpen) {
      this.toggleSearch();
    }
  }

  async closeSearch(preserveInert = false): Promise<void> {
    if (!this.isSearchOpen) {
      this.preserveInertFromSearch = false;
      return;
    }

    this.isSearchOpen = false;
    if (this.isBrowser) {
      document.body.style.overflow = '';
    }

    if (preserveInert) {
      this.preserveInertFromSearch = true;
    }

    await this.waitAfterTransition();

    if (!preserveInert) {
      this.setBackgroundInert(false);
      (this.menuToggleBtn?.nativeElement ?? this.lastFocused)?.focus?.();
      this.lastFocused = null;
    }
  }

  onSearchInertToggle(event: SearchInertEvent): void {
    if (event.enable) {
      this.preserveInertFromSearch = false;
      this.searchOverlayEl = event.except;
      this.setBackgroundInert(true, event.except);
    } else {
      this.searchOverlayEl = null;
      if (this.preserveInertFromSearch) {
        this.preserveInertFromSearch = false;
        return;
      }
      this.setBackgroundInert(false);
    }
  }

  onSearchCloseRequested(): void {
    this.closeSearch();
  }
  goCocktailCategory(): void {
    const queryParams = this.selectedCocktailCategory
      ? { category: this.selectedCocktailCategory }
      : {};
    this.router
      .navigate(['/cocktails'], { queryParams })
      .then(() => this.closeMenu());
  }

  goIngredientType(): void {
    const queryParams = this.selectedIngredientType
      ? { type: this.selectedIngredientType }
      : {};
    this.router
      .navigate(['/ingredients'], { queryParams })
      .then(() => this.closeMenu());
  }

  goArticleCategory(): void {
    const queryParams = this.selectedArticleCategory
      ? { category: this.selectedArticleCategory }
      : {};
    this.router
      .navigate(['/articles'], { queryParams })
      .then(() => this.closeMenu());
  }

  goGlossaryCategory(): void {
    const queryParams = this.selectedGlossaryCategory
      ? { category: this.selectedGlossaryCategory }
      : {};
    this.router
      .navigate(['/glossary'], { queryParams })
      .then(() => this.closeMenu());
  }

  clearSearchResults(): void {
    // no-op: il reset effettivo avviene alla chiusura dell’overlay di search
  }
}
