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

// 👇 per leggere la sprite in SSR (no fetch)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  provideClientHydration,
  withHttpTransferCacheOptions,
} from '@angular/platform-browser';

export const config: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    provideClientHydration(withHttpTransferCacheOptions({})),
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

        // ✅ Ligature Material (per <mat-icon aria-hidden="true">menu</mat-icon>, ecc.)
        reg.setDefaultFontSetClass('material-icons');
        reg.registerFontClassAlias('material-icons-outlined', 'material-icons');
        reg.registerFontClassAlias('material-icons-round', 'material-icons');
        reg.registerFontClassAlias(
          'material-symbols-outlined',
          'material-icons'
        );

        // ✅ Sprite SVG caricata IN-LITERAL (niente HTTP in SSR)
        const candidates = [
          join(process.cwd(), 'src/assets/icons/mdi.svg'),
          join(process.cwd(), 'src/assets/icon/mdi.svg'),
          join(process.cwd(), 'src/app/assets/icons/mdi.svg'),
          join(process.cwd(), 'src/app/assets/icon/mdi.svg'),
          join(process.cwd(), 'dist/browser/assets/icons/mdi.svg'),
          join(process.cwd(), 'dist/browser/assets/icon/mdi.svg'),
        ];
        const spritePath = candidates.find((p) => existsSync(p));
        if (spritePath) {
          const sprite = readFileSync(spritePath, 'utf8');
          reg.addSvgIconSetLiteral(sanitizer.bypassSecurityTrustHtml(sprite));
        } else {
          console.warn('⚠️ [SSR] mdi.svg non trovata: controlla il percorso.');
        }

        return reg;
      },
      deps: [HttpClient, DomSanitizer, DOCUMENT, ErrorHandler],
    },
  ],
};
