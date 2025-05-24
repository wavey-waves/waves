import mongoose from "mongoose";

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
    required: [true, "Password is required"]
  },
  color: {
    type: String,
    required: [true, "Color is required"],
    trim: true
  }
}, {
  timestamps: true,
  // Drop the old index if it exists
  autoIndex: true
});

// Drop any existing indexes
userSchema.index({ userName: 1 }, { unique: true });

const User = mongoose.model("Users", userSchema);

// Drop the old index if it exists
User.collection.dropIndexes().catch(err => {
  if (err.code !== 26) { // Ignore "namespace not found" error
    console.error('Error dropping indexes:', err);
  }
});

export default User;