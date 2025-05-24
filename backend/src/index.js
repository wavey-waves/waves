//dependencies
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';

//imports
import { connectDB } from './libs/db.js';
import authRoutes from './routes/auth.routes.js';


//setup
const app = express();
dotenv.config();

//env variables
const PORT = process.env.PORT;

//middleware
app.use(express.json());
app.use(express.Router());
app.use(cookieParser());

//Routes
app.use('/api/auth', authRoutes);


//server
app.listen(PORT, () => {
  console.log(`Server started on port: ${PORT}`);
  connectDB();
})