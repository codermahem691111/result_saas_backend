const mongoose = require("mongoose");

const classSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    subjects: [
      {
        name: { type: String, required: true, trim: true },
        // teacher assigned to teach this subject in this class
        teacher: { type: mongoose.Schema.Types.ObjectId, ref: "Member", default: null },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Class", classSchema);