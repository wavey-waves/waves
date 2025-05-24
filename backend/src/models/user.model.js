import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  userName: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
  },
  color: {
    type: String,
    required: true
  }
}, {timestamps: true});

const User = mongoose.model("Users", userSchema);

export default User;