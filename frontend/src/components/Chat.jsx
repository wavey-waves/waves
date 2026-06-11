import { useState, useEffect, useRef } from "react";
import { toast, ToastContainer } from "react-toastify";
import { useNavigate } from "react-router-dom";
import "react-toastify/dist/ReactToastify.css";
import iconImage from "../assets/icon.png";
import { createTransport } from "../transport";
import RadioPanel from "./RadioPanel";

// Mesh image chat (docs/MESH.md P2.b). Client-side cap on what we hand the
// mesh; receivers have their own 10 MiB auto-fetch cap on top of this.
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// Thumbnails are JPEG-encoded by the Rust side regardless of source format.
const THUMB_PREFIX = "data:image/jpeg;base64,";

function Chat({ roomType, roomCode, user, roomData }) {
  // Fix roomType detection for custom rooms
  const actualRoomType = roomType || (roomCode ? 'custom' : 'global');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [roomInfo, setRoomInfo] = useState(null);
  const [showMobileInfo, setShowMobileInfo] = useState(false);
  const messagesContainerRef = useRef(null);
  const textareaRef = useRef(null);
  const navigate = useNavigate();

  // The transport (web socket.io/WebRTC stack or Tauri mesh IPC) owns all IO;
  // this component keeps the message state, dedup, and rendering.
  const transportRef = useRef(null);
  const processedMessageIds = useRef(new Set());

  // Mesh image chat (P2.b): the attach UI is gated on transport.kind === "mesh".
  const [transportKind, setTransportKind] = useState(null);
  const [imageSending, setImageSending] = useState(false);
  // blob hash → { status: "ready", url } | { status: "failed", reason };
  // absent = pending (thumbnail only, waiting on the blob transfer).
  const [blobStates, setBlobStates] = useState({});
  const fileInputRef = useRef(null);
  const blobMimeRef = useRef(new Map()); // hash → mime, for event-driven exports
  const blobProbedRef = useRef(new Set()); // hashes probed once on arrival
  const blobExportsInFlightRef = useRef(new Set());



  //Constants for message input
  const CHARACTER_LIMIT = 1000;
  const CHARACTER_WARNING = 900;
  const [lastSent, setLastSent] = useState(0);
  const THROTTLE_DELAY = 1000;


  // Add viewport height handling
  useEffect(() => {
    function setVh() {
      document.documentElement.style.setProperty(
        "--vh",
        `${window.innerHeight * 0.01}px`
      );
    }
    setVh();
    window.addEventListener("resize", setVh);
    return () => window.removeEventListener("resize", setVh);
  }, []);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-focus the input box when component loads
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [user, roomData]); // Focus when user and room data are ready

  // Helper to add a message to state, preventing duplicates
  const addMessage = (message) => {
    // Ignore if the message is invalid
    if (!message || !message._id) return;

    // 1. Check if we've already processed this message by its permanent ID
    // 2. OR check if we've processed it by its temporary ID (from P2P)
    if (
      processedMessageIds.current.has(message._id) ||
      (message.tempId && processedMessageIds.current.has(message.tempId))
    ) {
      // If either ID is already known, we've seen this message. Ignore it.
      console.log(`[Deduplication] Ignored message: ${message.text}`);
      return;
    }

    // This is a new message. Add BOTH of its IDs to the set for future checks.
    processedMessageIds.current.add(message._id);
    if (message.tempId) {
      processedMessageIds.current.add(message.tempId);
    }

    setMessages((prevMessages) => [...prevMessages, message]);
  };

  // Try to export a mesh blob to the asset protocol and record its URL
  // (P2.b). A "blob-not-ready" rejection just means the transfer is still in
  // flight — the message keeps its thumbnail until onBlobReady retries with
  // force. Probes are one-shot per hash so history re-renders stay cheap.
  const requestBlobExport = async (hash, mime, { force = false } = {}) => {
    const transport = transportRef.current;
    if (!hash || typeof transport?.exportBlob !== "function") return;
    if (!force && blobProbedRef.current.has(hash)) return;
    if (blobExportsInFlightRef.current.has(hash)) return;
    blobProbedRef.current.add(hash);
    blobExportsInFlightRef.current.add(hash);
    try {
      const path = await transport.exportBlob({ hash, mime });
      // Lazy so @tauri-apps/api stays out of the web bundle (P1.f seam rule);
      // this path only runs under the mesh transport.
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      const url = convertFileSrc(path);
      setBlobStates((prev) =>
        prev[hash]?.status === "ready"
          ? prev
          : { ...prev, [hash]: { status: "ready", url } }
      );
    } catch (error) {
      if (error !== "blob-not-ready" && error?.message !== "blob-not-ready") {
        console.error("Blob export error:", error);
      }
    } finally {
      blobExportsInFlightRef.current.delete(hash);
    }
  };

  // Probe blob availability once per image message: the sender's own blobs
  // and already-downloaded history blobs resolve immediately; everything else
  // stays pending until the blobReady/blobFailed events flip it.
  useEffect(() => {
    for (const message of messages) {
      const blob = message.kind === "image" ? message.blob : null;
      if (!blob?.hash) continue;
      blobMimeRef.current.set(blob.hash, blob.mime);
      requestBlobExport(blob.hash, blob.mime);
    }
  }, [messages]);


  // Setup transport connection and fetch initial data
  useEffect(() => {
    let cancelled = false;

    const upsertMessage = (message) => {
      // If this message confirms a temporary one, replace it
      if (message.tempId && message.senderId._id === user.id) {
        // Add the *new* permanent ID to the processed set
        processedMessageIds.current.add(message._id);

        setMessages(prev =>
          prev.map(m => m._id === message.tempId ? message : m)
        );
      } else {
        // Otherwise, add it normally (it's from another user)
        addMessage(message);
      }
    };

    const setupTransportAndFetchData = async () => {
      try {
        const transport = await createTransport({ user });
        if (cancelled) return;
        transportRef.current = transport;
        setTransportKind(transport.kind);

        const resolved = await transport.resolveRoom({
          roomType: actualRoomType,
          roomCode,
          roomData,
        });
        if (cancelled) return;
        setRoomInfo(resolved);

        const history = await transport.fetchHistory(resolved.roomName);
        if (cancelled) return;
        if (Array.isArray(history)) {
          history.forEach(msg => {
            if (msg._id) processedMessageIds.current.add(msg._id)
          });
          setMessages(history.slice(-50));
        }

        await transport.connect({
          roomName: resolved.roomName,
          handlers: {
            onServerMessage: upsertMessage,
            onPeerMessage: addMessage,
            onUserLeft: () => {
              toast.warn("A user has left the room.");
            },
            // Mesh blob lifecycle (P2.b): a finished download means the
            // full-res asset can be exported and swapped in for the thumb.
            onBlobReady: (hash) => {
              const mime = blobMimeRef.current.get(hash);
              // No mime means the announcing message hasn't landed yet; the
              // arrival probe in the messages effect will pick it up then.
              if (mime !== undefined) requestBlobExport(hash, mime, { force: true });
            },
            onBlobFailed: (hash, reason) => {
              setBlobStates((prev) => ({
                ...prev,
                [hash]: { status: "failed", reason },
              }));
            },
            onError: (error) => {
              console.error("Socket error:", error);
              toast.error("Connection error. Please try refreshing the page.");
            },
            onReconnected: () => {
              toast.success("Reconnected to chat server");
            },
          },
        });
      } catch (error) {
        console.error("Error setting up socket or fetching data:", error);
        toast.error("Failed to connect to chat server");
      }
    };

    if (user) {
      setupTransportAndFetchData();
    }

    // Cleanup: the transport owns the socket/peer (or mesh channel) teardown;
    // the processed-id Set has a stable identity, so snapshot it here.
    const processedMessages = processedMessageIds.current;
    const probedBlobs = blobProbedRef.current;
    return () => {
      cancelled = true;
      transportRef.current?.disconnect();
      transportRef.current = null;
      // Clear for a clean state on next run. Blob probes must also reset:
      // a blobReady event missed while disconnected never re-fires, so the
      // next connection has to probe history blobs again.
      processedMessages.clear();
      probedBlobs.clear();
    };
  }, [user, actualRoomType, roomCode]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const now = Date.now();
    if (!newMessage.trim()) {
      toast.error("Message cannot be empty.");
      return;
    }
    if (newMessage.length > CHARACTER_LIMIT) {
      toast.error("Message exceeds character limit.");
      return;
    }
    if (now - lastSent < THROTTLE_DELAY) {
      toast.error("You're sending messages too quickly.");
      return;
    }

    // Store the message text before clearing
    const messageText = newMessage.trim();

    // Clear input immediately after validation
    setNewMessage("");
    setLastSent(now);
    if (textareaRef.current) {
      textareaRef.current.style.height = "40px";
    }

    const transport = transportRef.current;

    if (transport?.kind === "mesh") {
      // Mesh send: the Rust side assigns the canonical _id, so there is no
      // optimistic temp copy — render the returned message; the subscribe
      // echo then dedups on that _id in addMessage.
      try {
        const real = await transport.send({
          roomName: roomInfo?.roomName || "mesh-global",
          payload: { text: messageText },
        });
        addMessage(real);
      } catch (error) {
        toast.error("Failed to send message.");
        console.error("Mesh send error:", error);
      }
      return;
    }

    const messagePayload = {
      _id: crypto.randomUUID(),
      text: messageText,
      senderId: { _id: user.id, userName: user.username, color: user.color },
      roomName: roomInfo?.roomName || "global-room",
      createdAt: new Date().toISOString()
    };

    addMessage(messagePayload);

    // The web transport delivers over every open P2P data channel and always
    // POSTs to the server for fallback + persistence (the echo upserts by tempId).
    try {
      let roomName;
      if (actualRoomType === "global") {
        roomName = "global-room";
      } else if (actualRoomType === "custom" && roomCode) {
        roomName = `custom-${roomCode}`;
      } else {
        roomName = roomInfo?.roomName;
      }
      if (!roomName) throw new Error("Room name not available");

      await transport.send({ roomName, payload: messagePayload });
    } catch (error) {
      toast.error("Failed to send message to server.");
      console.error("Server send error:", error);
    }
  };

  // Mesh-only image send (P2.b): raw bytes go to the Rust side, which
  // thumbnails + announces and returns the canonical image message. The
  // subscribe echo dedups on its _id like any other mesh message.
  const handleImagePick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Image is too large (max 25 MB).");
      return;
    }
    const transport = transportRef.current;
    if (typeof transport?.sendImage !== "function") return;
    setImageSending(true);
    try {
      const bytes = await file.arrayBuffer();
      const sent = await transport.sendImage({
        roomName: roomInfo?.roomName || "mesh-global",
        bytes,
        mime: file.type,
      });
      addMessage(sent);
      // The sender already holds the blob — resolve the full-res asset now
      // instead of waiting for a blobReady event that is meant for receivers.
      if (sent?.blob?.hash) {
        blobMimeRef.current.set(sent.blob.hash, sent.blob.mime);
        requestBlobExport(sent.blob.hash, sent.blob.mime, { force: true });
      }
    } catch (error) {
      toast.error("Failed to send image.");
      console.error("Mesh image send error:", error);
    } finally {
      setImageSending(false);
    }
  };



  const getGradientColors = () => {
    if (actualRoomType === "global") {
      return {
        from: "from-violet-400 via-purple-700 to-indigo-500",
        button: "from-violet-600 to-blue-600",
        bg: "from-violet-600/5 via-transparent to-purple-600/5",
        accent: "from-violet-300 via-purple-400 to-indigo-300",
        border: "border-violet-500/20",
        userColor: "#7c3aed"
      };
    } else if (actualRoomType === "custom") {
      return {
        from: "from-rose-400 via-pink-500 to-fuchsia-500",
        button: "from-rose-600 to-pink-600",
        bg: "from-rose-600/5 via-transparent to-pink-600/5",
        accent: "from-rose-300 via-pink-400 to-fuchsia-300",
        border: "border-rose-500/20",
        userColor: "#e11d48"
      };
    } else {
      return {
        from: "from-emerald-400 via-teal-500 to-cyan-500",
        button: "from-emerald-600 to-cyan-600",
        bg: "from-emerald-600/5 via-transparent to-cyan-600/5",
        accent: "from-emerald-300 via-teal-400 to-cyan-300",
        border: "border-emerald-500/20",
        userColor: "#10b981"
      };
    }
  };

  const colors = getGradientColors();

  return (
    <>
      <ToastContainer position="bottom-right" autoClose={2500} theme="dark" />
      <link
        href="https://fonts.googleapis.com/css2?family=Gloria+Hallelujah&display=swap"
        rel="stylesheet"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Monoton&display=swap"
        rel="stylesheet"
      />
      <div className="relative h-screen flex flex-col bg-black">
        <div className="fixed inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950 to-black"></div>
          <div className={`absolute inset-0 bg-gradient-to-tr ${colors.bg}`}></div>
          <div className="absolute inset-0">
            <div className={`absolute inset-0 bg-gradient-to-tr ${colors.bg} animate-gradient`}></div>
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          </div>
        </div>

        <div className="relative z-10 flex flex-col h-full">
          {/* Header - Fixed */}
          <div className="flex-shrink-0 p-2 sm:p-3 md:p-4 border-b border-white/10">
            <div className="flex items-center justify-between gap-2 sm:gap-3 flex-wrap">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0 flex-1">
                <button
                  onClick={() => navigate('/')}
                  className="h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 select-none flex-shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
                  aria-label="Go back to dashboard"
                >
                  <img
                    src={iconImage}
                    alt="Waves - Go back to dashboard"
                    className="h-full w-full"
                  />
                </button>
                <h1 className={`font text-lg sm:text-xl md:text-2xl font-bold bg-gradient-to-r ${colors.from} bg-clip-text text-transparent flex-shrink-0`}>
                  {actualRoomType === "global" ? "Global" : actualRoomType === "custom" ? "Custom" : "Network"} room
                </h1>
                {/* Desktop info - hidden on mobile */}
                <span className={`hidden sm:inline text-xs sm:text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-0.5 sm:py-1 rounded-full border ${colors.border} backdrop-blur-sm flex-shrink-0`}>
                  {user.username}
                </span>
                {actualRoomType === "network" && roomInfo && (
                  <span className={`hidden sm:inline text-xs sm:text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-0.5 sm:py-1 rounded-full border ${colors.border} backdrop-blur-sm flex-shrink-0`}>
                    {roomInfo.roomName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {actualRoomType === "custom" && (
                  <button
                    onClick={() => {
                      const roomUrl = `${window.location.origin}/chat/custom/${roomCode}`;
                      if (navigator.share) {
                        // Use native sharing if available
                        navigator.share({
                          title: 'Join my Waves chat room!',
                          text: `Join me in a custom chat room on Waves`,
                          url: roomUrl
                        }).catch(() => {
                          // Fallback to clipboard copy if sharing fails
                          navigator.clipboard.writeText(`Join my Waves chat room: ${roomUrl}`);
                          toast.success("Room link copied to clipboard!");
                        });
                      } else {
                        // Fallback for browsers without native sharing
                        navigator.clipboard.writeText(`Join my Waves chat room: ${roomUrl}`);
                        toast.success("Room link copied to clipboard!");
                      }
                    }}
                    className={`text-xs sm:text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-0.5 sm:py-1 rounded-full border ${colors.border} backdrop-blur-sm hover:opacity-80 transition-opacity cursor-pointer flex items-center gap-1 flex-shrink-0`}
                    title="Click to share room with friends"
                  >
                    <span className="hidden sm:inline">Code: {roomCode}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                    </svg>
                  </button>
                )}
                {/* Info button for mobile */}
                <button
                  onClick={() => setShowMobileInfo(true)}
                  className={`sm:hidden p-1.5 rounded-lg bg-gradient-to-r ${colors.button} hover:opacity-90 transition-opacity text-white flex items-center border ${colors.border} backdrop-blur-sm flex-shrink-0`}
                  aria-label="Show room info"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Forest-mode radio controls (docs/MESH.md P3.b): mesh transport +
              custom rooms only — the room code drives the SSID/PSK (D2). */}
          {transportKind === "mesh" && actualRoomType === "custom" && roomCode && (
            <RadioPanel roomCode={roomCode} colors={colors} />
          )}

          {/* Mobile Info Modal */}
          {showMobileInfo && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowMobileInfo(false)}>
              <div className={`bg-gradient-to-br ${colors.cardBg} border ${colors.border} rounded-2xl p-6 max-w-sm w-full backdrop-blur-md shadow-2xl`} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                  <h2 className={`text-lg font-bold bg-gradient-to-r ${colors.from} bg-clip-text text-transparent`}>
                    Room Info
                  </h2>
                  <button
                    onClick={() => setShowMobileInfo(false)}
                    className={`p-1 rounded-lg hover:bg-white/10 transition-colors text-white`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-white/70 text-sm">Room Type:</span>
                    <span className={`text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent`}>
                      {actualRoomType === "global" ? "Global" : actualRoomType === "custom" ? "Custom" : "Network"} room
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white/70 text-sm">Username:</span>
                    <span className={`text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-1 rounded-full border ${colors.border} backdrop-blur-sm`}>
                      {user.username}
                    </span>
                  </div>
                  {actualRoomType === "network" && roomInfo && (
                    <div className="flex items-center gap-2">
                      <span className="text-white/70 text-sm">Network:</span>
                      <span className={`text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-1 rounded-full border ${colors.border} backdrop-blur-sm`}>
                        {roomInfo.roomName}
                      </span>
                    </div>
                  )}
                  {actualRoomType === "custom" && (
                    <div className="flex items-center gap-2">
                      <span className="text-white/70 text-sm">Room Code:</span>
                      <span className={`text-sm font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-1 rounded-full border ${colors.border} backdrop-blur-sm`}>
                        {roomCode}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Messages Area - Scrollable */}
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 space-y-2 custom-scrollbar pb-[100px] sm:pb-[100px] md:pb-[110px] lg:pb-[120px]"

          >
            {messages.map((message, index) => {
              // Skip rendering if senderId is null
              if (!message.senderId) return null;
              
              const isCurrentUser = message.senderId._id === user.id;
              const senderName = isCurrentUser ? user.username : message.senderId.userName;
              const senderColor = isCurrentUser ? colors.userColor : message.senderId.color;

              // Mesh image messages (P2.b): thumbnail renders immediately;
              // blobStates upgrades it to the full-res asset URL when ready.
              const blob = message.kind === "image" ? message.blob : null;
              const blobState = blob ? blobStates[blob.hash] : null;
              const thumbSrc = blob ? `${THUMB_PREFIX}${blob.thumbB64}` : null;


              return (
                <div
                  key={message._id || index}
                  className={`flex ${isCurrentUser ? "justify-end" : "justify-start"}`}
                >
                  <div className="max-w-[85%] sm:max-w-[70%] relative z-0">
                    <div
                      className={`text-xs sm:text-sm font-semibold mb-0.5 ${
                        isCurrentUser ? "text-right" : "text-left"
                      }`}
                      style={{ color: senderColor }}
                    >
                      {senderName}
                    </div>
                    <div className="relative">
                      <div
                        className={`rounded-2xl px-3 py-1.5 sm:px-4 sm:py-2 backdrop-blur-sm border text-white mb-1 cursor-pointer select-none transition-all hover:brightness-110`}
                        style={{
                          backgroundColor: `${senderColor}20`,
                          borderColor: `${senderColor}30`,
                        }}

                        onClick={(e) => e.stopPropagation()}
                      >
                        {blob ? (
                          <div
                            className={`relative my-1 overflow-hidden rounded-xl ${
                              !blobState ? "animate-pulse ring-1 ring-white/40" : ""
                            }`}
                          >
                            <img
                              src={blobState?.status === "ready" ? blobState.url : thumbSrc}
                              alt="Shared image"
                              className="max-h-60 rounded-xl object-cover"
                              onError={(e) => {
                                // Full-res asset failed to load — fall back
                                // to the inline thumbnail that always works.
                                if (e.currentTarget.src !== thumbSrc) {
                                  e.currentTarget.src = thumbSrc;
                                }
                              }}
                            />
                            {blobState?.status === "failed" && (
                              <span className="absolute bottom-1 left-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-white/80">
                                full image unavailable:{" "}
                                {blobState.reason === "exceeds-autofetch-cap"
                                  ? "too large for auto-download"
                                  : blobState.reason}
                              </span>
                            )}
                          </div>
                        ) : (
                          <p className="text-white/90 text-sm sm:text-base break-words text-left">
                            {message.text}
                          </p>
                        )}
                      </div>


                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Input Area - Fixed */}
          <div className="fixed bottom-0 left-0 right-0 p-2 sm:p-3 md:p-4 border-t border-white/10 bg-black/90 backdrop-blur-xl z-30">
            <form
              onSubmit={handleSendMessage}
              className="flex gap-2 max-w-4xl mx-auto relative"
            >
              <div className="relative flex-1">
                <textarea
                  ref={textareaRef}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type your message..."
                  rows={1}
                  style={{ resize: "none" }}
                  className={`w-full bg-white/5 text-white rounded-xl px-3 py-2 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-${colors.userColor}/50 border border-white/10 transition-all min-h-[40px] max-h-40 pr-14 text_scroll`}
                  onInput={(e) => {
                    e.target.style.height = "auto";
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                />
                {newMessage.length >= CHARACTER_WARNING && (
                  <span
                    className={`absolute bottom-2 right-4 text-xs font-mono pointer-events-none select-none ${
                      newMessage.length <= CHARACTER_LIMIT
                        ? "text-green-500"
                        : "text-red-400"
                    }`}
                    style={{
                      background: "rgba(0,0,0,0.6)",
                      borderRadius: "6px",
                      padding: "0 6px",
                      lineHeight: "1.5",
                    }}
                  >
                    {newMessage.length <= CHARACTER_LIMIT
                      ? `${CHARACTER_LIMIT - newMessage.length}`
                      : `-${newMessage.length - CHARACTER_LIMIT}`}
                  </span>
                )}
              </div>
              {transportKind === "mesh" && (
                <>
                  {/* Hidden picker behind the attach button (mesh only, P2.b) */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    aria-label="Image file"
                    onChange={handleImagePick}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={imageSending}
                    aria-label="Attach image"
                    title="Send an image"
                    className={`px-3 py-2 bg-gradient-to-r ${colors.button} rounded-xl text-white hover:opacity-90 transition-opacity font-medium text-sm sm:text-base flex items-center ${
                      imageSending ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                    style={{ height: "40px", minHeight: "40px", alignSelf: "start" }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className={`h-5 w-5 ${imageSending ? "animate-pulse" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  </button>
                </>
              )}
              <button
                type="submit"
                disabled={
                  !newMessage.trim() ||
                  newMessage.length > CHARACTER_LIMIT ||
                  Date.now() - lastSent < THROTTLE_DELAY
                }
                className={`px-3 sm:px-6 py-2 bg-gradient-to-r ${colors.button} rounded-xl text-white hover:opacity-90 transition-opacity font-medium text-sm sm:text-base whitespace-nowrap flex items-center gap-1.5 ${
                  !newMessage.trim() ||
                  newMessage.length > CHARACTER_LIMIT ||
                  Date.now() - lastSent < THROTTLE_DELAY
                    ? "opacity-50 cursor-not-allowed"
                    : ""
                }`}
                style={{ height: "40px", minHeight: "40px", alignSelf: "start" }}
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
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
                <span className="hidden sm:inline">Send</span>
              </button>
            </form>
          </div>
        </div>



        <style jsx global>{`
          .text_scroll::-webkit-scrollbar {
            width: 0 !important;
            height: 0 !important;
          }
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: linear-gradient(to bottom, ${colors.userColor}, ${roomType === "global" ? "#3b82f6" : "#0891b2"});
            border-radius: 3px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(to bottom, ${roomType === "global" ? "#6d28d9" : "#059669"}, ${roomType === "global" ? "#2563eb" : "#0e7490"});
          }
          .font {
            font-family: "Gloria Hallelujah", cursive;
            font-weight: 400;
            font-style: normal;
          }
          .waves-font {
            font-family: "Monoton", cursive;
          }
          .h-screen {
            height: calc(var(--vh, 1vh) * 100);
          }
        `}</style>
      </div>


    </>
  );
}

export default Chat;