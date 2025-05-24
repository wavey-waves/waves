//dependencies
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import path from 'path';

//imports
import { connectDB } from './libs/db.js';


//setup
const app = express();
dotenv.config();

//env variables
const PORT = process.env.PORT;
const __dirname = path.resolve();

//middleware
app.use(express.Router());
app.use(cookieParser());

//Routes


if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../frontend/dist")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend", "dist", "index.html"));
  });
}

//server
app.listen(PORT, () => {
  console.log(`Server started on port: ${PORT}`);
  connectDB();
})