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
