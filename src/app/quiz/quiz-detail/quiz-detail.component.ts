import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';

// Importa le interfacce corrette dal quiz.service
import {
  QuizService,
  Quiz,
  QuizQuestionContent,
} from '../../services/quiz.service';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-quiz-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, FormsModule],
  templateUrl: './quiz-detail.component.html',
  styleUrls: ['./quiz-detail.component.scss'],
})
export class QuizDetailComponent implements OnInit, OnDestroy {
  quiz: Quiz | undefined;
  loading = true;
  error: string | null = null;

  currentQuestionIndex = 0;
  selectedOptions: number[] = [];

  quizCompleted = false;
  score = 0;
  maxScore = 0;
  feedbackMessage = '';

  showResult = false;
  currentQuestion: QuizQuestionContent | undefined;

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private quizService: QuizService
  ) {}

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const quizSlug = params.get('slug');
      if (quizSlug) {
        this.loadQuizBySlug(quizSlug);
      } else {
        this.error = 'Quiz slug not provided.';
        this.loading = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private shuffleArray<T>(array: T[]): T[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  }

  loadQuizBySlug(slug: string): void {
    this.loading = true;
    this.error = null;
    this.quizService
      .getQuizBySlug(slug)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (quizData) => {
          this.quiz = quizData;

          if (
            !this.quiz ||
            !this.quiz.quizData ||
            !this.quiz.quizData.questions ||
            this.quiz.quizData.questions.length === 0
          ) {
            this.quiz = undefined;
            this.error = 'Quiz not found or no questions available.';
            this.loading = false;
            return;
          }

          this.quiz.quizData.questions = this.shuffleArray(
            this.quiz.quizData.questions
          );

          // Calcolo maxScore:
          // Se scoreValue esiste e valido, usa quello, altrimenti conta risposte corrette
          this.maxScore = this.quiz.quizData.questions.reduce((sum, q) => {
            if (typeof q.scoreValue === 'number' && !isNaN(q.scoreValue)) {
              return sum + q.scoreValue;
            }
            if (Array.isArray(q.correctOptionIndices)) {
              return sum + q.correctOptionIndices.length;
            }
            return sum;
          }, 0);

          console.log('DEBUG: Max Score Calculated:', this.maxScore);
          this.setCurrentQuestion();

          this.loading = false;
        },
        error: (err: HttpErrorResponse) => {
          this.loading = false;
          this.error = 'Failed to load quiz details. Please try again later.';
          console.error('DEBUG: Error loading quiz by slug:', err);
        },
      });
  }

  setCurrentQuestion(): void {
    if (!this.quiz || !this.quiz.quizData?.questions) return;

    this.currentQuestion =
      this.quiz.quizData.questions[this.currentQuestionIndex];

    console.log('DEBUG: --- Setting Current Question ---');
    console.log('DEBUG: Current Question Index:', this.currentQuestionIndex);
    console.log('DEBUG: Question Text:', this.currentQuestion.questionText);
    console.log(
      'DEBUG: Options:',
      this.currentQuestion.options.map((o) => o.optionText)
    );
    console.log(
      'DEBUG: Correct Option Indices:',
      this.currentQuestion.correctOptionIndices
    );
    console.log('DEBUG: --- End Setting Current Question ---');

    this.selectedOptions = [];
  }

  onOptionChange(optionIndex: number): void {
    if (this.showResult) return;

    const index = this.selectedOptions.indexOf(optionIndex);
    if (index > -1) {
      this.selectedOptions.splice(index, 1);
    } else {
      this.selectedOptions.push(optionIndex);
    }
    this.selectedOptions.sort((a, b) => a - b);

    console.log('DEBUG: User selected options:', this.selectedOptions);
  }

  checkAnswer(): void {
    if (this.selectedOptions.length === 0) {
      console.warn('Please select at least one option.');
      return;
    }

    if (!this.currentQuestion) return;

    const correctIndices = [
      ...(this.currentQuestion.correctOptionIndices || []),
    ].sort((a, b) => a - b);

    const correctlySelectedOptions = this.selectedOptions.filter((i) =>
      correctIndices.includes(i)
    );
    const incorrectlySelectedOptions = this.selectedOptions.filter(
      (i) => !correctIndices.includes(i)
    );

    console.log('DEBUG: Correctly Selected:', correctlySelectedOptions);
    console.log('DEBUG: Incorrectly Selected:', incorrectlySelectedOptions);

    // Calcolo punti: +1 ogni risposta corretta selezionata, -1 ogni errata selezionata, min 0, max scoreValue
    let points =
      correctlySelectedOptions.length - incorrectlySelectedOptions.length;
    points = Math.max(0, points);

    // Usa scoreValue se definito, altrimenti il numero di risposte corrette
    const maxPerQuestion =
      typeof this.currentQuestion.scoreValue === 'number'
        ? this.currentQuestion.scoreValue
        : correctIndices.length;

    points = Math.min(points, maxPerQuestion);

    console.log(
      `DEBUG: Score for this question: ${points} / Max: ${maxPerQuestion}`
    );

    this.score += points;
    this.showResult = true;

    setTimeout(() => this.nextQuestion(), 1500);
  }

  nextQuestion(): void {
    if (!this.quiz || !this.quiz.quizData?.questions) return;

    this.showResult = false;
    this.selectedOptions = [];
    this.currentQuestionIndex++;

    if (this.currentQuestionIndex >= this.quiz.quizData.questions.length) {
      this.finishQuiz();
    } else {
      this.setCurrentQuestion();
    }
  }

  finishQuiz(): void {
    this.quizCompleted = true;
    this.feedbackMessage = this.getFeedbackMessage(this.score);
    console.log('DEBUG: Quiz Finished. Final Score:', this.score);
    console.log('DEBUG: Feedback Message:', this.feedbackMessage);
  }

  getFeedbackMessage(currentScore: number): string {
    if (
      !this.quiz ||
      !this.quiz.quizData?.scoreFeedback ||
      this.quiz.quizData.scoreFeedback.length === 0
    ) {
      return 'Quiz completed! No specific feedback available.';
    }

    const sortedFeedback = [...this.quiz.quizData.scoreFeedback].sort(
      (a, b) => b.minScore - a.minScore
    );

    for (const feedback of sortedFeedback) {
      if (currentScore >= feedback.minScore) {
        return feedback.comment;
      }
    }
    return 'Quiz completed! Keep practicing!';
  }

  restartQuiz(): void {
    this.currentQuestionIndex = 0;
    this.selectedOptions = [];
    this.showResult = false;
    this.score = 0;
    this.quizCompleted = false;

    if (this.quiz?.slug) {
      this.loadQuizBySlug(this.quiz.slug);
    } else {
      this.error = 'Cannot restart quiz: slug not found.';
      this.loading = false;
    }
    console.log('DEBUG: Quiz Restarted. Score reset to 0.');
  }
}
