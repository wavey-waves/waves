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
  code: {
    type: String,
    unique: true,
    sparse: true, // Allow null values but ensure uniqueness when present
    uppercase: true,
    length: 6
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
  isCustomRoom: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + MESSAGE_EXPIRY),
    index: {expires : 0}
  }
}, {timestamps: true});

// Generate unique room code
roomSchema.statics.generateUniqueCode = async function() {
  let code;
  let exists = true;
  
  while (exists) {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room = await this.findOne({ code });
    exists = !!room;
  }
  
  return code;
};

const Room = mongoose.model("Rooms", roomSchema);

export default Room;