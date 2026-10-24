const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const cfg = require("./config");
const routes = require("./routes");
const { startConsumer, projector, audit } = require("./events");

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: cfg.clientUrl }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) =>
  res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ instance: cfg.instance })
);
app.use("/api/results", routes);
app.use((_req, res) => res.status(404).json({ message: "Not found" }));

mongoose
  .connect(cfg.mongoUri)
  .then(() => {
    startConsumer("result-projector", projector);
    startConsumer("result-audit", audit);
    const server = app.listen(cfg.port, () => console.log(`[${cfg.instance}] listening on ${cfg.port}`));
    const shutdown = () => { server.close(); setTimeout(() => process.exit(0), 1500); };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  })
  .catch((e) => {
    console.error("MongoDB connection failed:", e.message);
    process.exit(1);
  });
