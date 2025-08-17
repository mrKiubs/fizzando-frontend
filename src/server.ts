import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine, isMainModule } from '@angular/ssr/node';
import express from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bootstrap from './main.server';

// (opzionale ma consigliato) gzip
// npm i compression
// import compression from 'compression';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html');

const app = express();
const commonEngine = new CommonEngine();

// Se usi compression, abilitala qui
// app.use(compression());

// Siamo dietro proxy (Railway), così req.protocol/host sono corretti
app.set('trust proxy', 1);

// Servi file statici ma **senza** index di default, così non bypassi SSR
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false, // <— fondamentale: non rispondere con index.html
  })
);

// Healthcheck semplice
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

/**
 * Tutte le altre richieste renderizzano via SSR.
 */
app.get('*', (req, res, next) => {
  // Recupera protocollo/host corretti anche dietro proxy
  const xfProto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0];
  const xfHost = (req.headers['x-forwarded-host'] as string)?.split(',')[0];

  const protocol = xfProto || req.protocol;
  const host = xfHost || req.headers.host;

  const absoluteUrl = `${protocol}://${host}${req.originalUrl}`;

  // Evita caching dell'HTML SSR (gli asset statici sono già cache-ati 1y sopra)
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

// Error handler minimale
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
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export default app;
