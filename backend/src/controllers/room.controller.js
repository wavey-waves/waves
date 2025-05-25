import User from "../models/user.model.js";
import Room from "../models/room.model.js";
import {getClientIp} from 'request-ip';

const assignRoom = async (req, res) => {
  const ip = getClientIp(req);
  if(!ip) {
    return res.status(400).json({message: "Could not determine IP"});
  }

  const subnet = ip.split('.').slice(0, 3).join('.');
  const roomName = `room-${subnet}`;

  let room = await Room.findOne({roomName});
  if(!room) {
    room = await Room.create({
      roomName,
      createdByIP: ip,
    });
  }

  const userId = req.user.id;

  if (!room.members.includes(userId)) {
    room.members.push(userId);
    await room.save();
  }

  res.json({ roomId: room._id, roomName });
}
