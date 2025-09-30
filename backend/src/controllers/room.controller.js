import Room from "../models/room.model.js";
import {getClientIp} from 'request-ip';

export const assignRoom = async (req, res) => {
  try {
    const ip = getClientIp(req);
    if(!ip) {
      return res.status(400).json({message: "Could not determine IP address"});
    }

    // Extract subnet from IP (first three octets)
    const subnet = ip.split('.').slice(0, 3).join('.');
    const roomName = `network-${subnet}`;

    // Find or create room
    let room = await Room.findOne({roomName});
    if(!room) {
      room = await Room.create({
        roomName,
        createdByIp: ip,
        members: [req.user._id]
      });
    } else {
      // Add user to room if not already a member
      if (!room.members.includes(req.user._id)) {
        room.members.push(req.user._id);
        await room.save();
      }
    }

    // Populate member information
    await room.populate('members', 'userName color isAnonymous');

    res.json({
      roomId: room._id,
      roomName: room.roomName,
      memberCount: room.members.length,
      members: room.members
    });
  } catch (error) {
    console.log("Error in assignRoom controller:", error.message);
    res.status(500).json({message: "Failed to assign room"});
  }
}

export const createRoom = async (req, res) => {
  try {
    const code = await Room.generateUniqueCode();
    const roomName = `custom-${code}`;
    
    const room = await Room.create({
      roomName,
      code,
      isCustomRoom: true,
      createdByIp: getClientIp(req),
      members: [] // Empty initially, users will be added when they authenticate and join
    });

    res.json({
      roomId: room._id,
      roomName: room.roomName,
      code: room.code,
      memberCount: 0,
      members: []
    });
  } catch (error) {
    console.log("Error in createRoom controller:", error.message);
    res.status(500).json({message: "Failed to create room"});
  }
};

export const joinRoom = async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({message: "Room code is required"});
    }

    const room = await Room.findOne({ code: code.toUpperCase() });
    if (!room) {
      return res.status(404).json({message: "Room not found"});
    }

    // Just return room info, don't try to add user since they're not authenticated yet
    res.json({
      roomId: room._id,
      roomName: room.roomName,
      code: room.code,
      memberCount: room.members.length,
      members: [] // Don't expose member details for privacy
    });
  } catch (error) {
    console.log("Error in joinRoom controller:", error.message);
    res.status(500).json({message: "Failed to join room"});
  }
};

export const leaveRoom = async (req, res) => {
  try {
    const roomName = req.params.roomName;
    const userId = req.user._id;

    const room = await Room.findOne({roomName});
    if(!room) {
      return res.status(404).json({message: "Room not found"});
    }

    // Remove user from room members
    room.members = room.members.filter(memberId => memberId.toString() !== userId.toString());
    await room.save();

    res.json({message: "Left room successfully"});
  } catch (error) {
    console.log("Error in leaveRoom controller:", error.message);
    res.status(500).json({message: "Failed to leave room"});
  }
}
