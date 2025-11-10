# Waves - Real-time Chat Application

Waves is a modern, real-time chat application that offers global, network-based, and custom private chat rooms. Built with React, Node.js, and Socket.IO, it features a beautiful, responsive UI and seamless real-time communication.

## Features

###  Three Room Types
- **Global Room**: Connect with users worldwide in a public chat
- **Network Room**: Auto-assigned rooms based on IP subnet for local connections
- **Custom Rooms**: Private rooms with unique 6-character codes for secure sharing

###  Flexible Authentication
- Anonymous login with auto-generated usernames and colors
- Custom account creation with persistent identities
- Room-specific color palettes for visual distinction

###  Advanced Messaging
- Peer-to-Peer messaging via WebRTC with automatic server fallback
- Real-time communication with message deduplication
- Message reactions and timestamps

###  Responsive Design
- Mobile-optimized interface with touch-friendly controls
- Native sharing with clipboard fallback
- Auto-focus input fields and rate limiting

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- MongoDB
- npm or yarn

### Installation

1. Clone the repository
```bash
git clone https://github.com/wavey-waves/waves.git
cd waves
```

2. Install dependencies for both frontend and backend
```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

3. Create environment files

Backend (.env):
```env
PORT=3000
MONGODB_URI=your_mongodb_uri
JWT_SECRET=your_jwt_secret
NODE_ENV=development
```

4. Start the development servers

Backend:
```bash
cd backend
npm run dev
```

Frontend:
```bash
cd frontend
npm run dev
```

##  Tech Stack

### Frontend
- React (Vite)
- Socket.IO Client
- Axios
- TailwindCSS
- React Router
- react-toastify

### Backend
- Node.js
- Express
- Socket.IO
- MongoDB with Mongoose
- JWT Authentication

---

#  Complete System Flowchart

##  PLATFORM OVERVIEW
Waves is a real-time chat application featuring **Peer-to-Peer (P2P) messaging** with **WebRTC Data Channels**, **automatic server fallback**, and **three room types**: Global, Network-based, and Custom private rooms.

##  COMPLETE SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              WAVES CHAT PLATFORM                                │
│                          Real-time P2P Messaging System                         │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               USER JOURNEY                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                        ┌───────────────┴───────────────┐
                        │                               │
                        ▼                               ▼
            ┌─────────────────────┐         ┌─────────────────────┐
            │   ANONYMOUS USER    │         │ REGISTERED USER     │
            │   (localStorage)    │         │   (JWT Cookies)     │
            └─────────────────────┘         └─────────────────────┘
                        │                               │
                        └───────────────┬───────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              ROOM SELECTION                                     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                 ┌────────────────────┼───────────────────────────┐
                 │                    │                           │
                 ▼                    ▼                           ▼
      ┌─────────────────────┐    ┌────────────────┐     ┌──────────────────────┐
      │   GLOBAL ROOM       │    │ NETWORK        │     │ CUSTOM ROOM          │
      │   (/chat/global)    │    │ ROOM           │     │ (/chat/custom/XXXXXX)|
      │                     │    │ (/chat/network)|     │                      │
      └─────────────────────┘    └────────────────┘     └──────────────────────┘
                 │                     │                          │
                 └─────────────────────┼──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            AUTHENTICATION FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

##  AUTHENTICATION SYSTEM

### **Anonymous User Flow**
```
1. User visits / (Home)
2. Clicks room type (Global/Network/Custom)
3. JoinRoom component loads
4. Check localStorage.getItem('anonymousUser')
   ├── If exists & valid (not expired):
   │   └── Parse JSON: {name, color, expiry}
   │       └── expiry = Date.now() + 7 days
   └── If missing/invalid/expired:
       └── Generate new random name & color
           ├── Name: unique-names-generator (adjective-color-animal)
           ├── Color: Room-specific color palette
           └── Store in localStorage as JSON

5. User clicks "Join as Anonymous"
6. POST /api/auth/login with {userName: randomName}
   ├── If user exists: Return user data
   └── If user doesn't exist: Auto-create via signup
       └── POST /api/auth/signup with {userName, color, isAnonymous: true}

7. Server generates JWT token (7 days expiry)
8. Cookie: jwt=token; httpOnly=true; secure=production; path="/"
9. Return: {_id, userName, color, isAnonymous: true}
```

### **Registered User Flow**
```
1. User visits / (Home)
2. Clicks room type → JoinRoom component
3. Selects "Create Account" tab
4. Enters username, password, selects color
5. POST /api/auth/signup with {userName, password, color, isAnonymous: false}
   ├── Validate: username unique, password ≥6 chars
   ├── Hash password: bcrypt.genSalt(10) + bcrypt.hash()
   ├── Store: {userName, hashedPassword, color, isAnonymous: false}
   └── Generate JWT token (7 days)

6. Cookie: jwt=token (same settings as anonymous)
7. Return: {_id, userName, color, isAnonymous: false}
```

### **Session Persistence**
```
- JWT Cookie: 7 days expiry, httpOnly, secure in production
- Anonymous localStorage: 7 days expiry, auto-regenerates
- Color Assignment: Room-specific palettes (15 colors each)
  ├── Global: Purple/Violet/Blue theme
  ├── Network: Emerald/Cyan/Teal theme
  ├── Custom: Rose/Pink theme
```

##  ROOM TYPES & ASSIGNMENT

### **Global Room (/chat/global)**
```
- Accessible to all authenticated users
- Room name: "global-room"
- No special assignment logic
- All users join same Socket.IO room: "global-room"
```

### **Network Room (/chat/network)**
```
1. User authenticates successfully
2. POST /api/rooms/assign (protected route)
3. Extract client IP using request-ip package
4. Create subnet: IP.split('.').slice(0,3).join('.')
5. Generate roomName: `network-${subnet}`
6. Find/create room in MongoDB
   ├── If exists: Add user to members array
   └── If new: Create room with user as first member
7. Return: {roomId, roomName, memberCount, members[]}
8. Socket.IO join: socket.join(roomName)
```

### **Custom Room (/chat/custom/:code)**
```
Creation Flow:
1. User clicks "Custom Room" on home
2. CustomRoom component loads
3. User clicks "Create Room"
4. POST /api/rooms/create
5. Generate unique 6-char code:
   ├── Loop until unique: Math.random().toString(36).substring(2,8).toUpperCase()
   ├── Check MongoDB: Room.findOne({code})
6. Create room: {roomName: `custom-${code}`, code, isCustomRoom: true}
7. Return: {roomId, roomName, code, memberCount: 0}

Joining Flow:
1. User enters URL: /chat/custom/ABC123
2. ChatRoute component loads
3. POST /api/rooms/join with {code: "ABC123"}
4. Find room by code (case-insensitive)
5. Return room info (without member details for privacy)
6. Show JoinRoom component for authentication
7. After auth: Join Socket.IO room by roomName
```

##  MESSAGING SYSTEM

### **Message Flow Architecture**
```
┌─────────────────────────────────────────────────────────────────┐
│                      MESSAGE SENDING FLOW                       │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   User Types Message  │
                    └───────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   Input Validation    │
                    │   - Not empty         │
                    │   - ≤1000 chars       │
                    │   - Rate limit (1s)   │
                    └───────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   P2P Attempt First   │
                    │   (WebRTC DataChannel)│
                    └───────────────────────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
                    ▼           ▼           ▼
        ┌─────────────────┐  ┌─────┐ ┌─────────────┐
        │   P2P Success   │  │P2P  │ │  P2P Fails  │
        │   Direct Send   │  │Fails│ │  Server     │
        └─────────────────┘  └─────┘ │  Relay      │
                                     └─────────────┘
                                             │
                                             ▼
                                 ┌────────────────────────────────────┐
                                 │   Server Processing                │
                                 │   POST /api/messages/send/:roomName|
                                 └────────────────────────────────────┘
```

### **WebRTC P2P Implementation**
```
Connection Establishment:
1. User joins Socket.IO room
2. Server emits "existing-room-users" with other users
3. For each existing user:
   ├── Create RTCPeerConnection with ICE servers
   ├── Create DataChannel named "chat"
   ├── Create offer: pc.createOffer()
   ├── Set local description
   ├── Send offer via Socket.IO: "webrtc-offer"

4. Receiving user:
   ├── Create RTCPeerConnection
   ├── Set remote description (offer)
   ├── Create answer: pc.createAnswer()
   ├── Send answer via Socket.IO: "webrtc-answer"

5. ICE candidate exchange:
   ├── Both sides: pc.onicecandidate → emit "webrtc-ice-candidate"
   ├── Add received candidates to peer connections

6. DataChannel setup:
   ├── dc.onopen: Connection ready for P2P messaging
   ├── dc.onmessage: Receive P2P messages
   ├── dc.onclose: Cleanup connection

Fallback Logic:
- If P2P fails after 10 seconds: Close connection, use server
- Network changes: Automatically attempt P2P reconnection
- Firewall/NAT issues: Seamless server relay fallback
```

### **Message Storage & Cleanup**
```
Message Schema:
{
  senderId: ObjectId (ref: Users),
  room: String (default: "global-room"),
  text: String,
  reactions: [{
    userId: ObjectId,
    emoji: String,
    createdAt: Date
  }],
  expiresAt: Date (31 days for messages, 40 days for rooms)
}

Cleanup System:
- MongoDB TTL indexes auto-delete expired messages/rooms
- Manual cleanup: DELETE /api/messages/cleanup
  ├── Keep only latest 1000 messages per room
  ├── Delete older messages in batches
- Reaction limits: One reaction per user per message
```

##  UI/UX SYSTEM

### **Color Assignment System**
```
Room-Based Color Palettes:

Global Room Colors (15 colors):
┌─────────────────────────────────────────────────┐
│ #8b5cf6 #a855f7 #6366f1 #3b82f6 #0ea5e9 #60a5fa │
│ #d946ef #ec4899 #f43f5e #f97316 #f59e0b #fbbf24 │
│ #eab308 #84cc16 #22c55e                         │
└─────────────────────────────────────────────────┘
Theme: Purple → Violet → Blue → Indigo

Network Room Colors (15 colors):
┌─────────────────────────────────────────────────┐
│ #10b981 #14b8a6 #06b6d4 #34d399 #22c55e #84cc16 │
│ #0ea5e9 #60a5fa #3b82f6 #6366f1 #8b5cf6 #a855f7 │
│ #d946ef #ec4899 #f43f5e                         │
└─────────────────────────────────────────────────┘
Theme: Emerald → Teal → Cyan → Green

Custom Room Colors (15 colors):
┌─────────────────────────────────────────────────┐
│ #f43f5e #ec4899 #d946ef #e11d48 #f97316 #fbbf24 │
│ #f59e0b #84cc16 #22c55e #10b981 #06b6d4 #3b82f6 │
│ #6366f1 #8b5cf6 #a855f7                         │
└─────────────────────────────────────────────────┘
Theme: Rose → Pink → Fuchsia
```

### **Responsive Design System**
```
Mobile Optimizations:
- Viewport height: CSS custom property --vh
- Info button: Shows user details & room code on mobile
- Header layout: Logo acts as back button on mobile
- Touch-friendly: Larger buttons, swipe gestures
- Auto-focus: Input field focuses automatically on load

Desktop Features:
- Hover effects: Scale transforms, glow effects
- Gradient animations: CSS keyframe animations
- Modal dialogs: Documentation, room creation
- Native sharing: Web Share API with clipboard fallback
```

##  REAL-TIME COMMUNICATION

### **Socket.IO Event Flow**
```
Server Events (io.on):
├── "connection": New client connects
├── "join": Client joins room
├── "leave": Client leaves room
├── "disconnect": Client disconnects
├── "webrtc-offer": WebRTC offer received
├── "webrtc-answer": WebRTC answer received
├── "webrtc-ice-candidate": ICE candidate received

Client Events (socket.emit):
├── "join": Join room
├── "leave": Leave room
├── "webrtc-offer": Send WebRTC offer
├── "webrtc-answer": Send WebRTC answer
├── "webrtc-ice-candidate": Send ICE candidate

Broadcast Events (io.to(room).emit):
├── "userJoined": New user joined room
├── "userLeft": User left/disconnected
├── "chatMessage": New message received
├── "message-reacted": Message reaction updated
├── "existing-room-users": Send existing users to new joiner
```

### **Message Deduplication System**
```
Processed Message IDs:
- Set<string> processedMessageIds (in-memory)
- Tracks both _id and tempId for each message
- Prevents duplicate rendering from P2P + Server paths
- Cleanup: Automatic garbage collection on component unmount
```

##  MOBILE OPTIMIZATION

### **Mobile UI Components**
```
Info Button (Mobile Only):
- Position: Fixed top-right corner
- Content: Username, Room type/code, Member count
- Trigger: Click to show modal overlay
- Close: Click outside or X button

Header Layout:
- Desktop: Logo + Room info + Share + Info
- Mobile: Logo (back) + Room name + Info button
- Responsive breakpoints: Tailwind CSS classes

Input System:
- Auto-focus: textarea.focus() on component mount
- Auto-resize: Dynamic height based on content
- Character limit: 1000 chars with warning at 900
- Rate limiting: 1000ms throttle between sends
```

##  SHARING SYSTEM

### **Native Sharing Implementation**
```
if (navigator.share) {
  // Web Share API (Mobile browsers)
  navigator.share({
    title: \`Join \${roomName}\`,
    text: \`Join my chat room: \${roomCode}\`,
    url: window.location.href
  });
} else {
  // Clipboard fallback (Desktop/some mobile)
  navigator.clipboard.writeText(window.location.href);
  toast.success("Room link copied to clipboard!");
}
```

### **URL Structure**
```
/                    → Home (room selection)
/chat/global         → Global room
/chat/network        → Network room (IP-based)
/chat/custom/:code   → Custom room (code-based)
```

##  DATA PERSISTENCE

### **Cookies Stored**
```
jwt: JWT token (7 days expiry)
├── httpOnly: true (prevents XSS access)
├── secure: true (HTTPS only in production)
├── sameSite: "lax" (CSRF protection)
├── path: "/" (available site-wide)
```

### **localStorage Items**
```
anonymousUser: JSON string
├── {name, color, expiry}
├── expiry: Date.now() + 7 days
├── Auto-regenerates when expired

Legacy keys (auto-migrated):
├── anonymousUsername: string
├── userColor: string
```

### **Database Collections**
```
Users:
├── _id, userName, password?, color, isAnonymous
├── expiresAt (TTL: 7 days anonymous, 1 year registered)

Messages:
├── senderId, room, text, reactions[], expiresAt
├── TTL: 31 days

Rooms:
├── roomName, code?, members[], createdByIp, isCustomRoom
├── TTL: 40 days
```

##  DEPLOYMENT & CONFIGURATION

### **Environment Variables**
```
Backend (.env):
├── MONGODB_URI: MongoDB connection string
├── PORT: Server port (default: 3000)
├── JWT_SECRET: JWT signing key
├── NODE_ENV: development/production

Frontend (.env.*):
├── VITE_BACKEND_URL: API endpoint
    ├── Development: http://localhost:8000
    ├── Production: https://waves-c53a.onrender.com
```

### **Build Process**
```
Root package.json scripts:
├── build: Install deps + build frontend + install backend
├── start: Start backend (serves built frontend)

Frontend (Vite):
├── dev: Development server with HMR
├── build: Production build to dist/
├── preview: Preview production build

Backend (Node.js):
├── dev: nodemon with auto-restart
├── start: Production server
```

##  ERROR HANDLING & FALLBACKS

### **Connection Resilience**
```
WebRTC P2P Fallback:
├── Timeout: 10 seconds for P2P connection
├── Auto-fallback: Server relay if P2P fails
├── Reconnection: Automatic P2P reattempts

Network Issues:
├── Socket.IO auto-reconnection
├── Message queuing during disconnects
├── Offline detection and user feedback

Authentication Errors:
├── Token expiry: Redirect to join room
├── Invalid token: Clear cookies, re-authenticate
├── Network errors: Retry with exponential backoff
```

##  PERFORMANCE OPTIMIZATIONS

### **Message Cleanup**
```
Automatic Cleanup:
├── Keep latest 1000 messages per room
├── Delete older messages in batches
├── MongoDB TTL indexes for auto-expiry

Memory Management:
├── Processed message ID deduplication
├── Peer connection cleanup on disconnect
├── Component unmount cleanup

Rate Limiting:
├── 1000ms throttle between message sends
├── Character limits (1000 max)
├── Input validation before sending
```

##  USER EXPERIENCE FLOW

```
1. Landing Page
   ├── Animated "Waves" title with glow effects
   ├── Three room type cards with hover animations
   ├── Documentation button (top-right)
   └── Gradient background with subtle patterns

2. Room Selection
   ├── Global: Purple theme, instant access
   ├── Network: Green theme, IP-based auto-assignment
   ├── Custom: Pink theme, code generation/sharing

3. Authentication
   ├── Anonymous: Auto-generated name/color (localStorage)
   ├── Registered: Manual username/password creation
   ├── Color selection from room-specific palettes

4. Chat Interface
   ├── Real-time P2P messaging with server fallback
   ├── Mobile-responsive header with info modal
   ├── Auto-focus input field
   ├── Message reactions (one per user)
   ├── Share functionality with native API

5. Message Features
   ├── P2P priority with seamless server fallback
   ├── User color coding for message distinction
   ├── Timestamp display
   ├── Auto-scroll to latest messages
   ├── Character counter with warnings
```

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Acknowledgments

- [Socket.IO](https://socket.io/)
- [TailwindCSS](https://tailwindcss.com/)
- [MongoDB](https://www.mongodb.com/)
- [React](https://reactjs.org/)
