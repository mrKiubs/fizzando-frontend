import { ApplicationConfig, ErrorHandler } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import {
  provideClientHydration,
  withEventReplay,
  withHttpTransferCacheOptions,
} from '@angular/platform-browser';

import { MatIconRegistry } from '@angular/material/icon';
import { DOCUMENT } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes,
      withInMemoryScrolling({
        scrollPositionRestoration: 'disabled',
        anchorScrolling: 'enabled',
      })
    ),
    provideHttpClient(withFetch()),
    provideClientHydration(withEventReplay(), withHttpTransferCacheOptions({})),
    provideAnimations(),

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
        // Default font set (per <mat-icon>menu</mat-icon> o fontIcon="menu")
        reg.setDefaultFontSetClass('material-icons');

        // SOLO lato client puoi caricare sprite SVG (se lo usi davvero).
        // Assicurati che 'assets/icons/mdi.svg' esista e contenga i simboli richiesti.
        reg.addSvgIconSet(
          sanitizer.bypassSecurityTrustResourceUrl('assets/icons/mdi.svg')
        );

        return reg;
      },
      deps: [HttpClient, DomSanitizer, DOCUMENT, ErrorHandler],
    },
  ],
};
