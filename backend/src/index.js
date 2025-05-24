//dependencies
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';

//imports
import { connectDB } from './libs/db.js';
import authRoutes from './routes/auth.routes.js';
import { app, server } from './libs/socket.js';


//setup
const app = express();
dotenv.config();

//env variables
const PORT = 5000; // Hardcoded to 5000 to avoid conflicts

//middleware
app.use(express.json());
app.use(express.Router());
app.use(cookieParser());
app.use(cors({
  origin: 'http://localhost:5174',
  credentials: true
}));

//Routes
app.use('/api/auth', authRoutes);


//server
server.listen(PORT, () => {
  console.log(`Server started on port: ${PORT}`);
  connectDB();
})