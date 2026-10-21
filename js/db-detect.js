/** Detect whether TMS runs against the Node server or browser IndexedDB. */

let networkUnavailable = false;

export async function detectMode() {
  // Recheck on every load: a temporary server outage must not leave the tab
  // stuck on a separate browser database after the server is available again.
  let mode = 'idb';
  networkUnavailable = false;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch('/api/accounts', {
      method: 'HEAD', signal: ctrl.signal, cache: 'no-store',
    });
    if (res.ok) mode = 'http';
  } catch {
    mode = 'idb';
    networkUnavailable = true;
  } finally {
    clearTimeout(timeout);
  }

  sessionStorage.setItem('tms-mode', mode);
  return mode;
}

export async function createAdapter() {
  let mode;
  if (sessionStorage.getItem('tms-browser-choice') === '1') mode = 'idb';
  else {
    mode = await detectMode();
    let expectedServer = false;
    try { expectedServer = localStorage.getItem('tms-known-server') === '1'; } catch {}
    const localServerPort = typeof location !== 'undefined' && ['3000', '3001'].includes(location.port);
    if (mode === 'idb' && (expectedServer || (networkUnavailable && localServerPort))) {
      const error = new Error('Your saved workspace is unavailable. Retry the connection, or explicitly open the separate browser copy.');
      error.code = 'SERVER_UNAVAILABLE';
      throw error;
    }
  }

  if (mode === 'http') {
    try { localStorage.setItem('tms-known-server', '1'); } catch {}
    const { httpAdapter: adapter } = await import('./db-http.js');
    return { adapter, mode };
  }

  const { idbAdapter: adapter } = await import('./db-idb.js');
  return { adapter, mode };
}
