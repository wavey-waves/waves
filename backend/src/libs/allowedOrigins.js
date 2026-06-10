import './env.js';

// Single source of truth for the CORS allow-list, shared by the HTTP app
// (app.js) and the Socket.IO server (socket.js). Previously this list was
// duplicated in both files and had drifted out of sync.
//
// Extend per-deployment without code changes via the CLIENT_ORIGINS env var
// (comma-separated), e.g. CLIENT_ORIGINS="https://app.example.com,https://staging.example.com".

const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'https://waves-c53a.onrender.com',
  '13.228.225.19',
  '18.142.128.26',
  '54.254.162.138',
];

const envOrigins = (process.env.CLIENT_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** @type {string[]} */
export const allowedOrigins = [...new Set([...DEFAULT_ORIGINS, ...envOrigins])];
