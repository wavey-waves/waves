//imports
import './libs/env.js'; // load .env before any module reads process.env
import { connectDB } from './libs/db.js';
import { server } from './libs/socket.js';
// Importing app.js wires all middleware + routes onto the shared Express app.
import './app.js';

const PORT = process.env.PORT || 3000;

//server
server.listen(PORT, () => {
  console.log(`Server started on port: ${PORT}`);
  connectDB();
});
