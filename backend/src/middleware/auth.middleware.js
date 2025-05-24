import jwt from 'jsonwebtoken';

import User from '../models/user.model.js';

export const protectedRoute = async (req, res, next) => {
  try {
    const token = req.cookies.jwt;

    if(!token) {
      return res.status(401).json({message: "Unauthorised - No token"});
    }

    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    if(!decodedToken) {
      return res.status(401).json({message: "Unauthorised - Invalid token"});
    }

    const user = await User.findById(decodedToken.userId).select("-password");
    if(!user) {
      return res.status(404).json({message: "User not found"});
    }

    req.user = user;
    next();
  } catch (error) {
    console.log("Error in protected auth middleware", error.message);
    res.status(500).json({message: "Internal Server Error"});
  } 

}