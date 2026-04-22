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
const dbPath = process.env.DATABASE_PATH || path.join(rootDir, 'data', 'penciones.sqlite');
const db = openDatabase(dbPath);
cleanupSessions(db);

if (process.argv.includes('--init-only')) {
  console.log(`Database initialized at ${dbPath}`);
  process.exit(0);
}

const app = Fastify({ logger: true });

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

app.get('/healthz', async () => ({ ok: true }));

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
  const result = createCalculationWithVersion(request.user.id, customerName, payload);

  return reply.redirect(`/calculations/${result.lastInsertRowid}`);
});

app.get('/calculations/:id', { preHandler: requireAuth }, async (request, reply) => {
  const calculation = getCalculationForUser(request.params.id, request.user.id);
  if (!calculation) return reply.code(404).send('No encontrado');
  const versions = getVersionsForCalculation(calculation.id, request.user.id);
  return reply.type('text/html').send(detailView({ user: request.user, calculation, versions }));
});

app.get('/calculations/:id/edit', { preHandler: requireAuth }, async (request, reply) => {
  const calculation = getCalculationForUser(request.params.id, request.user.id);
  if (!calculation) return reply.code(404).send('No encontrado');
  return reply.type('text/html').send(editCalculationView({ user: request.user, calculation }));
});

app.post('/calculations/:id/update', { preHandler: requireAuth }, async (request, reply) => {
  const calculation = getCalculationForUser(request.params.id, request.user.id);
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

    insertCalculationVersion({
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
  const calculation = getCalculationForUser(request.params.id, request.user.id);
  if (!calculation) return reply.code(404).send('No encontrado');
  const buffer = await buildCalculationPdf(calculation);
  return reply
    .header('content-type', 'application/pdf')
    .header('content-disposition', `inline; filename="modalidad40-${calculation.id}.pdf"`)
    .send(buffer);
});

function getCalculationForUser(id, userId) {
  return db.prepare(`
    SELECT *
    FROM calculations
    WHERE id = ? AND user_id = ?
  `).get(id, userId);
}

function getVersionsForCalculation(id, userId) {
  return db.prepare(`
    SELECT calculation_versions.*
    FROM calculation_versions
    JOIN calculations ON calculations.id = calculation_versions.calculation_id
    WHERE calculation_versions.calculation_id = ? AND calculations.user_id = ?
    ORDER BY calculation_versions.version_number DESC
  `).all(id, userId);
}

function createCalculationWithVersion(userId, customerName, payload) {
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

    insertCalculationVersion({
      calculationId: result.lastInsertRowid,
      versionNumber: 1,
      userId,
      customerName,
      payload
    });

    return result;
  })();
}

function insertCalculationVersion({ calculationId, versionNumber, userId, customerName, payload }) {
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

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
await app.listen({ port, host });
