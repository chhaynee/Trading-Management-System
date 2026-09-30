/**
 * WSL/Windows compatibility hook.
 *
 * The project's node_modules lives on the Windows NTFS filesystem (/mnt/z/).
 * When running tests from WSL, the Windows-compiled better-sqlite3 native
 * module (PE32+ DLL) cannot be loaded by the Linux Node runtime.
 *
 * This preload hook redirects require('better-sqlite3') to a Linux-native
 * copy installed at /tmp/tms-server-linux/node_modules/better-sqlite3.
 *
 * Setup (one-time, run from repo root):
 *   mkdir -p /tmp/tms-server-linux
 *   cp server/package.json /tmp/tms-server-linux/
 *   cd /tmp/tms-server-linux && npm install
 *
 * Only needed for that WSL + Windows-drive setup; Docker and native installs
 * use plain `npm test`.
 *
 * Usage: cd server && npm run test:wsl
 */

const Module = require('module');
const path = require('path');
const fs = require('fs');

const LINUX_BSQ = '/tmp/tms-server-linux/node_modules/better-sqlite3';

if (!fs.existsSync(LINUX_BSQ)) {
  console.error(
    '[sqlite-hook] Linux-native better-sqlite3 not found at', LINUX_BSQ,
    '\nRun: mkdir -p /tmp/tms-server-linux && cp server/package.json /tmp/tms-server-linux/ && cd /tmp/tms-server-linux && npm install'
  );
  process.exit(1);
}

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'better-sqlite3') {
    return originalResolve.call(this, LINUX_BSQ, parent, isMain, options);
  }
  return originalResolve.call(this, request, parent, isMain, options);
};
