import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';

const app = express();
const server = createServer(app);

const GLOBAL_ROOM = "global-room";

const io = new SocketServer(server, {
  cors: {
    origin: ["http://localhost:5174", "http://localhost:5175", "http://localhost:5173", 'https://waves-c53a.onrender.com', '13.228.225.19', '18.142.128.26', '54.254.162.138'],
    credentials: true
  }
});

io.on("connection", socket => {
  console.log("A user connected ", socket.id);

  //only global room func for now
  socket.join(GLOBAL_ROOM);

  //notify all clients
  io.to(GLOBAL_ROOM).emit("userJoined", {
    socketId: socket.id,
    message: "A new user has joined the global chatroom"
  });

  //listen for chat msg
  socket.on("chatMessage", data => {
    // {content, sender } = data
    io.to(GLOBAL_ROOM).emit("chatMessage", {
      ...data,
      Timestamp: new Date()
    });
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected", socket.id);

    io.to(GLOBAL_ROOM).emit("userLeft", {
      socketId: socket.id,
      message: "A user has left"
    });
  });
});

export {io, app, server};