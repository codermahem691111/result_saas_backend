const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["teacher", "student"], required: true },
    name: { type: String, required: true, trim: true },
    fatherName: { type: String, required: true, trim: true },
    dob: { type: String, required: true }, // YYYY-MM-DD
    bachelor: { type: String, trim: true }, // teachers only
    major: { type: String, trim: true }, // teachers only
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class", default: null }, // students only
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    passwordHash: { type: String },
    registered: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Member", memberSchema);