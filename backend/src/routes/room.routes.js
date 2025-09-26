import express from "express";

import { protectedRoute } from "../middleware/auth.middleware.js";
import { assignRoom, leaveRoom, createRoom, joinRoom } from "../controllers/room.controller.js";

const router = express.Router();

router.get('/assign', protectedRoute, assignRoom);
router.post('/create', protectedRoute, createRoom);
router.post('/join', protectedRoute, joinRoom);
router.post('/leave/:roomName', protectedRoute, leaveRoom);

export default router;