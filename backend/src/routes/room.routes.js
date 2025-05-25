import express from "express";

import { protectedRoute } from "../middleware/auth.middleware.js";
import { assignRoom } from "../controllers/room.controller.js";

const router = express.Router();

router.post('/assign', protectedRoute, assignRoom);

export default router;