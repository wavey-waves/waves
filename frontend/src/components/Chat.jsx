import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { toast, ToastContainer } from "react-toastify";
import { useNavigate } from "react-router-dom";
import "react-toastify/dist/ReactToastify.css";

// Configure axios defaults
axios.defaults.withCredentials = true;

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

function Chat({ roomType, user }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [roomInfo, setRoomInfo] = useState(null);
  const messagesContainerRef = useRef(null);
  const socketRef = useRef(null);
  const CHARACTER_LIMIT = 1000;
  const CHARACTER_WARNING = 900;
  const textareaRef = useRef(null);
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

  // Setup socket connection and fetch initial data
  useEffect(() => {
    let currentRoom = null;

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

        // Initialize socket if not already done
        if (!socketRef.current) {
          socketRef.current = io(BACKEND_URL, {
            withCredentials: true,
          });

          // Setup message handler
          socketRef.current.on("chatMessage", (message) => {
            setMessages((prevMessages) => [...prevMessages, message]);
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
        }

        // Join the room
        socketRef.current.emit("join", currentRoom);

        // Fetch existing messages
        const endpoint = roomType === "global" ? "/api/messages/global-room" : `/api/messages/${currentRoom}`;
        const response = await axios.get(endpoint);
        setMessages(Array.isArray(response.data) ? response.data.slice(-50) : []);
      } catch (error) {
        console.error("Error setting up socket or fetching data:", error);
        toast.error("Failed to connect to chat server");
      }
    };

    if (user) {
      setupSocketAndFetchData();
    }

    // Cleanup function
    return () => {
      if (socketRef.current) {
        if (currentRoom) {
          socketRef.current.emit("leave", currentRoom);
        }
        socketRef.current.off("chatMessage");
        socketRef.current.off("error");
        socketRef.current.off("reconnect");
        socketRef.current.disconnect();
        socketRef.current = null;
      }
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
    try {
      const endpoint = roomType === "global" ? "/api/messages/send/global-room" : `/api/messages/send/${roomInfo?.roomName || ""}`;
      await axios.post(endpoint, {
        text: newMessage.trim(),
      });
      setNewMessage("");
      setLastSent(now);
      if (textareaRef.current) {
        textareaRef.current.style.height = "40px";
      }
    } catch (error) {
      toast.error("Error sending message.");
      console.error("Error sending message:", error);
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
            {messages.map((message, index) => (
              <div
                key={message._id || index}
                className={`flex ${
                  message.senderId._id === user.id
                    ? "justify-end"
                    : "justify-start"
                }`}
              >
                <div className="max-w-[85%] sm:max-w-[70%] relative z-0">
                  <div
                    className={`text-xs sm:text-sm font-semibold mb-0.5 ${
                      message.senderId._id === user.id
                        ? "text-right"
                        : "text-left"
                    }`}
                    style={{
                      color:
                        message.senderId._id === user.id
                          ? colors.userColor
                          : message.senderId.color,
                    }}
                  >
                    {message.senderId._id === user.id
                      ? user.username
                      : message.senderId.userName}
                  </div>
                  <div
                    className={`rounded-2xl px-3 py-1.5 sm:px-4 sm:py-2 backdrop-blur-sm border text-white mb-1`}
                    style={{
                      backgroundColor:
                        message.senderId._id === user.id
                          ? `${colors.userColor}20`
                          : `${message.senderId.color}20`,
                      borderColor:
                        message.senderId._id === user.id
                          ? `${colors.userColor}30`
                          : `${message.senderId.color}30`,
                    }}
                  >
                    <p className="text-white/90 text-sm sm:text-base break-words text-left">
                      {message.text}
                    </p>
                  </div>
                </div>
              </div>
            ))}
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