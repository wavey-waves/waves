import Message from '../models/message.model.js';

import { io } from "../libs/socket.js";

const GLOBAL_ROOM = "global-room";

export const getMessages = async (req, res) => {
  try {
    const messages = await Message
      .find({ room: GLOBAL_ROOM})
      .populate('senderId', 'userName color isAnonymous')
      .lean();
    res.status(200).json(messages);
  } catch (error) {
    console.log("Error in getMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const {text, image} = req.body;
    const senderId = req.user._id;

    //to implement with cloudinary
    /*
      let imageUrl;
      if (image) {
        // const uploadResponse = await cloudinary.uploader.upload(image);
        // imageUrl = uploadResponse.secure_url;
        imageUrl = image; // Or just save the raw image data/URL
      }
    */

    const newMessage = new Message({
      senderId,
      text,
      // image: imageUrl,
      room: GLOBAL_ROOM,
    });

    await newMessage.save();

    // Populate the sender information using findById
    const populated = await Message.findById(newMessage._id)
      .populate('senderId', 'userName color isAnonymous');

    io.to(GLOBAL_ROOM).emit("chatMessage", populated);

    res.status(201).json(populated);
  } catch (error) {
    console.log("Error in sendMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
}