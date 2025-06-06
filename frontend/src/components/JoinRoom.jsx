import { useState, useEffect } from "react";
import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator";
import { useNavigate } from "react-router-dom";
import axios from "axios";

// Configure axios defaults
axios.defaults.withCredentials = true;

// Predefined set of colors that work well with the dark theme
const USER_COLORS = [
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
  '#f97316', // Orange
];

function JoinRoom({ onJoin, roomName = "Global" }) {
  const navigate = useNavigate();
  const [joinType, setJoinType] = useState("anonymous"); // "anonymous" or "custom"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [randomName, setRandomName] = useState("");
  const [userColor, setUserColor] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const generateRandomName = () => {
    return uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: "-",
      length: 3,
    });
  };

  const generateRandomColor = () => {
    const randomIndex = Math.floor(Math.random() * USER_COLORS.length);
    return USER_COLORS[randomIndex];
  };

  // Initialize random name and color from localStorage or generate new ones
  useEffect(() => {
    const storedName = localStorage.getItem('anonymousUsername');
    const storedColor = localStorage.getItem('userColor');
    
    if (storedName && storedColor) {
      setRandomName(storedName);
      setUserColor(storedColor);
    } else {
      const newName = generateRandomName();
      const newColor = generateRandomColor();
      setRandomName(newName);
      setUserColor(newColor);
      localStorage.setItem('anonymousUsername', newName);
      localStorage.setItem('userColor', newColor);
    }
  }, []);

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

  const handleGenerateNewName = () => {
    const newName = generateRandomName();
    const newColor = generateRandomColor();
    setRandomName(newName);
    setUserColor(newColor);
    localStorage.setItem('anonymousUsername', newName);
    localStorage.setItem('userColor', newColor);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      {/* Dashboard-like gradient background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 to-black"></div>
        <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/5 via-transparent to-purple-600/5"></div>
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/10 via-transparent to-purple-500/10 animate-gradient"></div>
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
        </div>
      </div>
      {/* Modal content */}
      <div className="relative w-full max-w-md p-6 bg-black/40 backdrop-blur-sm rounded-2xl border border-white/10 shadow-2xl z-10">
        <div className="absolute top-4 left-4">
          <button
            onClick={() => navigate("/")}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/70 hover:text-white"
            aria-label="Back to home"
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
          </button>
        </div>

        <h2 className="text-2xl font-bold text-center mb-6 bg-gradient-to-r from-violet-400 via-purple-700 to-indigo-500 bg-clip-text text-transparent">
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
              className={`flex-1 py-2 px-4 rounded-lg transition-colors ${
                joinType === "anonymous"
                  ? "bg-violet-600 text-white"
                  : "bg-white/5 text-white/70 hover:bg-white/10"
              }`}
            >
              Join as Anonymous
            </button>
            <button
              onClick={() => setJoinType("custom")}
              className={`flex-1 py-2 px-4 rounded-lg transition-colors ${
                joinType === "custom"
                  ? "bg-violet-600 text-white"
                  : "bg-white/5 text-white/70 hover:bg-white/10"
              }`}
            >
              Custom Account
            </button>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            {joinType === "anonymous" ? (
              <div className="space-y-3">
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <p className="text-white/70 text-sm mb-2">Your random name:</p>
                  <p className="text-violet-400 font-medium">{randomName}</p>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateNewName}
                  className="w-full py-2 px-4 bg-white/5 text-white/70 rounded-xl hover:bg-white/10 transition-colors"
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
                      setUsername(alphanumericOnly);
                    }}
                    placeholder="Choose a username (alphanumeric only)"
                    className="w-full bg-white/5 text-white rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-violet-600/50 border border-white/10"
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
                    className="w-full bg-white/5 text-white rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-violet-600/50 border border-white/10 pr-12"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white focus:outline-none"
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
                    className="rounded border-white/10 bg-white/5"
                  />
                  <label htmlFor="createNew" className="text-white/70">
                    Create new account
                  </label>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-2 px-4 bg-gradient-to-r from-violet-600 to-blue-600 rounded-xl text-white hover:opacity-90 transition-opacity font-medium ${
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