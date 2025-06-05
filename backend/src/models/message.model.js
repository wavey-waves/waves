import mongoose from "mongoose";

const DAYS_TO_MS = 24 * 60 * 60 * 1000;
const MESSAGE_EXPIRY = 7 * DAYS_TO_MS; //7 days

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      required: true,
    },
    room: {
      type: String,
      default: "global-room",
      required: true
    },
    text: {
      type: String,
    },
    image: {
      type: String,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + MESSAGE_EXPIRY),
      index: {expires : 0}
    }
  },
  { timestamps: true }
);

const Message = mongoose.model("Message", messageSchema);

export default Message;