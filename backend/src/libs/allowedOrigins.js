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
  // IP-based origins need an explicit scheme — the cors and Socket.IO `origin`
  // checks match the browser `Origin` header (scheme://host[:port]), so a bare
  // IP never matches. Allow both http and https for each.
  'http://13.228.225.19',
  'https://13.228.225.19',
  'http://18.142.128.26',
  'https://18.142.128.26',
  'http://54.254.162.138',
  'https://54.254.162.138',
];

const envOrigins = (process.env.CLIENT_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** @type {string[]} */
export const allowedOrigins = [...new Set([...DEFAULT_ORIGINS, ...envOrigins])];
