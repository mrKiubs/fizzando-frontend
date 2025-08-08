import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'formatAbv', // Il nome che userai nel template HTML
})
export class FormatAbvPipe implements PipeTransform {
  /**
   * Trasforma una stringa di contenuto alcolico rimuovendo la parte decimale
   * (es. "22.5%" diventa "22%", "22.0%" diventa "22%").
   * Mantiene "Non-alcoholic" e formati senza decimali inalterati.
   * @param value La stringa di input (es. "22.0%", "40%", "Non-alcoholic", "15.5%").
   * @returns La stringa formattata (es. "22%", "40%", "Non-alcoholic", "15%").
   */
  transform(value: string | null | undefined): string {
    if (value === null || value === undefined) {
      return ''; // Ritorna una stringa vuota per valori null/undefined
    }

    const stringValue = String(value).trim(); // Assicurati che sia una stringa e rimuovi spazi bianchi

    // Gestisce esplicitamente "Non-alcoholic" (case-insensitive)
    if (stringValue.toLowerCase() === 'non-alcoholic') {
      return 'Non-alcoholic';
    }

    // Usa un'espressione regolare per trovare un numero (interi o decimali) seguito da '%'
    // e cattura solo la parte intera.
    const match = stringValue.match(/^(\d+)(?:\.\d+)?%$/);
    // Spiegazione della RegEx:
    // ^      : Inizio della stringa
    // (\d+)  : Cattura uno o più numeri (questa è la parte intera che vogliamo mantenere)
    // (?:\.\d+)? : Gruppo non catturante opzionale: un punto seguito da uno o più numeri
    // %      : Il simbolo di percentuale
    // $      : Fine della stringa

    if (match && match[1]) {
      // Se l'espressione regolare trova una corrispondenza e cattura la parte intera (match[1]),
      // restituisce solo la parte intera seguita dal simbolo '%'.
      return `${match[1]}%`;
    }

    // Se la stringa non corrisponde al formato numerico con percentuale (es. "40%", "test", ecc.),
    // restituisce il valore originale come fallback.
    return stringValue;
  }
}
