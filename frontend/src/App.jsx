import "./App.css";
import { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate,
  Navigate,
  useLocation,
  useParams,
} from "react-router-dom";
import Chat from "./components/Chat";
import JoinRoom from "./components/JoinRoom";
import axios from "axios";

// Configure axios defaults
axios.defaults.withCredentials = true;

function Home({ onJoinRoom }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showJoinRoom, setShowJoinRoom] = useState(location.state?.showJoinRoom || false);
  const [selectedRoomType, setSelectedRoomType] = useState(location.state?.roomType || null);

  // Clear location state after reading it
  useEffect(() => {
    if (location.state) {
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const handleRoomSelect = (roomType) => {
    setSelectedRoomType(roomType);
    setShowJoinRoom(true);
  };

  const handleJoinSuccess = (userData) => {
    onJoinRoom(userData, selectedRoomType);
    setShowJoinRoom(false);
    navigate(`/chat/${selectedRoomType}`, { state: { fromHome: true } });
  };

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Monoton&display=swap"
        rel="stylesheet"
      />
      <div className="relative overflow-hidden align-middle flex flex-col items-center justify-center min-h-screen">
        <div className="relative z-10 w-full">
          <div className="flex flex-col items-center mb-12 mt-8">
            <span
              className="z-100 waves-font text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-extrabold tracking-tight bg-gradient-to-r from-violet-400 via-purple-700 to-indigo-500 bg-clip-text text-transparent select-none"
              style={{
                textShadow: "0 0px 50px #6d28d9, 0 2px 0 #000",
                WebkitTextStroke: "1px #a78bfa",
              }}
            >
              Waves
            </span>
          </div>

          <div className="relative w-full flex flex-col md:flex-row gap-8 md:gap-5 items-center justify-center overflow-visible">
            <div className="fixed inset-0 z-0">
              <div className="absolute inset-0 bg-gradient-to-b from-slate-950 to-black"></div>
              <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/5 via-transparent to-purple-600/5"></div>
              <div
                className="absolute inset-0 opacity-40"
                style={{
                  backgroundImage: `url("data:image/svg+xml;base64,PHN2ZyB3aW...")`,
                  backgroundRepeat: "repeat",
                }}
              ></div>
              <div className="absolute inset-0">
                <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/10 via-transparent to-purple-500/10 animate-gradient"></div>
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
              </div>
            </div>

            <div 
              className="relative group w-full max-w-xs transition duration-300 transform hover:scale-105 hover:-translate-y-2 hover:rotate-1 hover:shadow-2xl hover:cursor-pointer"
              onClick={() => handleRoomSelect("global")}
            >
              <div className="absolute inset-0.5 bg-gradient-to-r from-violet-600 to-blue-600 rounded-3xl blur opacity-30 group-hover:opacity-80 transition duration-500 animated-gradient"></div>
              <div className="relative bg-black/80 backdrop-blur-xl rounded-2xl p-6 sm:p-8 shadow-2xl border border-gray-800/50 space-y-6">
                <div className="relative flex items-center gap-2">
                  <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-r from-violet-600 to-blue-600 rounded-full">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-5 h-5 sm:w-6 sm:h-6 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2l9 7-9 7-9-7z" />
                      <path d="M12 22V8" />
                    </svg>
                  </div>
                  <p className="text-lg sm:text-xl font-bold text-white">
                    Join Global room
                  </p>
                </div>
              </div>
            </div>

            <div 
              className="relative group w-full max-w-xs transition duration-300 transform hover:scale-105 hover:-translate-y-2 hover:rotate-1 hover:shadow-2xl hover:cursor-pointer"
              onClick={() => handleRoomSelect("network")}
            >
              <div className="absolute inset-0.5 bg-gradient-to-r from-emerald-600 to-cyan-600 rounded-3xl blur opacity-30 group-hover:opacity-80 transition duration-500 animated-gradient"></div>
              <div className="relative bg-black/80 backdrop-blur-xl rounded-2xl p-6 sm:p-8 shadow-2xl border border-gray-800/50 space-y-6">
                <div className="relative flex items-center gap-2">
                  <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-r from-emerald-600 to-cyan-600 rounded-full">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-5 h-5 sm:w-6 sm:h-6 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
                    </svg>
                  </div>
                  <p className="text-lg sm:text-xl font-bold text-white">
                    Join Network
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showJoinRoom && (
        <JoinRoom 
          onJoin={handleJoinSuccess} 
          roomName={selectedRoomType === "global" ? "Global" : "Network"} 
          onClose={() => setShowJoinRoom(false)}
        />
      )}
    </>
  );
}

function ChatRoute() {
  const { roomType } = useParams();
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Try to get current user from session using the check endpoint
        const response = await axios.get('/api/auth/check');
        setUser({
          id: response.data._id,
          username: response.data.userName,
          color: response.data.color,
          isAnonymous: response.data.isAnonymous
        });
      } catch (error) {
        // If no valid session, redirect to home
        navigate('/', { replace: true });
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [navigate]);

  if (isLoading) {
    return null; // or a loading spinner
  }

  return user ? <Chat roomType={roomType} user={user} /> : null;
}

function App() {
  const [user, setUser] = useState(null);
  const [roomType, setRoomType] = useState(null);

  const handleJoinRoom = (userData, type) => {
    setUser(userData);
    setRoomType(type);
  };

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home onJoinRoom={handleJoinRoom} />} />
        <Route 
          path="/chat/:roomType" 
          element={<ChatRoute />} 
        />
      </Routes>
    </Router>
  );
}

export default App;
