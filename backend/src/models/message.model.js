import mongoose from "mongoose";

const DAYS_TO_MS = 24 * 60 * 60 * 1000;
const MESSAGE_EXPIRY = 31 * DAYS_TO_MS; //31 days

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
    reactions: {
      type: [{
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Users",
          required: true
        },
        emoji: {
          type: String,
          required: true
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }],
      default: [],
      validate: {
        validator: function(reactions) {
          // Check for duplicate userIds in reactions array
          const userIds = reactions.map(r => r.userId.toString());
          return userIds.length === new Set(userIds).size;
        },
        message: 'Each user can only have one reaction per message'
      }
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