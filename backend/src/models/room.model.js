import mongoose from "mongoose";

const DAYS_TO_MS = 24 * 60 * 60 * 1000;
const MESSAGE_EXPIRY = 40 * DAYS_TO_MS; //40 days

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
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + MESSAGE_EXPIRY),
    index: {expires : 0}
  }
}, {timestamps: true});

const Room = mongoose.model("Rooms", roomSchema);

export default Room;