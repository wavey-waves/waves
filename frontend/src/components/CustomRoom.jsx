import { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";

function CustomRoom({ onJoin, onClose }) {
  const [mode, setMode] = useState(null); // 'create' or 'join'
  const [roomCode, setRoomCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleCreateRoom = async () => {
    setIsLoading(true);
    try {
      const response = await axios.post('/api/rooms/create');
      const roomData = {
        roomId: response.data.roomId,
        roomName: response.data.roomName,
        code: response.data.code,
        memberCount: response.data.memberCount
      };
      onJoin(roomData);
      toast.success(`Room created! Code: ${response.data.code}`);
    } catch (error) {
      console.error("Error creating room:", error);
      toast.error(error.response?.data?.message || "Failed to create room");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    if (!roomCode.trim()) {
      toast.error("Please enter a room code");
      return;
    }

    setIsLoading(true);
    try {
      const response = await axios.post('/api/rooms/join', { code: roomCode.trim() });
      const roomData = {
        roomId: response.data.roomId,
        roomName: response.data.roomName,
        code: response.data.code,
        memberCount: response.data.memberCount
      };
      onJoin(roomData);
      toast.success(`Joined room: ${response.data.code}`);
    } catch (error) {
      console.error("Error joining room:", error);
      toast.error(error.response?.data?.message || "Failed to join room");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative bg-black/90 backdrop-blur-xl rounded-2xl p-6 sm:p-8 shadow-2xl border border-gray-800/50 max-w-md w-full mx-4">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">Custom Room</h2>
          <p className="text-gray-400">Create a new room or join an existing one</p>
        </div>

        {!mode ? (
          <div className="space-y-4">
            <button
              onClick={() => setMode('create')}
              className="w-full py-3 px-4 bg-gradient-to-r from-rose-600 to-pink-600 text-white rounded-lg font-medium hover:from-rose-700 hover:to-pink-700 transition-all duration-200 transform hover:scale-105"
            >
              Create New Room
            </button>
            <button
              onClick={() => setMode('join')}
              className="w-full py-3 px-4 bg-gradient-to-r from-rose-600 to-pink-600 text-white rounded-lg font-medium hover:from-rose-700 hover:to-pink-700 transition-all duration-200 transform hover:scale-105"
            >
              Join Existing Room
            </button>
          </div>
        ) : mode === 'create' ? (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-gray-300 mb-4">Click the button below to create a new room with a unique code</p>
              <button
                onClick={handleCreateRoom}
                disabled={isLoading}
                className="w-full py-3 px-4 bg-gradient-to-r from-rose-600 to-pink-600 text-white rounded-lg font-medium hover:from-rose-700 hover:to-pink-700 transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {isLoading ? "Creating..." : "Create Room"}
              </button>
            </div>
            <button
              onClick={() => setMode(null)}
              className="w-full py-2 px-4 text-gray-400 hover:text-white transition-colors"
            >
              Back
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <form onSubmit={handleJoinRoom}>
              <div className="mb-4">
                <label className="block text-gray-300 text-sm font-medium mb-2">
                  Room Code
                </label>
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="Enter 6-character code"
                  maxLength={6}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || roomCode.length !== 6}
                className="w-full py-3 px-4 bg-gradient-to-r from-rose-600 to-pink-600 text-white rounded-lg font-medium hover:from-rose-700 hover:to-pink-700 transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {isLoading ? "Joining..." : "Join Room"}
              </button>
            </form>
            <button
              onClick={() => setMode(null)}
              className="w-full py-2 px-4 text-gray-400 hover:text-white transition-colors"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default CustomRoom;