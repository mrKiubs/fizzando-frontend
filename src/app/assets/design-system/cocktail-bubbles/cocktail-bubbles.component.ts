// src/app/.../cocktail-bubbles.component.ts
import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  inject,
  PLATFORM_ID,
  NgZone,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';

interface Bubble {
  left: number;
  size: number;
  duration: number;
  delay: number;
  spiralAmplitude: number;
}

@Component({
  selector: 'app-cocktail-bubbles',
  standalone: true,
  host: { ngSkipHydration: 'true' },
  templateUrl: './cocktail-bubbles.component.html',
  styleUrls: ['./cocktail-bubbles.component.scss'],
  imports: [CommonModule],
})
export class CocktailBubblesComponent
  implements OnInit, AfterViewInit, OnDestroy
{
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly ngZone = inject(NgZone);

  bubbles: Bubble[] = [];
  private isGenerating = false;
  private currentGenerationInterval: any;
  private currentCycleTimeout: any;
  private currentStopTimeout: any;

  private readonly GENERATION_DURATION_MS = 5000;
  private readonly BUBBLE_SPAWN_RATE_MS = 300;
  private readonly MIN_PAUSE_MS = 25000;
  private readonly MAX_PAUSE_MS = 35000;

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    // Avvia scheduling totalmente fuori da Angular (non blocca isStable)
    this.ngZone.runOutsideAngular(() => {
      this.startGenerationPeriod();
      this.scheduleNextCycle();
    });
  }

  ngOnDestroy(): void {
    if (this.currentGenerationInterval)
      clearInterval(this.currentGenerationInterval);
    if (this.currentCycleTimeout) clearTimeout(this.currentCycleTimeout);
    if (this.currentStopTimeout) clearTimeout(this.currentStopTimeout);
  }

  private getRandomPauseDuration(): number {
    return (
      Math.random() * (this.MAX_PAUSE_MS - this.MIN_PAUSE_MS) +
      this.MIN_PAUSE_MS
    );
  }

  private scheduleNextCycle(): void {
    if (!this.isBrowser) return;
    const pauseBeforeNextCycle = this.getRandomPauseDuration();

    if (this.currentCycleTimeout) clearTimeout(this.currentCycleTimeout);
    this.currentCycleTimeout = setTimeout(() => {
      this.startGenerationPeriod();
      this.scheduleNextCycle();
    }, this.GENERATION_DURATION_MS + pauseBeforeNextCycle);
  }

  private startGenerationPeriod(): void {
    if (!this.isBrowser || this.isGenerating) return;

    this.isGenerating = true;
    this.currentGenerationInterval = setInterval(() => {
      // Rientriamo in Angular solo per aggiornare l’array (trigger change detection)
      this.ngZone.run(() => this.addBubble());
    }, this.BUBBLE_SPAWN_RATE_MS);

    this.currentStopTimeout = setTimeout(() => {
      if (this.isGenerating) this.stopGenerationPeriod();
    }, this.GENERATION_DURATION_MS);
  }

  private stopGenerationPeriod(): void {
    if (!this.isBrowser || !this.isGenerating) return;

    this.isGenerating = false;
    if (this.currentGenerationInterval) {
      clearInterval(this.currentGenerationInterval);
      this.currentGenerationInterval = null;
    }
  }

  private viewportWidth(): number {
    return this.isBrowser ? window.innerWidth : 1200;
  }

  private addBubble(): void {
    if (!this.isBrowser) return;

    const newBubble: Bubble = {
      left: Math.random() * this.viewportWidth(),
      size: Math.random() * (20 - 5) + 5,
      duration: Math.random() * (12 - 8) + 8,
      delay: Math.random() * 3,
      spiralAmplitude: Math.random() * (10 - 3) + 3,
    };

    // Inserimento nello stato: rientro in Angular solo qui
    this.ngZone.run(() => {
      this.bubbles.push(newBubble);
    });

    // ⬇️ Programmo la rimozione COMPLETAMENTE fuori da Angular
    const removeAfter =
      newBubble.duration * 1000 + newBubble.delay * 1000 + 500;
    this.ngZone.runOutsideAngular(() => {
      setTimeout(() => {
        // rientro un attimo in Angular solo per aggiornare l’array
        this.ngZone.run(() => {
          this.bubbles = this.bubbles.filter((b) => b !== newBubble);
        });
      }, removeAfter);
    });
  }
}
