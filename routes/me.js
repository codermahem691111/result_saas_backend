const router = require("express").Router();
const Member = require("../models/Member");
const Class = require("../models/Class");
const { requireAuth } = require("../middleware/auth");

router.get("/", requireAuth(["teacher", "student"]), async (req, res) => {
  const m = await Member.findById(req.user.id).select("-passwordHash").lean();
  if (!m) return res.status(404).json({ message: "Account not found" });

  if (m.role === "student") {
    // the student's class and the teacher of each subject
    const cls = m.classId
      ? await Class.findById(m.classId).populate("subjects.teacher", "name email").lean()
      : null;
    m.classInfo = cls
      ? {
          name: cls.name,
          subjects: cls.subjects.map((s) => ({ name: s.name, teacher: s.teacher || null })),
        }
      : null;
  } else {
    // the classes and subjects this teacher has been assigned
    const classes = await Class.find({ "subjects.teacher": m._id }).lean();
    m.assignments = classes.map((c) => ({
      className: c.name,
      subjects: c.subjects.filter((s) => String(s.teacher) === String(m._id)).map((s) => s.name),
    }));
  }
  res.json(m);
});

module.exports = router;