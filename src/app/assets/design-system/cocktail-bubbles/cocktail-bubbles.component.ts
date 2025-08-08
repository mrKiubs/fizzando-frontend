import { Component, OnInit, OnDestroy } from '@angular/core';
import { interval, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CommonModule } from '@angular/common';

interface Bubble {
  left: number;
  size: number;
  duration: number; // Durata dell'animazione in secondi
  delay: number; // Ritardo prima che l'animazione inizi
  spiralAmplitude: number; // Ampiezza della deviazione laterale della spirale
}

@Component({
  selector: 'app-cocktail-bubbles',
  standalone: true,
  templateUrl: './cocktail-bubbles.component.html',
  styleUrls: ['./cocktail-bubbles.component.scss'],
  imports: [CommonModule],
})
export class CocktailBubblesComponent implements OnInit, OnDestroy {
  bubbles: Bubble[] = [];
  private destroy$ = new Subject<void>();
  private isGenerating: boolean = false;
  private currentGenerationInterval: any;
  private currentCycleTimeout: any;

  // Parametri per controllare l'intermittenza
  private readonly GENERATION_DURATION_MS = 5000; // Durata della "raffica" di bollicine (5 secondi)
  private readonly BUBBLE_SPAWN_RATE_MS = 300; // Frequenza di spawn durante la generazione attiva

  // Parametri per la pausa randomica
  private readonly MIN_PAUSE_MS = 25000; // Pausa minima (25 secondi)
  private readonly MAX_PAUSE_MS = 35000; // Pausa massima (35 secondi)

  ngOnInit(): void {
    // 1. Avvia la prima generazione immediatamente all'apertura
    this.startGenerationPeriod();

    // 2. Imposta il timer per avviare il ciclo intermittente randomico
    this.scheduleNextCycle();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.currentGenerationInterval) {
      clearInterval(this.currentGenerationInterval);
    }
    if (this.currentCycleTimeout) {
      clearTimeout(this.currentCycleTimeout);
    }
  }

  /**
   * Genera una pausa randomica tra MIN_PAUSE_MS e MAX_PAUSE_MS.
   * @returns {number} La durata della pausa in millisecondi.
   */
  private getRandomPauseDuration(): number {
    return (
      Math.random() * (this.MAX_PAUSE_MS - this.MIN_PAUSE_MS) +
      this.MIN_PAUSE_MS
    );
  }

  /**
   * Pianifica il prossimo ciclo di generazione delle bollicine.
   */
  private scheduleNextCycle(): void {
    const pauseBeforeNextCycle = this.getRandomPauseDuration();
    console.log(`Prossimo ciclo tra ${pauseBeforeNextCycle / 1000} secondi.`);

    if (this.currentCycleTimeout) {
      clearTimeout(this.currentCycleTimeout);
    }

    this.currentCycleTimeout = setTimeout(() => {
      this.startGenerationPeriod();
      this.scheduleNextCycle();
    }, this.GENERATION_DURATION_MS + pauseBeforeNextCycle);
  }

  // Avvia il periodo di generazione delle bollicine
  private startGenerationPeriod(): void {
    if (this.isGenerating) return;

    console.log('Inizio generazione bollicine...');
    this.isGenerating = true;
    this.currentGenerationInterval = setInterval(() => {
      this.addBubble();
    }, this.BUBBLE_SPAWN_RATE_MS);

    setTimeout(() => {
      if (this.isGenerating) {
        this.stopGenerationPeriod();
      }
    }, this.GENERATION_DURATION_MS);
  }

  // Ferma il periodo di generazione delle bollicine
  private stopGenerationPeriod(): void {
    if (!this.isGenerating) return;

    console.log('Stop generazione bollicine.');
    this.isGenerating = false;
    if (this.currentGenerationInterval) {
      clearInterval(this.currentGenerationInterval);
      this.currentGenerationInterval = null;
    }
  }

  addBubble(): void {
    const newBubble: Bubble = {
      left: Math.random() * window.innerWidth,
      size: Math.random() * (20 - 5) + 5, // Grandezza tra 5px e 20px
      duration: Math.random() * (12 - 8) + 8, // Durata animazione tra 8 e 12 secondi (più lunga per fluidità)
      delay: Math.random() * 3, // Ritardo per farle partire in momenti diversi (0-3 secondi)
      spiralAmplitude: Math.random() * (10 - 3) + 3, // Ampiezza della deviazione laterale tra 3px e 10px (più sottile)
    };
    this.bubbles.push(newBubble);

    // Rimuovi la bollicina dopo la sua animazione + un piccolo buffer
    setTimeout(() => {
      this.bubbles = this.bubbles.filter((bubble) => bubble !== newBubble);
    }, newBubble.duration * 1000 + newBubble.delay * 1000 + 500);
  }
}
