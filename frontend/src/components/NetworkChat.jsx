import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import JoinRoom from "./JoinRoom";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// Configure axios defaults
axios.defaults.withCredentials = true;

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

function NetworkChat() {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [user, setUser] = useState(null);
  const [room, setRoom] = useState(null);
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

  // Setup socket connection, room, and message handling
  useEffect(() => {
    let currentRoom = null;

    const setupSocketAndRoom = async () => {
      if (isJoined && user) {
        try {
          // Initialize socket if not already done
          if (!socketRef.current) {
            socketRef.current = io(BACKEND_URL, {
              withCredentials: true,
            });
          }

          // Get assigned room based on IP
          const roomResponse = await axios.get("/api/rooms/assign");
          currentRoom = roomResponse.data;
          setRoom(currentRoom);

          // Fetch messages for this room
          const messagesResponse = await axios.get(
            `/api/messages/${currentRoom.roomName}`
          );
          setMessages(
            Array.isArray(messagesResponse.data)
              ? messagesResponse.data.slice(-50)
              : []
          );

          // Join the socket room
          socketRef.current.emit("join", currentRoom.roomName);

          // Setup message handler
          const handleNewMessage = (message) => {
            setMessages((prevMessages) => [...prevMessages, message]);
          };

          socketRef.current.on("chatMessage", handleNewMessage);
        } catch (error) {
          console.error("Error setting up room:", error);
        }
      }
    };

    setupSocketAndRoom();

    // Cleanup function
    return () => {
      if (socketRef.current) {
        socketRef.current.off("chatMessage"); // Remove all chatMessage listeners
        if (currentRoom?.roomName) {
          socketRef.current.emit("leave", currentRoom.roomName);
          // Don't await this since it's in cleanup
          axios
            .post(`/api/rooms/leave/${currentRoom.roomName}`)
            .catch(console.error);
        }
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [isJoined, user]);

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
    if (room && socketRef.current) {
      try {
        await axios.post(`/api/messages/send/${room.roomName}`, {
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
    }
  };

  const handleJoin = (userData) => {
    setUser(userData);
    setIsJoined(true);
  };

  const handleLeaveRoom = () => {
    setIsJoined(false);
    setUser(null);
    setMessages([]);
    setRoom(null);
  };

  if (!isJoined) {
    return <JoinRoom onJoin={handleJoin} roomName="Network" />;
  }

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
          <div className="absolute inset-0 bg-gradient-to-tr from-emerald-600/5 via-transparent to-cyan-600/5"></div>
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 via-transparent to-cyan-500/10 animate-gradient"></div>
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          </div>
        </div>

        <div className="relative z-10 flex flex-col h-full">
          {/* Header - Fixed */}
          <div className="flex-shrink-0 flex items-center justify-between p-2 sm:p-3 md:p-4 border-b border-white/10">
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <h1 className="font text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500 bg-clip-text text-transparent">
                Network room
              </h1>
              <span className="text-xs sm:text-sm font-medium bg-gradient-to-r from-emerald-300 via-teal-400 to-cyan-300 bg-clip-text text-transparent px-2 py-0.5 sm:py-1 rounded-full border border-emerald-500/20 backdrop-blur-sm">
                {user.username}
              </span>
              {room && (
                <span className="text-xs sm:text-sm font-medium bg-gradient-to-r from-emerald-300 via-teal-400 to-cyan-300 bg-clip-text text-transparent px-2 py-0.5 sm:py-1 rounded-full border border-emerald-500/20 backdrop-blur-sm">
                  {room.roomName}
                </span>
              )}
            </div>
            <button
              onClick={handleLeaveRoom}
              className="px-2.5 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 bg-gradient-to-r from-emerald-600 to-cyan-600 rounded-lg text-white hover:opacity-90 transition-opacity text-xs sm:text-sm md:text-base whitespace-nowrap flex items-center gap-1"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 sm:h-5 sm:w-5"
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
              <span className="hidden sm:inline">Leave Room</span>
            </button>
          </div>

          {/* Messages Area - Scrollable */}
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 space-y-2 custom-scrollbar pb-[90px] sm:pb-[100px] md:pb-[110px] lg:pb-[120px]"
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
                        ? "text-right text-emerald-400"
                        : "text-left"
                    }`}
                    style={{
                      color:
                        message.senderId._id === user.id
                          ? "#10b981"
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
                          ? "#10b98120"
                          : `${message.senderId.color}20`,
                      borderColor:
                        message.senderId._id === user.id
                          ? "#10b98130"
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
                  className="w-full bg-white/5 text-white rounded-xl px-3 py-2 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-emerald-600/50 border border-white/10 transition-all min-h-[40px] max-h-40 pr-14 text_scroll text_scroll"
                  onInput={(e) => {
                    // Auto-resize textarea
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
                        ? "text-[#22c55e]"
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
                className={`px-3 sm:px-6 py-2 bg-gradient-to-r from-emerald-600 to-cyan-600 rounded-xl text-white hover:opacity-90 transition-opacity font-medium text-sm sm:text-base whitespace-nowrap flex items-center gap-1.5 ${
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

          <style jsx global>{`
            .text_scroll::-webkit-scrollbar {
              width: 0px; !important
              height: 0px; !important
            }            
            .custom-scrollbar::-webkit-scrollbar {
              width: 6px;
            }
            .custom-scrollbar::-webkit-scrollbar-track {
              background: transparent;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb {
              background: linear-gradient(to bottom, #10b981, #0891b2);
              border-radius: 3px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
              background: linear-gradient(to bottom, #059669, #0e7490);
            }
            .font {
              font-family: "Gloria Hallelujah", cursive;
              font-weight: 400;
              font-style: normal;
            }

            /* Use custom viewport height */
            .h-screen {
              height: calc(var(--vh, 1vh) * 100);
            }
          `}</style>
        </div>
      </div>
    </>
  );
}

export default NetworkChat;
