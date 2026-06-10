import jwt from 'jsonwebtoken';

import User from '../models/user.model.js';

export const protectedRoute = async (req, res, next) => {
  try {
    const token = req.cookies.jwt;

    if(!token) {
      return res.status(401).json({
        isAuthenticated: false,
        message: "No token provided"
      });
    }

    try {
      const decodedToken = /** @type {{ userId: string }} */ (
        jwt.verify(token, process.env.JWT_SECRET)
      );
      if(!decodedToken) {
        return res.status(401).json({
          isAuthenticated: false,
          message: "Invalid token"
        });
      }

      const user = await User.findById(decodedToken.userId).select("-password");
      if(!user) {
        return res.status(404).json({
          isAuthenticated: false,
          message: "User not found"
        });
      }

      req.user = {
        _id: user._id,
        userName: user.userName,
        color: user.color,
        isAuthenticated: true
      };
      next();
    } catch {
      // An expired / malformed / wrong-secret token is a client auth failure,
      // not a server error — respond 401 so clients can re-authenticate.
      return res.status(401).json({
        isAuthenticated: false,
        message: "Invalid token"
      });
    }
  } catch (error) {
    console.log("Error in protected auth middleware", error.message);
    res.status(500).json({
      isAuthenticated: false,
      message: "Internal Server Error"
    });
  } 
}
