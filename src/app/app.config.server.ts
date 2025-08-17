import { ApplicationConfig, ErrorHandler } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { MatIconRegistry } from '@angular/material/icon';
import { DOCUMENT } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';

export const config: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideNoopAnimations(),

    {
      provide: MatIconRegistry,
      useFactory: (
        http: HttpClient,
        sanitizer: DomSanitizer,
        document: Document,
        errorHandler: ErrorHandler
      ) => {
        const reg = new MatIconRegistry(
          http,
          sanitizer,
          document,
          errorHandler
        );
        // SSR: niente fetch di SVG. Usa le ligatures come default.
        reg.setDefaultFontSetClass('material-icons');
        reg.registerFontClassAlias('material-icons-outlined', 'material-icons');
        reg.registerFontClassAlias('material-icons-round', 'material-icons');
        return reg;
      },
      deps: [HttpClient, DomSanitizer, DOCUMENT, ErrorHandler],
    },
  ],
};
