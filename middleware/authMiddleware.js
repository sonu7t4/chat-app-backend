import jwt from "jsonwebtoken";
import { parse } from "cookie";
import User from "../models/User.js";
import { AUTH_COOKIE_NAME } from "../config/auth.js";

const authMiddleware = async (req, res, next) => {
  try {
    const token = parse(req.headers.cookie || "")[AUTH_COOKIE_NAME];

    if (!token) {
      return res.status(401).json({
        message: "No token provided",
      });
    }

    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    // Find user
    const user = await User.findById(decoded.userId).select(
      "-password"
    );

    if (!user) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    // Attach user to request
    req.user = user;

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};

export default authMiddleware;