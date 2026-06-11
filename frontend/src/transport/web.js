// Web transport: the socket.io + WebRTC + axios IO lifted verbatim out of
// Chat.jsx (docs/REALTIME.md is the protocol reference). This module owns only
// the wire — room resolution, history fetch, the signaling relay + data-channel
// peer flow (including the 10 s offer timeout), the P2P-first + server-fallback
// send, and cleanup. All message state, dedup, and rendering stay in Chat.jsx.
import axios from "axios";
import { io } from "socket.io-client";
import { toast } from "react-toastify";

// Configure axios defaults
axios.defaults.withCredentials = true;

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

// Public STUN servers for NAT traversal
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export function createTransport() {
  let socket = null;
  let currentRoom = null;

  // WebRTC connections and data channels, keyed by peer socket id.
  const peerConnections = new Map();
  const dataChannels = new Map();

  // Helper to clean up a P2P connection
  const closePeerConnection = (socketId) => {
    peerConnections.get(socketId)?.close();
    peerConnections.delete(socketId);
    dataChannels.delete(socketId);
    console.log(`Closed P2P connection to ${socketId}`);
  };

  const createPeerConnection = (peerSocketId, isInitiator, handlers) => {
    if (peerConnections.has(peerSocketId)) return;

    console.log(`Creating P2P connection to ${peerSocketId}, initiator: ${isInitiator}`);

    try {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.set(peerSocketId, pc);

      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit("webrtc-ice-candidate", {
            to: peerSocketId,
            candidate: event.candidate,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log(`P2P connection state with ${peerSocketId}: ${state}`);
        if (state === "failed" || state === "disconnected" || state === "closed") {
          closePeerConnection(peerSocketId);
        }
      };

      if (isInitiator) {
        const dataChannel = pc.createDataChannel("chat");
        dataChannels.set(peerSocketId, dataChannel);

        dataChannel.onmessage = (event) => {
          console.log("%c[P2P] Message received via DataChannel", "color: #22c55e;");
          try {
            const message = JSON.parse(event.data);
            handlers.onPeerMessage(message);
          } catch (error) {
            console.error("Failed to parse P2P message:", error);
          }
        };
        dataChannel.onopen = () => {
          console.log(`Data channel with ${peerSocketId} opened.`);
        };

        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            if (socket) {
              socket.emit("webrtc-offer", { to: peerSocketId, offer: pc.localDescription });
            }
          })
          .catch((e) => {
            console.error("Error creating offer:", e);
          });
      } else {
        pc.ondatachannel = (event) => {
          const dataChannel = event.channel;
          dataChannels.set(peerSocketId, dataChannel);

          dataChannel.onmessage = (e) => {
            console.log("%c[P2P] Message received via DataChannel", "color: #22c55e;");
            try {
              const message = JSON.parse(e.data);
              handlers.onPeerMessage(message);
            } catch (error) {
              console.error("Failed to parse P2P message:", error);
            }
          };
          dataChannel.onopen = () => console.log(`Data channel with ${peerSocketId} opened.`);
        };
      }
    } catch (error) {
      console.error(`Failed to create RTCPeerConnection for ${peerSocketId}:`, error);
      toast.error("WebRTC is not supported or failed to initialize");
      return;
    }
  };

  return {
    kind: "web",

    // Resolve the Socket.IO/Mongo room name (docs/CLAUDE.md: the naming
    // convention is load-bearing). Returns the roomInfo object Chat renders.
    async resolveRoom({ roomType, roomCode, roomData }) {
      if (roomType === "network") {
        // Fetch room info for network rooms
        const roomResponse = await axios.get("/api/rooms/assign");
        return roomResponse.data;
      }
      if (roomType === "custom" && roomCode) {
        return {
          roomName: `custom-${roomCode}`,
          code: roomCode,
          ...(roomData || {}),
        };
      }
      if (roomType === "custom" && !roomCode) {
        console.error("[ERROR] Custom room type but no room code provided");
        return { roomName: "global-room" };
      }
      return { roomName: "global-room" };
    },

    async fetchHistory(roomName) {
      const response = await axios.get(`/api/messages/${roomName}`);
      return response.data;
    },

    connect({ roomName, handlers }) {
      currentRoom = roomName;

      // Initialize socket if not already done
      if (!socket) {
        socket = io(BACKEND_URL, {
          withCredentials: true,
        });

        // Setup message handler
        socket.on("chatMessage", (message) => {
          console.log("%c[SERVER] Message received via WebSocket", "color: #f97316;");
          handlers.onServerMessage(message);
        });

        // Setup error handler
        socket.on("error", (error) => {
          handlers.onError(error);
        });

        // Setup reconnection handler
        socket.on("reconnect", () => {
          handlers.onReconnected();
          // Rejoin room after reconnection
          if (currentRoom) {
            socket.emit("join", currentRoom);
          }
        });

        socket.on("existing-room-users", ({ users }) => {
          console.log("Existing users in room: ", users);
          users.forEach((peerSocketId) => {
            createPeerConnection(peerSocketId, true, handlers);
          });
        });

        socket.on("webrtc-offer", ({ from, offer }) => {
          console.log(`Received WebRTC offer from ${from}`);
          createPeerConnection(from, false, handlers);
          const pc = peerConnections.get(from);
          if (pc) {
            pc.setRemoteDescription(new RTCSessionDescription(offer))
              .then(() => pc.createAnswer())
              .then((answer) => pc.setLocalDescription(answer))
              .then(() => socket.emit("webrtc-answer", { to: from, answer: pc.localDescription }))
              .catch((e) => {
                console.error("Error handling offer:", e);
                closePeerConnection(from);
              });
          }

          // Add timeout for the connection
          setTimeout(() => {
            const currentPC = peerConnections.get(from);
            // If after 10 seconds the connection is still not 'connected'...
            if (currentPC && currentPC.connectionState !== "connected") {
              console.warn(`[Timeout] P2P connection to ${from} did not connect in time.`);
              // ...assume it has failed and clean it up.
              closePeerConnection(from);
            }
          }, 10000); // 10-second timeout
        });

        socket.on("webrtc-answer", ({ from, answer }) => {
          console.log(`Received WebRTC answer from ${from}`);
          peerConnections.get(from)?.setRemoteDescription(new RTCSessionDescription(answer))
            .catch((e) => console.error("Error setting remote description for answer:", e));
        });

        socket.on("webrtc-ice-candidate", ({ from, candidate }) => {
          peerConnections.get(from)?.addIceCandidate(new RTCIceCandidate(candidate))
            .catch((e) => console.error("Error adding received ICE candidate:", e));
        });

        socket.on("userLeft", ({ socketId }) => {
          handlers.onUserLeft({ socketId });
          closePeerConnection(socketId);
        });
      }

      // Join the room
      socket.emit("join", roomName);
    },

    async send({ roomName, payload }) {
      // Deliver to any connected peers over their open data channels (P2P path).
      dataChannels.forEach((channel) => {
        if (channel.readyState === "open") {
          try {
            channel.send(JSON.stringify(payload));
            console.log(`[CLIENT]Message sent to peer via P2P`);
          } catch (error) {
            console.error(`P2P send error:`, error);
          }
        }
      });

      // Always send to server for fallback and persistence
      await axios.post(`/api/messages/send/${roomName}`, {
        text: payload.text,
        tempId: payload._id,
      });
    },

    disconnect() {
      if (socket) {
        if (currentRoom) {
          socket.emit("leave", currentRoom);
        }

        console.log(`Cleaning up ${peerConnections.size} peer connections.`);
        peerConnections.forEach((pc) => {
          pc.close();
        });

        socket.disconnect();
      }

      // Clear everything for a clean state on the next transport
      peerConnections.clear();
      dataChannels.clear();
      socket = null;
      currentRoom = null;
    },
  };
}
