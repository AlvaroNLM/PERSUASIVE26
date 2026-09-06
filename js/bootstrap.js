// A classic script can report module-loading failures, including file:// CORS.
// The study itself still runs as ES modules; no experiment content is duplicated here.
(() => {
  const appURL = new URL('./app.js', document.currentScript.src);
  function fail(error) {
    console.error('Study initialization failed:', error);
    const main = document.querySelector('#main');
    if (!main) return;
    main.replaceChildren();
    const title = document.createElement('h1');
    title.textContent = 'Unable to open the study';
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = location.protocol === 'file:'
      ? 'Please open this study through a web server, not directly as a file. Run python3 -m http.server 8000 in the project folder and open http://localhost:8000.'
      : 'A required application file could not be loaded. Please check your connection and retry. If this continues, contact the researcher.';
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.onclick = () => location.reload();
    main.append(title, message, retry);
    main.focus();
  }
  async function start() {
    try {
      if (location.protocol === 'file:') throw new Error('ES modules require HTTP(S); file:// has an opaque origin.');
      const app = await import(appURL.href);
      await app.initialize();
    } catch (error) { fail(error); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
