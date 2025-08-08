import { ApplicationConfig, ErrorHandler } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { MatIconRegistry } from '@angular/material/icon'; // <-- Rimosso provideIcons dall'import
import { DomSanitizer } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';

import { routes } from './app.routes';
import { provideAnimations } from '@angular/platform-browser/animations';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideAnimations(),
    {
      provide: MatIconRegistry,
      useFactory: (
        httpClient: HttpClient,
        sanitizer: DomSanitizer,
        document: Document,
        errorHandler: ErrorHandler
      ) => {
        const matIconRegistry = new MatIconRegistry(
          httpClient,
          sanitizer,
          document,
          errorHandler
        );
        matIconRegistry.addSvgIconSet(
          sanitizer.bypassSecurityTrustResourceUrl('assets/icons/mdi.svg')
        );
        return matIconRegistry;
      },
      deps: [HttpClient, DomSanitizer, DOCUMENT, ErrorHandler],
    },
    // provideIcons([]) <-- Questa riga è stata rimossa perché non più esportata o necessaria
  ],
};
