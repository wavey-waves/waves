import mongoose from "mongoose";

const roomSchema = new mongoose.Schema({
  roomName: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  members: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Users'
    }
  ],
  createdByIp: {
    type: String,
  }
}, {timestamps: true});

const Room = mongoose.model("Rooms", roomSchema);

export default Room;