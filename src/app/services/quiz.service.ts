// src/app/services/quiz.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { env } from '../config/env'; // Importa env

// Interfacce che rispecchiano la struttura del JSON di Strapi (campo quizData)
export interface Option {
  optionText: string;
}

export interface QuizQuestionContent {
  questionText: string;
  options: Option[];
  correctOptionIndices: number[];
  isMonitoredForScore: boolean;
  scoreValue: number;
}

export interface ScoreFeedback {
  minScore: number;
  comment: string;
}

export interface QuizDataContent {
  questions: QuizQuestionContent[];
  scoreFeedback: ScoreFeedback[];
}

// Interfaccia per la struttura dell'elemento 'data' all'interno delle risposte di Strapi
// Per Strapi v5 "flat", gli attributi sono direttamente sull'oggetto data, non sotto 'attributes'.
export interface StrapiDataItem {
  id: number;
  title: string; // Accesso diretto
  slug: string; // Accesso diretto
  description: string; // Accesso diretto
  category: string; // Accesso diretto
  quizData: QuizDataContent; // Accesso diretto al JSON
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
}

// Interfaccia per la risposta di un singolo quiz da Strapi (quando si chiede per ID)
export interface StrapiSingleQuizResponse {
  data: StrapiDataItem; // Un singolo oggetto StrapiDataItem
}

// Interfaccia per la risposta di una lista di quiz da Strapi
export interface StrapiListQuizResponse {
  data: StrapiDataItem[]; // Un array di StrapiDataItem
  meta: {
    pagination: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
  };
}

// Interfaccia semplificata per il frontend, che estrae gli attributi di interesse
export interface Quiz {
  id: number;
  title: string;
  slug: string;
  description: string;
  category: string;
  quizData: QuizDataContent;
  createdAt: string; // Aggiunto per ordinamento
}

@Injectable({
  providedIn: 'root',
})
export class QuizService {
  // URL base della tua API Strapi
  private apiUrl = env.apiUrl; // CORREZIONE: Usa env.apiUrl
  private quizzesBaseUrl = `${this.apiUrl}/api/cocktail-quizs`; // URL specifico per i quiz

  constructor(private http: HttpClient) {}

  /**
   * Recupera una lista di quiz da Strapi.
   * @param page Il numero di pagina da recuperare.
   * @param pageSize Il numero di elementi per pagina.
   * @param searchTerm Termine di ricerca per titolo/descrizione.
   * @param category Categoria per il filtro.
   * @returns Un Observable di una lista di oggetti Quiz (semplificati per il frontend).
   */
  getQuizzes(
    page: number = 1,
    pageSize: number = 10,
    searchTerm: string = '',
    category: string = ''
  ): Observable<{ quizzes: Quiz[]; total: number }> {
    let params = new HttpParams();
    params = params.append('pagination[page]', page.toString());
    params = params.append('pagination[pageSize]', pageSize.toString());

    // Filtri per la ricerca
    if (searchTerm) {
      params = params.append('filters[$or][0][title][$containsi]', searchTerm);
      params = params.append(
        'filters[$or][1][description][$containsi]',
        searchTerm
      );
    }

    // Filtro per categoria
    if (category) {
      params = params.append('filters[category][$eq]', category);
    }

    // Effettua la chiamata HTTP e mappa la risposta per estrarre solo i dati necessari
    return this.http
      .get<StrapiListQuizResponse>(this.quizzesBaseUrl, { params }) // Usa quizzesBaseUrl
      .pipe(
        map((response) => {
          const quizzes: Quiz[] = response.data.map((item) => ({
            id: item.id,
            title: item.title,
            slug: item.slug,
            description: item.description,
            category: item.category,
            quizData: item.quizData,
            createdAt: item.createdAt, // Mappa createdAt
          }));
          return { quizzes, total: response.meta.pagination.total };
        })
      );
  }

  /**
   * Recupera un singolo quiz da Strapi tramite il suo slug.
   * Questo metodo non usa 'populate=quizData' perché quizData è un campo JSON diretto
   * e dovrebbe essere incluso di default nella risposta di un singolo elemento.
   * @param slug Lo slug del quiz da recuperare.
   * @returns Un Observable dell'oggetto Quiz (semplificato per il frontend) o undefined se non trovato.
   */
  getQuizBySlug(slug: string): Observable<Quiz | undefined> {
    let params = new HttpParams();
    params = params.append('filters[slug][$eq]', slug);

    // Strapi per le query filtrate restituisce un array, anche se ci aspettiamo uno solo
    return this.http
      .get<StrapiListQuizResponse>(this.quizzesBaseUrl, { params }) // Usa quizzesBaseUrl
      .pipe(
        map((response) => {
          if (response.data && response.data.length > 0) {
            const item = response.data[0];
            return {
              id: item.id,
              title: item.title,
              slug: item.slug,
              description: item.description,
              category: item.category,
              quizData: item.quizData,
              createdAt: item.createdAt, // Mappa createdAt
            };
          }
          return undefined; // Quiz non trovato
        })
      );
  }

  /**
   * Recupera un singolo quiz da Strapi tramite il suo ID.
   * Questo metodo include 'populate=quizData' per assicurarsi che il campo JSON sia incluso.
   * @param id L'ID numerico del quiz da recuperare.
   * @returns Un Observable dell'oggetto Quiz (semplificato per il frontend) o undefined se non trovato.
   */
  getQuizById(id: number): Observable<Quiz | undefined> {
    return this.http
      .get<StrapiSingleQuizResponse>(
        `${this.quizzesBaseUrl}/${id}?populate=quizData` // Usa quizzesBaseUrl
      )
      .pipe(
        map((response) => {
          if (response.data) {
            const item = response.data;
            return {
              id: item.id,
              title: item.title,
              slug: item.slug,
              description: item.description,
              category: item.category,
              quizData: item.quizData,
              createdAt: item.createdAt, // Mappa createdAt
            };
          }
          return undefined; // Quiz non trovato
        })
      );
  }

  /**
   * Recupera gli ultimi N quiz.
   * @param count Il numero di quiz più recenti da recuperare.
   * @returns Un Observable di una lista di oggetti Quiz.
   */
  getLatestQuizzes(count: number): Observable<Quiz[]> {
    let params = new HttpParams()
      .set('pagination[limit]', count.toString())
      .set('sort', 'createdAt:desc'); // Ordina per data di creazione decrescente

    return this.http
      .get<StrapiListQuizResponse>(this.quizzesBaseUrl, { params })
      .pipe(
        map((response) => {
          return response.data.map((item) => ({
            id: item.id,
            title: item.title,
            slug: item.slug,
            description: item.description,
            category: item.category,
            quizData: item.quizData,
            createdAt: item.createdAt,
          }));
        })
      );
  }
}
