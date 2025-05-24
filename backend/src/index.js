//dependencies
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';

//imports
import { connectDB } from './libs/db.js';


//setup
const app = express();
dotenv.config();

//env variables
const PORT = process.env.PORT;

//middleware
app.use(express.Router());
app.use(cookieParser());

//Routes


//server
app.listen(PORT, () => {
  console.log(`Server started on port: ${PORT}`);
  connectDB();
})