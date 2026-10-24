require("dotenv").config();

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");

module.exports = {
  port: Number(process.env.PORT) || 5100,
  instance: process.env.INSTANCE_ID || `result-${process.pid}`,
  mongoUri: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/school_admin?directConnection=true",
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  jwtSecret: process.env.JWT_SECRET,
  clientUrl: process.env.CLIENT_URL || "http://localhost:3000",
  cacheTtl: Number(process.env.CACHE_TTL_SECONDS) || 900,
  stream: "school:events", // the event log every service publishes to / reads from
};
