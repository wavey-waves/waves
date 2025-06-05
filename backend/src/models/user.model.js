import mongoose from "mongoose";

const DAYS_TO_MS = 24 * 60 * 60 * 1000;

const userSchema = new mongoose.Schema({
  userName: {
    type: String,
    required: [true, "Username is required"],
    unique: true,
    trim: true,
    minlength: [1, "Username cannot be empty"]
  },
  password: {
    type: String,
  },
  color: {
    type: String,
    required: [true, "Color is required"],
    trim: true
  },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    index: { expires: 0 },
  }
}, {
  timestamps: true,
});

userSchema.pre('save', function (next) {
  if (this.isAnonymous) {
    this.expiresAt = new Date(Date.now() + 7 * DAYS_TO_MS); // 1 week
  } else {
    this.expiresAt = new Date(Date.now() + 365 * DAYS_TO_MS); // 1 year
  }
  next();
});

const User = mongoose.model("Users", userSchema);


export default User;