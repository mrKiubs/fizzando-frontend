import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

// Importa il QuizService e le interfacce necessarie
import {
  QuizService,
  Quiz,
  // Non importare StrapiListQuizResponse qui se non la usi direttamente per tipizzare la risposta del service
} from '../../services/quiz.service'; // Percorso corretto
import {
  trigger,
  state,
  style,
  transition,
  animate,
} from '@angular/animations';
import { Observable, of, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { HttpErrorResponse } from '@angular/common/http';

interface FaqItemState {
  isExpanded: boolean;
}

@Component({
  selector: 'app-quiz-list',
  standalone: true,
  imports: [CommonModule, MatIconModule, FormsModule, RouterModule],
  templateUrl: './quiz-list.component.html',
  styleUrls: ['./quiz-list.component.scss'],
  animations: [
    trigger('accordionAnimation', [
      state('void', style({ height: '0', opacity: 0, overflow: 'hidden' })),
      state('closed', style({ height: '0', opacity: 0, overflow: 'hidden' })),
      state('open', style({ height: '*', opacity: 1, overflow: 'hidden' })),
      transition('void => open', [
        style({ height: '0', opacity: 0 }),
        animate('300ms ease-out', style({ height: '*', opacity: 1 })),
      ]),
      transition('open => closed', [
        animate('300ms ease-out', style({ height: '0', opacity: 0 })),
      ]),
      transition('closed => open', [
        animate('300ms ease-out', style({ height: '*', opacity: 1 })),
      ]),
    ]),
  ],
})
export class QuizListComponent implements OnInit, OnDestroy {
  quizzes: Quiz[] = [];
  loading: boolean = true;
  error: string | null = null;

  searchTerm: string = '';
  isExpanded: boolean = false;
  selectedCategory: string = '';

  categories$: Observable<string[]> = of([
    'Classic Cocktails',
    'Tropical Cocktails',
    'Strong Spirits',
    'Bartending Techniques',
    'Mocktails',
    'Gin & Tonic Delights',
    'Whiskey Wonders',
    'Wine & Sparkling Sips',
    'Cocktail & Food Pairings',
    'Seasonal Cocktails',
    'Prohibition Era Cocktails',
    'Cocktail Origins & History',
    'Italian Cocktail Classics',
    'Caribbean Cocktail Journey',
  ]);

  currentPage: number = 1;
  itemsPerPage: number = 10;
  totalItems: number = 0;

  faqs: FaqItemState[] = [
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
    { isExpanded: false },
  ];

  private destroy$ = new Subject<void>();

  constructor(private quizService: QuizService) {}

  ngOnInit(): void {
    this.loadQuizzes();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadQuizzes(append: boolean = false): void {
    this.loading = true;
    this.error = null;

    this.quizService
      .getQuizzes(
        this.currentPage,
        this.itemsPerPage,
        this.searchTerm,
        this.selectedCategory
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          // DEBUGGING: Log the raw response
          //console.log('Raw Service Response (already mapped):', response);

          // *** MODIFICA CHIAVE QUI: response contiene direttamente 'quizzes' e 'total' ***
          const newQuizzes: Quiz[] = response.quizzes; // Accedi a 'quizzes'
          this.totalItems = response.total; // Accedi a 'total'

          if (append) {
            this.quizzes = [...this.quizzes, ...newQuizzes];
          } else {
            this.quizzes = newQuizzes;
          }

          this.loading = false;
          //console.log('Final Quizzes Array:', this.quizzes); // Log the final array
        },
        error: (err: HttpErrorResponse) => {
          this.loading = false;
          this.error = 'Failed to load quizzes. Please try again later.';
          console.error('Error loading quizzes:', err);
        },
      });
  }

  onSearchTermChange(): void {
    this.currentPage = 1;
    this.loadQuizzes();
  }

  applyFilters(): void {
    this.currentPage = 1;
    this.loadQuizzes();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedCategory = '';
    this.currentPage = 1;
    this.isExpanded = false;
    this.loadQuizzes();
  }

  toggleExpansion(): void {
    this.isExpanded = !this.isExpanded;
  }

  getActiveFiltersText(): string {
    const activeFilters: string[] = [];
    if (this.searchTerm) {
      activeFilters.push(`"${this.searchTerm}"`);
    }
    if (this.selectedCategory) {
      activeFilters.push(this.selectedCategory);
    }
    return activeFilters.length > 0
      ? activeFilters.join(', ')
      : 'No filters active';
  }

  loadMore(): void {
    if (this.quizzes.length < this.totalItems && !this.loading) {
      this.currentPage++;
      this.loadQuizzes(true);
    }
  }

  trackByQuizId(index: number, quiz: Quiz): number | undefined {
    return quiz.id;
  }

  toggleFaq(faqItem: FaqItemState): void {
    faqItem.isExpanded = !faqItem.isExpanded;
  }
}
