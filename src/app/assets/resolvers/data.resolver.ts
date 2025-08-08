// src/app/core/resolvers/data.resolver.ts

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, ResolveFn } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators'; // Importa map se il tuo servizio restituisce un array e hai bisogno del primo elemento

/**
 * Funzione Resolver Generica per recuperare un singolo elemento tramite un parametro della rotta.
 * @param serviceType Il tipo del servizio (es. CocktailService, IngredientService).
 * @param methodName Il nome del metodo nel servizio da chiamare (es. 'getCocktailBySlug', 'getIngredientById').
 * @param paramName Il nome del parametro della rotta da usare per la ricerca (es. 'slug', 'externalId').
 * @returns Una funzione ResolveFn che recupera i dati.
 */
export function dataResolver<T>(
  serviceType: any, // Tipo generico del servizio
  methodName: string, // Nome del metodo da chiamare sul servizio
  paramName: string // Nome del parametro nella rotta (es. ':slug')
): ResolveFn<T | null> {
  return (route: ActivatedRouteSnapshot): Observable<T | null> => {
    const service = inject(serviceType); // Inietta dinamicamente il servizio corretto
    const paramValue = route.paramMap.get(paramName); // Ottieni il valore del parametro dalla rotta

    if (!paramValue) {
      console.warn(
        `Resolver generico: Parametro '${paramName}' non trovato nella rotta.`
      );
      // Qui puoi decidere come gestire l'assenza del parametro, es. reindirizzare
      // inject(Router).navigate(['/404']);
      return of(null); // Restituisce un Observable di null per continuare la navigazione
    }

    // Assicurati che il metodo esista sul servizio e sia una funzione
    const serviceMethod = (service as any)[methodName];
    if (typeof serviceMethod !== 'function') {
      console.error(
        `Resolver generico: Metodo '${methodName}' non trovato o non è una funzione sul servizio fornito.`
      );
      return of(null);
    }

    // Esegui la chiamata al servizio e gestisci gli errori
    return serviceMethod(paramValue).pipe(
      // Se i tuoi servizi restituiscono sempre un singolo oggetto (T), non hai bisogno di `map` qui.
      // Se restituiscono un array e ti serve il primo elemento, allora `map` come nell'esempio di CocktailService.
      // Esempio: map((response: any) => response.data && response.data.length > 0 ? response.data[0] : null),
      catchError((error: any) => {
        console.error(
          `Resolver generico: Errore durante il caricamento dei dati per ${paramName}=${paramValue} usando il metodo ${methodName}:`,
          error
        );
        // Puoi reindirizzare a una pagina di errore qui se necessario
        // inject(Router).navigate(['/error']);
        return of(null); // Ritorna null per permettere la navigazione
      })
    );
  };
}
