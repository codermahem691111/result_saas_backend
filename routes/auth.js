const router = require("express").Router();
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const Member = require("../models/Member");
const { sign } = require("../middleware/auth");

const same = (a, b) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Admin login (credentials live in .env)
router.post("/admin/login", (req, res) => {
  const { email, password } = req.body;
  const ok =
    email &&
    password &&
    safeEq(String(email).toLowerCase(), process.env.ADMIN_EMAIL.toLowerCase()) &&
    safeEq(password, process.env.ADMIN_PASSWORD);
  if (!ok) return res.status(401).json({ message: "Wrong email or password" });
  res.json({ token: sign({ role: "admin", email }), role: "admin" });
});

// Register: details must match the record the admin created
router.post("/register", async (req, res) => {
  try {
    const { role, email, name, fatherName, dob, bachelor, major, password } = req.body;
    if (!["teacher", "student"].includes(role))
      return res.status(400).json({ message: "Invalid role" });
    if (!email || !password || password.length < 6)
      return res.status(400).json({ message: "Email and a password of 6+ characters are required" });

    const m = await Member.findOne({ email: String(email).toLowerCase().trim(), role });
    const matches =
      m &&
      same(m.name, name) &&
      same(m.fatherName, fatherName) &&
      m.dob === dob &&
      (role === "student" || (same(m.bachelor, bachelor) && same(m.major, major)));
    if (!matches)
      return res.status(403).json({
        message: "Your details don't match our records. Ask the admin to check them.",
      });
    if (m.registered)
      return res.status(409).json({ message: "This account is already registered. Please login." });

    m.passwordHash = await bcrypt.hash(password, 10);
    m.registered = true;
    await m.save();
    res.json({ token: sign({ role, id: m._id, email: m.email }), role });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { role, email, password } = req.body;
    const m = await Member.findOne({ email: String(email || "").toLowerCase().trim(), role });
    if (!m || !m.registered || !(await bcrypt.compare(password || "", m.passwordHash)))
      return res.status(401).json({ message: "Wrong email or password" });
    res.json({ token: sign({ role, id: m._id, email: m.email }), role });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
