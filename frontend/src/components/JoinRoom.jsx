import { useState, useEffect } from "react";
import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator";

function JoinRoom({ onJoin, roomName = "Global" }) {
  const [joinType, setJoinType] = useState("anonymous"); // "anonymous" or "custom"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [randomName, setRandomName] = useState("");

  const generateRandomName = () => {
    return uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: "-",
      length: 3,
    });
  };

  // Initialize random name from localStorage or generate new one
  useEffect(() => {
    const storedName = localStorage.getItem('anonymousUsername');
    if (storedName) {
      setRandomName(storedName);
    } else {
      const newName = generateRandomName();
      setRandomName(newName);
      localStorage.setItem('anonymousUsername', newName);
    }
  }, []);

  const handleJoin = async (e) => {
    e.preventDefault();
    
    let finalUsername = username;
    if (joinType === "anonymous") {
      finalUsername = randomName;
      // Store the random name in localStorage when joining
      localStorage.setItem('anonymousUsername', randomName);
    }

    // TODO: Add backend integration here
    // For now, we'll just pass the username to the parent component
    onJoin({
      username: finalUsername,
      password: joinType === "custom" ? password : null,
      isNewUser: isCreating
    });
  };

  const handleGenerateNewName = () => {
    const newName = generateRandomName();
    setRandomName(newName);
    // Update localStorage with new name
    localStorage.setItem('anonymousUsername', newName);
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
        <h2 className="text-2xl font-bold text-center mb-6 bg-gradient-to-r from-violet-400 via-purple-700 to-indigo-500 bg-clip-text text-transparent">
          Join {roomName} Room
        </h2>

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
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Choose a username"
                    className="w-full bg-white/5 text-white rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-violet-600/50 border border-white/10"
                    required
                  />
                </div>
                <div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full bg-white/5 text-white rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-violet-600/50 border border-white/10"
                    required
                  />
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
              className="w-full py-2 px-4 bg-gradient-to-r from-violet-600 to-blue-600 rounded-xl text-white hover:opacity-90 transition-opacity font-medium"
            >
              {joinType === "anonymous" ? "Join Anonymously" : isCreating ? "Create Account" : "Login"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default JoinRoom; 