import express from "express";

import {
  getUsers,
  searchUsers,
} from "../Controllers/userController.js";

import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

router.get(
  "/search",
  authMiddleware,
  searchUsers
);

router.get(
  "/",
  authMiddleware,
  getUsers
);

export default router;