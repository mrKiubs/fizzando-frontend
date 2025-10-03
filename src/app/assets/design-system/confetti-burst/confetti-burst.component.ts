import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Inject,
  Input,
  NgZone,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-confetti-burst',
  standalone: true,
  template: `<canvas
    #canvas
    class="confetti-canvas"
    aria-hidden="true"
  ></canvas>`,
  styles: [
    `
      :host {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 3;
        contain: layout paint size;
      }
      .confetti-canvas {
        width: 100%;
        height: 100%;
        display: block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfettiBurstComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true })
  canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() triggerOnInit = false;
  @Input() particleCount = 160;
  @Input() duration = 2000;
  @Input() gravity = 0.6;
  @Input() drift = 0.4;
  @Input() spreadDeg = 80;
  @Input() startPower = 10;
  @Input() colors = [
    '#FF6B6B',
    '#FFD93D',
    '#6BCB77',
    '#4D96FF',
    '#B983FF',
    '#FFD93D',
  ];

  // ➕ nuovi @Input per tuning
  @Input() maxDpr = 2; // cap del devicePixelRatio
  @Input() highDprParticleScale = 0.7; // moltiplicatore particelle su DPR > 1.5
  @Input() reducedMotionParticleScale = 0.5; // moltiplicatore se reduced motion
  @Input() minParticleCount = 60; // non scendere sotto questa soglia

  private isBrowser = false;
  private ctx!: CanvasRenderingContext2D;
  private dpr = 1;
  private rafId: number | null = null;
  private resizeObs?: ResizeObserver;

  constructor(private zone: NgZone, @Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    const rawDpr = Math.max(1, window.devicePixelRatio || 1);
    this.dpr = Math.min(this.maxDpr, rawDpr);

    const ctx = this.canvasRef.nativeElement.getContext('2d');
    if (!ctx) return; // guard extra
    this.ctx = ctx;

    const parent =
      this.canvasRef.nativeElement.parentElement ??
      this.canvasRef.nativeElement;
    const rect = parent.getBoundingClientRect();
    this.canvasRef.nativeElement.width = Math.max(
      1,
      Math.floor(rect.width * this.dpr)
    );
    this.canvasRef.nativeElement.height = Math.max(
      1,
      Math.floor(rect.height * this.dpr)
    );

    // 🔹 ResizeObserver (opzionale, ma utile)
    if ('ResizeObserver' in window) {
      this.resizeObs = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const box = entry.contentRect;
          this.canvasRef.nativeElement.width = Math.max(
            1,
            Math.floor(box.width * this.dpr)
          );
          this.canvasRef.nativeElement.height = Math.max(
            1,
            Math.floor(box.height * this.dpr)
          );
        }
      });
      this.resizeObs.observe(parent);
    }

    if (this.triggerOnInit) setTimeout(() => this.burst(), 120);
  }

  ngOnDestroy(): void {
    if (this.rafId != null && this.isBrowser) cancelAnimationFrame(this.rafId);
    if (this.resizeObs) this.resizeObs.disconnect(); // opzionale
  }

  public burst(origin: 'center' | 'top' | 'bottom' = 'center') {
    if (!this.isBrowser) return;
    const c = this.canvasRef.nativeElement;
    const { width, height } = c;
    const x0 = width / 2;
    // se vuoi fisso in basso, ok così; altrimenti ripristina la logica origin
    const y0 = height * 0.95;
    this.zone.runOutsideAngular(() => this.runAnimation(x0, y0));
  }

  private runAnimation(x0: number, y0: number) {
    const ctx = this.ctx;
    const c = this.canvasRef.nativeElement;
    const end = (performance.now?.() ?? Date.now()) + this.duration;

    const spread = (this.spreadDeg * Math.PI) / 180;
    const base = -Math.PI / 2;

    // ✅ calcola UNA SOLA VOLTA fuori dall'Array.from
    const prefersReduced =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    const highDpr = this.dpr > 1.5;

    let effectiveCount = this.particleCount;
    if (highDpr) {
      effectiveCount = Math.floor(effectiveCount * this.highDprParticleScale);
    }
    if (prefersReduced) {
      effectiveCount = Math.floor(
        effectiveCount * this.reducedMotionParticleScale
      );
    }
    effectiveCount = Math.max(this.minParticleCount, effectiveCount);

    // ✅ usa effectiveCount come length
    const parts = Array.from({ length: effectiveCount }, () => {
      const a = base + (Math.random() - 0.5) * spread;
      const s = (Math.random() * 0.5 + 0.75) * this.startPower;
      return {
        x: x0,
        y: y0,
        vx: Math.cos(a) * s + (Math.random() - 0.5) * this.drift,
        vy: Math.sin(a) * s,
        size: Math.random() * 6 + 4,
        rot: Math.random() * Math.PI,
        rotSpeed: (Math.random() - 0.5) * 0.2,
        color: this.colors[(Math.random() * this.colors.length) | 0],
        tilt: Math.random() * Math.PI,
        tiltSpeed: (Math.random() - 0.5) * 0.3,
        alpha: 1,
      };
    });

    const step = () => {
      const now = performance.now?.() ?? Date.now();
      const progress = 1 - Math.max(0, end - now) / this.duration;
      ctx.clearRect(0, 0, c.width, c.height);

      for (const p of parts) {
        p.vy += this.gravity * 0.3;
        p.x += p.vx * this.dpr;
        p.y += p.vy * this.dpr;
        p.rot += p.rotSpeed;
        p.tilt += p.tiltSpeed;
        if (progress > 0.7) p.alpha = Math.max(0, 1 - (progress - 0.7) / 0.3);

        // 🔹 clipping leggero (opzionale) per ridurre overdraw
        if (p.y < -40 * this.dpr || p.y > c.height + 80 * this.dpr) {
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const w = p.size * (0.6 + Math.abs(Math.cos(p.tilt)) * 0.8);
        const h = p.size * (0.6 + Math.abs(Math.sin(p.tilt)) * 0.8);
        ctx.fillStyle = p.color;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
      }

      const alive = parts.some(
        (p) => p.alpha > 0 && p.y < c.height + 40 * this.dpr
      );
      if (now < end && alive) {
        this.rafId = requestAnimationFrame(step);
      } else {
        ctx.clearRect(0, 0, c.width, c.height);
        this.rafId = null;
      }
    };

    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(step);
  }
}
