import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateModality40 } from './calc.js';
import { buildCalculationPdf } from './pdf.js';
import { cleanupSessions, createSession, deleteSession, getSessionUser, openDatabase } from './db.js';
import { dashboardView, detailView, editCalculationView, loginView } from './views.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export async function buildApp() {
  validateRuntimeConfig();

  const dbPath = resolveDatabasePath();
  const db = openDatabase(dbPath);
  cleanupSessions(db);

  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET || 'dev-secret-change-me',
    hook: 'onRequest'
  });
  await app.register(formbody);
  await app.register(fastifyStatic, {
    root: path.join(rootDir, 'public'),
    prefix: '/public/'
  });

  app.addHook('preHandler', async (request) => {
    const token = request.cookies.session;
    request.user = getSessionUser(db, token);
  });

  function requireAuth(request, reply, done) {
    if (!request.user) {
      reply.redirect('/login');
      return;
    }
    done();
  }

  app.get('/healthz', async () => ({
    ok: true,
    storage: process.env.VERCEL && !process.env.DATABASE_PATH ? 'ephemeral-sqlite' : 'sqlite',
    databasePath: dbPath
  }));

  app.get('/login', async (request, reply) => {
    if (request.user) return reply.redirect('/');
    return reply.type('text/html').send(loginView({ error: request.query.error }));
  });

  app.post('/login', async (request, reply) => {
    const { username, password } = request.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      return reply.redirect('/login?error=Usuario%20o%20contrase%C3%B1a%20incorrectos');
    }

    const session = createSession(db, user.id);
    reply.setCookie('session', session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      signed: false,
      secure: process.env.NODE_ENV === 'production',
      expires: new Date(session.expiresAt)
    });
    return reply.redirect('/');
  });

  app.get('/logout', async (request, reply) => {
    deleteSession(db, request.cookies.session);
    reply.clearCookie('session', { path: '/' });
    return reply.redirect('/login');
  });

  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    const calculations = db.prepare(`
      SELECT id, customer_name, result_json, current_version, created_at
      FROM calculations
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 50
    `).all(request.user.id);
    return reply.type('text/html').send(dashboardView({ user: request.user, calculations }));
  });

  app.post('/calculations', { preHandler: requireAuth }, async (request, reply) => {
    const payload = calculateModality40(request.body);
    const customerName = payload.input.nombre || 'Sin nombre';
    const result = createCalculationWithVersion(db, request.user.id, customerName, payload);

    return reply.redirect(`/calculations/${result.lastInsertRowid}`);
  });

  app.get('/calculations/:id', { preHandler: requireAuth }, async (request, reply) => {
    const calculation = getCalculationForUser(db, request.params.id, request.user.id);
    if (!calculation) return reply.code(404).send('No encontrado');
    const versions = getVersionsForCalculation(db, calculation.id, request.user.id);
    return reply.type('text/html').send(detailView({ user: request.user, calculation, versions }));
  });

  app.get('/calculations/:id/edit', { preHandler: requireAuth }, async (request, reply) => {
    const calculation = getCalculationForUser(db, request.params.id, request.user.id);
    if (!calculation) return reply.code(404).send('No encontrado');
    return reply.type('text/html').send(editCalculationView({ user: request.user, calculation }));
  });

  app.post('/calculations/:id/update', { preHandler: requireAuth }, async (request, reply) => {
    const calculation = getCalculationForUser(db, request.params.id, request.user.id);
    if (!calculation) return reply.code(404).send('No encontrado');

    const payload = calculateModality40(request.body);
    const customerName = payload.input.nombre || 'Sin nombre';
    const nextVersion = (calculation.current_version || 1) + 1;

    db.transaction(() => {
      db.prepare(`
        UPDATE calculations
        SET customer_name = ?,
            nss = ?,
            engine_version = ?,
            input_json = ?,
            result_json = ?,
            notes = ?,
            current_version = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).run(
        customerName,
        payload.input.nss,
        payload.version,
        JSON.stringify(payload.input),
        JSON.stringify(payload),
        payload.input.notas,
        nextVersion,
        calculation.id,
        request.user.id
      );

      insertCalculationVersion(db, {
        calculationId: calculation.id,
        versionNumber: nextVersion,
        userId: request.user.id,
        customerName,
        payload
      });
    })();

    return reply.redirect(`/calculations/${calculation.id}`);
  });

  app.get('/calculations/:id/pdf', { preHandler: requireAuth }, async (request, reply) => {
    const calculation = getCalculationForUser(db, request.params.id, request.user.id);
    if (!calculation) return reply.code(404).send('No encontrado');
    const buffer = await buildCalculationPdf(calculation);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="modalidad40-${calculation.id}.pdf"`)
      .send(buffer);
  });

  return { app, dbPath };
}

export function resolveDatabasePath() {
  if (process.env.DATABASE_PATH) return path.resolve(process.env.DATABASE_PATH);
  if (process.env.VERCEL) return '/tmp/penciones.sqlite';
  return path.join(rootDir, 'data', 'penciones.sqlite');
}

function validateRuntimeConfig() {
  if (!process.env.VERCEL) return;

  const missing = [];
  if (!process.env.COOKIE_SECRET) missing.push('COOKIE_SECRET');
  if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD');

  if (missing.length) {
    throw new Error(`Missing required Vercel environment variables: ${missing.join(', ')}`);
  }
}

function getCalculationForUser(db, id, userId) {
  return db.prepare(`
    SELECT *
    FROM calculations
    WHERE id = ? AND user_id = ?
  `).get(id, userId);
}

function getVersionsForCalculation(db, id, userId) {
  return db.prepare(`
    SELECT calculation_versions.*
    FROM calculation_versions
    JOIN calculations ON calculations.id = calculation_versions.calculation_id
    WHERE calculation_versions.calculation_id = ? AND calculations.user_id = ?
    ORDER BY calculation_versions.version_number DESC
  `).all(id, userId);
}

function createCalculationWithVersion(db, userId, customerName, payload) {
  return db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO calculations (
        user_id, customer_name, nss, engine_version, input_json, result_json, notes,
        current_version, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).run(
      userId,
      customerName,
      payload.input.nss,
      payload.version,
      JSON.stringify(payload.input),
      JSON.stringify(payload),
      payload.input.notas
    );

    insertCalculationVersion(db, {
      calculationId: result.lastInsertRowid,
      versionNumber: 1,
      userId,
      customerName,
      payload
    });

    return result;
  })();
}

function insertCalculationVersion(db, { calculationId, versionNumber, userId, customerName, payload }) {
  db.prepare(`
    INSERT INTO calculation_versions (
      calculation_id, version_number, user_id, customer_name, nss, engine_version,
      input_json, result_json, notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    calculationId,
    versionNumber,
    userId,
    customerName,
    payload.input.nss,
    payload.version,
    JSON.stringify(payload.input),
    JSON.stringify(payload),
    payload.input.notas
  );
}

if (process.argv.includes('--init-only')) {
  const dbPath = resolveDatabasePath();
  const { app } = await buildApp();
  await app.close();
  console.log(`Database initialized at ${dbPath}`);
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { app } = await buildApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  await app.listen({ port, host });
}
