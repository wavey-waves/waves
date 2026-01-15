# Waves Desktop Application

This is the Tauri-based desktop application for Waves, providing the same functionality as the web application.

## Prerequisites

- Node.js (v18 or higher)
- Rust (latest stable version)
- npm or yarn
- Backend server running (see main README)

## Setup

1. Install dependencies:
```bash
cd app
npm install
```

2. Install Tauri CLI (if not already installed):
```bash
npm install -g @tauri-apps/cli
```

3. Set up environment variables:
Create a `.env` file in the `app` directory:
```env
VITE_BACKEND_URL=http://localhost:3000
```

## Development

1. Make sure the backend server is running (see main backend README)

2. Run the desktop app in development mode:
```bash
npm run tauri:dev
```

This will:
- Start the Vite dev server on port 1420
- Build and run the Tauri application
- Hot reload when you make changes

## Building

To build the desktop application for production:

```bash
npm run tauri:build
```

The built application will be in `app/src-tauri/target/release/` (or `target/debug/` for debug builds).

## Configuration

- Backend URL: Set `VITE_BACKEND_URL` in `.env` file or environment variables
- Window size: Configure in `app/src-tauri/tauri.conf.json`
- App metadata: Configure in `app/src-tauri/Cargo.toml`

## Features

The desktop app includes all the same features as the web app:
- Global chat rooms
- Network-based chat rooms
- Custom private rooms
- Anonymous and custom account authentication
- Real-time messaging with Socket.IO
- P2P WebRTC communication with server fallback

## Notes

- The app uses HashRouter instead of BrowserRouter for better compatibility with desktop file protocols
- Clipboard functionality uses Tauri's clipboard-manager plugin
- All API calls are configured to use the backend URL from environment variables

