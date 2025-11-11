import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { toast, ToastContainer } from "react-toastify";
import { useNavigate } from "react-router-dom";
import "react-toastify/dist/ReactToastify.css";
import iconImage from "../assets/icon.png";

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

function Chat({ roomType, roomCode, user, roomData }) {
  // Fix roomType detection for custom rooms
  const actualRoomType = roomType || (roomCode ? 'custom' : 'global');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [replyToId, setReplyToId] = useState(null);
  const [roomInfo, setRoomInfo] = useState(null);
  const [showMobileInfo, setShowMobileInfo] = useState(false);
  const messagesContainerRef = useRef(null);
  const socketRef = useRef(null); 
  const textareaRef = useRef(null); 
  const navigate = useNavigate();

  // Refs for WebRTC connections, data channels, and message deduplication
  const peerConnectionsRef = useRef(new Map());
  const dataChannelsRef = useRef(new Map());
  const processedMessageIds = useRef(new Set());



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

  const scrollToBottom = (behavior = 'auto') => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      const lastMessage = container.querySelector('[data-message-id]:last-child');
      if (lastMessage) {
        // Get the position of the last message relative to the container
        const containerRect = container.getBoundingClientRect();
        const lastMessageRect = lastMessage.getBoundingClientRect();
        const paddingBottom = replyToId ? 220 : 120;
        
        // Calculate scroll position to show last message at bottom of visible area (above padding)
        const currentScrollTop = container.scrollTop;
        const messageTop = lastMessageRect.top - containerRect.top + currentScrollTop;
        const targetScrollTop = messageTop - (container.clientHeight - paddingBottom) + lastMessageRect.height;
        
        container.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior
        });
      } else {
        container.scrollTo({
          top: container.scrollHeight - container.clientHeight,
          behavior
        });
      }
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    setTimeout(() => {
      scrollToBottom();
    }, 50);
  }, [messages]);

  // Scroll when reply state changes to keep messages visible
  useEffect(() => {
    if (replyToId) {
      // Use longer timeout to account for padding transition
      setTimeout(() => {
        scrollToBottom('smooth');
      }, 350);
    }
  }, [replyToId]);

  // Auto-focus the input box when component loads
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [user, roomData]); // Focus when user and room data are ready

  // Helper to add a message to state, preventing duplicates
  const addMessage = (message) => {
    // Ignore if the message is invalid
    if (!message || !message._id) return;

    // Check if we've already processed this message
    if (
      processedMessageIds.current.has(message._id) ||
      (message.tempId && processedMessageIds.current.has(message.tempId))
    ) {
      return;
    }

    // Mark as processed and add to state
    processedMessageIds.current.add(message._id);
    if (message.tempId) {
      processedMessageIds.current.add(message.tempId);
    }

    setMessages((prevMessages) => [...prevMessages, message]);
  };

  // Helper to update a message
  const updateMessage = (updatedMessage) => {
    setMessages(prevMessages => 
      prevMessages.map(msg => 
        msg._id === updatedMessage._id ? updatedMessage : msg
      )
    );
  };





  // Helper to clean up a P2P connection
  const closePeerConnection = (socketId) => {
    peerConnectionsRef.current.get(socketId)?.close();
    peerConnectionsRef.current.delete(socketId);
    dataChannelsRef.current.delete(socketId);
    console.log(`Closed P2P connection to ${socketId}`);
  };

  // Reply functionality
  const handleReply = (message) => {
    // Check if the message has a valid MongoDB ObjectId (24 hex characters)
    const isValidObjectId = /^[a-fA-F0-9]{24}$/.test(message._id);
    if (!isValidObjectId) {
      toast.error("Cannot reply to message that hasn't been confirmed yet");
      return;
    }

    setReplyToId(message._id);
    // Scroll to bottom after setting reply state with smooth behavior
    setTimeout(() => {
      scrollToBottom('smooth');
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 350);
  };

  // Mobile swipe to reply functionality
  const [swipingMessage, setSwipingMessage] = useState(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const SWIPE_THRESHOLD = 80; // Minimum swipe distance to trigger reply
  const SWIPE_VELOCITY_THRESHOLD = 0.3; // Minimum velocity for swipe

  // Add non-passive touch event listeners
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleTouchMove = (e) => {
      if (!swipingMessage) return;

      const touchX = e.touches[0].clientX;
      const touchY = e.touches[0].clientY;
      const deltaX = touchX - touchStartX.current;
      const deltaY = Math.abs(touchY - touchStartY.current);

      // Only allow horizontal swipes (limit vertical movement)
      if (deltaY < 30 && deltaX > 10) {
        e.preventDefault(); // Now this will work with non-passive listener
        setSwipeOffset(Math.max(0, deltaX));
      } else if (deltaY > 50) {
        // Cancel swipe if too much vertical movement
        setSwipingMessage(null);
        setSwipeOffset(0);
      }
    };

    container.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      container.removeEventListener('touchmove', handleTouchMove);
    };
  }, [swipingMessage]);

  const handleTouchStart = (e, message) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    // Capture a monotonic epoch time for velocity calculations
    touchStartTime.current = Date.now();
    setSwipingMessage(message._id);
    setSwipeOffset(0);
  };

  const handleTouchEnd = (e, message) => {
    if (!swipingMessage) return;

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX.current;
    const deltaY = Math.abs(touchEndY - touchStartY.current);
    // Compute velocity using the same time base as touchStartTime (ms since epoch)
    // Guard against zero-duration by adding +1ms
    const durationMs = Math.max(1, Date.now() - (touchStartTime.current || Date.now()));
    const velocity = Math.abs(deltaX) / durationMs; // px per ms

    // Check if it's a valid swipe
    if (deltaX > SWIPE_THRESHOLD && deltaY < 50 && (velocity > SWIPE_VELOCITY_THRESHOLD || deltaX > SWIPE_THRESHOLD * 1.5)) {
      // Add success animation
      const messageElement = e.target.closest('[data-message-id]');
      if (messageElement) {
        messageElement.classList.add('swipe-success');
        setTimeout(() => {
          messageElement.classList.remove('swipe-success');
        }, 200);
      }
      
      handleReply(message);
    }

    // Reset swipe state
    setSwipingMessage(null);
    setSwipeOffset(0);
  };  const cancelReply = () => {
    setReplyToId(null);
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
            try {
              const message = JSON.parse(event.data);
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
              try {
                const message = JSON.parse(e.data);
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
        if (actualRoomType === "network") {
          // Fetch room info for network rooms
          const roomResponse = await axios.get("/api/rooms/assign");
          setRoomInfo(roomResponse.data);
          currentRoom = roomResponse.data.roomName;
        } else if (actualRoomType === "custom" && roomCode) {
          // Handle custom rooms
          setRoomInfo({
            roomName: `custom-${roomCode}`,
            code: roomCode,
            ...(roomData || {})
          });
          currentRoom = `custom-${roomCode}`;
        } else if (actualRoomType === "custom" && !roomCode) {
          console.error("[ERROR] Custom room type but no room code provided");
          currentRoom = "global-room";
        } else {
          currentRoom = "global-room";
        }

        let endpoint;
        if (actualRoomType === "global") {
          endpoint = "/api/messages/global-room";
        } else if (actualRoomType === "custom") {
          endpoint = `/api/messages/custom-${roomCode}`;
        } else {
          endpoint = `/api/messages/${currentRoom}`;
        }
        const response = await axios.get(endpoint);
        if (Array.isArray(response.data)) {
            response.data.forEach(msg => {
                if(msg._id) processedMessageIds.current.add(msg._id)
            });
            setMessages(response.data.slice(-50));
        }

        const upsertMessage = (message) => {
          // Check if we already processed this permanent ID - if so, skip it entirely
          if (processedMessageIds.current.has(message._id)) {
            return;
          }

          // Mark this permanent ID as processed immediately to prevent duplicates
          processedMessageIds.current.add(message._id);

          // If this message confirms a temporary one, try to replace it
          if (message.tempId) {
            // Also mark the tempId as processed
            processedMessageIds.current.add(message.tempId);
            
            setMessages(prev => {
              // Check if we have a message with this tempId
              const hasTempMessage = prev.some(m => m._id === message.tempId);
              
              if (hasTempMessage) {
                // Replace the temp message with the confirmed one
                return prev.map(m => m._id === message.tempId ? message : m);
              } else {
                // This is from another user - we don't have their tempId, so add it normally
                return [...prev, message];
              }
            });
          } else {
            // Otherwise, add it normally (it's from another user without tempId)
            setMessages(prev => [...prev, message]);
          }
        };

        // Initialize socket if not already done
        if (!socketRef.current) {
          socketRef.current = io(BACKEND_URL, {
            withCredentials: true,
          });

          // Setup message handler
          socketRef.current.on("chatMessage", message => {
            console.log(`[Socket] Received message ${message._id} from ${message.senderId?.userName}`);
            upsertMessage(message);
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
  }, [user, actualRoomType, roomCode]);

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

    // Store the message text before clearing
    const messageText = newMessage.trim();
    
    // Clear input immediately after validation
    setNewMessage("");
    setLastSent(now);
    if (textareaRef.current) {
      textareaRef.current.style.height = "40px";
    }

    const messagePayload = {
      _id: crypto.randomUUID(),
      text: messageText,
      replyTo: replyToId ? messages.find(m => m._id === replyToId) : null,
      senderId: { _id: user.id, userName: user.username, color: user.color },
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
      let roomName;
      if (actualRoomType === "global") {
        roomName = "global-room";
      } else if (actualRoomType === "custom" && roomCode) {
        roomName = `custom-${roomCode}`;
      } else {
        roomName = roomInfo?.roomName;
      }
      if (!roomName) throw new Error("Room name not available");
      const endpoint = `/api/messages/send/${roomName}`;

      // 🔽 Add a 'p2pSent' flag to the server request
      const requestData = {
        text: messageText,
        tempId: messagePayload._id,
        p2pSent: wasSentByP2P
      };
      
      // Only include replyTo if it exists
      if (replyToId) {
        requestData.replyTo = replyToId;
      }
      
      await axios.post(endpoint, requestData);
    } catch (error) {
      toast.error("Failed to send message to server.");
      console.error("Server send error:", error);
    }

    // Clear reply state and scroll to bottom after sending
    setReplyToId(null);
    setTimeout(() => {
      scrollToBottom('smooth');
    }, 350);
  };



  const getGradientColors = () => {
    if (actualRoomType === "global") {
      return {
        from: "from-violet-400 via-purple-700 to-indigo-500",
        button: "from-violet-600 to-blue-600",
        bg: "from-violet-600/5 via-transparent to-purple-600/5",
        accent: "from-violet-300 via-purple-400 to-indigo-300",
        border: "border-violet-500/20",
        userColor: "#7c3aed"
      };
    } else if (actualRoomType === "custom") {
      return {
        from: "from-rose-400 via-pink-500 to-fuchsia-500",
        button: "from-rose-600 to-pink-600",
        bg: "from-rose-600/5 via-transparent to-pink-600/5",
        accent: "from-rose-300 via-pink-400 to-fuchsia-300",
        border: "border-rose-500/20",
        userColor: "#e11d48"
      };
    } else {
      return {
        from: "from-emerald-400 via-teal-500 to-cyan-500",
        button: "from-emerald-600 to-cyan-600",
        bg: "from-emerald-600/5 via-transparent to-cyan-600/5",
        accent: "from-emerald-300 via-teal-400 to-cyan-300",
        border: "border-emerald-500/20",
        userColor: "#10b981"
      };
    }
  };

  const colors = getGradientColors();

  return (
    <>
      <ToastContainer position="bottom-right" autoClose={2500} theme="dark" />
      <link
        href="https://fonts.googleapis.com/css2?family=Gloria+Hallelujah&display=swap"
        rel="stylesheet"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Monoton&display=swap"
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
          <div className="flex-shrink-0 p-2 sm:p-3 md:p-4 border-b border-white/10">
            <div className="flex items-center justify-between gap-2 sm:gap-3 flex-wrap">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0 flex-1">
                <button
                  onClick={() => navigate('/')}
                  className="h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 select-none flex-shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
                  aria-label="Go back to dashboard"
                >
                  <img
                    src={iconImage}
                    alt="Waves - Go back to dashboard"
                    className="h-full w-full"
                  />
                </button>
                <h1 className={`font text-lg sm:text-xl md:text-2xl font-bold bg-gradient-to-r ${colors.from} bg-clip-text text-transparent flex-shrink-0`}>
                  {actualRoomType === "global" ? "Global" : actualRoomType === "custom" ? "Custom" : "Network"} room
                </h1>
                {/* Desktop info - hidden on mobile */}
                <span className={`hidden sm:inline text-xs sm:text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-0.5 sm:py-1 rounded-full border ${colors.border} backdrop-blur-sm flex-shrink-0`}>
                  {user.username}
                </span>
                {actualRoomType === "network" && roomInfo && (
                  <span className={`hidden sm:inline text-xs sm:text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-0.5 sm:py-1 rounded-full border ${colors.border} backdrop-blur-sm flex-shrink-0`}>
                    {roomInfo.roomName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {actualRoomType === "custom" && (
                  <button
                    onClick={() => {
                      const roomUrl = `${window.location.origin}/chat/custom/${roomCode}`;
                      if (navigator.share) {
                        // Use native sharing if available
                        navigator.share({
                          title: 'Join my Waves chat room!',
                          text: `Join me in a custom chat room on Waves`,
                          url: roomUrl
                        }).catch(err => {
                          // Fallback to clipboard copy if sharing fails
                          navigator.clipboard.writeText(`Join my Waves chat room: ${roomUrl}`);
                          toast.success("Room link copied to clipboard!");
                        });
                      } else {
                        // Fallback for browsers without native sharing
                        navigator.clipboard.writeText(`Join my Waves chat room: ${roomUrl}`);
                        toast.success("Room link copied to clipboard!");
                      }
                    }}
                    className={`text-xs sm:text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-0.5 sm:py-1 rounded-full border ${colors.border} backdrop-blur-sm hover:opacity-80 transition-opacity cursor-pointer flex items-center gap-1 flex-shrink-0`}
                    title="Click to share room with friends"
                  >
                    <span className="hidden sm:inline">Code: {roomCode}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                    </svg>
                  </button>
                )}
                {/* Info button for mobile */}
                <button
                  onClick={() => setShowMobileInfo(true)}
                  className={`sm:hidden p-1.5 rounded-lg bg-gradient-to-r ${colors.button} hover:opacity-90 transition-opacity text-white flex items-center border ${colors.border} backdrop-blur-sm flex-shrink-0`}
                  aria-label="Show room info"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Info Modal */}
          {showMobileInfo && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowMobileInfo(false)}>
              <div className={`bg-gradient-to-br ${colors.cardBg} border ${colors.border} rounded-2xl p-6 max-w-sm w-full backdrop-blur-md shadow-2xl`} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                  <h2 className={`text-lg font-bold bg-gradient-to-r ${colors.from} bg-clip-text text-transparent`}>
                    Room Info
                  </h2>
                  <button
                    onClick={() => setShowMobileInfo(false)}
                    className={`p-1 rounded-lg hover:bg-white/10 transition-colors text-white`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-white/70 text-sm">Room Type:</span>
                    <span className={`text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent`}>
                      {actualRoomType === "global" ? "Global" : actualRoomType === "custom" ? "Custom" : "Network"} room
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white/70 text-sm">Username:</span>
                    <span className={`text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-1 rounded-full border ${colors.border} backdrop-blur-sm`}>
                      {user.username}
                    </span>
                  </div>
                  {actualRoomType === "network" && roomInfo && (
                    <div className="flex items-center gap-2">
                      <span className="text-white/70 text-sm">Network:</span>
                      <span className={`text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-1 rounded-full border ${colors.border} backdrop-blur-sm`}>
                        {roomInfo.roomName}
                      </span>
                    </div>
                  )}
                  {actualRoomType === "custom" && (
                    <div className="flex items-center gap-2">
                      <span className="text-white/70 text-sm">Room Code:</span>
                      <span className={`text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-1 rounded-full border ${colors.border} backdrop-blur-sm`}>
                        {roomCode}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Messages Area - Scrollable */}
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 space-y-2 custom-scrollbar"
            style={{ 
              paddingBottom: replyToId ? '220px' : '120px',
              transition: 'padding-bottom 0.3s ease-out'
            }}
          >
            {messages.map((message, index) => {
              // Skip rendering if senderId is null
              if (!message.senderId) return null;
              
              const isCurrentUser = message.senderId._id === user.id;
              const senderName = isCurrentUser ? user.username : message.senderId.userName;
              const senderColor = isCurrentUser ? colors.userColor : message.senderId.color;


              return (
                <div
                  key={message._id || index}
                  className={`flex ${isCurrentUser ? "justify-end" : "justify-start"}`}
                  data-message-id={message._id}
                >
                  <div 
                    className="max-w-[85%] sm:max-w-[70%] relative z-0 group"
                    style={{
                      transform: swipingMessage === message._id ? `translateX(${swipeOffset}px)` : 'translateX(0)',
                      transition: swipingMessage === message._id ? 'none' : 'transform 0.2s ease-out'
                    }}
                    onTouchStart={(e) => handleTouchStart(e, message)}
                    onTouchEnd={(e) => handleTouchEnd(e, message)}
                  >
                    {/* Swipe indicator */}
                    {swipingMessage === message._id && swipeOffset > 20 && (
                      <div 
                        className={`absolute left-0 top-0 bottom-0 flex items-center justify-center w-12 rounded-l-2xl backdrop-blur-sm border-l-2 transition-all duration-200 ${
                          swipeOffset > SWIPE_THRESHOLD ? 'bg-green-500/30 border-green-400' : 'bg-blue-500/20 border-blue-400'
                        }`}
                        style={{ 
                          transform: 'translateX(-100%)',
                          opacity: swipeOffset > 20 ? 1 : 0
                        }}
                      >
                        <svg 
                          className={`w-5 h-5 transition-colors duration-200 ${
                            swipeOffset > SWIPE_THRESHOLD ? 'text-green-400' : 'text-blue-400'
                          }`} 
                          fill={swipeOffset > SWIPE_THRESHOLD ? 'currentColor' : 'none'} 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                      </div>
                    )}
                    {/* Reply display */}
                    {message.replyTo && (() => {
                      const repliedMessageColor = message.replyTo.senderId?._id === user.id 
                        ? colors.userColor 
                        : message.replyTo.senderId?.color || '#6b7280';
                      
                      return (
                        <div className="mb-3 ml-2 sm:ml-3">
                          <div className="flex items-center gap-2 text-xs mb-2" style={{ color: `${repliedMessageColor}` }}>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                            <span className="font-medium">Replying to {message.replyTo.senderId?.userName || 'Unknown'}</span>
                          </div>
                          <div 
                            className="rounded-lg px-3 py-2 max-w-full backdrop-blur-sm cursor-pointer hover:brightness-110 transition-all"
                            style={{
                              background: `${repliedMessageColor}15`,
                              borderLeft: `3px solid ${repliedMessageColor}60`
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              // Find the original message element and scroll to it
                              const originalMessageElement = document.querySelector(`[data-message-id="${message.replyTo._id}"]`);
                              if (originalMessageElement) {
                                // Check if element is already visible
                                const container = messagesContainerRef.current;
                                const elementRect = originalMessageElement.getBoundingClientRect();
                                const containerRect = container.getBoundingClientRect();
                                
                                const isVisible = elementRect.top >= containerRect.top && 
                                                 elementRect.bottom <= containerRect.bottom;
                                
                                if (!isVisible) {
                                  originalMessageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }
                                
                                // Add highlight effect
                                originalMessageElement.classList.add('highlight-message');
                                setTimeout(() => {
                                  originalMessageElement.classList.remove('highlight-message');
                                }, 2000);
                              }
                            }}
                            title="Click to view original message"
                          >
                            <p className="text-gray-300 text-sm line-clamp-2">
                              {message.replyTo.text}
                            </p>
                          </div>
                        </div>
                      );
                    })()}

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
                        className={`rounded-2xl px-3 py-1.5 sm:px-4 sm:py-2 backdrop-blur-sm border text-white mb-1 cursor-pointer select-none transition-all hover:brightness-110 hover:shadow-md group-hover:shadow-sm`}
                        style={{
                          backgroundColor: `${senderColor}20`,
                          borderColor: `${senderColor}30`,
                        }}

                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="text-white/90 text-sm sm:text-base break-words text-left">
                          {message.text}
                        </p>
                      </div>

                      {/* Reply button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReply(message);
                        }}
                        className="absolute -top-1 -right-1 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
                        style={{
                          background: `linear-gradient(135deg, ${senderColor}, ${senderColor}dd)`,
                        }}
                        title="Reply to this message"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Input Area - Fixed */}
          <div className="fixed bottom-0 left-0 right-0 p-2 sm:p-3 md:p-4 border-t border-white/10 bg-black/90 backdrop-blur-xl z-30">
            {/* Reply Preview */}
            {replyToId && (() => {
              const replyMessage = messages.find(m => m._id === replyToId);
              if (!replyMessage) return null;
              
              const replyPreviewColor = replyMessage.senderId?._id === user.id 
                ? colors.userColor 
                : replyMessage.senderId?.color || '#6b7280';
              
              return (
                <div className="max-w-4xl mx-auto mb-3 opacity-100 animate-fade-in">
                  <div 
                    className="rounded-xl border p-3 backdrop-blur-sm shadow-lg transform transition-all duration-300 ease-out"
                    style={{
                      background: `linear-gradient(135deg, ${replyPreviewColor}15, ${replyPreviewColor}08)`,
                      borderColor: `${replyPreviewColor}40`
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-sm" style={{ color: replyPreviewColor }}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                        <span className="font-medium">Replying to {replyMessage.senderId?.userName || 'Unknown'}</span>
                      </div>
                      <button
                        onClick={cancelReply}
                        className="text-gray-400 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-lg"
                        title="Cancel reply (Esc)"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div 
                      className="rounded-lg px-3 py-2 max-w-full backdrop-blur-sm cursor-pointer hover:brightness-110 transition-all"
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        borderLeft: `3px solid ${replyPreviewColor}80`
                      }}
                      onClick={() => {
                        // Scroll to the original message when clicked
                        const originalMessageElement = document.querySelector(`[data-message-id="${replyToId}"]`);
                        if (originalMessageElement) {
                          // Check if element is already visible
                          const container = messagesContainerRef.current;
                          const elementRect = originalMessageElement.getBoundingClientRect();
                          const containerRect = container.getBoundingClientRect();
                          
                          const isVisible = elementRect.top >= containerRect.top && 
                                           elementRect.bottom <= containerRect.bottom;
                          
                          if (!isVisible) {
                            originalMessageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }
                          
                          // Add highlight effect
                          originalMessageElement.classList.add('highlight-message');
                          setTimeout(() => {
                            originalMessageElement.classList.remove('highlight-message');
                          }, 2000);
                        }
                      }}
                      title="Click to view original message"
                    >
                      <p className="text-gray-200 text-sm line-clamp-2">
                        {replyMessage.text}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            <form
              onSubmit={handleSendMessage}
              className="flex gap-2 max-w-4xl mx-auto relative"
            >
              <div className="relative flex-1">
                <textarea
                  ref={textareaRef}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder={replyToId ? `Reply to ${messages.find(m => m._id === replyToId)?.senderId?.userName || 'user'}...` : "Type your message..."}
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
                    } else if (e.key === "Escape" && replyToId) {
                      e.preventDefault();
                      cancelReply();
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



        <style>{`
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
          .waves-font {
            font-family: "Monoton", cursive;
          }
          .h-screen {
            height: calc(var(--vh, 1vh) * 100);
          }
          .line-clamp-2 {
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }
          .animate-fade-in {
            animation: fadeIn 0.3s ease-out;
          }
          @keyframes fadeIn {
            from {
              opacity: 0;
              transform: translateY(10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .highlight-message {
            animation: highlight 2s ease-out;
          }
          @keyframes highlight {
            0% {
              background: ${colors.userColor}30;
            }
            50% {
              background: ${colors.userColor}20;
            }
            100% {
              background: transparent;
            }
          }
          .swipe-success {
            animation: swipeSuccess 0.2s ease-out;
          }
          @keyframes swipeSuccess {
            0% {
              transform: translateX(0) scale(1);
            }
            50% {
              transform: translateX(20px) scale(0.95);
            }
            100% {
              transform: translateX(0) scale(1);
            }
          }
        `}</style>
      </div>


    </>
  );
}

export default Chat;