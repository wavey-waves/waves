import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';

const app = express();
const server = createServer(app);

const io = new SocketServer(server, {
  cors: {
    origin: ["http://localhost:5174", "http://localhost:5175", "http://localhost:5173", 'https://waves-c53a.onrender.com', '13.228.225.19', '18.142.128.26', '54.254.162.138'],
    credentials: true,
    transports: ["websocket", "polling"]
  }
});

io.on("connection", socket => {
  console.log("A user connected ", socket.id);

  // Handle joining rooms
  socket.on("join", (roomName) => {
    socket.join(roomName);
    console.log(`User ${socket.id} joined room: ${roomName}`);
    
    // Notify room members
    io.to(roomName).emit("userJoined", {
      socketId: socket.id,
      message: "A new user has joined the room"
    });
  });

  // Handle leaving rooms
  socket.on("leave", (roomName) => {
    socket.leave(roomName);
    console.log(`User ${socket.id} left room: ${roomName}`);
    
    // Notify room members
    io.to(roomName).emit("userLeft", {
      socketId: socket.id,
      message: "A user has left the room"
    });
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected", socket.id);
    
    // Get all rooms this socket was in
    const rooms = Array.from(socket.rooms);
    rooms.forEach(room => {
      if (room !== socket.id) { // socket.id is also treated as a room
        io.to(room).emit("userLeft", {
          socketId: socket.id,
          message: "A user has disconnected"
        });
      }
    });
  });
});

export {io, app, server};