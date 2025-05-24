import {Server} from 'socket.io';
import http from 'http';
import express from 'express';

const app = express();
const server = http.createServer(app);

const GLOBAL_ROOM = "global-room";

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5174", "http://localhost:5175", "http://localhost:5173"],
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