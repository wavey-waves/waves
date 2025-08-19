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

  // Reaction state
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);
  const [longPressTimer, setLongPressTimer] = useState(null);
  const [hoverTimer, setHoverTimer] = useState(null);
  const [showReactionDetails, setShowReactionDetails] = useState(null);

  // Common emojis for quick selection
  const quickEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡'];

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

  // Helper to update a message (for reactions)
  const updateMessage = (updatedMessage) => {
    setMessages(prevMessages => 
      prevMessages.map(msg => 
        msg._id === updatedMessage._id ? updatedMessage : msg
      )
    );
  };

  // Handle reaction to message
  const handleReaction = async (messageId, emoji) => {
    try {
      // Optimistic update - immediately update the UI
      setMessages(prevMessages => 
        prevMessages.map(msg => {
          if (msg._id === messageId) {
            const newReactions = [...(msg.reactions || [])];
            
            // Check if user already reacted with this emoji
            const existingReactionIndex = newReactions.findIndex(
              reaction => (reaction.userId._id === user.id || reaction.userId === user.id) && reaction.emoji === emoji
            );

            if (existingReactionIndex > -1) {
              // Remove the reaction if it exists
              newReactions.splice(existingReactionIndex, 1);
            } else {
              // Remove any other reaction from this user first (one reaction per user)
              const filteredReactions = newReactions.filter(
                reaction => reaction.userId._id !== user.id && reaction.userId !== user.id
              );
              // Add the new reaction
              filteredReactions.push({ 
                userId: { _id: user.id, userName: user.username }, 
                emoji,
                createdAt: new Date()
              });
              newReactions.splice(0, newReactions.length, ...filteredReactions);
            }
            
            return { ...msg, reactions: newReactions };
          }
          return msg;
        })
      );

      setShowEmojiPicker(null);
      
      // Make the API call in the background
      await axios.post(`/api/messages/${messageId}/react`, { emoji });
      
      // Note: The server will emit "message-reacted" which will update with the authoritative data
      // This ensures consistency if there were any conflicts
      
    } catch (error) {
      console.error("Error reacting to message:", error);
      toast.error("Failed to react to message");
      
      // On error, we could revert the optimistic update here if needed
      // For now, the server's response via socket will correct any inconsistencies
    }
  };

  // Long press handlers
  const handleLongPressStart = (messageId) => {
    const timer = setTimeout(() => {
      setShowEmojiPicker(messageId);
    }, 200);
    setLongPressTimer(timer);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  // Hover handlers
  const handleMouseEnter = (messageId) => {
    const timer = setTimeout(() => {
      setShowEmojiPicker(messageId);
    }, 100); // 100ms hover delay (reduced from 200ms)
    setHoverTimer(timer);
  };

  const handleMouseLeave = () => {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      setHoverTimer(null);
    }
    // Don't immediately close the picker on mouse leave
    // Let it stay open so user can click on emojis
  };

  // Close emoji picker when clicking outside or after a delay
  const handleEmojiPickerClose = () => {
    setTimeout(() => {
      setShowEmojiPicker(null);
    }, 100); // 100ms delay (reduced from 100ms - keeping the same)
  };

  // Handle showing reaction details
  const handleReactionDetailsToggle = (messageId, emoji, reactionList, event) => {
    event.stopPropagation();
    if (showReactionDetails?.messageId === messageId && showReactionDetails?.emoji === emoji) {
      setShowReactionDetails(null);
    } else {
      const rect = event.currentTarget.getBoundingClientRect();
      setShowReactionDetails({
        messageId,
        emoji,
        reactions: reactionList,
        position: {
          x: rect.right + 8, // Position to the right of the button
          y: rect.top
        }
      });
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

          dataChannel.onmessage = event => {
            console.log("%c[P2P] Message received via DataChannel", "color: #22c55e;");
            try {
              const message = JSON.parse(event.data)
              addMessage(message);             
            } catch (error) {
              console.error("Failed to parse P2P message:", error);
            }
          };
          dataChannel.onopen = () => {
            console.log(`Data channel with ${peerSocketId} opened.`);
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

            dataChannel.onmessage = (e) => {
              console.log("%c[P2P] Message received via DataChannel", "color: #22c55e;");
              try {
                const message = JSON.parse(e.data)
                addMessage(message);             
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

        const endpoint = roomType === "global" ? "/api/messages/global-room" : `/api/messages/${currentRoom}`;
        const response = await axios.get(endpoint);
        if (Array.isArray(response.data)) {
            response.data.forEach(msg => {
                if(msg._id) processedMessageIds.current.add(msg._id)
            });
            setMessages(response.data.slice(-50));
        }

        const upsertMessage = (message) => {
          // If this message confirms a temporary one, replace it
          if (message.tempId && message.senderId._id === user.id) {
            // Add the *new* permanent ID to the processed set
            processedMessageIds.current.add(message._id);

            setMessages(prev => 
              prev.map(m => m._id === message.tempId ? message : m)
            );
          } else {
            // Otherwise, add it normally (it's from another user)
            addMessage(message);
          }
        };

        // Initialize socket if not already done
        if (!socketRef.current) {
          socketRef.current = io(BACKEND_URL, {
            withCredentials: true,
          });

          // Setup message handler
          socketRef.current.on("chatMessage", message => {
            console.log("%c[SERVER] Message received via WebSocket", "color: #f97316;");
            upsertMessage(message);
          });

          // Handle message reactions
          socketRef.current.on("message-reacted", (updatedMessage) => {
            console.log("%c[SERVER] Message reaction received", "color: #f97316;");
            updateMessage(updatedMessage);
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
        }

        // Join the room
        socketRef.current.emit("join", currentRoom);
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
    };
  }, [user, roomType]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const now = Date.now();
    if (!newMessage.trim()) {
      toast.error("Message cannot be empty.");
      return;
    }
    if (newMessage.length > CHARACTER_LIMIT) {
      toast.error("Message exceeds character limit.");
      return;
    }
    if (now - lastSent < THROTTLE_DELAY) {
      toast.error("You're sending messages too quickly.");
      return;
    }

    const messagePayload = {
      _id: crypto.randomUUID(),
      text: newMessage.trim(),
      senderId: { _id: user.id, userName: user.username, color: getGradientColors().userColor },
      roomName: roomInfo?.roomName || "global-room",
      createdAt: new Date().toISOString()
    };

    addMessage(messagePayload);

    let wasSentByP2P = false;
    let peerCount = 0;

    dataChannelsRef.current.forEach((channel) => {
      peerCount++;
      if (channel.readyState === "open") {
        try {
          channel.send(JSON.stringify(messagePayload));
          console.log(`[CLIENT]Message sent to peer via P2P`);
          wasSentByP2P = true;
        } catch (error) {
          console.error(`P2P send error:`, error);
        }
      }
    });

    // If there are no peers, P2P send is irrelevant
    if (peerCount === 0) {
      wasSentByP2P = false;
    }

    // Always send to server for fallback and persistence
    try {
      const roomName = roomType === "global" ? "global-room" : roomInfo?.roomName;
      if (!roomName) throw new Error("Room name not available");
      const endpoint = `/api/messages/send/${roomName}`;

      // 🔽 Add a 'p2pSent' flag to the server request
      await axios.post(endpoint, {
        text: messagePayload.text,
        tempId: messagePayload._id,
        p2pSent: wasSentByP2P
      });
    } catch (error) {
      toast.error("Failed to send message to server.");
      console.error("Server send error:", error);
    }

    setNewMessage("");
    setLastSent(now);
    if (textareaRef.current) {
      textareaRef.current.style.height = "40px";
    }
  };

  // Group reactions by emoji
  const groupReactions = (reactions) => {
    const grouped = {};
    reactions.forEach(reaction => {
      if (!grouped[reaction.emoji]) {
        grouped[reaction.emoji] = [];
      }
      grouped[reaction.emoji].push(reaction);
    });
    return grouped;
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
            onClick={() => {
              setShowEmojiPicker(null);
              setShowReactionDetails(null);
            }}
          >
            {messages.map((message, index) => {
              // Skip rendering if senderId is null
              if (!message.senderId) return null;
              
              const isCurrentUser = message.senderId._id === user.id;
              const senderName = isCurrentUser ? user.username : message.senderId.userName;
              const senderColor = isCurrentUser ? colors.userColor : message.senderId.color;
              const reactions = message.reactions || [];
              const groupedReactions = groupReactions(reactions);

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
                    <div className="relative">
                      <div
                        className={`rounded-2xl px-3 py-1.5 sm:px-4 sm:py-2 backdrop-blur-sm border text-white mb-1 cursor-pointer select-none transition-all hover:brightness-110`}
                        style={{
                          backgroundColor: `${senderColor}20`,
                          borderColor: `${senderColor}30`,
                        }}
                        onMouseDown={() => handleLongPressStart(message._id)}
                        onMouseUp={handleLongPressEnd}
                        onMouseEnter={() => handleMouseEnter(message._id)}
                        onMouseLeave={() => {
                          handleLongPressEnd();
                          handleMouseLeave();
                        }}
                        onTouchStart={() => handleLongPressStart(message._id)}
                        onTouchEnd={handleLongPressEnd}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="text-white/90 text-sm sm:text-base break-words text-left">
                          {message.text}
                        </p>
                      </div>

                      {/* Reactions Display */}
                      {Object.keys(groupedReactions).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(groupedReactions).map(([emoji, reactionList]) => (
                            <button
                              key={emoji}
                              className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-all hover:bg-white/10 ${
                                reactionList.some(r => r.userId._id === user.id || r.userId === user.id)
                                  ? 'bg-white/20 border border-white/30'
                                  : 'bg-white/5 border border-white/10'
                              }`}
                              onClick={(e) => handleReaction(message._id, emoji)}
                              onTouchStart={(e) => handleReactionDetailsToggle(message._id, emoji, reactionList, e)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                handleReactionDetailsToggle(message._id, emoji, reactionList, e);
                              }}
                              title={reactionList.map(r => r.userId.userName || r.userId).join(', ')}
                            >
                              <span>{emoji}</span>
                              <span className="text-white/80">{reactionList.length}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Emoji Picker */}
                      {showEmojiPicker === message._id && (
                        <div 
                          className="absolute bottom-full left-0 mb-2 bg-black/90 backdrop-blur-sm border border-white/20 rounded-lg p-2 flex gap-2 z-50 shadow-xl"
                          onClick={(e) => e.stopPropagation()}
                          onMouseEnter={() => {
                            if (hoverTimer) {
                              clearTimeout(hoverTimer);
                              setHoverTimer(null);
                            }
                          }}
                          onMouseLeave={handleEmojiPickerClose}
                        >
                          {quickEmojis.map(emoji => (
                            <button
                              key={emoji}
                              className="text-xl hover:scale-125 transition-transform p-1 rounded hover:bg-white/10"
                              onClick={() => handleReaction(message._id, emoji)}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
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
                style={{ height: "40px", minHeight: "40px", alignSelf: "start" }}
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

        {/* Reaction Details Modal */}
        {showReactionDetails && (
          <>
            {/* Invisible overlay to close on click outside */}
            <div 
              className="fixed inset-0 z-40"
              onClick={() => setShowReactionDetails(null)}
            />
            
            {/* Small popup */}
            <div 
              className="fixed z-50 bg-black/95 backdrop-blur-sm border border-white/30 rounded-lg p-3 shadow-xl min-w-[200px] max-w-[250px]"
              style={{
                left: `${Math.min(showReactionDetails.position.x, window.innerWidth - 260)}px`,
                top: `${Math.max(10, Math.min(showReactionDetails.position.y, window.innerHeight - 200))}px`
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/20">
                <span className="text-lg">{showReactionDetails.emoji}</span>
                <span className="text-white/80 text-xs font-medium">
                  {showReactionDetails.reactions.length}
                </span>
              </div>
              
              <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                {showReactionDetails.reactions.map((reaction, index) => (
                  <div 
                    key={index}
                    className="flex items-center gap-2 py-1 px-1 rounded hover:bg-white/10 transition-colors"
                  >
                    <div 
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
                      style={{ 
                        backgroundColor: reaction.userId._id === user.id ? colors.userColor : '#64748b'
                      }}
                    >
                      {(reaction.userId.userName || reaction.userId)?.[0]?.toUpperCase() || '?'}
                    </div>
                    <span className="text-white/90 text-xs truncate flex-1">
                      {reaction.userId.userName || reaction.userId || 'Unknown'}
                      {reaction.userId._id === user.id && (
                        <span className="text-white/60 ml-1">(You)</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

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