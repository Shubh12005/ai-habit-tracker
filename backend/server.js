import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import { connectDB } from "./config/db.js";
import authRoutes from "./routes/auth.js";
import logRoutes from "./routes/logs.js";
import aiRoutes from "./routes/ai.js";
import habitRoutes from "./routes/habits.js";
import adminRoutes from "./routes/admin.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

const app = express();

// Parse and normalize allowed origins from environment variable (strip trailing slashes)
const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    // Allow requests with no origin (curl, same-origin, server-to-server, Render health check)
    if (!origin) return cb(null, true);

    const cleanOrigin = origin.replace(/\/+$/, "");

    // Allow any localhost / 127.0.0.1 origin in development
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleanOrigin)) {
      return cb(null, true);
    }

    // Allow wildcard if explicitly set
    if (process.env.CLIENT_URL === "*") {
      return cb(null, true);
    }

    // Allow anything explicitly listed in CLIENT_URL (e.g. https://your-app.vercel.app)
    if (allowedOrigins.includes(cleanOrigin)) {
      return cb(null, true);
    }

    // Allow Vercel preview deployments if main Vercel app domain is configured in CLIENT_URL
    try {
      const originHost = new URL(cleanOrigin).hostname;
      const isVercelOrigin = /\.vercel\.app$/.test(originHost);
      const hasVercelAllowed = allowedOrigins.some((url) => url.includes(".vercel.app"));
      if (isVercelOrigin && hasVercelAllowed) {
        return cb(null, true);
      }
    } catch {
      // Invalid URL format
    }

    return cb(new Error(`Origin ${origin} not allowed by CORS`));
  },

  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "1mb" }));

// Production health check endpoints for Render and monitoring
app.get(["/health", "/api/health"], (req, res) =>
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/habits", habitRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 8000;
const HOST = "0.0.0.0";

connectDB().then(() => {
  app.listen(PORT, HOST, () =>
    console.log(`Server running on http://${HOST}:${PORT}`)
  );
});