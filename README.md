# Penciones

Sistema web para calcular escenarios de Modalidad 40 del IMSS, guardar historial y generar PDFs.

## Arranque local

```bash
npm install
cp .env.example .env
npm run dev
```

Credenciales iniciales por defecto:

- Usuario: `admin`
- Password: `admin123`

Cambia `ADMIN_PASSWORD` y `COOKIE_SECRET` antes de usarlo con datos reales.

## Cloud Run

La app escucha `PORT` y `HOST`, por lo que puede ejecutarse en Cloud Run. Para persistencia real en Cloud Run, monta un volumen o migra la capa `src/db.js` a Cloud SQL, porque el filesystem del contenedor no debe considerarse persistente.

## Vercel

La app incluye `api/index.js` y `vercel.json` para correr Fastify como Vercel Function. Antes de desplegar configura estas variables:

- `COOKIE_SECRET`: secreto largo para cookies.
- `ADMIN_USER`: usuario administrador inicial, opcional; por defecto `admin`.
- `ADMIN_PASSWORD`: obligatorio en Vercel.
- `COOKIE_SECURE`: opcional. Usa `true` para forzar cookies solo por HTTPS o `false` para permitir HTTP en despliegues internos/proxy. Si no se define, la app lo detecta con `x-forwarded-proto`.

Si no configuras `DATABASE_PATH`, Vercel usa `/tmp/penciones.sqlite`. Eso permite arrancar la app, pero el almacenamiento es efimero y puede perder historial entre cold starts o despliegues. Para producción real conviene migrar `src/db.js` a una base externa como Turso, Neon o Supabase.
