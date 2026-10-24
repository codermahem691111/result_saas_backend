const Redis = require("ioredis");
const cfg = require("./config");

// Short command timeout: if Redis is slow or down we fall back to MongoDB instead of hanging requests.
const redis = new Redis(cfg.redisUrl, { commandTimeout: 500, maxRetriesPerRequest: 1 });
redis.on("error", (e) => console.error("[redis]", e.message));

const cardKey = (id) => `card:${id}`;

// Cache read: never throws, a Redis problem just counts as a miss.
async function readCard(id) {
  try {
    const v = await redis.get(cardKey(id));
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

// TTL gets random jitter so thousands of cards never expire in the same second.
async function writeCards(entries) {
  if (!entries.length) return;
  const pipe = redis.pipeline();
  for (const [id, card] of entries) {
    const ttl = cfg.cacheTtl + Math.floor(Math.random() * cfg.cacheTtl * 0.1);
    pipe.set(cardKey(id), JSON.stringify(card), "EX", ttl);
  }
  await pipe.exec();
}

// Append an event to the stream (approximate trim keeps it bounded).
const publish = (type, data) =>
  redis.xadd(cfg.stream, "MAXLEN", "~", 100000, "*", "type", type, "data", JSON.stringify(data));

module.exports = { redis, readCard, writeCards, publish };
