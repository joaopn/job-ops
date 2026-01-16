/**
 * Express app factory (useful for tests).
 */

import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { apiRouter } from './api/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createBasicAuthGuard() {
  const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER || '';
  const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || '';
  const basicAuthEnabled = BASIC_AUTH_USER.length > 0 && BASIC_AUTH_PASSWORD.length > 0;

  function isAuthorized(req: express.Request): boolean {
    if (!basicAuthEnabled) return false;
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Basic ')) return false;
    const encoded = authHeader.slice('Basic '.length).trim();
    let decoded = '';
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    } catch {
      return false;
    }
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) return false;
    const user = decoded.slice(0, separatorIndex);
    const pass = decoded.slice(separatorIndex + 1);
    return user === BASIC_AUTH_USER && pass === BASIC_AUTH_PASSWORD;
  }

  function isPublicReadOnlyRoute(method: string, path: string): boolean {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = path.split('?')[0] || path;
    if (normalizedMethod === 'POST' && normalizedPath === '/api/ukvisajobs/search') return true;
    if (normalizedMethod === 'POST' && normalizedPath === '/api/visa-sponsors/search') return true;
    return false;
  }

  function requiresAuth(method: string, path: string): boolean {
    if (isPublicReadOnlyRoute(method, path)) return false;
    return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  }

  const middleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!basicAuthEnabled || !requiresAuth(req.method, req.path)) return next();
    if (isAuthorized(req)) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="Job Ops"');
    res.status(401).send('Authentication required');
  };

  return {
    middleware,
    isAuthorized,
    basicAuthEnabled,
  };
}

function injectUmami(html: string): string {
  const snippet =
    '<script defer src="https://umami.dakheera47.com/script.js" data-website-id="0dc42ed1-87c3-4ac0-9409-5a9b9588fe66"></script>';
  if (html.includes(snippet)) return html;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${snippet}\n</head>`);
  }
  return `${html}\n${snippet}`;
}

export function createApp() {
  const app = express();
  const authGuard = createBasicAuthGuard();

  app.use(cors());
  app.use(express.json());

  // Logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    });
    next();
  });

  // Optional Basic Auth for write access (read-only by default)
  app.use(authGuard.middleware);

  // API routes
  app.use('/api', apiRouter);

  // Serve static files for generated PDFs
  const pdfDir = process.env.DATA_DIR
    ? join(process.env.DATA_DIR, 'pdfs')
    : join(__dirname, '../../data/pdfs');
  app.use('/pdfs', express.static(pdfDir));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve client app in production
  if (process.env.NODE_ENV === 'production') {
    const clientDir = join(__dirname, '../../dist/client');
    app.use(express.static(clientDir));

    // SPA fallback
    const indexPath = join(clientDir, 'index.html');
    let cachedIndexHtml: string | null = null;
    app.get('*', async (req, res) => {
      if (!req.accepts('html')) {
        res.status(404).end();
        return;
      }
      if (!cachedIndexHtml) {
        cachedIndexHtml = await readFile(indexPath, 'utf-8');
      }
      const isAuthenticated = authGuard.basicAuthEnabled && authGuard.isAuthorized(req);
      const html = isAuthenticated ? cachedIndexHtml : injectUmami(cachedIndexHtml);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    });
  }

  return app;
}
