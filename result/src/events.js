// Event-driven core: Redis Streams + consumer groups.
// Every consumer GROUP receives every event (fan-out); inside a group each event goes to exactly
// one instance (load sharing). Unacknowledged events are re-claimed, so delivery is at-least-once.
const Redis = require("ioredis");
const cfg = require("./config");
const { writeCards } = require("./redis");
const { buildCards } = require("./cards");
const { Audit } = require("./models");

// Group 1: keeps the Redis read model fresh (cache warming before students ever ask).
const projector = {
  "marks.recorded": async ({ studentIds }) => {
    const cards = await buildCards(studentIds, "primary");
    await writeCards([...cards.entries()]);
  },
};

// Group 2: independent audit trail (who changed which marks, when). Idempotent via eventId.
const audit = {
  "marks.recorded": async ({ studentIds, ...rest }, eventId) => {
    await Audit.updateOne(
      { eventId },
      { $setOnInsert: { type: "marks.recorded", ...rest, studentCount: studentIds.length } },
      { upsert: true }
    );
  },
};

function startConsumer(group, handlers) {
  const conn = new Redis(cfg.redisUrl); // dedicated connection: XREADGROUP blocks it
  conn.on("error", () => {});

  const ensureGroup = async () => {
    try { await conn.xgroup("CREATE", cfg.stream, group, "$", "MKSTREAM"); }
    catch (e) { if (!/BUSYGROUP/.test(e.message)) console.error(`[${group}]`, e.message); }
  };

  const handle = async (id, fields) => {
    const msg = {};
    for (let i = 0; i < fields.length; i += 2) msg[fields[i]] = fields[i + 1];
    try {
      const fn = handlers[msg.type];
      if (fn) await fn(JSON.parse(msg.data), id);
      await conn.xack(cfg.stream, group, id);
    } catch (e) {
      if (e instanceof SyntaxError) return conn.xack(cfg.stream, group, id); // unreadable: can never succeed
      console.error(`[${group}] event ${id} failed, stays pending for retry:`, e.message);
    }
  };

  (async () => {
    await ensureGroup();
    for (;;) {
      try {
        const res = await conn.xreadgroup("GROUP", group, cfg.instance, "COUNT", 50, "BLOCK", 5000, "STREAMS", cfg.stream, ">");
        for (const [, msgs] of res || []) for (const [id, f] of msgs) await handle(id, f);
      } catch (e) {
        if (/NOGROUP/.test(e.message)) await ensureGroup();
        else console.error(`[${group}]`, e.message);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  })();

  // Retry events that another instance claimed but never finished (e.g. it crashed).
  setInterval(async () => {
    try {
      const [, msgs] = await conn.xautoclaim(cfg.stream, group, cfg.instance, 30000, "0-0", "COUNT", 50);
      for (const [id, f] of msgs) if (f) await handle(id, f);
    } catch {}
  }, 15000).unref();
}

module.exports = { startConsumer, projector, audit };
