import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import mongoose from "mongoose";

export const sendMessage = async (req, res) => {
  try {
    const senderId = req.user._id;
    const { receiverId, content } = req.body;
    const trimmedContent =
      typeof content === "string" ? content.trim() : "";

    if (
      !receiverId ||
      !mongoose.Types.ObjectId.isValid(receiverId) ||
      receiverId.toString() === senderId.toString() ||
      !trimmedContent ||
      trimmedContent.length > 5000
    ) {
      return res.status(400).json({
        message: "A valid receiver and message up to 5000 characters are required",
      });
    }

    // Find existing conversation
    let conversation = await Conversation.findOne({
      participants: {
        $all: [senderId, receiverId],
      },
    });

    // Create conversation if it doesn't exist
    if (!conversation) {
      conversation = await Conversation.create({
        participants: [senderId, receiverId],
      });
    }

    // Create message
    const message = await Message.create({
      sender: senderId,
      receiver: receiverId,
      content: trimmedContent,
    });

    // Update last message
    conversation.lastMessage = message._id;
    await conversation.save();

    // Return populated message
    const populatedMessage = await Message.findById(
      message._id
    )
      .populate("sender", "username profilePicture")
      .populate("receiver", "username profilePicture");

    res.status(201).json({
      message: populatedMessage,
    });
  } catch (error) {
    console.error("Send message error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};

export const getMessages = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { userId } = req.params;

    const messages = await Message.find({
      $or: [
        {
          sender: currentUserId,
          receiver: userId,
        },
        {
          sender: userId,
          receiver: currentUserId,
        },
      ],
      deletedFor: { $nin: [currentUserId] },
    })
      .populate("sender", "username profilePicture")
      .populate("receiver", "username profilePicture")
      .sort({ createdAt: 1 });

    res.status(200).json({
      messages,
    });
  } catch (error) {
    console.error("Get messages error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};