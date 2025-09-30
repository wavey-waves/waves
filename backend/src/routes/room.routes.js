import express from "express";

import { protectedRoute } from "../middleware/auth.middleware.js";
import { assignRoom, leaveRoom, createRoom, joinRoom } from "../controllers/room.controller.js";

const router = express.Router();

router.get('/assign', protectedRoute, assignRoom);
router.post('/create', createRoom);
router.post('/join', joinRoom);
router.post('/leave/:roomName', protectedRoute, leaveRoom);

export default router;