import Message from '../models/message.model.js';
import { io } from "../libs/socket.js";

const NO_OF_MESSAGES = 1000;

export const getMessages = async (req, res) => {
  try {
    const roomName = req.params.roomName;
    console.log(`[DEBUG] Getting messages for room: ${roomName}`);
    const messages = await Message
      .find({ room: roomName })
      .populate('senderId', 'userName color isAnonymous')
      .populate('replyTo', 'text senderId')
      .populate('reactions.userId', 'userName')
      .populate({
        path: 'replyTo',
        populate: {
          path: 'senderId',
          select: 'userName color isAnonymous'
        }
      })
      .sort({ createdAt: 1 })
      .lean();
    console.log(`[DEBUG] Found ${messages.length} messages for room ${roomName}`);
    res.status(200).json(messages);
  } catch (error) {
    console.log("Error in getMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const {text, image, tempId, replyTo} = req.body;
    const senderId = req.user._id;
    const roomName = req.params.roomName;

    console.log(`[DEBUG] Sending message to room: ${roomName}, text: ${text}, replyTo: ${replyTo}`);

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: "Message text is required" });
    }

    // Validate replyTo if provided
    if (replyTo) {
      // Check if replyTo is a valid MongoDB ObjectId (24 hex characters)
      const isValidObjectId = /^[a-fA-F0-9]{24}$/.test(replyTo);
      if (!isValidObjectId) {
        return res.status(400).json({ error: "Invalid replyTo ID format" });
      }

      const repliedMessage = await Message.findById(replyTo);
      if (!repliedMessage) {
        return res.status(400).json({ error: "Replied message not found" });
      }
      if (repliedMessage.room !== roomName) {
        return res.status(400).json({ error: "Cannot reply to message from different room" });
      }
    }

    const newMessage = new Message({
      senderId,
      text: text.trim(),
      room: roomName,
      replyTo: replyTo || null,
      reactions: []
    });

    await newMessage.save();

    // Populate the sender information
    const populated = await Message.findById(newMessage._id)
      .populate('senderId', 'userName color isAnonymous')
      .populate('replyTo', 'text senderId')
      .populate('reactions.userId', 'userName')
      .populate({
        path: 'replyTo',
        populate: {
          path: 'senderId',
          select: 'userName color isAnonymous'
        }
      })
      .lean();

    const payload = {...populated, tempId};    

    console.log(`[Server] Broadcasting message ${payload._id} to room ${roomName}.`);
    io.to(roomName).emit("chatMessage", payload);

    res.status(201).json(populated);
  } catch (error) {
    console.log("Error in sendMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
}

export const reactToMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body;
    const userId = req.user._id;

    if (!emoji || emoji.trim() === '') {
      return res.status(400).json({ error: "Emoji is required" });
    }

    const message = await Message.findById(id);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Check if user already reacted with this emoji
    const existingReactionIndex = message.reactions.findIndex(
      reaction => reaction.userId.toString() === userId.toString() && reaction.emoji === emoji
    );

    if (existingReactionIndex > -1) {
      // Remove the reaction if it exists
      message.reactions.splice(existingReactionIndex, 1);
    } else {
      // Remove any other reaction from this user first (one reaction per user)
      message.reactions = message.reactions.filter(
        reaction => reaction.userId.toString() !== userId.toString()
      );
      // Add the new reaction
      message.reactions.push({ userId, emoji });
    }

    await message.save();

    // Populate and send the updated message
    const updatedMessage = await Message.findById(id)
      .populate('senderId', 'userName color isAnonymous')
      .populate('replyTo', 'text senderId')
      .populate('reactions.userId', 'userName')
      .populate({
        path: 'replyTo',
        populate: {
          path: 'senderId',
          select: 'userName color isAnonymous'
        }
      })
      .lean();

    // Emit to all users in the room
    io.to(message.room).emit("message-reacted", updatedMessage);

    res.status(200).json(updatedMessage);
  } catch (error) {
    console.log("Error in reactToMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const cleanupMessages = async (req, res) => {
  try {
    const rooms = await Message.distinct("room");

    for (const room of rooms) {
      const messages = await Message.find({ room })
        .sort({ createdAt: -1 })
        .skip(NO_OF_MESSAGES)
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