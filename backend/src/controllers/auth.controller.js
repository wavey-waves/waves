import bcrypt from "bcryptjs";

import User from "../models/user.model.js";
import { generateToken } from "../libs/utils.js";

export const signup = async (req, res) => {
  const {userName, password, color, isAnonymous} = req.body;
  try {
    // Validate required fields
    if(!userName || userName.trim() === '') {
      return res.status(400).json({message: "Username is required"});
    }

    if(!color) {
      return res.status(400).json({message: "Color is required"});
    }

    // Check if user already exists
    const existingUser = await User.findOne({userName: userName.trim()});
    if(existingUser) {
      return res.status(400).json({message: "Username already exists"});
    }

    // Create new user
    const newUser = new User({
      userName: userName.trim(),
      color: color,
      isAnonymous: isAnonymous || false
    });

    // Only hash and set password for non-anonymous users
    if (!isAnonymous) {
      if(!password || password.length < 6) {
        return res.status(400).json({message: "Password must be at least 6 characters long"});
      }
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      newUser.password = hashedPassword;
    }

    // Save user and generate token
    if(newUser) {
      await newUser.save();
      generateToken(newUser._id, res);

      res.status(201).json({
        _id: newUser._id,
        userName: newUser.userName,
        color: newUser.color,
        isAnonymous: newUser.isAnonymous
      });
    } else {
      res.status(400).json({message: "Invalid User data"});
    }
  } catch (error) {
    console.log("Error in signup auth controller", error.message);
    res.status(500).json({message: "Internal Server Error"});
  }
}

export const login = async (req, res) => {
  const {userName, password} = req.body;
  try {
    if(!userName) {
      return res.status(400).json({ message: "Username is required" });
    }

    const user = await User.findOne({userName: userName.trim()});
    if(!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    
    if (!user.isAnonymous) {
      const correctPassword = await bcrypt.compare(password, user.password);
      if(!correctPassword) {
        return res.status(400).json({ message: "Invalid credentials" });
      }
    }
    

    generateToken(user._id, res);
    res.status(200).json({
      id: user._id,
      userName: user.userName,
      color: user.color,
      isAnonymous: user.isAnonymous
    });
  } catch (error) {
    console.log("Error in login auth controller", error.message);
    res.status(500).json({message: "Internal Server Error"});
  }
}

//protected routes
export const logout = (req, res) => {
  try {
    res.cookie("jwt", "", {maxAge: 0});
    res.status(200).json({message: "Logged out Successfully"})
  } catch (error) {
    console.log("Error in logout auth controller", error.message);
    res.status(500).json({message: "Internal Server Error"});
  }
}

export const checkAuth = (req, res) => {
  try {
    res.status(200).json(req.user);
  } catch (error) {
    console.log("Error in check auth controller", error.message);
    res.status(500).json({message: "Internal Server Error"});
  }
}