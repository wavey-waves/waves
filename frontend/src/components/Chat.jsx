import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { toast, ToastContainer } from "react-toastify";
import { useNavigate } from "react-router-dom";
import "react-toastify/dist/ReactToastify.css";

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

// ===== Encryption helpers (AES-GCM 256) =====
const b64ToBytes = (b64) => {
  if (typeof b64 !== "string") {
    throw new Error("Base64 input must be a string");
  }
  const trimmed = b64.trim();
  if (trimmed.length === 0) {
    throw new Error("Base64 input is empty");
  }
  // Remove whitespace and normalize padding
  const normalized = trimmed.replace(/\s+/g, "");
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(normalized)) {
    throw new Error("Base64 input contains invalid characters or padding");
  }
  let padded = normalized;
  const mod4 = padded.length % 4;
  if (mod4 === 1) {
    throw new Error("Invalid Base64 length");
  }
  if (mod4 > 0) {
    padded += "=".repeat(4 - mod4);
  }
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch (e) {
    throw new Error(`Failed to decode Base64: ${e && e.message ? e.message : e}`);
  }
};

const bytesToB64 = (bytes) => {
  let view;
  if (bytes instanceof ArrayBuffer) {
    view = new Uint8Array(bytes);
  } else if (ArrayBuffer.isView(bytes) && bytes.buffer instanceof ArrayBuffer) {
    view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } else if (Array.isArray(bytes)) {
    view = new Uint8Array(bytes);
  } else {
    throw new Error("bytesToB64 expects Uint8Array, ArrayBuffer, or TypedArray");
  }
  try {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < view.length; i += chunkSize) {
      const chunk = view.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  } catch (e) {
    throw new Error(`Failed to encode Base64: ${e && e.message ? e.message : e}`);
  }
};

async function exportKeyBase64(key) {
  try {
    const raw = await crypto.subtle.exportKey("raw", key);
    return bytesToB64(raw);
  } catch (e) {
    throw new Error(`Failed to export key: ${e && e.message ? e.message : e}`);
  }
}

async function importKeyBase64(b64) {
  try {
    const raw = b64ToBytes(b64);
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
  } catch (e) {
    throw new Error(`Failed to import key from Base64: ${e && e.message ? e.message : e}`);
  }
}

async function encryptString(key, plaintext) {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(String(plaintext)));
    return { ciphertext: bytesToB64(ciphertext), iv: bytesToB64(iv) };
  } catch (e) {
    throw new Error(`Encryption failed: ${e && e.message ? e.message : e}`);
  }
}

async function decryptToString(key, ciphertextB64, ivB64) {
  try {
    const dec = new TextDecoder();
    const iv = b64ToBytes(ivB64);
    const ct = b64ToBytes(ciphertextB64);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return dec.decode(plaintext);
  } catch (e) {
    throw new Error(`Decryption failed: ${e && e.message ? e.message : e}`);
  }
}

function Chat({ roomType, user }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [roomInfo, setRoomInfo] = useState(null);
  const messagesContainerRef = useRef(null);
  const socketRef = useRef(null); 
  const textareaRef = useRef(null); 
  const navigate = useNavigate();

  // Refs for WebRTC connections, data channels, and message deduplication
  const peerConnectionsRef = useRef(new Map());
  const dataChannelsRef = useRef(new Map());
  const processedMessageIds = useRef(new Set());
  const groupKeyRef = useRef(null);
  const currentRoomRef = useRef(null);
  const keyPromisesRef = useRef(new Map());

  //Constants for message input
  const CHARACTER_LIMIT = 1000;
  const CHARACTER_WARNING = 900;
  const [lastSent, setLastSent] = useState(0);
  const THROTTLE_DELAY = 1000;

  // Add viewport height handling
  useEffect(() => {
    function setVh() {
      document.documentElement.style.setProperty(
        "--vh",
        `${window.innerHeight * 0.01}px`
      );
    }
    setVh();
    window.addEventListener("resize", setVh);
    return () => window.removeEventListener("resize", setVh);
  }, []);

  const storageKeyForRoom = (room) => `waves:groupKey:${room}`;

  const loadKeyForRoom = async (room) => {
    try {
      const b64 = localStorage.getItem(storageKeyForRoom(room));
      if (!b64) return null;
      return await importKeyBase64(b64);
    } catch (e) {
      console.warn("Failed to load group key:", e);
      return null;
    }
  };

  const saveKeyForRoom = async (room, key) => {
    try {
      const b64 = await exportKeyBase64(key);
      localStorage.setItem(storageKeyForRoom(room), b64);
    } catch (e) {
      console.warn("Failed to save group key:", e);
    }
  };

  const ensureKeyForRoom = async (room, generateIfMissing = false) => {
    if (!room) throw new Error("Room is required to ensure group key");
    if (groupKeyRef.current && currentRoomRef.current === room) return groupKeyRef.current;

    const existingPromise = keyPromisesRef.current.get(room);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async () => {
      let key = await loadKeyForRoom(room);
      if (!key && generateIfMissing) {
        key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        await saveKeyForRoom(room, key);
      }
      if (key) {
        groupKeyRef.current = key;
        currentRoomRef.current = room;
      }
      return key;
    })();

    keyPromisesRef.current.set(room, promise);
    try {
      return await promise;
    } finally {
      keyPromisesRef.current.delete(room);
    }
  };

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Helper to add a message to state, preventing duplicates
  const addMessage = (message) => {
    // Ignore if the message is invalid
    if (!message || !message._id) return;

    // 1. Check if we've already processed this message by its permanent ID
    // 2. OR check if we've processed it by its temporary ID (from P2P)
    if (
      processedMessageIds.current.has(message._id) ||
      (message.tempId && processedMessageIds.current.has(message.tempId))
    ) {
      // If either ID is already known, we've seen this message. Ignore it.
      console.log(`[Deduplication] Ignored message: ${message.text}`);
      return;
    }

    // This is a new message. Add BOTH of its IDs to the set for future checks.
    processedMessageIds.current.add(message._id);
    if (message.tempId) {
      processedMessageIds.current.add(message.tempId);
    }

    setMessages((prevMessages) => [...prevMessages, message]);
  };

  const processInboundAndAdd = async (incoming) => {
    try {
      let message = incoming;
      // Support wrapped payloads from P2P
      if (incoming && incoming.type === "msg" && incoming.message) {
        message = incoming.message;
      }
      // Decrypt if needed
      if (message && message.ciphertext && message.iv) {
        try {
          const roomCtx = currentRoomRef.current;
          const key = groupKeyRef.current || (roomCtx && await loadKeyForRoom(roomCtx));
          if (!key) {
            console.warn(`[Decrypt] No group key for room=${roomCtx || "<unknown>"} while processing message id=${message._id || "<no-id>"} from sender=${message?.senderId?._id || "<unknown>"}`);
            console.warn(`[Decrypt] groupKeyRef.current: ${!!groupKeyRef.current}, currentRoomRef.current: ${roomCtx}, dataChannelsRef.size: ${dataChannelsRef.current.size}`);
            // Fallback: add original message for visibility
            addMessage({ ...message, failedToDecrypt: true });
            return;
          }
          const text = await decryptToString(key, message.ciphertext, message.iv);
          addMessage({ ...message, text });
          return;
        } catch (err) {
          console.error(`[Decrypt] Failed for message id=${message._id || "<no-id>"} in room=${currentRoomRef.current || "<unknown>"}`, err);
          // Fallback: add original message marked as failed to decrypt
          addMessage({ ...message, failedToDecrypt: true });
          return;
        }
      }
      // Fallback: plaintext
      addMessage(message);
    } catch (e) {
      console.error("Failed to process inbound message:", e);
      // Add as-is to avoid losing messages entirely
      if (incoming) addMessage(incoming);
    }
  };

  // Helper to clean up a P2P connection
  const closePeerConnection = (socketId) => {
    peerConnectionsRef.current.get(socketId)?.close();
    peerConnectionsRef.current.delete(socketId);
    dataChannelsRef.current.delete(socketId);
    console.log(`Closed P2P connection to ${socketId}`);
  };

  // Setup socket connection and fetch initial data
  useEffect(() => {
    let currentRoom = null;

    const sendGroupKeyToPeer = async (peerSocketId) => {
      const maxAttempts = 3;
      let attempt = 0;
      let delayMs = 200;
      while (attempt < maxAttempts) {
        attempt++;
        try {
          const channel = dataChannelsRef.current.get(peerSocketId);
          if (!channel) throw new Error("DataChannel not found");
          if (channel.readyState !== "open") throw new Error(`DataChannel not open (state=${channel.readyState})`);
          const key = groupKeyRef.current || (currentRoom && await loadKeyForRoom(currentRoom));
          if (!key) throw new Error("No group key available to export");
          const exported = await exportKeyBase64(key);
          channel.send(JSON.stringify({ type: "key", key: exported }));
          console.log(`Sent group key to ${peerSocketId} (attempt ${attempt})`);
          return;
        } catch (e) {
          console.warn(`Failed to send group key to ${peerSocketId} (attempt ${attempt}):`, e);
          if (attempt >= maxAttempts) {
            toast.error("Failed to share encryption key with a peer. Try rejoining the room.");
            break;
          }
          await new Promise(res => setTimeout(res, delayMs));
          delayMs *= 2; // exponential backoff
        }
      }
    };

    const createPeerConnection = (peerSocketId, isInitiator) => {
      if(peerConnectionsRef.current.has(peerSocketId)) return;

      console.log(`Creating P2P connection to ${peerSocketId}, initiator: ${isInitiator}`);

      try {       
        const pc = new RTCPeerConnection(ICE_SERVERS);
        peerConnectionsRef.current.set(peerSocketId, pc);

        pc.onicecandidate = event => {
          if (event.candidate && socketRef.current) {
            socketRef.current.emit("webrtc-ice-candidate", {
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

        if(isInitiator) {
          const dataChannel = pc.createDataChannel("chat");
          dataChannelsRef.current.set(peerSocketId, dataChannel);

          dataChannel.onmessage = async event => {
            console.log("%c[P2P] DataChannel message", "color: #22c55e;");
            try {
              const payload = JSON.parse(event.data);
              if (payload?.type === "key" && payload.key) {
                if (!groupKeyRef.current) {
                  const imported = await importKeyBase64(payload.key);
                  groupKeyRef.current = imported;
                  if (currentRoom) await saveKeyForRoom(currentRoom, imported);
                  console.log("Imported group key from peer (initiator channel)");
                  
                  // Also share via server for other peers
                  try {
                    const exported = await exportKeyBase64(imported);
                    socketRef.current.emit("share-group-key", { roomName: currentRoom, key: exported });
                    console.log(`[Key] Shared imported key via server for room: ${currentRoom}`);
                  } catch (e) {
                    console.error("Failed to share imported key via server:", e);
                  }
                }
              } else {
                await processInboundAndAdd(payload);
              }
            } catch (error) {
              console.error("Failed to parse P2P message:", error);
            }
          };
          dataChannel.onopen = async () => {
            console.log(`Data channel with ${peerSocketId} opened.`);
            // Ensure we have a key; initiator generates if missing
            let key = groupKeyRef.current || (currentRoom && await loadKeyForRoom(currentRoom));
            if (!key) {
              try {
                key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
                groupKeyRef.current = key;
                if (currentRoom) await saveKeyForRoom(currentRoom, key);
                console.log("Generated new group key (initiator)");
              } catch (e) {
                console.error("Failed to generate group key:", e);
              }
            }
            if (key) {
              await sendGroupKeyToPeer(peerSocketId);
            }
          };

          pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
              if(socketRef.current) {
                socketRef.current.emit("webrtc-offer", {to:peerSocketId, offer: pc.localDescription});
              }
            })
            .catch(e => {
              console.error("Error creating offer:", e);
            });
        } else {
          pc.ondatachannel = (event) => {
            const dataChannel = event.channel;
            dataChannelsRef.current.set(peerSocketId, dataChannel);

            dataChannel.onmessage = async (e) => {
              console.log("%c[P2P] DataChannel message", "color: #22c55e;");
              try {
                const payload = JSON.parse(e.data);
                if (payload?.type === "key" && payload.key) {
                  if (!groupKeyRef.current) {
                    const imported = await importKeyBase64(payload.key);
                    groupKeyRef.current = imported;
                    if (currentRoom) await saveKeyForRoom(currentRoom, imported);
                    console.log("Imported group key from peer (non-initiator)");
                    
                    // Also share via server for other peers
                    try {
                      const exported = await exportKeyBase64(imported);
                      socketRef.current.emit("share-group-key", { roomName: currentRoom, key: exported });
                      console.log(`[Key] Shared imported key via server for room: ${currentRoom}`);
                    } catch (e) {
                      console.error("Failed to share imported key via server:", e);
                    }
                  }
                } else {
                  await processInboundAndAdd(payload);
                }
              } catch (error) {
                console.error("Failed to parse P2P message:", error);
              }
            };
            dataChannel.onopen = async () => {
              console.log(`Data channel with ${peerSocketId} opened.`);
              // If we already have a key, share it; otherwise wait to receive
              const key = groupKeyRef.current || (currentRoom && await loadKeyForRoom(currentRoom));
              if (key) {
                await sendGroupKeyToPeer(peerSocketId);
              } else {
                console.log(`[Key] Waiting to receive key from peer ${peerSocketId} for room ${currentRoom}`);
              }
            };
          };
        }
      } catch (error) {
        console.error(`Failed to create RTCPeerConnection for ${peerSocketId}:`, error);
        toast.error("WebRTC is not supported or failed to initialize");
        return;
      }      
    }

    const setupSocketAndFetchData = async () => {
      try {
        if (roomType === "network") {
          // Fetch room info for network rooms
          const roomResponse = await axios.get("/api/rooms/assign");
          setRoomInfo(roomResponse.data);
          currentRoom = roomResponse.data.roomName;
        } else {
          currentRoom = "global-room";
        }
        currentRoomRef.current = currentRoom;
        // Try to load an existing key for this room before proceeding
        try {
          const loadedKey = await loadKeyForRoom(currentRoom);
          if (loadedKey) {
            groupKeyRef.current = loadedKey;
            console.log(`[Key] Loaded existing key for room: ${currentRoom}`);
          } else {
            console.log(`[Key] No existing key found for room: ${currentRoom}`);
          }
        } catch (e) {
          console.warn("Failed to load group key:", e);
        }

        // If no key exists and this is a global room, generate one immediately
        // This ensures at least one user has a key to share
        if (!groupKeyRef.current && currentRoom === "global-room") {
          try {
            const newKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
            groupKeyRef.current = newKey;
            await saveKeyForRoom(currentRoom, newKey);
            console.log(`[Key] Generated new key for global room: ${currentRoom}`);
            
            // Share the new key via server immediately
            try {
              const exported = await exportKeyBase64(newKey);
              socketRef.current.emit("share-group-key", { roomName: currentRoom, key: exported });
              console.log(`[Key] Shared new key via server for room: ${currentRoom}`);
            } catch (e) {
              console.error("Failed to share new key via server:", e);
            }
          } catch (e) {
            console.error("Failed to generate initial global room key:", e);
          }
        }

        const endpoint = roomType === "global" ? "/api/messages/global-room" : `/api/messages/${currentRoom}`;
        const response = await axios.get(endpoint);
        if (Array.isArray(response.data)) {
            response.data.forEach(msg => {
                if(msg._id) processedMessageIds.current.add(msg._id)
            });
            // Decrypt any encrypted messages before displaying
            const out = [];
            for (const m of response.data.slice(-50)) {
              if (m.ciphertext && m.iv) {
                try {
                  const key = groupKeyRef.current || await loadKeyForRoom(currentRoom);
                  if (key) {
                    const text = await decryptToString(key, m.ciphertext, m.iv);
                    out.push({ ...m, text });
                  } else {
                    out.push(m); // show as-is if no key yet
                  }
                } catch {
                  out.push(m);
                }
              } else {
                out.push(m);
              }
            }
            setMessages(out);
        }

        const upsertMessage = async (message) => {
          // If this message confirms a temporary one, replace it
          if (message.tempId && message.senderId._id === user.id) {
            // Add the *new* permanent ID to the processed set
            processedMessageIds.current.add(message._id);

            // Decrypt if needed before replacing
            let finalMsg = message;
            if (message.ciphertext && message.iv) {
              try {
                const key = groupKeyRef.current || (currentRoom && await loadKeyForRoom(currentRoom));
                if (key) {
                  const text = await decryptToString(key, message.ciphertext, message.iv);
                  finalMsg = { ...message, text };
                }
              } catch {}
            }

            setMessages(prev => 
              prev.map(m => m._id === message.tempId ? finalMsg : m)
            );
          } else {
            // Otherwise, add it normally (it's from another user)
            await processInboundAndAdd(message);
          }
        };

        // Initialize socket if not already done
        if (!socketRef.current) {
          socketRef.current = io(BACKEND_URL, {
            withCredentials: true,
          });

          // Setup message handler
          socketRef.current.on("chatMessage", async message => {
            console.log("%c[SERVER] Message received via WebSocket", "color: #f97316;");
            await upsertMessage(message);
          });

          // Setup error handler
          socketRef.current.on("error", (error) => {
            console.error("Socket error:", error);
            toast.error("Connection error. Please try refreshing the page.");
          });

          // Setup reconnection handler
          socketRef.current.on("reconnect", () => {
            toast.success("Reconnected to chat server");
            // Rejoin room after reconnection
            if (currentRoom) {
              socketRef.current.emit("join", currentRoom);
            }
          });

          socketRef.current.on("existing-room-users", ({users}) => {
            console.log("Existing users in room: ", users);
            users.forEach(peerSocketId => {
              createPeerConnection(peerSocketId, true);
            });
          });

          socketRef.current.on("webrtc-offer", ({from, offer}) => {
            console.log(`Received WebRTC offer from ${from}`);
            createPeerConnection(from, false);
            const pc = peerConnectionsRef.current.get(from);
            if(pc) {
              pc.setRemoteDescription(new RTCSessionDescription(offer))
                .then(() => pc.createAnswer())
                .then(answer => pc.setLocalDescription(answer))
                .then(() => socketRef.current.emit("webrtc-answer", {to: from, answer: pc.localDescription}))
                .catch(e => {
                  console.error("Error handling offer:", e);
                  closePeerConnection(from);
                });
            }

            // Add timeout for the connection
            setTimeout(() => {
              const currentPC = peerConnectionsRef.current.get(from);
              // If after 10 seconds the connection is still not 'connected'...
              if (currentPC && currentPC.connectionState !== 'connected') {
                  console.warn(`[Timeout] P2P connection to ${from} did not connect in time.`);
                  // ...assume it has failed and clean it up.
                  closePeerConnection(from);
              }
          }, 10000); // 10-second timeout
          });

          socketRef.current.on("webrtc-answer", ({ from, answer }) => {
            console.log(`Received WebRTC answer from ${from}`);
            peerConnectionsRef.current.get(from)?.setRemoteDescription(new RTCSessionDescription(answer))
              .catch(e => console.error("Error setting remote description for answer:", e));
          });

          socketRef.current.on("webrtc-ice-candidate", ({from, candidate}) => {
            peerConnectionsRef.current.get(from)?.addIceCandidate(new RTCIceCandidate(candidate))
              .catch(e => console.error("Error adding received ICE candidate:", e));
          });

          socketRef.current.on("user-left", ({socketId}) => {
            toast.warn("A user has left the room.");
            closePeerConnection(socketId);
          });

          socketRef.current.on("group-key-shared", async ({ roomName, key }) => {
            console.log(`Received group key for room ${roomName} from server.`);
            if (currentRoom === roomName) {
              try {
                const imported = await importKeyBase64(key);
                groupKeyRef.current = imported;
                await saveKeyForRoom(currentRoom, imported);
                console.log(`Imported group key for room ${currentRoom} from server.`);
              } catch (e) {
                console.error("Failed to import key from server:", e);
              }
            }
          });

          socketRef.current.on("group-key-request", async ({ roomName }) => {
            console.log(`Received group key request for room ${roomName} from server.`);
            if (currentRoom === roomName) {
              try {
                const key = groupKeyRef.current || await loadKeyForRoom(currentRoom);
                if (key) {
                  const exported = await exportKeyBase64(key);
                  socketRef.current.emit("group-key-shared", { roomName, key: exported });
                  console.log(`Shared group key for room ${currentRoom} to server.`);
                } else {
                  console.warn(`No key available for room ${currentRoom} to share with server.`);
                }
              } catch (e) {
                console.error("Failed to share key with server:", e);
              }
            }
          });
        }

        // Join the room
        socketRef.current.emit("join", currentRoom);

        // Add a fallback: if we have a key but no P2P connections after a delay,
        // try to share it via the server (this helps with deployment scenarios)
        setTimeout(async () => {
          if (groupKeyRef.current && dataChannelsRef.current.size === 0) {
            console.log(`[Key] No P2P connections established, sharing key via server for room: ${currentRoom}`);
            try {
              const exported = await exportKeyBase64(groupKeyRef.current);
              socketRef.current.emit("share-group-key", { roomName: currentRoom, key: exported });
            } catch (e) {
              console.error("Failed to share key via server:", e);
            }
          } else if (!groupKeyRef.current) {
            console.log(`[Key] No key available, requesting from room members via server for room: ${currentRoom}`);
            socketRef.current.emit("request-group-key", { roomName: currentRoom });
          }
        }, 3000); // Wait 3 seconds for P2P to establish
      } catch (error) {
        console.error("Error setting up socket or fetching data:", error);
        toast.error("Failed to connect to chat server");
      }
    };

    if (user) {
      setupSocketAndFetchData();
    }

    // Cleanup function

    const socket = socketRef.current;
    const connections = peerConnectionsRef.current;
    const channels = dataChannelsRef.current;
    const processedMessages = processedMessageIds.current;
    return () => {
      if (socket) {
        if (currentRoom) {
          socket.emit("leave", currentRoom);
        }
        
        // Use the 'connections' variable which is a stable snapshot.
        console.log(`Cleaning up ${connections.size} peer connections.`);
        connections.forEach((pc) => {
          pc.close();
        });
        
        socket.disconnect();
      }

      // Clear all refs for a clean state on next run
      connections.clear();
      channels.clear();
      processedMessages.clear();
      // Note: keep groupKeyRef and localStorage to persist per-room key
    };
  }, [user, roomType]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const now = Date.now();
    const trimmed = newMessage.trim();
    if (!trimmed) {
      toast.error("Message cannot be empty.");
      return;
    }
    if (trimmed.length > CHARACTER_LIMIT) {
      toast.error("Message exceeds character limit.");
      return;
    }
    if (now - lastSent < THROTTLE_DELAY) {
      toast.error("You're sending messages too quickly.");
      return;
    }

    const roomName = roomType === "global" ? "global-room" : roomInfo?.roomName;
    if (!roomName) {
      const detail = roomType === "network" ? "No room assigned yet." : "";
      toast.error(`Unable to determine room. ${detail}`.trim());
      console.error("handleSendMessage: Missing roomName", { roomType, roomInfo });
      return;
    }

    const basePayload = {
      _id: crypto.randomUUID(),
      text: trimmed,
      senderId: { _id: user.id, userName: user.username, color: getGradientColors().userColor },
      roomName,
      createdAt: new Date().toISOString(),
      pending: true
    };

    // Encrypt once (used for both P2P and server)
    let ciphertext, iv;
    try {
      const key = await ensureKeyForRoom(roomName, true);
      if (!key) throw new Error("Failed to get or create group key");
      const result = await encryptString(key, basePayload.text);
      ciphertext = result.ciphertext;
      iv = result.iv;
    } catch (err) {
      console.error("Encryption error in handleSendMessage:", err);
      toast.error(`Encryption failed: ${err?.message || err}`);
      return;
    }

    // Attempt P2P send to open channels
    let openChannels = 0;
    let p2pSuccess = 0;
    try {
      dataChannelsRef.current.forEach((channel) => {
        if (channel && channel.readyState === "open") {
          openChannels++;
          try {
            const p2pMsg = {
              type: "msg",
              message: {
                _id: basePayload._id,
                tempId: basePayload._id,
                ciphertext,
                iv,
                senderId: basePayload.senderId,
                createdAt: basePayload.createdAt,
                room: roomName
              }
            };
            channel.send(JSON.stringify(p2pMsg));
            p2pSuccess++;
          } catch (sendErr) {
            console.error("P2P send error:", sendErr);
          }
        }
      });
    } catch (e2) {
      console.error("P2P iteration error:", e2);
    }

    // Attempt server send
    let serverSuccess = false;
    try {
      const endpoint = `/api/messages/send/${roomName}`;
      await axios.post(endpoint, {
        ciphertext,
        iv,
        tempId: basePayload._id,
        p2pSent: p2pSuccess > 0
      });
      serverSuccess = true;
    } catch (error) {
      const detail = error?.response?.data?.error || error?.message || String(error);
      console.error("Server send error:", error);
      toast.error(`Server send failed: ${detail}`);
    }

    // Show locally only if at least one path succeeded; else keep input intact
    if (p2pSuccess > 0 || serverSuccess) {
      addMessage(basePayload);
      setNewMessage("");
      setLastSent(now);
      if (textareaRef.current) {
        textareaRef.current.style.height = "40px";
      }
    } else {
      // Neither path succeeded
      toast.error("Message could not be sent. Please try again.");
    }
  };

  const getGradientColors = () => {
    return roomType === "global" 
      ? {
          from: "from-violet-400 via-purple-700 to-indigo-500",
          button: "from-violet-600 to-blue-600",
          bg: "from-violet-600/5 via-transparent to-purple-600/5",
          accent: "from-violet-300 via-purple-400 to-indigo-300",
          border: "border-violet-500/20",
          userColor: "#7c3aed"
        }
      : {
          from: "from-emerald-400 via-teal-500 to-cyan-500",
          button: "from-emerald-600 to-cyan-600",
          bg: "from-emerald-600/5 via-transparent to-cyan-600/5",
          accent: "from-emerald-300 via-teal-400 to-cyan-300",
          border: "border-emerald-500/20",
          userColor: "#10b981"
        };
  };

  const colors = getGradientColors();

  return (
    <>
      <ToastContainer position="bottom-right" autoClose={2500} theme="dark" />
      <link
        href="https://fonts.googleapis.com/css2?family=Gloria+Hallelujah&display=swap"
        rel="stylesheet"
      />
      <div className="relative h-screen flex flex-col bg-black">
        <div className="fixed inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950 to-black"></div>
          <div className={`absolute inset-0 bg-gradient-to-tr ${colors.bg}`}></div>
          <div className="absolute inset-0">
            <div className={`absolute inset-0 bg-gradient-to-tr ${colors.bg} animate-gradient`}></div>
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          </div>
        </div>

        <div className="relative z-10 flex flex-col h-full">
          {/* Header - Fixed */}
          <div className="flex-shrink-0 flex items-center justify-between p-2 sm:p-3 md:p-4 border-b border-white/10">
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <h1 className={`font text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r ${colors.from} bg-clip-text text-transparent`}>
                {roomType === "global" ? "Global" : "Network"} room
              </h1>
              <span className={`text-xs sm:text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-0.5 sm:py-1 rounded-full border ${colors.border} backdrop-blur-sm`}>
                {user.username}
              </span>
              {roomType === "network" && roomInfo && (
                <span className={`text-xs sm:text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-0.5 sm:py-1 rounded-full border ${colors.border} backdrop-blur-sm`}>
                  {roomInfo.roomName}
                </span>
              )}
            </div>
            <button
              onClick={() => navigate('/')}
              className={`p-2 rounded-lg bg-gradient-to-r ${colors.button} hover:opacity-90 transition-opacity text-white flex items-center gap-1.5 border ${colors.border} backdrop-blur-sm`}
              aria-label="Go back to home"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              <span className="hidden sm:inline font-medium">Back</span>
            </button>
          </div>

          {/* Messages Area - Scrollable */}
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 space-y-2 custom-scrollbar pb-[100px] sm:pb-[100px] md:pb-[110px] lg:pb-[120px]"
          >
            {messages.map((message, index) => {
              // Skip rendering if senderId is null
              if (!message.senderId) return null;
              
              const isCurrentUser = message.senderId._id === user.id;
              const senderName = isCurrentUser ? user.username : message.senderId.userName;
              const senderColor = isCurrentUser ? colors.userColor : message.senderId.color;

              // Handle different message states
              let messageContent = message.text;
              let messageStyle = "text-white/90";
              let borderStyle = `${senderColor}30`;
              
              if (message.failedToDecrypt) {
                messageContent = "🔒 Message could not be decrypted (encryption key missing)";
                messageStyle = "text-red-400 italic";
                borderStyle = "border-red-500/50";
              } else if (message.pending) {
                messageContent = message.text;
                messageStyle = "text-white/70 italic";
                borderStyle = `${senderColor}20`;
              } else if (!message.text && message.ciphertext) {
                messageContent = "🔒 Encrypted message (decrypting...)";
                messageStyle = "text-yellow-400 italic";
                borderStyle = "border-yellow-500/50";
              }

              return (
                <div
                  key={message._id || index}
                  className={`flex ${isCurrentUser ? "justify-end" : "justify-start"}`}
                >
                  <div className="max-w-[85%] sm:max-w-[70%] relative z-0">
                    <div
                      className={`text-xs sm:text-sm font-semibold mb-0.5 ${
                        isCurrentUser ? "text-right" : "text-left"
                      }`}
                      style={{ color: senderColor }}
                    >
                      {senderName}
                    </div>
                    <div
                      className={`rounded-2xl px-3 py-1.5 sm:px-4 sm:py-2 backdrop-blur-sm border text-white mb-1`}
                      style={{
                        backgroundColor: `${senderColor}20`,
                        borderColor: borderStyle,
                      }}
                    >
                      <p className={`${messageStyle} text-sm sm:text-base break-words text-left`}>
                        {messageContent}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Input Area - Fixed */}
          <div className="fixed bottom-0 left-0 right-0 p-2 sm:p-3 md:p-4 border-t border-white/10 bg-black/90 backdrop-blur-xl z-30">
            <form
              onSubmit={handleSendMessage}
              className="flex gap-2 max-w-4xl mx-auto relative"
            >
              <div className="relative flex-1">
                <textarea
                  ref={textareaRef}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type your message..."
                  rows={1}
                  style={{ resize: "none" }}
                  className={`w-full bg-white/5 text-white rounded-xl px-3 py-2 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-${colors.userColor}/50 border border-white/10 transition-all min-h-[40px] max-h-40 pr-14 text_scroll`}
                  onInput={(e) => {
                    e.target.style.height = "auto";
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                />
                {newMessage.length >= CHARACTER_WARNING && (
                  <span
                    className={`absolute bottom-2 right-4 text-xs font-mono pointer-events-none select-none ${
                      newMessage.length <= CHARACTER_LIMIT
                        ? "text-green-500"
                        : "text-red-400"
                    }`}
                    style={{
                      background: "rgba(0,0,0,0.6)",
                      borderRadius: "6px",
                      padding: "0 6px",
                      lineHeight: "1.5",
                    }}
                  >
                    {newMessage.length <= CHARACTER_LIMIT
                      ? `${CHARACTER_LIMIT - newMessage.length}`
                      : `-${newMessage.length - CHARACTER_LIMIT}`}
                  </span>
                )}
              </div>
              <button
                type="submit"
                disabled={
                  !newMessage.trim() ||
                  newMessage.length > CHARACTER_LIMIT ||
                  Date.now() - lastSent < THROTTLE_DELAY
                }
                className={`px-3 sm:px-6 py-2 bg-gradient-to-r ${colors.button} rounded-xl text-white hover:opacity-90 transition-opacity font-medium text-sm sm:text-base whitespace-nowrap flex items-center gap-1.5 ${
                  !newMessage.trim() ||
                  newMessage.length > CHARACTER_LIMIT ||
                  Date.now() - lastSent < THROTTLE_DELAY
                    ? "opacity-50 cursor-not-allowed"
                    : ""
                }`}
                style={{ height: "40px", minHeight: "40px", alignSelf: "end" }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
                <span className="hidden sm:inline">Send</span>
              </button>
            </form>
          </div>
        </div>

        <style jsx global>{`
          .text_scroll::-webkit-scrollbar {
            width: 0 !important;
            height: 0 !important;
          }
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: linear-gradient(to bottom, ${colors.userColor}, ${roomType === "global" ? "#3b82f6" : "#0891b2"});
            border-radius: 3px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(to bottom, ${roomType === "global" ? "#6d28d9" : "#059669"}, ${roomType === "global" ? "#2563eb" : "#0e7490"});
          }
          .font {
            font-family: "Gloria Hallelujah", cursive;
            font-weight: 400;
            font-style: normal;
          }
          .h-screen {
            height: calc(var(--vh, 1vh) * 100);
          }
        `}</style>
      </div>
    </>
  );
}

export default Chat; 