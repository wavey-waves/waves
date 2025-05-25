import Message from '../models/message.model.js';
import { io } from "../libs/socket.js";

export const getMessages = async (req, res) => {
  try {
    const roomName = req.params.roomName;
    const messages = await Message
      .find({ room: roomName })
      .populate('senderId', 'userName color isAnonymous')
      .sort({ createdAt: 1 }) // Sort messages by creation time
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
    const roomName = req.params.roomName;

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: "Message text is required" });
    }

    const newMessage = new Message({
      senderId,
      text: text.trim(),
      room: roomName,
    });

    await newMessage.save();

    // Populate the sender information
    const populated = await Message.findById(newMessage._id)
      .populate('senderId', 'userName color isAnonymous');

    // Emit to room
    io.to(roomName).emit("chatMessage", populated);

    res.status(201).json(populated);
  } catch (error) {
    console.log("Error in sendMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
}