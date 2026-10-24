const jwt = require("jsonwebtoken");

const sign = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1d" });

function requireAuth(roles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Login required" });
    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      if (roles.length && !roles.includes(user.role))
        return res.status(403).json({ message: "Access denied" });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ message: "Session expired, please login again" });
    }
  };
}

module.exports = { sign, requireAuth };
