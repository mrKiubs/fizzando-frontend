import { Component, OnInit, OnDestroy, inject, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
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
  private readonly ngZone = inject(NgZone);

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
  private nextQuestionTimeout: any;

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
    if (this.nextQuestionTimeout) clearTimeout(this.nextQuestionTimeout);
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

          this.maxScore = this.quiz.quizData.questions.reduce((sum, q) => {
            if (typeof q.scoreValue === 'number' && !isNaN(q.scoreValue)) {
              return sum + q.scoreValue;
            }
            if (Array.isArray(q.correctOptionIndices)) {
              return sum + q.correctOptionIndices.length;
            }
            return sum;
          }, 0);

          this.setCurrentQuestion();
          this.loading = false;
        },
        error: (err: HttpErrorResponse) => {
          this.loading = false;
          this.error = 'Failed to load quiz details. Please try again later.';
          console.error('Error loading quiz by slug:', err);
        },
      });
  }

  setCurrentQuestion(): void {
    if (!this.quiz || !this.quiz.quizData?.questions) return;
    this.currentQuestion =
      this.quiz.quizData.questions[this.currentQuestionIndex];
    this.selectedOptions = [];
  }

  onOptionChange(optionIndex: number): void {
    if (this.showResult) return;
    const idx = this.selectedOptions.indexOf(optionIndex);
    if (idx > -1) this.selectedOptions.splice(idx, 1);
    else this.selectedOptions.push(optionIndex);
    this.selectedOptions.sort((a, b) => a - b);
  }

  checkAnswer(): void {
    if (this.selectedOptions.length === 0 || !this.currentQuestion) return;

    const correctIndices = [
      ...(this.currentQuestion.correctOptionIndices || []),
    ].sort((a, b) => a - b);

    const correctlySelected = this.selectedOptions.filter((i) =>
      correctIndices.includes(i)
    );
    const incorrectlySelected = this.selectedOptions.filter(
      (i) => !correctIndices.includes(i)
    );

    let points = correctlySelected.length - incorrectlySelected.length;
    points = Math.max(0, points);

    const maxPerQuestion =
      typeof this.currentQuestion.scoreValue === 'number'
        ? this.currentQuestion.scoreValue
        : correctIndices.length;

    this.score += Math.min(points, maxPerQuestion);
    this.showResult = true;

    // ⬇️ fuori da Angular: non tiene vivo lo zone
    this.ngZone.runOutsideAngular(() => {
      this.nextQuestionTimeout = setTimeout(() => {
        this.ngZone.run(() => this.nextQuestion());
      }, 1500);
    });
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
  }

  getFeedbackMessage(currentScore: number): string {
    if (!this.quiz?.quizData?.scoreFeedback?.length) {
      return 'Quiz completed! No specific feedback available.';
    }
    const sorted = [...this.quiz.quizData.scoreFeedback].sort(
      (a, b) => b.minScore - a.minScore
    );
    for (const f of sorted) {
      if (currentScore >= f.minScore) return f.comment;
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
  }
}
