'use strict';

// Dependency-free configuration loader.
// Reads an optional .env file from the project root, then exposes typed
// settings. Real environment variables always win over .env values.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

const envFileUsed = loadEnvFile(path.join(ROOT, '.env'));

function intVal(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

const config = {
  PORT: intVal(process.env.PORT, 3000),
  HOST: process.env.HOST || '0.0.0.0',
  MAX_UPLOAD_MB: intVal(process.env.MAX_UPLOAD_MB, 200),
  MAX_PREVIEW_MB: intVal(process.env.MAX_PREVIEW_MB, 2),
  DATA_DIR: process.env.DATA_DIR || path.join(ROOT, 'data'),
  VERSION: '0.1.0',
};

config.envFileUsed = envFileUsed;
config.ROOT = ROOT;

module.exports = config;
