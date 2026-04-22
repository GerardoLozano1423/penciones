import { buildApp } from '../src/server.js';

let appPromise;

async function getApp() {
  if (!appPromise) {
    appPromise = buildApp().then(async ({ app }) => {
      await app.ready();
      return app;
    });
  }

  return appPromise;
}

export default async function handler(request, response) {
  const app = await getApp();
  app.server.emit('request', request, response);
}
