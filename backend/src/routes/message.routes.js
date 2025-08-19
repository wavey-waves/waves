import express from "express";

import { cleanupMessages, getMessages, reactToMessage, sendMessage } from "../controllers/message.controller.js";
import { protectedRoute } from "../middleware/auth.middleware.js";

const router = express.Router();

// Get messages for a room
router.get("/:roomName", protectedRoute, getMessages);

// Send message to a room
router.post("/send/:roomName", protectedRoute, sendMessage);

// React to a message
router.post("/:id/react", protectedRoute, reactToMessage);

// Only retain latest 1000 messages in a room
router.delete("/cleanup", protectedRoute, cleanupMessages);

export default router;