function Documentation({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl shadow-2xl border border-purple-500/30 max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-4 flex items-center justify-between border-b border-purple-500/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white">How Waves Works</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white/20 rounded-full p-2 transition-colors"
            aria-label="Close Documentation"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div 
          className="overflow-y-auto max-h-[calc(90vh-80px)] px-6 py-6 space-y-6 text-gray-200 text-left"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#8b5cf6 #1e293b'
          }}
        >
          <style>{`
            .overflow-y-auto::-webkit-scrollbar {
              width: 12px;
            }
            .overflow-y-auto::-webkit-scrollbar-track {
              background: #1e293b;
              border-radius: 10px;
            }
            .overflow-y-auto::-webkit-scrollbar-thumb {
              background: linear-gradient(180deg, #8b5cf6 0%, #a855f7 100%);
              border-radius: 10px;
              border: 2px solid #1e293b;
            }
            .overflow-y-auto::-webkit-scrollbar-thumb:hover {
              background: linear-gradient(180deg, #a855f7 0%, #c084fc 100%);
            }
          `}</style>
          {/* Introduction */}
          <div className="space-y-3">
            <h3 className="text-xl font-bold text-white">Understanding Peer-to-Peer (P2P) Messaging in Waves</h3>
            <p className="leading-relaxed">
              Waves uses advanced <span className="text-violet-400 font-semibold">WebRTC technology</span> with <span className="text-purple-400 font-semibold">Data Channels</span> to enable real-time peer-to-peer messaging,
              making your chat experience ultra-fast and reliable—even in situations where the internet is extremely slow or unreliable.
            </p>
          </div>

          {/* What Does P2P Mean */}
          <div className="bg-slate-800/50 rounded-xl p-5 border border-purple-500/20 space-y-4">
            <h4 className="text-lg font-semibold text-white flex items-center gap-2">
              <span className="w-2 h-2 bg-violet-500 rounded-full"></span>
              What Does P2P Mean in Waves?
            </h4>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 bg-violet-600 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5">
                  1
                </div>
                <div>
                  <p className="font-semibold text-violet-400">WebRTC Connection Establishment:</p>
                  <p className="text-gray-300">When you join a chat room, Waves uses Socket.IO signaling to discover other users, then establishes direct WebRTC peer connections with ICE servers for NAT traversal.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 bg-emerald-600 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5">
                  2
                </div>
                <div>
                  <p className="font-semibold text-emerald-400">Local Network Priority:</p>
                  <p className="text-gray-300">If you and other users are on the same local network (WiFi router), messages flow directly through WebRTC Data Channels—even with poor internet connectivity.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 bg-orange-600 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5">
                  3
                </div>
                <div>
                  <p className="font-semibold text-orange-400">Automatic Server Fallback:</p>
                  <p className="text-gray-300">If direct P2P connection fails after 10 seconds (due to firewalls, different networks, etc.), Waves seamlessly switches to server relay via Socket.IO for reliable delivery.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Common Misconceptions */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-white flex items-center gap-2">
              <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
              Common Misconceptions Clarified
            </h4>
            
            <div className="bg-slate-800/50 rounded-lg p-4 border border-orange-500/20">
              <p className="font-semibold text-orange-400 mb-2">Does Waves Work Completely Without Internet?</p>
              <p className="text-sm text-gray-300 mb-3">
                <span className="text-red-400 font-semibold">No.</span> Waves requires initial internet connectivity for Socket.IO signaling to discover users and establish WebRTC connections.
                However, once P2P links are established, communication can continue even with minimal internet.
              </p>
              <ul className="space-y-2 text-sm text-gray-300 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-violet-400 mt-1">•</span>
                  <span><span className="font-semibold text-white">Same Local Network:</span> Messages flow directly via WebRTC Data Channels, working reliably even with poor internet connectivity.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-violet-400 mt-1">•</span>
                  <span><span className="font-semibold text-white">Different Networks:</span> Requires stable internet for server relay, but still provides fast, reliable messaging.</span>
                </li>
              </ul>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-4 border border-emerald-500/20">
              <p className="font-semibold text-emerald-400 mb-2">Is Communication Seamless When Internet Is "Very Slow"?</p>
              <p className="text-sm text-gray-300">
                <span className="text-emerald-400 font-semibold">Yes!</span> P2P messaging on Waves is designed to work brilliantly 
                even if your internet speed is very low or unreliable, as long as your devices are still connected to the same local network router.
              </p>
            </div>
          </div>

          <div className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 rounded-xl p-5 border border-violet-500/30 space-y-4">
            <h4 className="text-lg font-semibold text-white flex items-center gap-2">
              <span className="w-2 h-2 bg-violet-500 rounded-full"></span>
              When Can You Use P2P Messaging?
            </h4>
            
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-semibold text-violet-400 mb-2">Optimal P2P Conditions:</p>
                <ul className="space-y-1 text-gray-300 ml-4">
                  <li className="flex items-start gap-2">
                    <span className="text-violet-400">•</span>
                    <span>All users connected to the same WiFi network/router (home, office, school).</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-violet-400">•</span>
                    <span>Messages travel directly via WebRTC Data Channels with minimal latency.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-violet-400">•</span>
                    <span>Works reliably even with poor internet connectivity once connections are established.</span>
                  </li>
                </ul>
              </div>

              <div>
                <p className="font-semibold text-orange-400 mb-2">Server Relay Fallback:</p>
                <ul className="space-y-1 text-gray-300 ml-4">
                  <li className="flex items-start gap-2">
                    <span className="text-orange-400">•</span>
                    <span>If direct WebRTC connections fail (firewalls, different networks, NAT issues).</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-orange-400">•</span>
                    <span>Waves automatically switches to Socket.IO server relay after 10-second timeout.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-orange-400">•</span>
                    <span>Still provides fast, reliable messaging but depends on internet stability.</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* What Does This Mean */}
          <div className="bg-slate-800/50 rounded-xl p-5 border border-purple-500/20 space-y-3">
            <h4 className="text-lg font-semibold text-white flex items-center gap-2">
              <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
              What Does This Mean for You?
            </h4>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-3">
                <span className="text-violet-400 text-lg">•</span>
                <span><span className="font-semibold text-white">Ultra-Fast Messaging:</span> Direct WebRTC Data Channel connections on local networks provide instant message delivery.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-emerald-400 text-lg">•</span>
                <span><span className="font-semibold text-white">Seamless Fallback:</span> Automatic switching between P2P and server relay ensures messages always get delivered.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-orange-400 text-lg">•</span>
                <span><span className="font-semibold text-white">Secure & Private:</span> Messages are automatically deleted after 7 days, with JWT authentication, message deduplication, and end-to-end security.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-pink-400 text-lg">•</span>
                <span><span className="font-semibold text-white">Network Aware:</span> Smart room assignment and connection optimization based on your network environment.</span>
              </li>
            </ul>
          </div>

          {/* Summary */}
          <div className="bg-gradient-to-r from-violet-600/20 to-purple-600/20 rounded-xl p-5 border-2 border-violet-500/40">
            <h4 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              Summary
            </h4>
            <p className="text-sm text-gray-200 leading-relaxed mb-3">
              Waves combines <span className="text-violet-400 font-semibold">WebRTC P2P technology</span> with intelligent fallback mechanisms to provide 
              <span className="text-emerald-400 font-semibold"> ultra-fast messaging</span> on local networks while ensuring 
              <span className="text-orange-400 font-semibold"> reliable delivery</span> across all network conditions.
            </p>
            <p className="text-sm text-gray-200 leading-relaxed">
              <span className="text-white font-semibold">Initial internet connectivity</span> is required for Socket.IO signaling and connection establishment, 
              but once WebRTC Data Channels are established, communication remains <span className="text-violet-400 font-semibold">fast and resilient </span> 
              even with poor internet conditions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Documentation;
