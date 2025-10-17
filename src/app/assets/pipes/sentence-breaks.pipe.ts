// src/app/directives/sentence-breaks.directive.ts
import {
  Directive,
  ElementRef,
  Input,
  OnChanges,
  Renderer2,
} from '@angular/core';

@Directive({
  selector: '[sentenceBreaks]',
  standalone: true,
  host: { '[style.white-space]': '"pre-line"' },
})
export class SentenceBreaksDirective implements OnChanges {
  @Input('sentenceBreaks') value: string | null | undefined;

  constructor(private el: ElementRef<HTMLElement>, private r: Renderer2) {}

  ngOnChanges(): void {
    const text = (this.value ?? '').toString();
    const out = this.processMultiline(text);
    this.r.setProperty(this.el.nativeElement, 'textContent', out);
  }

  // Mantiene eventuali newline già presenti: processiamo riga per riga
  private processMultiline(text: string): string {
    return text
      .split('\n')
      .map((line) => this.splitSentencesSafely(line))
      .join('\n');
  }

  private splitSentencesSafely(input: string): string {
    let s = input.trim();
    if (!s) return '';

    // 1) Proteggi acronimi/abbreviazioni sostituendo i "." con un segnaposto
    //    - A.D.M., U.S.A., P.T.O.
    s = s.replace(/\b(?:[A-Z]\.){2,}[A-Z]?/g, (m) => m.replace(/\./g, '§'));
    //    - e.g., i.e., etc.
    s = s.replace(/\b(?:e\.g\.|i\.e\.|etc\.)/gi, (m) => m.replace(/\./g, '§'));

    // 2) Inserisci newline dopo fine frase reale:
    //    ., !, ?, ;, : + spazio + (eventuale apertura virgolette/parentesi) + maiuscola
    s = s.replace(/([.!?;:])\s+(?=(?:["“'(\[]?\s*[A-Z]))/g, '$1\n');

    s = s.replace(/\b(?:e\.g\.|i\.e\.|etc\.|Mr\.|Mrs\.|Dr\.)/gi, (m) =>
      m.replace(/\./g, '§')
    );

    // 3) Ripristina i punti negli acronimi
    s = s.replace(/§/g, '.');

    return s;
  }
}
