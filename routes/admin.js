const router = require("express").Router();
const Member = require("../models/Member");
const Class = require("../models/Class");
const { requireAuth } = require("../middleware/auth");

router.use(requireAuth(["admin"]));

// ---------- Teachers & students ----------
router.get("/members", async (req, res) => {
  const filter = ["teacher", "student"].includes(req.query.role) ? { role: req.query.role } : {};
  res.json(await Member.find(filter).select("-passwordHash").sort({ createdAt: -1 }));
});

router.post("/members", async (req, res) => {
  try {
    const { role, name, fatherName, dob, bachelor, major, email } = req.body;
    if (!["teacher", "student"].includes(role))
      return res.status(400).json({ message: "Invalid role" });
    if (!name || !fatherName || !dob || !email)
      return res.status(400).json({ message: "Name, father's name, date of birth and email are required" });
    if (role === "teacher" && (!bachelor || !major))
      return res.status(400).json({ message: "Teachers need a bachelor degree and major" });

    const doc = { role, name, fatherName, dob, email };
    if (role === "teacher") Object.assign(doc, { bachelor, major });
    const m = await Member.create(doc);
    res.status(201).json(m);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: "That email is already added" });
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/members/:id", async (req, res) => {
  const m = await Member.findByIdAndDelete(req.params.id);
  if (m && m.role === "teacher") {
    // free up the subjects this teacher was teaching
    await Class.updateMany(
      { "subjects.teacher": m._id },
      { $set: { "subjects.$[s].teacher": null } },
      { arrayFilters: [{ "s.teacher": m._id }] }
    );
  }
  res.json({ deleted: true });
});

// Assign a student to a class, or move them to another one (classId null = unassign)
router.put("/members/:id/class", async (req, res) => {
  try {
    const { classId } = req.body;
    const student = await Member.findOne({ _id: req.params.id, role: "student" });
    if (!student) return res.status(404).json({ message: "Student not found" });
    if (classId && !(await Class.exists({ _id: classId })))
      return res.status(404).json({ message: "Class not found" });
    student.classId = classId || null;
    await student.save();
    res.json(student);
  } catch {
    res.status(400).json({ message: "Invalid request" });
  }
});

// ---------- Classes & subjects ----------
router.get("/classes", async (_req, res) => {
  res.json(await Class.find().sort({ createdAt: 1 }).populate("subjects.teacher", "name email"));
});

router.post("/classes", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Class name is required" });
    const exists = await Class.findOne({ name }).collation({ locale: "en", strength: 2 });
    if (exists) return res.status(409).json({ message: "That class already exists" });
    res.status(201).json(await Class.create({ name }));
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/classes/:id", async (req, res) => {
  await Class.findByIdAndDelete(req.params.id);
  // students of this class become unassigned
  await Member.updateMany({ classId: req.params.id }, { $set: { classId: null } });
  res.json({ deleted: true });
});

router.post("/classes/:id/subjects", async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ message: "Subject name is required" });
  const cls = await Class.findById(req.params.id);
  if (!cls) return res.status(404).json({ message: "Class not found" });
  if (cls.subjects.some((s) => s.name.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ message: "That subject is already in this class" });
  cls.subjects.push({ name });
  await cls.save();
  res.status(201).json(cls);
});

router.delete("/classes/:id/subjects/:subjectId", async (req, res) => {
  const cls = await Class.findById(req.params.id);
  if (!cls) return res.status(404).json({ message: "Class not found" });
  cls.subjects.pull({ _id: req.params.subjectId });
  await cls.save();
  res.json(cls);
});

// Assign (or change / remove with teacherId null) the teacher of a subject
router.put("/classes/:id/subjects/:subjectId/teacher", async (req, res) => {
  try {
    const { teacherId } = req.body;
    if (teacherId && !(await Member.exists({ _id: teacherId, role: "teacher" })))
      return res.status(404).json({ message: "Teacher not found" });
    const cls = await Class.findOneAndUpdate(
      { _id: req.params.id, "subjects._id": req.params.subjectId },
      { $set: { "subjects.$.teacher": teacherId || null } },
      { new: true }
    );
    if (!cls) return res.status(404).json({ message: "Subject not found" });
    res.json(cls);
  } catch {
    res.status(400).json({ message: "Invalid request" });
  }
});

module.exports = router;