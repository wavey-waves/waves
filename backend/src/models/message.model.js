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
    ciphertext: {
      type: String,
      trim: true,
    },
    iv: {
      type: String,
      trim: true,
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

// Ensure ciphertext and iv are provided together (both present or both absent)
messageSchema.pre('validate', function(next) {
  const hasCiphertext = typeof this.ciphertext === 'string' && this.ciphertext.trim().length > 0;
  const hasIv = typeof this.iv === 'string' && this.iv.trim().length > 0;
  if (hasCiphertext !== hasIv) {
    if (hasCiphertext) {
      this.invalidate('iv', 'IV is required when ciphertext is provided');
    } else {
      this.invalidate('ciphertext', 'Ciphertext is required when IV is provided');
    }
  }
  next();
});

const Message = mongoose.model("Message", messageSchema);

export default Message;