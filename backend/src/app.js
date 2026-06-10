//dependencies
import './libs/env.js'; // load .env before anything reads process.env
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import requestIp from 'request-ip';

//imports
import authRoutes from './routes/auth.routes.js';
import messageRoutes from './routes/message.routes.js';
import roomRoutes from './routes/room.routes.js';
import { app } from './libs/socket.js';
import { allowedOrigins } from './libs/allowedOrigins.js';

//setup
app.set('trust proxy', true);

const __dirname = path.resolve();

//middleware
app.use(express.json());
app.use(requestIp.mw());
app.use(cookieParser());
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

//Routes
app.use('/api/auth', authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/rooms", roomRoutes);

if(process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, "../frontend/dist")));

  app.get('/:wildcard(.*)', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  })
}

// Express identifies error-handling middleware by its 4-arg arity, so `next`
// must stay in the signature even though it's unused here.
app.use((err, req, res, _next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ message: err.message || 'Internal Server Error' });
});

export { app };
export default app;
