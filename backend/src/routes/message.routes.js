import express from "express";

import { getMessages, sendMessage } from "../controllers/message.controller.js";
import { protectedRoute } from "../middleware/auth.middleware.js";

const router = express.Router();

// Get messages for a room
router.get("/:roomName", protectedRoute, getMessages);

// Send message to a room
router.post("/send/:roomName", protectedRoute, sendMessage);

export default router;