//dependencies
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import requestIp from 'request-ip';

//imports
import { connectDB } from './libs/db.js';
import authRoutes from './routes/auth.routes.js';
import messageRoutes from './routes/message.routes.js';
import roomRoutes from './routes/room.routes.js';
import { app, server } from './libs/socket.js';


//setup
dotenv.config();
app.set('trust proxy', true);

const PORT = process.env.PORT || 3000;
const __dirname = path.resolve();

//middleware
app.use(express.json());
app.use(requestIp.mw());
app.use(cookieParser());
app.use(cors({
  origin: ['http://localhost:5174', 'http://localhost:5175', 'http://localhost:5173', 'https://waves-c53a.onrender.com', '13.228.225.19', '18.142.128.26', '54.254.162.138'],
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

app.use((err, req, res, next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ message: err.message || 'Internal Server Error' });
});

//server
server.listen(PORT, () => {
  console.log(`Server started on port: ${PORT}`);
  connectDB();
})