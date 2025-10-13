// server.ts
import { APP_BASE_HREF } from '@angular/common';
import compression from 'compression';
import { CommonEngine, isMainModule } from '@angular/ssr/node';
import express, { Request, Response, NextFunction } from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bootstrap from './main.server';

/* ================== PATHS ================== */
const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html');

/* ================== APP ================== */
const app = express();
const commonEngine = new CommonEngine();

app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ================== MIDDLEWARE GLOBALI ================== */

// Gzip
app.use(compression());

// NOINDEX su dominio Railway (staging)
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  if (host.includes('.up.railway.app')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

// /robots.txt dinamico
app.get('/robots.txt', (req, res) => {
  const host = (req.headers.host || '').toLowerCase();
  if (host.includes('.up.railway.app')) {
    res.type('text/plain').send('User-agent: *\nDisallow: /');
  } else {
    res
      .type('text/plain')
      .send(
        'User-agent: *\nAllow: /\nSitemap: https://www.fizzando.com/sitemap.xml'
      );
  }
});

// Health check
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

/* ================== STATICI (no index) ================== */
// Cache policy:
// - file con hash nel nome (js/css/font/img) -> 1 anno + immutable
// - svg non hashati -> 1h
// - assets/ non hashati -> 7d
// - fallback -> 1h
app.use(
  express.static(browserDistFolder, {
    index: false,
    setHeaders: (res, filePath) => {
      const isHashed =
        /(?:-|\.)([A-Za-z0-9_-]{8,})\.(?:js|css|woff2|webp|png|jpe?g|svg)$/i.test(
          filePath
        );

      if (isHashed) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }

      if (filePath.endsWith('.svg')) {
        res.setHeader('Cache-Control', 'public, max-age=3600'); // 1h
      } else if (filePath.startsWith(browserDistFolder + '/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=604800'); // 7d
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600'); // 1h
      }
    },
  })
);

/* ================== MICRO-CACHE SSR ================== */
type CacheEntry = { html: string; expires: number };
const htmlCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();

const CACHE_TTL_MS = Number(process.env['SSR_CACHE_TTL_MS'] ?? 60_000); // 60s
const CACHE_MAX_ENTRIES = Number(process.env['SSR_CACHE_MAX'] ?? 300);

function evictOneIfNeeded(): void {
  if (htmlCache.size < CACHE_MAX_ENTRIES) return;
  const first = htmlCache.keys().next();
  if (!first.done) htmlCache.delete(first.value as string);
}

function isCacheablePath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname.startsWith('/cocktails') ||
    pathname.startsWith('/ingredients') ||
    pathname.startsWith('/glossary')
  );
}

/* ============== SSR CATCH-ALL ============== */
app.get('*', (req: Request, res: Response, next: NextFunction): void => {
  try {
    // URL assoluto per Angular SSR
    const xfProto = (
      req.headers['x-forwarded-proto'] as string | undefined
    )?.split(',')[0];
    const xfHost = (
      req.headers['x-forwarded-host'] as string | undefined
    )?.split(',')[0];
    const protocol = xfProto || req.protocol;
    const host = xfHost || req.headers.host || 'localhost';
    const absoluteUrl = `${protocol}://${host}${req.originalUrl}`;

    const pathOnly = req.path || '/';
    const cacheable = isCacheablePath(pathOnly);

    // Header per CDN/edge
    if (cacheable) {
      res.setHeader(
        'Cache-Control',
        'public, max-age=0, s-maxage=300, stale-while-revalidate=60'
      );
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

    const cacheKey = (req.originalUrl || '/').toLowerCase();

    if (cacheable) {
      const now = Date.now();
      const cached = htmlCache.get(cacheKey);
      if (cached && cached.expires > now) {
        res.setHeader('x-ssr-cache', 'HIT');
        res.send(cached.html);
        return;
      }
      res.setHeader('x-ssr-cache', cached ? 'STALE' : 'MISS');

      let p = inFlight.get(cacheKey);
      if (!p) {
        p = commonEngine
          .render({
            bootstrap,
            documentFilePath: indexHtml,
            url: absoluteUrl,
            publicPath: browserDistFolder,
            providers: [{ provide: APP_BASE_HREF, useValue: req.baseUrl }],
          })
          .then((html) => {
            evictOneIfNeeded();
            htmlCache.set(cacheKey, {
              html,
              expires: Date.now() + CACHE_TTL_MS,
            });
            inFlight.delete(cacheKey);
            return html;
          })
          .catch((err) => {
            inFlight.delete(cacheKey);
            throw err;
          });
        inFlight.set(cacheKey, p);
      }

      // NON ritorno la Promise → chiudo sempre con void
      p.then((html) => res.send(html)).catch((err) => next(err));
      return;
    }

    // NON cacheabile → render diretto (senza ritornare la Promise)
    commonEngine
      .render({
        bootstrap,
        documentFilePath: indexHtml,
        url: absoluteUrl,
        publicPath: browserDistFolder,
        providers: [{ provide: APP_BASE_HREF, useValue: req.baseUrl }],
      })
      .then((html) => res.send(html))
      .catch((err) => next(err));
    return;
  } catch (e) {
    next(e as any);
    return;
  }
});

/* ============== ERROR HANDLER ============== */
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).send('Server error');
});

/* ============== AVVIO SERVER ============== */
if (isMainModule(import.meta.url)) {
  const port = Number(process.env['PORT'] || 4000);
  app.listen(port, '0.0.0.0', () => {
    // console.log(`SSR listening on http://0.0.0.0:${port}`);
  });
}

// export per Angular SSR adapter
export default app;
