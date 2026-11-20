import mongoose from "mongoose";
import { format, subDays, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from "date-fns";
import User from "../models/User.js";
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import AIInsight from "../models/AIInsight.js";
import { todayKey, lastNDays, calcStreak } from "../utils/dateHelpers.js";
import { chatCompletion } from "../utils/aiService.js";

// Helper to format date keys
const toDateStr = (date) => format(date, "yyyy-MM-dd");

/**
 * 1. Admin Dashboard Overview Statistics
 * Live MongoDB aggregation of users, habits, logs, trends
 */
export const getDashboardStats = async (req, res) => {
  try {
    const today = todayKey();

    // 1. Core summary numbers
    const totalUsers = await User.countDocuments();
    const inactiveUsers = await User.countDocuments({ status: "inactive" });
    const activeUsers = totalUsers - inactiveUsers;

    const totalHabits = await Habit.countDocuments({ isArchived: false });
    const habitsCompletedToday = await HabitLog.countDocuments({ completedDate: today });

    // 2. Overall completion rate calculation
    // Look at last 30 days: total actual logs vs expected (totalActiveHabits * 30)
    const days30 = lastNDays(30);
    const logsLast30Days = await HabitLog.countDocuments({
      completedDate: { $gte: days30[0], $lte: days30[days30.length - 1] },
    });
    const expected30Days = Math.max(1, totalHabits * 30);
    const overallCompletionRate = Math.min(
      100,
      Math.round((logsLast30Days / expected30Days) * 100)
    );

    // 3. User Registration Growth (by month for last 6 months)
    const sixMonthsAgo = subDays(new Date(), 180);
    const userGrowthAgg = await User.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Format registration growth
    const registrationGrowth = userGrowthAgg.map((u) => ({
      month: u._id,
      users: u.count,
    }));

    // 4. Daily Active Users & Daily Habit Completions (last 14 days)
    const days14 = lastNDays(14);
    const dailyStatsAgg = await HabitLog.aggregate([
      {
        $match: {
          completedDate: { $gte: days14[0], $lte: days14[days14.length - 1] },
        },
      },
      {
        $group: {
          _id: "$completedDate",
          completions: { $sum: 1 },
          activeUsers: { $addToSet: "$userId" },
        },
      },
      {
        $project: {
          _id: 1,
          completions: 1,
          activeUsersCount: { $size: "$activeUsers" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const dailyMap = {};
    dailyStatsAgg.forEach((d) => {
      dailyMap[d._id] = {
        completions: d.completions,
        activeUsers: d.activeUsersCount,
      };
    });

    const dailyTrends = days14.map((day) => ({
      date: day.slice(5), // MM-DD
      fullDate: day,
      completions: dailyMap[day]?.completions || 0,
      activeUsers: dailyMap[day]?.activeUsers || 0,
    }));

    // 5. Weekly Habit Completion Trends (last 8 weeks)
    const days56 = lastNDays(56);
    const weeklyLogs = await HabitLog.find({
      completedDate: { $gte: days56[0], $lte: days56[days56.length - 1] },
    }).select("completedDate");

    const weeklyBuckets = {};
    // Group into 8 7-day chunks
    for (let i = 0; i < 8; i++) {
      const slice = days56.slice(i * 7, (i + 1) * 7);
      const label = `W${i + 1} (${slice[0].slice(5)})`;
      weeklyBuckets[label] = 0;
      weeklyLogs.forEach((l) => {
        if (slice.includes(l.completedDate)) {
          weeklyBuckets[label]++;
        }
      });
    }

    const weeklyTrends = Object.entries(weeklyBuckets).map(([week, completions]) => ({
      week,
      completions,
    }));

    // 6. Monthly User Activity (last 4 months)
    const monthlyLogs = await HabitLog.aggregate([
      {
        $match: {
          createdAt: { $gte: subDays(new Date(), 120) },
        },
      },
      {
        $group: {
          _id: { $substr: ["$completedDate", 0, 7] },
          completions: { $sum: 1 },
          activeUsers: { $addToSet: "$userId" },
        },
      },
      {
        $project: {
          _id: 1,
          completions: 1,
          activeUsers: { $size: "$activeUsers" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const monthlyActivity = monthlyLogs.map((m) => ({
      month: m._id,
      completions: m.completions,
      activeUsers: m.activeUsers,
    }));

    // 7. Popular Habit Categories
    const categoryAgg = await Habit.aggregate([
      { $match: { isArchived: false } },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const popularCategories = categoryAgg.map((c) => ({
      name: c._id || "Other",
      value: c.count,
    }));

    // 8. Recent Activity
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select("name email role status createdAt avatar");

    const recentHabits = await Habit.find()
      .populate("userId", "name email")
      .sort({ createdAt: -1 })
      .limit(5)
      .select("name category frequency icon color createdAt userId");

    const recentCompletions = await HabitLog.find()
      .populate("userId", "name email avatar")
      .populate("habitId", "name category icon color")
      .sort({ createdAt: -1 })
      .limit(6);

    res.json({
      summary: {
        totalUsers,
        activeUsers,
        inactiveUsers,
        totalHabits,
        habitsCompletedToday,
        overallCompletionRate,
      },
      charts: {
        registrationGrowth,
        dailyTrends,
        weeklyTrends,
        monthlyActivity,
        popularCategories,
      },
      recentActivity: {
        users: recentUsers,
        habits: recentHabits,
        completions: recentCompletions,
      },
    });
  } catch (err) {
    console.error("Admin dashboard error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * 2. User Management
 * Searchable, filterable, sortable, paginated user list
 */
export const getUsers = async (req, res) => {
  try {
    const {
      search = "",
      status = "all",
      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    // Build filter
    const query = {};
    if (search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [{ name: regex }, { email: regex }];
    }

    if (status === "active") {
      query.status = { $ne: "inactive" };
    } else if (status === "inactive") {
      query.status = "inactive";
    }

    // Sort order
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .select("-password");

    // Augment with habit counts, completion counts, last activity
    const userIds = users.map((u) => u._id);

    const habitCounts = await Habit.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: "$userId", count: { $sum: 1 } } },
    ]);
    const habitMap = {};
    habitCounts.forEach((h) => {
      habitMap[String(h._id)] = h.count;
    });

    const logCounts = await HabitLog.aggregate([
      { $match: { userId: { $in: userIds } } },
      {
        $group: {
          _id: "$userId",
          count: { $sum: 1 },
          lastLogDate: { $max: "$completedDate" },
        },
      },
    ]);
    const logMap = {};
    logCounts.forEach((l) => {
      logMap[String(l._id)] = {
        count: l.count,
        lastLogDate: l.lastLogDate,
      };
    });

    const enrichedUsers = users.map((u) => {
      const uObj = u.toObject();
      const hCount = habitMap[String(u._id)] || 0;
      const lInfo = logMap[String(u._id)] || { count: 0, lastLogDate: null };

      return {
        ...uObj,
        totalHabits: hCount,
        completedHabits: lInfo.count,
        lastActivity: lInfo.lastLogDate || u.lastLogin || u.updatedAt,
      };
    });

    res.json({
      users: enrichedUsers,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum) || 1,
        limit: limitNum,
      },
    });
  } catch (err) {
    console.error("Admin getUsers error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * 3. User Details
 * Full profile, habits, streaks, history for an individual user
 */
export const getUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const habits = await Habit.find({ userId: user._id }).sort({ createdAt: -1 });

    const logs = await HabitLog.find({ userId: user._id }).sort({ completedDate: -1 });

    // Calculate individual habit metrics
    const habitStats = habits.map((habit) => {
      const hLogs = logs.filter((l) => String(l.habitId) === String(habit._id));
      const dateKeys = hLogs.map((l) => l.completedDate).sort().reverse();
      const { current, longest } = calcStreak(dateKeys);

      return {
        _id: habit._id,
        name: habit.name,
        category: habit.category,
        frequency: habit.frequency,
        targetDays: habit.targetDays,
        icon: habit.icon,
        color: habit.color,
        isArchived: habit.isArchived,
        createdAt: habit.createdAt,
        totalCompletions: hLogs.length,
        currentStreak: current,
        longestStreak: longest,
      };
    });

    // Recent 14 days activity grid
    const days14 = lastNDays(14);
    const dailyActivity = days14.map((date) => {
      const dayLogs = logs.filter((l) => l.completedDate === date);
      return {
        date,
        count: dayLogs.length,
        habits: dayLogs.map((l) => {
          const h = habits.find((item) => String(item._id) === String(l.habitId));
          return h ? h.name : "Habit";
        }),
      };
    });

    res.json({
      user,
      habits: habitStats,
      summary: {
        totalHabits: habits.length,
        activeHabits: habits.filter((h) => !h.isArchived).length,
        totalCompletions: logs.length,
        joinedDate: user.createdAt,
        lastLogin: user.lastLogin,
      },
      dailyActivity,
      recentLogs: logs.slice(0, 15).map((l) => {
        const h = habits.find((item) => String(item._id) === String(l.habitId));
        return {
          _id: l._id,
          completedDate: l.completedDate,
          habitName: h ? h.name : "Deleted habit",
          habitCategory: h ? h.category : "General",
          habitIcon: h ? h.icon : "🎯",
        };
      }),
    });
  } catch (err) {
    console.error("Admin getUserDetails error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * 4. Update User Account Status
 * Active / Inactive account toggle
 */
export const updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ message: "You cannot deactivate your own administrator account" });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const authorizedAdmin = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (user.email.trim().toLowerCase() === authorizedAdmin) {
      return res.status(400).json({ message: "Cannot modify status of the authoritative administrator account" });
    }

    user.status = status;
    await user.save();

    res.json({
      message: `User status successfully updated to ${status}`,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        status: user.status,
      },
    });
  } catch (err) {
    console.error("Admin updateUserStatus error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * 5. Global Habit Analytics
 * Comprehensive aggregations across all habits and logs with date filters
 */
export const getGlobalAnalytics = async (req, res) => {
  try {
    const { timeRange = "30d", startDate, endDate } = req.query;

    const today = new Date();
    let startKey;
    let endKey = toDateStr(today);

    if (timeRange === "today") {
      startKey = endKey;
    } else if (timeRange === "7d") {
      startKey = toDateStr(subDays(today, 6));
    } else if (timeRange === "30d") {
      startKey = toDateStr(subDays(today, 29));
    } else if (timeRange === "thisMonth") {
      startKey = toDateStr(startOfMonth(today));
      endKey = toDateStr(endOfMonth(today));
    } else if (timeRange === "custom" && startDate && endDate) {
      startKey = startDate;
      endKey = endDate;
    } else {
      startKey = toDateStr(subDays(today, 29));
    }

    // 1. Overall habits counts
    const totalHabits = await Habit.countDocuments({ isArchived: false });
    const allHabits = await Habit.find({ isArchived: false }).select("name category targetDays userId");

    // 2. Logs in the selected range
    const logsInRange = await HabitLog.find({
      completedDate: { $gte: startKey, $lte: endKey },
    }).select("habitId userId completedDate");

    const totalCompletions = logsInRange.length;

    // Calculate days interval length
    const startObj = parseISO(startKey);
    const endObj = parseISO(endKey);
    const diffDays = Math.max(1, Math.round((endObj - startObj) / (1000 * 60 * 60 * 24)) + 1);

    const totalExpected = Math.max(1, totalHabits * diffDays);
    const overallCompletionRate = Math.min(100, Math.round((totalCompletions / totalExpected) * 100));

    // 3. Most popular habits (by completion count)
    const habitCompletionMap = {};
    logsInRange.forEach((l) => {
      const hid = String(l.habitId);
      habitCompletionMap[hid] = (habitCompletionMap[hid] || 0) + 1;
    });

    const habitDetailsMap = {};
    allHabits.forEach((h) => {
      habitDetailsMap[String(h._id)] = h;
    });

    const rankedHabits = Object.entries(habitCompletionMap)
      .map(([hid, count]) => {
        const habit = habitDetailsMap[hid];
        return {
          habitId: hid,
          name: habit ? habit.name : "Habit",
          category: habit ? habit.category : "Other",
          completions: count,
          completionRate: Math.min(100, Math.round((count / diffDays) * 100)),
        };
      })
      .sort((a, b) => b.completions - a.completions);

    const mostPopularHabits = rankedHabits.slice(0, 5);

    // Least completed habits (include active habits with 0 or few completions)
    const leastCompletedHabits = allHabits
      .map((h) => {
        const count = habitCompletionMap[String(h._id)] || 0;
        return {
          habitId: h._id,
          name: h.name,
          category: h.category,
          completions: count,
          completionRate: Math.min(100, Math.round((count / diffDays) * 100)),
        };
      })
      .sort((a, b) => a.completions - b.completions)
      .slice(0, 5);

    // 4. Most active habit categories
    const categoryCompletions = {};
    const categoryHabitCount = {};

    allHabits.forEach((h) => {
      categoryHabitCount[h.category] = (categoryHabitCount[h.category] || 0) + 1;
    });

    logsInRange.forEach((l) => {
      const h = habitDetailsMap[String(l.habitId)];
      const cat = h ? h.category : "Other";
      categoryCompletions[cat] = (categoryCompletions[cat] || 0) + 1;
    });

    const activeCategories = Object.keys({ ...categoryHabitCount, ...categoryCompletions }).map((cat) => ({
      category: cat,
      habits: categoryHabitCount[cat] || 0,
      completions: categoryCompletions[cat] || 0,
    })).sort((a, b) => b.completions - a.completions);

    // 5. Daily completion trend over selected interval
    let daysArray = [];
    try {
      daysArray = eachDayOfInterval({ start: startObj, end: endObj }).map(toDateStr);
    } catch {
      daysArray = [startKey];
    }

    const dayCountMap = {};
    logsInRange.forEach((l) => {
      dayCountMap[l.completedDate] = (dayCountMap[l.completedDate] || 0) + 1;
    });

    const completionTrend = daysArray.map((date) => ({
      date: date.length > 5 ? date.slice(5) : date,
      fullDate: date,
      completions: dayCountMap[date] || 0,
    }));

    // 6. User-wise habit activity summary
    const userCompletionsMap = {};
    logsInRange.forEach((l) => {
      const uid = String(l.userId);
      userCompletionsMap[uid] = (userCompletionsMap[uid] || 0) + 1;
    });

    const usersList = await User.find().select("name email");
    const userActivitySummaries = usersList.map((u) => ({
      userId: u._id,
      name: u.name,
      email: u.email,
      completionsInRange: userCompletionsMap[String(u._id)] || 0,
    })).sort((a, b) => b.completionsInRange - a.completionsInRange);

    res.json({
      filter: {
        timeRange,
        startDate: startKey,
        endDate: endKey,
        daysCount: diffDays,
      },
      metrics: {
        totalHabits,
        totalCompletions,
        overallCompletionRate,
      },
      mostPopularHabits,
      leastCompletedHabits,
      activeCategories,
      completionTrend,
      userActivitySummaries,
    });
  } catch (err) {
    console.error("Admin getGlobalAnalytics error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * 6. Daily Activity Reports
 * Date selector, scheduled vs completed vs missed, aggregate & individual breakdown
 */
export const getDailyActivityReport = async (req, res) => {
  try {
    const targetDate = req.query.date || todayKey();

    // 1. Total registered users as of targetDate
    const endOfTargetDate = new Date(`${targetDate}T23:59:59.999Z`);
    const totalRegisteredUsers = await User.countDocuments({
      createdAt: { $lte: endOfTargetDate },
    });

    // 2. Active habits created on or before targetDate
    const scheduledHabits = await Habit.find({
      isArchived: false,
      createdAt: { $lte: endOfTargetDate },
    }).populate("userId", "name email");

    // Total habits scheduled today: daily habits count (weekly habits count targetDays/7 or scheduled)
    const totalHabitsScheduled = scheduledHabits.filter((h) => h.frequency === "daily" || h.targetDays > 0).length;

    // 3. Completions on this exact date
    const logsOnDate = await HabitLog.find({
      completedDate: targetDate,
    })
      .populate("userId", "name email avatar")
      .populate("habitId", "name category icon color frequency");

    const totalHabitsCompleted = logsOnDate.length;

    // 4. Missed or incomplete habits
    const totalMissedHabits = Math.max(0, totalHabitsScheduled - totalHabitsCompleted);

    // 5. Active users on target date (distinct users who logged a habit)
    const activeUserIds = new Set();
    logsOnDate.forEach((log) => {
      if (log.userId) {
        activeUserIds.add(String(log.userId._id || log.userId));
      }
    });

    const usersActiveCount = activeUserIds.size;
    const dailyCompletionRate =
      totalHabitsScheduled > 0
        ? Math.min(100, Math.round((totalHabitsCompleted / totalHabitsScheduled) * 100))
        : 0;

    // 6. Category breakdown for this date
    const categoryStats = {};
    logsOnDate.forEach((log) => {
      const cat = log.habitId?.category || "Other";
      categoryStats[cat] = (categoryStats[cat] || 0) + 1;
    });

    const categoryActivity = Object.entries(categoryStats).map(([name, count]) => ({
      name,
      count,
    }));

    // 7. User-by-user breakdown for that date
    const userBreakdownMap = {};
    scheduledHabits.forEach((h) => {
      if (!h.userId) return;
      const uid = String(h.userId._id);
      if (!userBreakdownMap[uid]) {
        userBreakdownMap[uid] = {
          userId: h.userId._id,
          name: h.userId.name,
          email: h.userId.email,
          scheduledCount: 0,
          completedCount: 0,
          habits: [],
        };
      }
      userBreakdownMap[uid].scheduledCount++;
    });

    logsOnDate.forEach((l) => {
      if (!l.userId) return;
      const uid = String(l.userId._id || l.userId);
      if (userBreakdownMap[uid]) {
        userBreakdownMap[uid].completedCount++;
        userBreakdownMap[uid].habits.push({
          name: l.habitId?.name || "Habit",
          category: l.habitId?.category || "General",
          icon: l.habitId?.icon || "🎯",
        });
      }
    });

    const userBreakdown = Object.values(userBreakdownMap);

    res.json({
      date: targetDate,
      metrics: {
        totalRegisteredUsers,
        usersActiveToday: usersActiveCount,
        usersCompletedAtLeastOne: usersActiveCount,
        totalHabitsScheduled,
        totalHabitsCompleted,
        totalMissedHabits,
        dailyCompletionRate,
      },
      categoryActivity,
      logs: logsOnDate.map((l) => ({
        _id: l._id,
        userName: l.userId?.name || "Unknown",
        userEmail: l.userId?.email || "Unknown",
        userAvatar: l.userId?.avatar || "U",
        habitName: l.habitId?.name || "Deleted Habit",
        category: l.habitId?.category || "Other",
        icon: l.habitId?.icon || "🎯",
        color: l.habitId?.color || "#f59e0b",
        time: l.createdAt,
      })),
      userBreakdown,
    });
  } catch (err) {
    console.error("Admin getDailyActivityReport error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * 7. AI Insights Overview
 * Platform-level AI analytics generated via Google Gemini AI
 */
export const getAIInsights = async (req, res) => {
  try {
    // Return latest cached report or null
    const latest = await AIInsight.findOne({ type: "admin_report" }).sort({ createdAt: -1 });

    if (!latest) {
      return res.json({ insight: null });
    }

    let parsed = null;
    try {
      parsed = JSON.parse(latest.content);
    } catch {
      parsed = { summary: latest.content };
    }

    res.json({
      insight: {
        _id: latest._id,
        generatedAt: latest.createdAt,
        data: parsed,
      },
    });
  } catch (err) {
    console.error("Admin getAIInsights error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const generateAIInsights = async (req, res) => {
  try {
    const { timeframe = "weekly" } = req.body;

    // Gather aggregated non-sensitive platform statistics
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: { $ne: "inactive" } });
    const totalHabits = await Habit.countDocuments({ isArchived: false });

    const days = timeframe === "monthly" ? 30 : 7;
    const pastDays = lastNDays(days);

    const logs = await HabitLog.find({
      completedDate: { $gte: pastDays[0], $lte: pastDays[pastDays.length - 1] },
    });

    const categoryStats = await Habit.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Calculate aggregated metrics without leaking personal secrets
    const totalCompletions = logs.length;
    const dailyAvg = (totalCompletions / days).toFixed(1);

    const prompt = `
You are an executive AI Business & Behavioral Analytics Consultant evaluating an AI Habit Tracker platform.
Analyze the following aggregated platform habit and user engagement data for the past ${days} days (${timeframe}):

Platform Aggregate Metrics:
- Total Registered Users: ${totalUsers}
- Active Users Ratio: ${activeUsers}/${totalUsers} (${Math.round((activeUsers / Math.max(1, totalUsers)) * 100)}%)
- Total Active Habits: ${totalHabits}
- Total Habits Completed in ${days} days: ${totalCompletions}
- Daily Average Platform Completions: ${dailyAvg}
- Habit Categories Breakdown:
${categoryStats.map((c) => `  * ${c._id}: ${c.count} habits`).join("\n")}

Respond ONLY with a valid JSON object matching this exact structure:
{
  "summary": "2-3 sentences high level executive overview of platform health and engagement.",
  "timeframe": "${timeframe}",
  "keyFindings": [
    "Key observation 1 with specific metric rationale",
    "Key observation 2 with specific metric rationale",
    "Key observation 3 with specific metric rationale"
  ],
  "habitTrends": "Analysis of consistency, peak engagement days, and overall completion trends.",
  "abandonedHabits": "Analysis of commonly abandoned habit types or categories with friction points.",
  "topCategories": "Analysis of the most successful and resilient habit categories.",
  "recommendations": [
    "Actionable recommendation 1 to improve user retention",
    "Actionable recommendation 2 to improve user engagement",
    "Actionable recommendation 3 for habit building mechanics"
  ],
  "platformCautions": [
    "Platform level warning or risk to monitor (e.g. dropoff after day 14)",
    "Infrastructure or engagement bottleneck caution"
  ]
}
Do not include markdown backticks around the json or any leading/trailing commentary. Return raw JSON only.
`;

    const aiRes = await chatCompletion({
      system: "You are an expert AI product and behavioral analytics advisor. Return valid JSON only.",
      user: prompt,
      temperature: 0.6,
    });

    let structured = null;
    try {
      const cleanJson = aiRes.content.replace(/```json|```/g, "").trim();
      structured = JSON.parse(cleanJson);
    } catch {
      structured = {
        summary: aiRes.content,
        timeframe,
        keyFindings: ["Data generated based on platform logs."],
        habitTrends: "Consistent activity observed across active habits.",
        abandonedHabits: "Habits requiring high daily friction face dropoffs.",
        topCategories: "Health and Fitness remain popular categories.",
        recommendations: [
          "Introduce streak protection alerts to re-engage inactive users.",
          "Suggest micro-habits under 5 minutes for struggling categories.",
          "Encourage weekend consistency via gentle notification reminders.",
        ],
        platformCautions: [
          "Monitor user drop-off trends after day 7.",
          "Ensure habit completion latency stays under 150ms.",
        ],
      };
    }

    const saved = await AIInsight.create({
      userId: req.user._id,
      type: "admin_report",
      content: JSON.stringify(structured),
      meta: {
        timeframe,
        totalUsers,
        totalHabits,
        totalCompletions,
      },
    });

    res.json({
      insight: {
        _id: saved._id,
        generatedAt: saved.createdAt,
        data: structured,
      },
    });
  } catch (err) {
    console.error("Admin generateAIInsights error:", err);
    res.status(500).json({ message: err.message });
  }
};
