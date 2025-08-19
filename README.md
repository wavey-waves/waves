# Waves - Real-time Chat Application

Waves is a modern, real-time chat application that offers both global and network-based chat rooms. Built with React, Node.js, and Socket.IO, it features a beautiful, responsive UI and seamless real-time communication.

## Features

### Global Chat
- Join a global chatroom accessible to all users
- Real-time message updates
- User presence indicators
- Beautiful, modern UI with gradient effects

### Network Chat
- Automatic room assignment based on IP subnet
- Connect with users on the same network
- Real-time message updates within network rooms
- Member list with user status

### User Authentication
- Anonymous login with randomly generated names
- Custom account creation
- Persistent user colors
- Secure authentication with JWT

### UI/UX
- Modern, responsive design
- Beautiful gradient animations
- Dark theme optimized for readability
- Real-time typing indicators
- Message timestamps
- Auto-scroll to latest messages
- Character counter and limit warning
- Send button disables and rate-limits
- Error toasts for empty/long/too-fast messages

### P2P Communication
- Peer-to-peer messaging via WebRTC Data Channels whenever possible
- Automatic fallback to server relaying (Socket.IO) when P2P is unavailable

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

## 🛠️ Tech Stack

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

## Usage

1. **Global Chat**
   - Click "Join Global Room" on the home page
   - Choose anonymous login or create an account
   - Start chatting with users worldwide

2. **Network Chat**
   - Click "Join Network" on the home page
   - You'll be automatically assigned to a room based on your IP subnet
   - Chat with users on your network

3. **User Account**
   - Create a custom account with username and password
   - Or use anonymous login with auto-generated username
   - Your color will be preserved across sessions

## Security Features

- JWT-based authentication
- HTTP-only cookies
- Password hashing with bcrypt
- CORS configuration
- Input validation and sanitization

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
