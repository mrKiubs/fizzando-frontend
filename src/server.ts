// server.ts
import { APP_BASE_HREF } from '@angular/common';
import compression from 'compression';
import { CommonEngine, isMainModule } from '@angular/ssr/node';
import express, { Request, Response, NextFunction } from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
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
type CacheEntry = { html: string; expires: number; etag: string };
const htmlCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();

const CACHE_TTL_MS = Number(process.env['SSR_CACHE_TTL_MS'] ?? 60_000); // 60s
const CACHE_MAX_ENTRIES = Number(process.env['SSR_CACHE_MAX'] ?? 300);

// ignora parametri di tracking nella cache key
const IGNORED_QUERY_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'ref',
  'ref_src',
]);

function normalizeCacheKey(req: Request): string {
  try {
    const url = new URL(
      req.protocol + '://' + (req.headers.host || 'localhost') + req.originalUrl
    );
    const params = url.searchParams;
    // rimuovi tracking
    IGNORED_QUERY_KEYS.forEach((k) => params.delete(k));
    // ordina params → chiave stabile
    const ordered = new URLSearchParams();
    Array.from(params.keys())
      .sort()
      .forEach((k) => ordered.append(k, params.get(k)!));
    return (
      url.pathname + (ordered.toString() ? '?' + ordered.toString() : '')
    ).toLowerCase();
  } catch {
    return (req.originalUrl || '/').toLowerCase();
  }
}

function evictOneIfNeeded(): void {
  if (htmlCache.size < CACHE_MAX_ENTRIES) return;
  const first = htmlCache.keys().next();
  if (!first.done) htmlCache.delete(first.value as string);
}

function isCacheablePath(pathname: string): boolean {
  // pagine stabili e “al centro” del funnel: home, liste, detail
  return (
    pathname === '/' ||
    pathname.startsWith('/cocktails') || // liste + /cocktails/*
    pathname.startsWith('/ingredients') || // liste + /ingredients/*
    pathname.startsWith('/glossary') || // liste + /glossary/*
    pathname.startsWith('/find-cocktail') || // anche la finder (se SSR non dipende da user input)
    pathname.startsWith('/about') || // eventuali pag statiche
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/terms')
  );
}

function etagFromHtml(html: string): string {
  // weak ETag, sufficiente per 304/conditional
  const hash = crypto
    .createHash('sha1')
    .update(html)
    .digest('hex')
    .slice(0, 12);
  return `W/"${html.length.toString(16)}-${hash}"`;
}

/* ============== SSR CATCH-ALL ============== */
app.get('*', (req: Request, res: Response, next: NextFunction): void => {
  const t0 = Date.now();
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

    // Riduci la frammentazione della cache
    const cacheKey = normalizeCacheKey(req);

    // Header comuni
    res.setHeader('Vary', 'Accept-Encoding'); // utile per proxy/edge
    if (cacheable) {
      // friendly per CDN (Cloudflare legge Cache-Control)
      res.setHeader(
        'Cache-Control',
        'public, max-age=0, s-maxage=300, stale-while-revalidate=60'
      );
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

    if (cacheable) {
      const now = Date.now();
      const cached = htmlCache.get(cacheKey);

      if (cached && cached.expires > now) {
        res.setHeader('ETag', cached.etag);
        // Conditional (304) se client/edge ha etag
        if (req.headers['if-none-match'] === cached.etag) {
          res.status(304).end();
          res.setHeader(
            'Server-Timing',
            `ssr;dur=${Date.now() - t0};desc="HIT-304"`
          );
          return;
        }
        res.setHeader('x-ssr-cache', 'HIT');
        res.setHeader('Server-Timing', `ssr;dur=${Date.now() - t0};desc="HIT"`);
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
            const etag = etagFromHtml(html);
            evictOneIfNeeded();
            htmlCache.set(cacheKey, {
              html,
              etag,
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

      p.then((html) => {
        res.setHeader('ETag', etagFromHtml(html));
        res.setHeader(
          'Server-Timing',
          `ssr;dur=${Date.now() - t0};desc="MISS"`
        );
        res.send(html);
      }).catch((err) => next(err));
      return;
    }

    // NON cacheabile → render diretto
    commonEngine
      .render({
        bootstrap,
        documentFilePath: indexHtml,
        url: absoluteUrl,
        publicPath: browserDistFolder,
        providers: [{ provide: APP_BASE_HREF, useValue: req.baseUrl }],
      })
      .then((html) => {
        res.setHeader('ETag', etagFromHtml(html));
        res.setHeader(
          'Server-Timing',
          `ssr;dur=${Date.now() - t0};desc="BYPASS"`
        );
        res.send(html);
      })
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
