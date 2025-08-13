import { useState, useEffect, useCallback } from "react";
import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator";
import axios from "axios";

// Configure axios defaults
axios.defaults.withCredentials = true;

// Predefined set of distinct, vibrant colors that work well with the dark theme
const ROOM_THEMES = {
  global: {
    // UI theme colors
    themeColors: {
      from: "from-violet-400 via-purple-700 to-indigo-500",
      button: "from-violet-600 to-blue-600",
      bg: "from-violet-600/5 via-transparent to-purple-600/5",
      accent: "from-violet-300 via-purple-400 to-indigo-300",
      border: "border-violet-500/20",
      hover: "hover:bg-violet-600/10",
      active: "bg-violet-600"
    },
    // User colors
    userColors: [
      '#8b5cf6', // Rich Purple
      '#a855f7', // Bright Violet
      '#6366f1', // Indigo
      '#3b82f6', // Bright Blue
      '#0ea5e9', // Sky Blue
      '#60a5fa', // Light Blue
      '#d946ef', // Fuchsia
      '#ec4899', // Hot Pink
      '#f43f5e', // Rose
      '#f97316', // Vibrant Orange
      '#f59e0b', // Warm Amber
      '#fbbf24', // Amber
      '#eab308', // Bright Yellow
      '#84cc16', // Lime Green
      '#22c55e', // Green
    ]
  },
  network: {
    // UI theme colors
    themeColors: {
      from: "from-emerald-400 via-teal-500 to-cyan-500",
      button: "from-emerald-600 to-cyan-600",
      bg: "from-emerald-600/5 via-transparent to-cyan-600/5",
      accent: "from-emerald-300 via-teal-400 to-cyan-300",
      border: "border-emerald-500/20",
      hover: "hover:bg-emerald-600/10",
      active: "bg-emerald-600"
    },
    // User colors
    userColors: [
      '#10b981', // Vibrant Emerald
      '#14b8a6', // Teal
      '#06b6d4', // Bright Cyan
      '#34d399', // Emerald
      '#22c55e', // Green
      '#84cc16', // Lime Green
      '#0ea5e9', // Sky Blue
      '#60a5fa', // Light Blue
      '#3b82f6', // Bright Blue
      '#6366f1', // Indigo
      '#8b5cf6', // Rich Purple
      '#a855f7', // Bright Violet
      '#d946ef', // Fuchsia
      '#ec4899', // Hot Pink
      '#f43f5e', // Rose
    ]
  }
};

function JoinRoom({ onJoin, roomName = "Global", onClose }) {
  const [joinType, setJoinType] = useState("anonymous");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [randomName, setRandomName] = useState("");
  const [userColor, setUserColor] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Get theme colors based on room type
  const themeColors = ROOM_THEMES[roomName.toLowerCase() === "global" ? "global" : "network"].themeColors;

  const generateRandomName = () => {
    return uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: "-",
      length: 3,
    });
  };

  const generateRandomColor = useCallback(() => {
    const roomColors = ROOM_THEMES[roomName.toLowerCase() === "global" ? "global" : "network"].userColors;
    const randomIndex = Math.floor(Math.random() * roomColors.length);
    return roomColors[randomIndex];
  }, [roomName]);

  const handleGenerateNewName = useCallback(() => {
    const newName = generateRandomName();
    const newColor = generateRandomColor();
    
    // Set the expiry for 7 days from now
    const expiryTime = new Date().getTime() + 7 * 24 * 60 * 60 * 1000;
    
    const item = {
      name: newName,
      color: newColor,
      expiry: expiryTime,
    };
    
    // Store the object as a JSON string
    localStorage.setItem('anonymousUser', JSON.stringify(item));
    
    setRandomName(newName);
    setUserColor(newColor);
  }, [generateRandomColor]);

  // Initialize random name and color from localStorage or generate new ones
  useEffect(() => {
    const itemStr = localStorage.getItem('anonymousUser');
    try {
      if (itemStr) {
        const item = JSON.parse(itemStr);
        const hasValidShape =
          item &&
          typeof item.name === 'string' &&
          typeof item.color === 'string' &&
          typeof item.expiry === 'number';

        
        // If invalid or expired, regenerate
        if (!hasValidShape || Date.now() > item.expiry) {
          localStorage.removeItem('anonymousUser');
          handleGenerateNewName();
        } else {
          setRandomName(item.name);
          setUserColor(item.color);
        }
      } else {
        // Migrate legacy keys if present
        const legacyName = localStorage.getItem('anonymousUsername');
        const legacyColor = localStorage.getItem('userColor');
        if (legacyName && legacyColor) {
          const expiryTime = Date.now() + 7 * 24 * 60 * 60 * 1000;
          const migrated = { name: legacyName, color: legacyColor, expiry: expiryTime };
          localStorage.setItem('anonymousUser', JSON.stringify(migrated));
          localStorage.removeItem('anonymousUsername');
          localStorage.removeItem('userColor');
          setRandomName(legacyName);
          setUserColor(legacyColor);
        } else {
          // If no user exists, generate a new one
          handleGenerateNewName();
        }
      }
    } catch {
      // Bad JSON or other issues -> regenerate
      localStorage.removeItem('anonymousUser');
      handleGenerateNewName();
    }
    
  }, [handleGenerateNewName]);

  const handleJoin = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    
    try {
      if (joinType === "anonymous") {
        // Handle anonymous join
        const finalUsername = randomName;
        const finalColor = userColor;
        
        try {
          // Try to login first (no password needed for anonymous)
          const loginRes = await axios.post('/api/auth/login', {
            userName: finalUsername
          });
          
          const { id, userName, color } = loginRes.data;
          localStorage.setItem('anonymousUsername', finalUsername);
          localStorage.setItem('userColor', finalColor);
          onJoin({
            id,
            username: userName,
            color,
            isAnonymous: true
          });
        } catch (loginErr) {
          // If user doesn't exist, create new anonymous user
          if (loginErr.response?.status === 400 && loginErr.response?.data?.message === "Invalid credentials") {
            try {
              const signupRes = await axios.post('/api/auth/signup', {
                userName: finalUsername,
                color: finalColor,
                isAnonymous: true
              });

              const { _id, userName, color } = signupRes.data;
              localStorage.setItem('anonymousUsername', finalUsername);
              localStorage.setItem('userColor', finalColor);
              onJoin({
                id: _id,
                username: userName,
                color,
                isAnonymous: true
              });
            } catch (signupErr) {
              setError(signupErr.response?.data?.message || "Failed to create anonymous user");
            }
          } else {
            setError(loginErr.response?.data?.message || "Something went wrong");
          }
        }
      } else {
        // Handle custom account
        const finalColor = userColor || generateRandomColor();
        
        if (isCreating) {
          // Sign up new user
          const response = await axios.post('/api/auth/signup', {
            userName: username,
            password,
            color: finalColor,
            isAnonymous: false
          });

          const { _id, userName, color } = response.data;
          onJoin({
            id: _id,
            username: userName,
            color,
            isAnonymous: false
          });
        } else {
          // Login existing user
          const response = await axios.post('/api/auth/login', {
            userName: username,
            password
          });

          const { id, userName, color } = response.data;
          onJoin({
            id,
            username: userName,
            color,
            isAnonymous: false
          });
        }
      }
    } catch (error) {
      setError(error.response?.data?.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      {/* Dashboard-like gradient background */}
      <div className="absolute inset-0 z-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 to-black"></div>
        <div className={`absolute inset-0 bg-gradient-to-tr ${themeColors.bg}`}></div>
        <div className="absolute inset-0">
          <div className={`absolute inset-0 bg-gradient-to-tr ${themeColors.bg} animate-gradient`}></div>
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
        </div>
      </div>
      {/* Modal content */}
      <div className="relative w-full max-w-md p-6 bg-black/40 backdrop-blur-sm rounded-2xl border border-white/10 shadow-2xl z-10">
        <div className="absolute top-4 right-4">
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-red-500/10 backdrop-blur-sm border border-red-500/20 text-red-400/90 hover:bg-red-500/20 hover:border-red-500/30 hover:text-red-300 transition-all"
            aria-label="Close"
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
                d="M6 18L18 6M6 6l12 12" 
              />
            </svg>
          </button>
        </div>

        <h2 className={`text-2xl font-bold text-center mb-6 bg-gradient-to-r ${themeColors.from} bg-clip-text text-transparent`}>
          Join {roomName} Room
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="flex gap-4 mb-6">
            <button
              onClick={() => setJoinType("anonymous")}
              className={`flex-1 py-2 px-4 rounded-lg transition-all ${
                joinType === "anonymous"
                  ? `${themeColors.active} text-white`
                  : "bg-white/10 backdrop-blur-sm border border-white/10 text-white/90 hover:bg-white/15 hover:border-white/20"
              }`}
            >
              Join as Anonymous
            </button>
            <button
              onClick={() => setJoinType("custom")}
              className={`flex-1 py-2 px-4 rounded-lg transition-all ${
                joinType === "custom"
                  ? `${themeColors.active} text-white`
                  : "bg-white/10 backdrop-blur-sm border border-white/10 text-white/90 hover:bg-white/15 hover:border-white/20"
              }`}
            >
              Custom Account
            </button>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            {joinType === "anonymous" ? (
              <div className="space-y-3">
                <div className={`bg-white/10 backdrop-blur-sm rounded-xl p-4 border ${themeColors.border}`}>
                  <p className="text-white/90 text-sm mb-2">Your random name:</p>
                  <p className={`font-medium bg-gradient-to-r ${themeColors.accent} bg-clip-text text-transparent`}>{randomName}</p>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateNewName}
                  className={`w-full py-2 px-4 bg-white/10 backdrop-blur-sm border border-white/10 text-white/90 rounded-xl hover:bg-white/15 hover:border-white/20 transition-all`}
                >
                  Generate New Name
                </button>
              </div>
            ) : (
              <>
                <div>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => {
                      const alphanumericOnly = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
                      setUsername(alphanumericOnly.toLowerCase());
                    }}
                    placeholder="Choose a username (alphanumeric only)"
                    className={`w-full bg-white/10 backdrop-blur-sm text-white/90 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-${roomName === "Global" ? "violet" : "emerald"}-600/50 border border-white/10 focus:border-white/20 placeholder-white/50`}
                    pattern="[a-zA-Z0-9]+"
                    title="Username can only contain letters and numbers"
                    required
                  />
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"} 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className={`w-full bg-white/10 backdrop-blur-sm text-white/90 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-${roomName === "Global" ? "violet" : "emerald"}-600/50 border border-white/10 focus:border-white/20 placeholder-white/50 pr-12`}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white focus:outline-none"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a9.956 9.956 0 012.293-3.95m3.362-2.675A9.956 9.956 0 0112 5c4.477 0 8.268 2.943 9.542 7a9.965 9.965 0 01-4.043 5.197M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="createNew"
                    checked={isCreating}
                    onChange={(e) => setIsCreating(e.target.checked)}
                    className={`rounded border-white/10 bg-white/10 backdrop-blur-sm focus:ring-${roomName === "Global" ? "violet" : "emerald"}-600`}
                  />
                  <label htmlFor="createNew" className="text-white/90">
                    Create new account
                  </label>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-2 px-4 bg-gradient-to-r ${themeColors.button} rounded-xl text-white hover:opacity-90 transition-opacity font-medium ${
                isLoading ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {joinType === "anonymous" ? "Joining..." : isCreating ? "Creating Account..." : "Logging in..."}
                </span>
              ) : (
                joinType === "anonymous" ? "Join Anonymously" : isCreating ? "Create Account" : "Login"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default JoinRoom; 