import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine, isMainModule } from '@angular/ssr/node';
import express from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bootstrap from './main.server';

// opzionale ma consigliato: gzip
// import compression from 'compression';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html');

const app = express();
const commonEngine = new CommonEngine();

app.set('trust proxy', 1);

// if you enable it: app.use(compression());

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
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
  })
);

// 4) SSR catch-all (dopo robots/static)
app.get('*', (req, res, next) => {
  const xfProto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0];
  const xfHost = (req.headers['x-forwarded-host'] as string)?.split(',')[0];
  const protocol = xfProto || req.protocol;
  const host = xfHost || req.headers.host;
  const absoluteUrl = `${protocol}://${host}${req.originalUrl}`;

  // niente cache per l’HTML SSR
  res.setHeader('Cache-Control', 'no-store');

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
});

// error handler
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(500).send('Server error');
  }
);

if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port as number, '0.0.0.0', () => {
    console.log(`SSR listening on http://0.0.0.0:${port}`);
  });
}

// export per Angular SSR adapter
export default app;
