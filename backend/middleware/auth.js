import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer ")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        message: "Not authorized, no token",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        message: "User no longer exists",
      });
    }

    if (user.status === "inactive") {
      return res.status(403).json({
        message: "Account has been deactivated. Please contact an administrator.",
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      message: "Not authorized, token invalid",
    });
  }
};

export const requireAdmin = (req, res, next) => {
  const authorizedEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();

  if (
    req.user &&
    req.user.role === "admin" &&
    req.user.status === "active" &&
    authorizedEmail &&
    req.user.email?.trim().toLowerCase() === authorizedEmail
  ) {
    return next();
  }

  return res.status(403).json({
    message: "Access denied. Only the authorized administrator can access this resource.",
  });
};