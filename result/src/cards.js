// Read model: one pre-computed report card per student.
const { Member, Class, Mark } = require("./models");
const { readCard, writeCards } = require("./redis");

const pct = (o, t) => (t ? Math.round((o / t) * 1000) / 10 : null);
const grade = (p) => (p >= 90 ? "A+" : p >= 80 ? "A" : p >= 70 ? "B" : p >= 60 ? "C" : p >= 50 ? "D" : "F");
const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);

// readPref: the event projector reads the primary (it runs right after a write, so a lagging
// secondary could hand it old data). Student cache-misses read from secondaries.
async function buildCards(studentIds, readPref = "secondaryPreferred") {
  const students = await Member.find({ _id: { $in: studentIds }, role: "student" })
    .select("name fatherName classId").read(readPref).lean();
  const classIds = [...new Set(students.map((s) => s.classId).filter(Boolean).map(String))];
  const [classes, marks] = await Promise.all([
    Class.find({ _id: { $in: classIds } }).read(readPref).lean(),
    Mark.find({ studentId: { $in: studentIds } }).read(readPref).lean(),
  ]);

  const classById = new Map(classes.map((c) => [String(c._id), c]));
  const marksByStudent = new Map();
  for (const m of marks) {
    const k = String(m.studentId);
    if (!marksByStudent.has(k)) marksByStudent.set(k, []);
    marksByStudent.get(k).push(m);
  }

  const cards = new Map();
  for (const s of students) {
    const cls = classById.get(String(s.classId));
    const mine = (marksByStudent.get(String(s._id)) || []).filter((m) => String(m.classId) === String(s.classId));
    const subjects = (cls?.subjects || []).map((sub) => {
      const find = (exam) => {
        const m = mine.find((x) => String(x.subjectId) === String(sub._id) && x.exam === exam);
        return m ? { obtained: m.obtained, total: m.total } : null;
      };
      const parts = [find("midterm"), find("final")].filter(Boolean);
      const obtained = sum(parts, "obtained");
      const total = sum(parts, "total");
      return {
        subject: sub.name, midterm: find("midterm"), final: find("final"), obtained, total,
        percentage: pct(obtained, total), grade: total ? grade(pct(obtained, total)) : null,
      };
    });
    const O = sum(subjects, "obtained"), T = sum(subjects, "total");
    cards.set(String(s._id), {
      student: { name: s.name, fatherName: s.fatherName },
      className: cls?.name || null,
      subjects,
      overall: T ? { obtained: O, total: T, percentage: pct(O, T), grade: grade(pct(O, T)) } : null,
      generatedAt: new Date().toISOString(),
    });
  }
  return cards;
}

// Cache-aside read: Redis first, MongoDB secondary on a miss, then repopulate.
async function getCard(studentId) {
  const hit = await readCard(studentId);
  if (hit) return { card: hit, cache: "HIT" };
  const card = (await buildCards([studentId])).get(String(studentId));
  if (card) await writeCards([[studentId, card]]).catch(() => {});
  return { card, cache: "MISS" };
}

module.exports = { buildCards, getCard };
