// Load environment variables exactly once, before any module that reads
// process.env at import time (e.g. allowedOrigins.js). Import this first.
import dotenv from 'dotenv';

dotenv.config();
