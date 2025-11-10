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
import CustomRoom from "./components/CustomRoom";
import Documentation from "./components/Documentation";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import axios from "axios";

// Configure axios defaults
axios.defaults.withCredentials = true;

function Home({ onJoinRoom }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showJoinRoom, setShowJoinRoom] = useState(location.state?.showJoinRoom || false);
  const [selectedRoomType, setSelectedRoomType] = useState(location.state?.roomType || null);
  const [showCustomRoom, setShowCustomRoom] = useState(false);
  const [customRoomData, setCustomRoomData] = useState(null);
  const [showDocumentation, setShowDocumentation] = useState(false);

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

  const handleCustomRoomJoin = (roomData) => {
    // Store custom room data and show join room component
    setCustomRoomData(roomData);
    setSelectedRoomType('custom');
    setShowCustomRoom(false);
    setShowJoinRoom(true);
  };

  const handleCustomJoinSuccess = (userData) => {
    onJoinRoom(userData, 'custom');
    setShowJoinRoom(false);
    navigate(`/chat/custom/${customRoomData.code}`, { state: { fromHome: true, roomData: customRoomData } });
  };

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Monoton&display=swap"
        rel="stylesheet"
      />
      <div className="relative overflow-hidden align-middle flex flex-col items-center justify-center min-h-screen">
        {/* Documentation Button - Top Right */}
        <button
          onClick={() => setShowDocumentation(true)}
          className="fixed top-6 right-6 z-50 group"
          aria-label="Open Documentation"
        >
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-violet-600 to-purple-600 rounded-full blur opacity-50 group-hover:opacity-100 transition duration-300"></div>
            <div className="relative bg-gradient-to-r from-violet-600 to-purple-600 text-white px-4 py-2 rounded-full flex items-center gap-2 shadow-lg hover:shadow-2xl transition-all duration-300 hover:scale-105">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
              <span className="font-semibold text-sm">Docs</span>
            </div>
          </div>
        </button>

        <div className="relative z-10 w-full">
          <div className="flex flex-col items-center mb-12 mt-8 relative">
            {/* Subtle background glow */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-80 h-80 bg-gradient-to-r from-violet-600/10 via-purple-600/15 to-indigo-600/10 rounded-full blur-3xl"></div>
            </div>
            
            {/* Main text with moderate effects */}
            <span
              className="relative z-10 waves-font text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-extrabold tracking-tight bg-gradient-to-r from-violet-400 via-purple-700 to-indigo-500 bg-clip-text text-transparent select-none"
              style={{
                textShadow: "0 0px 60px #6d28d9, 0 2px 0 #000",
                WebkitTextStroke: "1px #a78bfa",
                filter: "drop-shadow(0 0 15px rgba(139, 92, 246, 0.4))",
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

            <div 
              className="relative group w-full max-w-xs transition duration-300 transform hover:scale-105 hover:-translate-y-2 hover:rotate-1 hover:shadow-2xl hover:cursor-pointer"
              onClick={() => setShowCustomRoom(true)}
            >
              <div className="absolute inset-0.5 bg-gradient-to-r from-orange-600 to-red-600 rounded-3xl blur opacity-30 group-hover:opacity-80 transition duration-500 animated-gradient"></div>
              <div className="relative bg-black/80 backdrop-blur-xl rounded-2xl p-6 sm:p-8 shadow-2xl border border-gray-800/50 space-y-6">
                <div className="relative flex items-center gap-2">
                  <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-r from-orange-600 to-red-600 rounded-full">
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
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <p className="text-lg sm:text-xl font-bold text-white">
                    Custom Room
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showJoinRoom && (
        <JoinRoom 
          onJoin={selectedRoomType === 'custom' ? handleCustomJoinSuccess : handleJoinSuccess} 
          roomName={
            selectedRoomType === "global" ? "Global" : 
            selectedRoomType === "network" ? "Network" : 
            selectedRoomType === "custom" ? `Custom ${customRoomData?.code}` : 
            "Room"
          } 
          onClose={() => setShowJoinRoom(false)}
          isCustomRoom={selectedRoomType === 'custom'}
          customRoomData={customRoomData}
        />
      )}

      {showCustomRoom && (
        <CustomRoom 
          onJoin={handleCustomRoomJoin}
          onClose={() => setShowCustomRoom(false)}
        />
      )}

      {/* Documentation Modal */}
      <Documentation 
        isOpen={showDocumentation} 
        onClose={() => setShowDocumentation(false)} 
      />
    </>
  );
}

function ChatRoute() {
  const { roomType: urlRoomType, roomCode } = useParams();
  // Determine actual room type: if roomCode exists, it's a custom room
  const roomType = roomCode ? 'custom' : urlRoomType;
  console.log(`[DEBUG] URL params - urlRoomType: ${urlRoomType}, roomCode: ${roomCode}, resolved roomType: ${roomType}`);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showJoinRoom, setShowJoinRoom] = useState(false);
  const [roomData, setRoomData] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    const checkAuth = async () => {
      console.log(`[DEBUG] Checking auth for room: ${roomType}/${roomCode}`);
      try {
        // Try to get current user from session using the check endpoint
        const response = await axios.get('/api/auth/check');
        console.log(`[DEBUG] User authenticated:`, response.data.userName);
        if (isMounted) {
          setUser({
            id: response.data._id,
            username: response.data.userName,
            color: response.data.color,
            isAnonymous: response.data.isAnonymous
          });
        }
      } catch (error) {
        console.log(`[DEBUG] No authentication found, handling room type: ${roomType}`);
        // If no valid session, handle based on room type
        if (isMounted) {
          if (roomType === 'custom' && roomCode) {
            console.log(`[DEBUG] Custom room detected, checking room: ${roomCode}`);
            // For custom rooms, verify the room exists first, then show join room
            checkCustomRoom();
          } else if (roomType === 'global' || roomType === 'network') {
            console.log(`[DEBUG] ${roomType} room detected, showing JoinRoom directly`);
            // For global/network rooms, show join room directly
            setShowJoinRoom(true);
          } else {
            console.log(`[DEBUG] Unknown room type, redirecting to home`);
            // For unknown room types, redirect to home
            navigate('/', { replace: true });
          }
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    const checkCustomRoom = async () => {
      console.log(`[DEBUG] Checking custom room: ${roomCode}`);
      try {
        const response = await axios.post('/api/rooms/join', { code: roomCode });
        console.log(`[DEBUG] Room verification successful:`, response.data);
        setRoomData({
          roomId: response.data.roomId,
          roomName: response.data.roomName,
          code: response.data.code,
          memberCount: response.data.memberCount
        });
        setShowJoinRoom(true);
        console.log(`[DEBUG] Showing JoinRoom for custom room`);
      } catch (error) {
        console.log(`[DEBUG] Room verification failed:`, error.response?.status, error.message);
        if (error.response?.status === 404) {
          // Room doesn't exist, redirect to home with error message
          toast.error("Room not found or has expired");
          navigate('/', { replace: true });
          console.log(`[DEBUG] Redirecting to home - room not found`);
        } else {
          // Network error or server error, still allow joining (room might exist)
          console.warn("Could not verify room, but allowing join attempt:", error.message);
          setRoomData({
            code: roomCode,
            roomName: `custom-${roomCode}`
          });
          setShowJoinRoom(true);
          console.log(`[DEBUG] Showing JoinRoom despite verification error`);
        }
      }
    };

    checkAuth();

    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
    };
  }, [navigate, roomType, roomCode]);

  const handleJoinSuccess = (userData) => {
    setUser(userData);
    setShowJoinRoom(false);
  };

  if (isLoading) {
    return null; // or a loading spinner
  }

  if (showJoinRoom && !user) {
    return (
      <>
        <link
          href="https://fonts.googleapis.com/css2?family=Monoton&display=swap"
          rel="stylesheet"
        />
        <div className="relative overflow-hidden align-middle flex flex-col items-center justify-center min-h-screen">
          <div className="fixed inset-0 z-0">
            <div className="absolute inset-0 bg-gradient-to-b from-slate-950 to-black"></div>
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/5 via-transparent to-purple-600/5"></div>
          </div>
          <JoinRoom 
            onJoin={handleJoinSuccess} 
            roomName={
              roomType === 'custom' ? `Custom ${roomCode}` :
              roomType === 'global' ? 'Global' :
              roomType === 'network' ? 'Network' : 'Room'
            }
            onClose={() => navigate('/', { replace: true })}
            isCustomRoom={roomType === 'custom'}
            customRoomData={roomData}
          />
        </div>
      </>
    );
  }

  return user ? <Chat roomType={roomType} roomCode={roomCode} user={user} roomData={location.state?.roomData || roomData} /> : null;
}

function App() {
  const [user, setUser] = useState(null);
  const [roomType, setRoomType] = useState(null);

  const handleJoinRoom = (userData, type) => {
    setUser(userData);
    setRoomType(type);
  };

  return (
    <>
      <ToastContainer position="bottom-right" autoClose={2500} theme="dark" />
      <Router>
        <Routes>
          <Route path="/" element={<Home onJoinRoom={handleJoinRoom} />} />
          <Route 
            path="/chat/:roomType" 
            element={<ChatRoute />} 
          />
          <Route 
            path="/chat/custom/:roomCode" 
            element={<ChatRoute />} 
          />
        </Routes>
      </Router>
    </>
  );
}

export default App;
