import bcrypt from "bcryptjs";

import User from "../models/user.model.js";
import { generateToken } from "../libs/utils.js";

export const signup = async (req, res) => {
  const {userName, password, color} = req.body;
  try {
    if(!userName || !color) {
      return res.status(400).json({message: "Required fields not filled"});
    }

    if(password.length < 6) {
      return res.status(400).json({message: "Password length too short"});
    }

    const user = await User.findOne({userName});
    if(user) {
      return res.status(400).json({message: "User already exists"});
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      userName,
      password: hashedPassword,
      color
    });

    if(newUser) {
      //gen jwt
      generateToken(newUser._id, res);

      await newUser.save();

      res.status(201).json({
        _id: newUser._id,
        userName: newUser.userName,
        color: newUser.color
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
    const user = await User.findOne({userName});
    if(!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }
    
    const correctPassword = await bcrypt.compare(password, user.password);
    if(!correctPassword) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    generateToken(user._id, res);
    res.status(200).json({
      id: user._id,
      userName: user.userName,
      color: user.color
    })
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