import express from "express";

import { protectedRoute } from "../middleware/auth.middleware.js";
import { assignRoom, leaveRoom } from "../controllers/room.controller.js";

const router = express.Router();

router.get('/assign', protectedRoute, assignRoom);
router.post('/leave/:roomName', protectedRoute, leaveRoom);

export default router;