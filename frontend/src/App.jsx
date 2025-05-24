import "./App.css";
import { BrowserRouter as Router, Routes, Route, useNavigate } from "react-router-dom";
import GlobalChat from "./components/GlobalChat";

function Home() {
  const navigate = useNavigate();

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

          <div className="relative w-full flex flex-col md:flex-row gap-8 md:gap-5 items-center justify-center overflow-hidden">
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
              className="relative group w-full max-w-xs cursor-pointer"
              onClick={() => navigate('/global-chat')}
            >
              <div className="absolute inset-0.5 bg-gradient-to-r from-violet-600 to-blue-600 rounded-3xl blur opacity-30 group-hover:opacity-40 transition duration-1000"></div>
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

            <div className="relative group w-full max-w-xs">
              <div className="absolute inset-0.5 bg-gradient-to-r from-violet-600 to-blue-600 rounded-3xl blur opacity-30 group-hover:opacity-40 transition duration-1000"></div>
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
                  <p className="text-lg sm:text-xl font-bold text-white">Join Network</p>
                </div>
              </div>
            </div>

            <div className="relative group w-full max-w-xs">
              <div className="absolute inset-0.5 bg-gradient-to-r from-violet-600 to-blue-600 rounded-3xl blur opacity-30 group-hover:opacity-40 transition duration-1000"></div>
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
                  <p className="text-lg sm:text-xl font-bold text-white">Create/join room</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/global-chat" element={<GlobalChat />} />
      </Routes>
    </Router>
  );
}

export default App;