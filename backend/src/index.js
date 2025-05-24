//dependencies
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';

//imports
import { connectDB } from './libs/db.js';
import authRoutes from './routes/auth.routes.js';
import messageRoutes from './routes/message.routes.js';
import { app, server } from './libs/socket.js';


//setup
dotenv.config();

const PORT = process.env.PORT;
const __dirname = path.resolve();

//middleware
app.use(express.json());
app.use(express.Router());
app.use(cookieParser());
app.use(cors({
  origin: ['http://localhost:5174', 'http://localhost:5175', 'http://localhost:5173'],
  credentials: true
}));

//Routes
app.use('/api/auth', authRoutes);
app.use("/api/messages", messageRoutes);

if(process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, "../frontend/dist")));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'dist', 'index.html'));
  })
}

//server
server.listen(PORT, () => {
  console.log(`Server started on port: ${PORT}`);
  connectDB();
})