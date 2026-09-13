import express from "express";
import upload from "../middleware/uploadMiddleware.js";
import {
  sendMessage,
  getMessages,
} from "../Controllers/messageController.js";

import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  sendMessage
);

router.post(
  "/upload",
  authMiddleware,
  upload.single("image"),
  (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "No image uploaded",
      });
    }

    const imageUrl = `/uploads/${req.file.filename}`;

    res.status(200).json({
      message: "Image uploaded successfully",
      imageUrl,
    });
  } catch (error) {
    console.error("Image upload error:", error.message);

    res.status(500).json({
      message: "Image upload failed",
    });
  }
  }
);

router.get(
  "/:userId",
  authMiddleware,
  getMessages
);

export default router;