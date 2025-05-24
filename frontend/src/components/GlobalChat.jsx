import { useState, useEffect, useRef } from "react";
import JoinRoom from "./JoinRoom";

function GlobalChat() {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [user, setUser] = useState(null);
  const messagesContainerRef = useRef(null);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim()) {
      setMessages([...messages, { text: newMessage, sender: user.username }]);
      setNewMessage("");
    }
  };

  const handleJoin = (userData) => {
    // TODO: Add backend integration here
    // For now, we'll just set the user data
    setUser(userData);
  };

  if (!user) {
    return <JoinRoom onJoin={handleJoin} roomName="Global" />;
  }

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Gloria+Hallelujah&display=swap"
        rel="stylesheet"
      />
      <div className="relative h-screen flex flex-col bg-black">
        <div className="fixed inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950 to-black"></div>
          <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/5 via-transparent to-purple-600/5"></div>
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/10 via-transparent to-purple-500/10 animate-gradient"></div>
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          </div>
        </div>

        <div className="relative z-10 flex flex-col h-full">
          {/* Header - Fixed */}
          <div className="flex-shrink-0 flex items-center justify-between p-2 sm:p-3 md:p-4 border-b border-white/10">
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <h1 className="font text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-violet-400 via-purple-700 to-indigo-500 bg-clip-text text-transparent">
                Global room
              </h1>
              <span className="text-xs sm:text-sm font-medium bg-gradient-to-r from-violet-300 via-purple-400 to-indigo-300 bg-clip-text text-transparent px-2 py-0.5 sm:py-1 rounded-full border border-violet-500/20 backdrop-blur-sm">
                {user.username}
              </span>
            </div>
            <button
              onClick={() => window.history.back()}
              className="px-2.5 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 bg-gradient-to-r from-violet-600 to-blue-600 rounded-lg text-white hover:opacity-90 transition-opacity text-xs sm:text-sm md:text-base whitespace-nowrap flex items-center gap-1"
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
              <span className="hidden sm:inline">Back</span>
            </button>
          </div>

          {/* Messages Area - Scrollable */}
          <div 
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4 custom-scrollbar"
          >
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${
                  message.sender === user.username ? "justify-end" : "justify-start"
                }`}
              >
                <div className="max-w-[85%] sm:max-w-[70%]">
                  <div
                    className={`text-xs sm:text-sm font-semibold mb-1 ${
                      message.sender === user.username
                        ? "text-right text-violet-400"
                        : "text-left text-blue-400"
                    }`}
                  >
                    {message.sender}
                  </div>
                  <div
                    className={`rounded-2xl px-3 py-1.5 sm:px-4 sm:py-2 backdrop-blur-sm ${
                      message.sender === user.username
                        ? "bg-violet-600/20 border border-violet-500/30 text-white"
                        : "bg-blue-600/20 border border-blue-500/30 text-white"
                    }`}
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
          <div className="flex-shrink-0 p-4 pb-15 border-t border-white/10 bg-black/40 backdrop-blur-xl">
            <form
              onSubmit={handleSendMessage}
              className="flex gap-2 max-w-4xl mx-auto"
            >
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type your message..."
                className="flex-1 bg-white/5 text-white rounded-xl px-3 py-1.5 sm:px-4 sm:py-2 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-violet-600/50 border border-white/10"
              />
              <button
                type="submit"
                className="px-4 sm:px-6 py-1.5 sm:py-2 bg-gradient-to-r from-violet-600 to-blue-600 rounded-xl text-white hover:opacity-90 transition-opacity font-medium text-sm sm:text-base whitespace-nowrap flex items-center gap-1.5"
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
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" 
                  />
                </svg>
                <span className="hidden sm:inline">Send</span>
              </button>
            </form>
          </div>
        </div>

        <style jsx global>{`
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: linear-gradient(to bottom, #7c3aed, #3b82f6);
            border-radius: 3px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(to bottom, #6d28d9, #2563eb);
          }
          .font {
            font-family: "Gloria Hallelujah", cursive;
            font-weight: 400;
            font-style: normal;
          }
        `}</style>
      </div>
    </>
  );
}

export default GlobalChat;
