const mongoose = require("mongoose");
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

// Read-only views of collections owned by the main API (same database).
const readOnly = { strict: false, autoCreate: false, autoIndex: false };
const Member = mongoose.model(
  "Member",
  new Schema({ role: String, name: String, fatherName: String, classId: ObjectId }, readOnly),
  "members"
);
const Class = mongoose.model(
  "Class",
  new Schema({ name: String, subjects: [{ name: String, teacher: ObjectId }] }, readOnly),
  "classes"
);

// Owned by this service
const markSchema = new Schema(
  {
    classId: { type: ObjectId, required: true },
    subjectId: { type: ObjectId, required: true },
    studentId: { type: ObjectId, required: true },
    teacherId: { type: ObjectId, required: true },
    exam: { type: String, enum: ["midterm", "final"], required: true },
    obtained: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);
markSchema.index({ studentId: 1, classId: 1, subjectId: 1, exam: 1 }, { unique: true }); // one mark per student/subject/exam
markSchema.index({ classId: 1, subjectId: 1, exam: 1 }); // teacher sheet lookups
const Mark = mongoose.model("Mark", markSchema);

// Audit trail built by an independent event consumer
const Audit = mongoose.model(
  "Audit",
  new Schema({ eventId: { type: String, unique: true }, type: String }, { strict: false, timestamps: true })
);

module.exports = { Member, Class, Mark, Audit };
