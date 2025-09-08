import { APP_BASE_HREF } from '@angular/common';
import compression from 'compression';
import { CommonEngine, isMainModule } from '@angular/ssr/node';
import express, { Request, Response, NextFunction } from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bootstrap from './main.server';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html');

const app = express();
const commonEngine = new CommonEngine();

app.set('trust proxy', 1);

// gzip
app.use(compression());

// 1) NOINDEX su dominio di staging (deve stare in alto)
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  if (host.includes('.up.railway.app')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

// 2) robots.txt dinamico (prima del catch-all)
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

// opzionale: healthcheck
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

// 3) static (ok senza index, così non salti l’SSR)
//    con cache policy: hashed => 1y immutable, svg non hashati => 1h, altri asset non hashati => 7d, fallback 1h
app.use(
  express.static(browserDistFolder, {
    index: false,
    setHeaders: (res, filePath) => {
      const isHashed = /\.[0-9a-f]{8,}\./i.test(filePath);

      if (isHashed) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }

      if (filePath.endsWith('.svg')) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      } else if (filePath.startsWith(browserDistFolder + '/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  })
);

/* ---------------------- MICRO-CACHE SSR SOLO PER COCKTAILS ---------------------- */

type CacheEntry = { html: string; expires: number };
const htmlCache = new Map<string, CacheEntry>();

const CACHE_TTL_MS = Number(process.env['SSR_CACHE_TTL_MS'] ?? 60_000); // default 60s
const CACHE_MAX_ENTRIES = Number(process.env['SSR_CACHE_MAX'] ?? 200);

function evictOneIfNeeded() {
  if (htmlCache.size < CACHE_MAX_ENTRIES) return;
  const first = htmlCache.keys().next();
  if (!first.done) {
    const key = first.value as string;
    htmlCache.delete(key);
  }
}

/* ---------------------- SSR catch-all (dopo robots/static) ---------------------- */

const inFlight = new Map<string, Promise<string>>();

app.get('*', (req: Request, res: Response, next: NextFunction) => {
  try {
    const xfProto = (
      req.headers['x-forwarded-proto'] as string | undefined
    )?.split(',')[0];
    const xfHost = (
      req.headers['x-forwarded-host'] as string | undefined
    )?.split(',')[0];
    const protocol = xfProto || req.protocol;
    const host = xfHost || req.headers.host || 'localhost';
    const absoluteUrl = `${protocol}://${host}${req.originalUrl}`;

    // niente cache per l’HTML SSR (browser side)
    res.setHeader('Cache-Control', 'no-store');

    const pathOnly = req.path || '/';
    const isCocktailDetail =
      req.method === 'GET' && pathOnly.startsWith('/cocktails/');

    // Chiave cache normalizzata: solo path+query, niente host/protocol, lowercase
    const cacheKey = (req.originalUrl || '/').toLowerCase();

    if (isCocktailDetail) {
      const now = Date.now();
      const cached = htmlCache.get(cacheKey);
      if (cached && cached.expires > now) {
        res.setHeader('x-ssr-cache', 'HIT');
        res.send(cached.html);
        return;
      }
      res.setHeader('x-ssr-cache', cached ? 'STALE' : 'MISS');

      // Deduplica render concorrenti per la stessa chiave
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

      p.then((html) => res.send(html)).catch((err) => next(err));
      return;
    }

    // Non cacheabile: render normale
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
  } catch (e) {
    next(e);
  }
});

// error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).send('Server error');
});

if (isMainModule(import.meta.url)) {
  const port = Number(process.env['PORT'] || 4000);
  app.listen(port, '0.0.0.0', () => {
    //console.log(`SSR listening on http://0.0.0.0:${port}`);
  });
}

// export per Angular SSR adapter
export default app;
