import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { GlossaryCardComponent } from '../glossary-card/glossary-card.component';
import { GlossaryService, GlossaryTerm } from '../../services/glossary.service';
import { Subject, Subscription, Observable } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { Title } from '@angular/platform-browser'; // Rimosso DomSanitizer

import {
  trigger,
  state,
  style,
  transition,
  animate,
} from '@angular/animations';

// Rimosso l'interfaccia FaqItem completa
interface FaqItemState {
  // Interfaccia semplificata per gestire solo lo stato di espansione
  isExpanded: boolean;
}

@Component({
  selector: 'app-glossary-list',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, GlossaryCardComponent],
  templateUrl: './glossary-list.component.html',
  styleUrls: ['./glossary-list.component.scss'],
  animations: [
    trigger('accordionAnimation', [
      state(
        'void',
        style({
          height: '0',
          opacity: 0,
          overflow: 'hidden',
        })
      ),
      state(
        'closed',
        style({
          height: '0',
          opacity: 0,
          overflow: 'hidden',
        })
      ),
      state(
        'open',
        style({
          height: '*',
          opacity: 1,
          overflow: 'hidden',
        })
      ),
      transition('closed => open', [
        style({ height: '0', opacity: 0 }),
        animate('0.3s ease-out', style({ height: '*', opacity: 1 })),
      ]),
      transition('open => closed', [
        style({ height: '*', opacity: 1 }),
        animate('0.3s ease-out', style({ height: '0', opacity: 0 })),
      ]),
      transition('void => open', [
        style({ height: '0', opacity: 0 }),
        animate('0.3s ease-out', style({ height: '*', opacity: 1 })),
      ]),
      transition('open => void', [
        style({ height: '*', opacity: 1 }),
        animate('0.3s ease-out', style({ height: '0', opacity: 0 })),
      ]),
    ]),
  ],
})
export class GlossaryListComponent implements OnInit, OnDestroy {
  terms: GlossaryTerm[] = [];
  loading = false;
  error: string | null = null;

  searchTerm: string = '';
  selectedCategory: string = '';

  currentPage: number = 1;
  pageSize: number = 10;
  totalItems: number = 0;

  categories$: Observable<string[]> = new Observable<string[]>();
  totalItems$: Observable<number> = new Observable<number>();

  isExpanded: boolean = false;

  private searchTermsSubject = new Subject<string>();
  private searchSubscription: Subscription | undefined;
  private termsDataSubscription: Subscription | undefined;
  private totalItemsSubscription: Subscription | undefined;
  private currentPageSubscription: Subscription | undefined;

  // FAQ: Manteniamo solo lo stato di espansione per ogni item
  faqs: FaqItemState[] = [
    { isExpanded: false }, // FAQ 1
    { isExpanded: false }, // FAQ 2
    { isExpanded: false }, // FAQ 3
    { isExpanded: false }, // FAQ 4
    { isExpanded: false }, // FAQ 5
  ];

  constructor(
    private glossaryService: GlossaryService,
    private titleService: Title // Inject Title service
  ) // Rimosso private sanitizer: DomSanitizer
  {}

  ngOnInit(): void {
    // Set the page title for SEO
    this.titleService.setTitle(
      'Cocktail Glossary: Terms, Techniques & Definitions | MyCocktailApp'
    ); // Sostituisci [Your App Name]

    this.categories$ = this.glossaryService.getCategories();

    // Sottoscrizione per i termini del glossario (fondamentale)
    this.termsDataSubscription = this.glossaryService
      .getCurrentTerms()
      .subscribe(
        (data: {
          terms: GlossaryTerm[];
          total: number;
          currentPage: number;
          resetTerms: boolean;
        }) => {
          // DEBUG LOGS - Controlla la console per vedere se i dati arrivano
          console.log(
            'GLOSSARY COMPONENT (A): termsDataSubscription received data. Terms Count:',
            data.terms.length,
            'Total:',
            data.total,
            'Current Page:',
            data.currentPage,
            'Resetting terms:',
            data.resetTerms
          );
          // Questo è il punto chiave: assegniamo i termini ricevuti
          this.terms = data.terms;
          this.totalItems = data.total;
          this.currentPage = data.currentPage;
          this.loading = false;
          this.error = null;
        },
        (error) => {
          console.error('GLOSSARY COMPONENT (A): Error fetching terms:', error);
          this.error = 'Failed to load glossary terms. Please try again later.';
          this.loading = false;
        }
      );

    // Sottoscrizione per il conteggio totale degli elementi (utile per il "Load More")
    this.totalItemsSubscription = this.glossaryService
      .getTotalItems()
      .subscribe((total) => {
        console.log(
          'GLOSSARY COMPONENT (B): totalItemsSubscription received total:',
          total
        );
        this.totalItems = total;
      });

    // Sottoscrizione per la pagina corrente (utile per debug e UI)
    this.currentPageSubscription = this.glossaryService.currentPageSubject
      .asObservable()
      .subscribe((page) => {
        console.log(
          'GLOSSARY COMPONENT (C): currentPageSubscription received page:',
          page
        );
        this.currentPage = page;
      });

    // Gestione del debouncing per la ricerca
    this.searchTermsSubject
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe((term) => {
        console.log(
          'GLOSSARY COMPONENT (D): searchTermsSubject triggered. Term:',
          term
        );
        this.loading = true;
        this.glossaryService.setSearchTerm(term);
      });

    // Inizializza il caricamento iniziale dei termini
    this.loading = true;
    this.glossaryService.initializeGlossary();
  }

  ngOnDestroy(): void {
    // Annulla tutte le sottoscrizioni per evitare memory leaks
    this.searchSubscription?.unsubscribe();
    this.termsDataSubscription?.unsubscribe();
    this.totalItemsSubscription?.unsubscribe();
    this.currentPageSubscription?.unsubscribe();
  }

  onSearchTermChange(): void {
    // Emette il termine di ricerca al subject
    this.searchTermsSubject.next(this.searchTerm);
  }

  applyFilters() {
    console.log(
      'GLOSSARY COMPONENT (E): applyFilters called. Selected Category:',
      this.selectedCategory
    );
    this.loading = true;
    this.glossaryService.setSelectedCategory(this.selectedCategory);
  }

  clearFilters() {
    console.log('GLOSSARY COMPONENT (F): clearFilters called.');
    this.searchTerm = '';
    this.selectedCategory = '';
    this.loading = true;

    this.glossaryService.setSearchTerm('');
    this.glossaryService.setSelectedCategory('');
    this.searchTermsSubject.next(''); // Invia un termine vuoto per resettare la ricerca
  }

  loadMore(): void {
    console.log('GLOSSARY COMPONENT (G): loadMore called.');
    // Carica più termini solo se non sta già caricando e ci sono ancora elementi da caricare
    if (!this.loading && this.terms.length < this.totalItems) {
      this.loading = true;
      this.glossaryService.loadMore();
    }
  }

  trackByTermId(index: number, term: GlossaryTerm): number {
    return term.id;
  }

  toggleExpansion(): void {
    this.isExpanded = !this.isExpanded;
  }

  // Metodo per espandere/collassare una FAQ
  toggleFaq(faqItem: FaqItemState): void {
    faqItem.isExpanded = !faqItem.isExpanded;
  }

  getActiveFiltersText(): string {
    const activeFilters: string[] = [];

    if (this.searchTerm) {
      activeFilters.push(`"${this.searchTerm}"`);
    }
    if (this.selectedCategory) {
      activeFilters.push(this.selectedCategory);
    }

    if (activeFilters.length > 0) {
      return activeFilters.join(', ');
    } else {
      return 'No filters active';
    }
  }

  get nextLoadAmount(): number {
    return Math.min(this.pageSize, this.totalItems - this.terms.length);
  }
}
