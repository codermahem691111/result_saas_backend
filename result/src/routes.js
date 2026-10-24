const router = require("express").Router();
const jwt = require("jsonwebtoken");
const cfg = require("./config");
const { Member, Class, Mark } = require("./models");
const { getCard } = require("./cards");
const { publish } = require("./redis");

const EXAMS = ["midterm", "final"];
const isId = (v) => /^[0-9a-f]{24}$/i.test(String(v));

const auth = (role) => (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Login required" });
  try {
    const user = jwt.verify(token, cfg.jwtSecret);
    if (user.role !== role) return res.status(403).json({ message: "Access denied" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: "Session expired, please login again" });
  }
};

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => { console.error(e); res.status(500).json({ message: "Server error" }); });

// A teacher may only grade the exact subject of the exact class they were assigned.
const teaches = (teacherId, classId, subjectId) =>
  Class.exists({ _id: classId, subjects: { $elemMatch: { _id: subjectId, teacher: teacherId } } }).read("primary");

// ---------- Student: read my result (served from the Redis read model) ----------
router.get("/me", auth("student"), wrap(async (req, res) => {
  const { card, cache } = await getCard(req.user.id);
  if (!card) return res.status(404).json({ message: "Student not found" });
  res.set("Cache-Control", "no-store");
  res.json({ ...card, meta: { servedBy: cfg.instance, cache } });
}));

// ---------- Teacher: what can I grade? ----------
router.get("/teacher/assignments", auth("teacher"), wrap(async (req, res) => {
  const classes = await Class.find({ "subjects.teacher": req.user.id }).read("primary").lean();
  res.json(
    classes.flatMap((c) =>
      c.subjects
        .filter((s) => String(s.teacher) === req.user.id)
        .map((s) => ({ classId: c._id, className: c.name, subjectId: s._id, subjectName: s.name }))
    )
  );
}));

// ---------- Teacher: marks sheet for one class + subject + exam ----------
router.get("/teacher/sheet", auth("teacher"), wrap(async (req, res) => {
  const { classId, subjectId, exam } = req.query;
  if (!isId(classId) || !isId(subjectId) || !EXAMS.includes(exam))
    return res.status(400).json({ message: "Invalid request" });
  if (!(await teaches(req.user.id, classId, subjectId)))
    return res.status(403).json({ message: "You are not assigned to this subject" });

  const [students, marks] = await Promise.all([
    Member.find({ role: "student", classId }).select("name fatherName").sort({ name: 1 }).read("primary").lean(),
    Mark.find({ classId, subjectId, exam }).read("primary").lean(),
  ]);
  const byStudent = new Map(marks.map((m) => [String(m.studentId), m]));
  res.json({
    total: marks[0]?.total ?? null,
    students: students.map((s) => ({
      _id: s._id, name: s.name, fatherName: s.fatherName,
      obtained: byStudent.get(String(s._id))?.obtained ?? null,
    })),
  });
}));

// ---------- Teacher: save marks (command) -> emits "marks.recorded" (event) ----------
router.put("/teacher/marks", auth("teacher"), wrap(async (req, res) => {
  const { classId, subjectId, exam, entries } = req.body;
  const total = Number(req.body.total);
  if (!isId(classId) || !isId(subjectId) || !EXAMS.includes(exam) || !Array.isArray(entries) || entries.length > 5000)
    return res.status(400).json({ message: "Invalid request" });
  if (!Number.isFinite(total) || total <= 0 || total > 100000)
    return res.status(400).json({ message: "Total marks must be a positive number" });
  if (!(await teaches(req.user.id, classId, subjectId)))
    return res.status(403).json({ message: "You are not assigned to this subject" });

  const roster = new Set(
    (await Member.find({ role: "student", classId }).select("_id").read("primary").lean()).map((s) => String(s._id))
  );
  const ops = [];
  const touched = [];
  for (const e of entries) {
    if (!roster.has(String(e.studentId))) return res.status(400).json({ message: "A student is not in this class" });
    const filter = { classId, subjectId, exam, studentId: e.studentId };
    touched.push(String(e.studentId));
    if (e.obtained === null || e.obtained === "" || e.obtained === undefined) {
      ops.push({ deleteOne: { filter } }); // cleared cell removes the mark
      continue;
    }
    const obtained = Number(e.obtained);
    if (!Number.isFinite(obtained) || obtained < 0 || obtained > total)
      return res.status(400).json({ message: `Marks must be between 0 and ${total}` });
    ops.push({ updateOne: { filter, update: { $set: { obtained, total, teacherId: req.user.id } }, upsert: true } });
  }

  // Changing the total applies to the whole sheet; don't let it invalidate marks not in this request.
  if (await Mark.exists({ classId, subjectId, exam, studentId: { $nin: touched }, obtained: { $gt: total } }))
    return res.status(400).json({ message: "Some saved marks are higher than this new total" });
  await Mark.updateMany({ classId, subjectId, exam }, { $set: { total } });
  if (ops.length) await Mark.bulkWrite(ops);

  const studentIds = [...new Set([...touched, ...(await Mark.distinct("studentId", { classId, subjectId, exam })).map(String)])];
  let eventPublished = true;
  try {
    await publish("marks.recorded", { teacherId: req.user.id, classId, subjectId, exam, total, studentIds });
  } catch (e) {
    eventPublished = false; // data is safe in MongoDB; caches refresh when their TTL ends
    console.error("[events] publish failed:", e.message);
  }
  res.json({ saved: ops.length, eventPublished });
}));

module.exports = router;
