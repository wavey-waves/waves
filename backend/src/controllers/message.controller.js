import Message from '../models/message.model.js';
import { io } from "../libs/socket.js";

const NO_OF_MESSAGES = 1000;

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
    const {text, image, tempId} = req.body;
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
      .populate('senderId', 'userName color isAnonymous')
      .lean();

    const payload = {...populated, tempId};    

    // ✅ Always broadcast the message. The server is the source of truth.
    console.log(`[Server] Broadcasting message ${payload._id} to room ${roomName}.`);
    io.to(roomName).emit("chatMessage", payload);

    res.status(201).json(populated);
  } catch (error) {
    console.log("Error in sendMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
}

export const cleanupMessages = async (req, res) => {
  try {
    const rooms = await Message.distinct("room");

    for (const room of rooms) {
      const messages = await Message.find({ room })
        .sort({ createdAt: -1 }) // newest first
        .skip(NO_OF_MESSAGES)               // skip top n
        .select("_id");

      const idsToDelete = messages.map((msg) => msg._id);
      if (idsToDelete.length > 0) {
        await Message.deleteMany({ _id: { $in: idsToDelete } });
        console.log(`Cleaned ${idsToDelete.length} messages in room "${room}"`);
      }
    }

    return res.status(200).json({ message: "Cleanup completed successfully" });
  } catch (error) {
    console.error("Error in cleanupMessages controller:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}