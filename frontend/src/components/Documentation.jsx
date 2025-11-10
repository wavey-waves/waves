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
          className="overflow-y-auto max-h-[calc(90vh-80px)] px-6 py-6 space-y-6 text-gray-200"
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
              Waves uses advanced <span className="text-violet-400 font-semibold">Peer-to-Peer (P2P) technology</span> to enable real-time messaging, 
              making your chat experience ultra-fast and reliable—even in situations where the internet is extremely slow or almost unavailable.
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
                  <p className="font-semibold text-violet-400">Direct Connection:</p>
                  <p className="text-gray-300">When you join a chat room on Waves, your device tries to connect directly to other users' devices using P2P technology via WebRTC.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 bg-emerald-600 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5">
                  2
                </div>
                <div>
                  <p className="font-semibold text-emerald-400">Low or Nearly No Internet? No Problem!</p>
                  <p className="text-gray-300">If you and other users are connected to the same local network or WiFi router, your messages are sent seamlessly—even when your internet connection is very slow (as low as 1kbps) or almost down.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 bg-orange-600 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5">
                  3
                </div>
                <div>
                  <p className="font-semibold text-orange-400">Fallback for Robustness:</p>
                  <p className="text-gray-300">If a direct P2P connection isn't possible (because devices are on different networks), Waves automatically switches to using its server as a relay so your messages always get delivered.</p>
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
                <span className="text-red-400 font-semibold">No.</span> Waves needs some level of internet connectivity—at a minimum, 
                enough for devices to discover each other and set up the P2P links, and to use fallback relaying if P2P is not possible.
              </p>
              <ul className="space-y-2 text-sm text-gray-300 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-violet-400 mt-1">•</span>
                  <span><span className="font-semibold text-white">When Connected to the Same Router:</span> Even if your internet speed drops to almost zero, 
                  as long as you're all connected to the same WiFi router, messages are sent directly between devices.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-violet-400 mt-1">•</span>
                  <span><span className="font-semibold text-white">No Router Connection:</span> If you aren't connected to the same local network, 
                  the app will try to use the internet (server relay) for communication.</span>
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

          {/* When Can You Use P2P */}
          <div className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 rounded-xl p-5 border border-violet-500/30 space-y-4">
            <h4 className="text-lg font-semibold text-white flex items-center gap-2">
              <span className="w-2 h-2 bg-violet-500 rounded-full"></span>
              When Can You Use P2P Messaging?
            </h4>
            
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-semibold text-violet-400 mb-2">✅ Best Case for P2P:</p>
                <ul className="space-y-1 text-gray-300 ml-4">
                  <li className="flex items-start gap-2">
                    <span className="text-violet-400">•</span>
                    <span>All users are on the same WiFi network/router (e.g., home, school, office).</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-violet-400">•</span>
                    <span>Internet speed doesn't matter—the messages travel directly and instantly.</span>
                  </li>
                </ul>
              </div>

              <div>
                <p className="font-semibold text-orange-400 mb-2">🔄 Fallback to Server Relay:</p>
                <ul className="space-y-1 text-gray-300 ml-4">
                  <li className="flex items-start gap-2">
                    <span className="text-orange-400">•</span>
                    <span>If your devices can't establish direct connections (different networks, firewalls, etc.), Waves will use the server.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-orange-400">•</span>
                    <span>You still get fast, reliable messaging, but it may depend on your internet speed.</span>
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
                <span className="text-violet-400 text-lg">⚡</span>
                <span><span className="font-semibold text-white">Ultra-Fast Messaging:</span> Direct messages between users on the same local network, even if the internet is extremely slow.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-emerald-400 text-lg">🔗</span>
                <span><span className="font-semibold text-white">Always Connected:</span> Messages are seamless and reliable—Waves automatically chooses the best route.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-orange-400 text-lg">📡</span>
                <span><span className="font-semibold text-white">No True "Offline" Messaging:</span> Waves is not a purely offline app; connecting to a router is necessary for discovering other users and establishing connections.</span>
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
            <p className="text-sm text-gray-200 leading-relaxed">
              Waves' P2P messaging is optimized for local network connections—your messages remain <span className="text-violet-400 font-semibold">lightning-fast</span> even 
              if the internet nearly stops working, as long as you're on the same router. <span className="text-white font-semibold">Some internet is always needed</span> for 
              setup and fallback routing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Documentation;
