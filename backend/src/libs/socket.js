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

  //WebRTC signalling
  socket.on("webrtc-offer", ({offer, to}) => {
    const target = io.sockets.sockets.get(to);
    if(!target || !offer) return; 

    //ignore default room(socket id) and check if both share a room
    const shareRoom = [...socket.rooms].some(r => r !== socket.id && target.rooms.has(r));
    if(!shareRoom) return; //security check

    socket.to(to).emit("webrtc-offer", {offer, from: socket.id});
  });

  socket.on("webrtc-answer", ({answer, to}) => {
    const target = io.sockets.sockets.get(to);
    if(!target || !answer) return; 

    const shareRoom = [...socket.rooms].some(r => r !== socket.id && target.rooms.has(r));
    if(!shareRoom) return;
    socket.to(to).emit("webrtc-answer", {answer, from: socket.id});
  });

  socket.on("webrtc-ice-candidate", ({candidate, to}) => {
    const target = io.sockets.sockets.get(to);
    if(!target || !candidate) return; 

    const shareRoom = [...socket.rooms].some(r => r !== socket.id && target.rooms.has(r));
    if(!shareRoom) return;
    socket.to(to).emit("webrtc-ice-candidate", {candidate, from: socket.id});
  });


  // Handle joining rooms
  socket.on("join", (roomName) => {
    socket.join(roomName);
    console.log(`User ${socket.id} joined room: ${roomName}`);

    // Get other users in the room
    const clientsInRoom = io.sockets.adapter.rooms.get(roomName);
    const otherUsers = [];
    if (clientsInRoom) {
      clientsInRoom.forEach(clientId => {
        if (clientId !== socket.id) {
          otherUsers.push(clientId);
        }
      });
    }

    // Send the list of existing users to the new user to initiate P2P
    socket.emit("existing-room-users", { users: otherUsers });
    
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