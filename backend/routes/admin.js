import express from "express";
import {
  getDashboardStats,
  getUsers,
  getUserDetails,
  updateUserStatus,
  getGlobalAnalytics,
  getDailyActivityReport,
  getAIInsights,
  generateAIInsights,
} from "../controllers/adminController.js";
import { protect, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// Apply protect and requireAdmin middleware to ALL admin routes
router.use(protect, requireAdmin);

// Admin dashboard overview
router.get("/dashboard", getDashboardStats);

// User management
router.get("/users", getUsers);
router.get("/users/:id", getUserDetails);
router.put("/users/:id/status", updateUserStatus);

// Global habit analytics
router.get("/analytics", getGlobalAnalytics);

// Daily activity reports
router.get("/activity", getDailyActivityReport);

// AI insights
router.get("/insights", getAIInsights);
router.post("/insights/generate", generateAIInsights);

export default router;
