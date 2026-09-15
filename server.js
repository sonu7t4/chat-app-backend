import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import messageRoutes from "./routes/messageRoutes.js";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import User from "./models/User.js";
import Message from "./models/Message.js";
import Conversation from "./models/Conversation.js";
import userRoutes from "./routes/userRoutes.js";
import { parseCookie } from "cookie";
import { AUTH_COOKIE_NAME } from "./config/auth.js";
import { createOriginMiddleware } from "./middleware/originMiddleware.js";

dotenv.config({ quiet: true });

const app = express();
const allowedOrigins = (process.env.CLIENT_URLS || "https://chat-app-frontendd-rho.vercel.app")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use("/uploads", express.static("uploads"));

// Create HTTP server
// Create HTTP server
const httpServer = createServer(app);

// Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json());
app.use(createOriginMiddleware(allowedOrigins));

connectDB();

// REST API
app.use("/api/auth", authRoutes);

app.use("/api/messages", messageRoutes);

app.use("/api/users", userRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "Chat App API is running 🚀",
  });
});

const onlineUsers = new Map();

// Socket.IO connection
io.use(async (socket, next) => {
  try {
    const token = parseCookie(socket.handshake.headers.cookie || "")[AUTH_COOKIE_NAME];

    if (!token) {
      return next(new Error("Unauthorized"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId);

    if (!user) {
      return next(new Error("Unauthorized"));
    }

    socket.user = user;
    next();
  } catch (error) {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", async (socket) => {
  try {
    const user = socket.user;
    const userId = user._id.toString();

    // Store socket information
    socket.userId = userId;

    onlineUsers.set(userId, socket.id);

    // Tell everyone that this user is online
  socket.broadcast.emit("userOnline", {
    userId,
    });

    // Update user status
    user.isOnline = true;
    user.lastSeen = null;

    await user.save();

    console.log(`${user.username} is online 🟢`);

    // -----------------------------
    // SEND MESSAGE
    // -----------------------------

    socket.on("sendMessage", async (data) => {
      try {
        const {
  receiverId,
  content,
  messageType = "text",
} = data;

        const trimmedContent = typeof content === "string" ? content.trim() : "";

        if (
          !receiverId ||
          !mongoose.Types.ObjectId.isValid(receiverId) ||
          receiverId === userId ||
          !trimmedContent ||
          trimmedContent.length > 5000 ||
          !["text", "image"].includes(messageType)
        ) {
          return;
        }

        // Find conversation
        let conversation = await Conversation.findOne({
          participants: {
            $all: [userId, receiverId],
          },
        });

        // Create conversation if needed
        if (!conversation) {
          conversation = await Conversation.create({
            participants: [userId, receiverId],
          });
        }

        // Create message
      const receiverSocketId = onlineUsers.get(receiverId.toString());
      const message = await Message.create({
  sender: userId,
  receiver: receiverId,
  content: trimmedContent,
  messageType,
  isDelivered: Boolean(receiverSocketId),
});

        // Update last message
        conversation.lastMessage = message._id;

        await conversation.save();

        // Populate message
        const populatedMessage = await Message.findById(
          message._id
        )
          .populate(
            "sender",
            "username profilePicture"
          )
          .populate(
            "receiver",
            "username profilePicture"
          );

        // Send to sender
        if (receiverSocketId) {
          const receiverSocket = io.sockets.sockets.get(receiverSocketId);

          if (receiverSocket?.connected) {
            await Message.findByIdAndUpdate(message._id, {
              isDelivered: true,
            });
            populatedMessage.isDelivered = true;
            receiverSocket.emit("newMessage", populatedMessage);
          } else {
            onlineUsers.delete(receiverId.toString());
          }
        }

        socket.emit("messageSent", populatedMessage);

        if (receiverSocketId && populatedMessage.isDelivered) {
          socket.emit("messageDelivered", {
            messageId: message._id,
          });
        }
      } catch (error) {
        console.error(
          "Send message error:",
          error.message
        );
      }
    });

    socket.on("editMessage", async ({ messageId, content }, acknowledge) => {
      try {
        const reply = typeof acknowledge === "function" ? acknowledge : () => {};
        const trimmedContent = typeof content === "string" ? content.trim() : "";

        if (
          !messageId ||
          !mongoose.Types.ObjectId.isValid(messageId) ||
          !trimmedContent ||
          trimmedContent.length > 5000
        ) {
          reply({ ok: false, message: "Enter a valid message up to 5000 characters." });
          return;
        }

        const message = await Message.findOneAndUpdate(
          { _id: messageId, sender: userId, isDeleted: { $ne: true }, messageType: "text" },
          { $set: { content: trimmedContent, isEdited: true, editedAt: new Date() } },
          { returnDocument: "after" },
        )
          .populate("sender", "username profilePicture")
          .populate("receiver", "username profilePicture");

        if (!message) {
          reply({ ok: false, message: "Only your active text messages can be edited." });
          return;
        }

        const receiverSocketId = onlineUsers.get(message.receiver._id.toString());
        socket.emit("messageUpdated", message);

        if (receiverSocketId) {
          io.to(receiverSocketId).emit("messageUpdated", message);
        }
        reply({ ok: true });
      } catch (error) {
        if (typeof acknowledge === "function") {
          acknowledge({ ok: false, message: "Message edit failed." });
        }
        console.error("Edit message error:", error.message);
      }
    });

    socket.on("deleteMessage", async ({ messageId }, acknowledge) => {
      try {
        const reply = typeof acknowledge === "function" ? acknowledge : () => {};

        if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
          reply({ ok: false, message: "Invalid message." });
          return;
        }

        const message = await Message.findOneAndUpdate(
          { _id: messageId, sender: userId, isDeleted: { $ne: true } },
          {
            $set: {
              content: "This message was deleted",
              isDeleted: true,
              deletedAt: new Date(),
            },
          },
          { returnDocument: "after" },
        )
          .populate("sender", "username profilePicture")
          .populate("receiver", "username profilePicture");

        if (!message) {
          reply({ ok: false, message: "Only your active messages can be deleted." });
          return;
        }

        const receiverSocketId = onlineUsers.get(message.receiver._id.toString());
        socket.emit("messageDeleted", message);

        if (receiverSocketId) {
          io.to(receiverSocketId).emit("messageDeleted", message);
        }
        reply({ ok: true });
      } catch (error) {
        if (typeof acknowledge === "function") {
          acknowledge({ ok: false, message: "Message deletion failed." });
        }
        console.error("Delete message error:", error.message);
      }
    });

    socket.on("deleteMessageForMe", async ({ messageId }, acknowledge) => {
      try {
        const reply = typeof acknowledge === "function" ? acknowledge : () => {};

        if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
          reply({ ok: false, message: "Invalid message." });
          return;
        }

        const message = await Message.findOneAndUpdate(
          {
            _id: messageId,
            isDeleted: true,
            $or: [{ sender: userId }, { receiver: userId }],
          },
          { $addToSet: { deletedFor: userId } },
          { returnDocument: "after" },
        );

        if (!message) {
          reply({ ok: false, message: "This deleted message cannot be removed." });
          return;
        }

        socket.emit("messageHidden", { messageId });
        reply({ ok: true });
      } catch (error) {
        if (typeof acknowledge === "function") {
          acknowledge({ ok: false, message: "Message removal failed." });
        }
        console.error("Delete message for me error:", error.message);
      }
    });

    // -----------------------------
    // DISCONNECT
    // -----------------------------

    socket.on("disconnect", async () => {
      const userId = socket.userId;
      try {
        // Only remove THIS socket
        if (
          onlineUsers.get(userId) === socket.id
        ) {
          onlineUsers.delete(userId);

          const disconnectedUser =
            await User.findById(userId);

          if (disconnectedUser) {
            disconnectedUser.isOnline = false;
            disconnectedUser.lastSeen =
              new Date();

            await disconnectedUser.save();

            io.emit("userOffline", {
      userId,
    });

    console.log(
      `${disconnectedUser.username} went offline 🔴`
    );
          }
        }

      } catch (error) {
        console.error(
          "Disconnect error:",
          error.message
        );
      }
    });
    socket.on("typing", ({ receiverId }) => {
  const receiverSocketId =
    onlineUsers.get(receiverId);

  if (receiverSocketId) {
    io.to(receiverSocketId).emit(
      "userTyping",
      {
        userId: socket.userId,
      }
    );
  }
});
socket.on("stopTyping", ({ receiverId }) => {
  const receiverSocketId =
    onlineUsers.get(receiverId);

  if (receiverSocketId) {
    io.to(receiverSocketId).emit(
      "userStoppedTyping",
      {
        userId: socket.userId,
      }
    );
  }

});
socket.on(
  "markMessagesSeen",
  async ({ senderId }) => {
    try {
      const receiverId = socket.userId;

      const messages =
        await Message.find({
          sender: senderId,
          receiver: receiverId,
          isSeen: false,
        });

      if (messages.length === 0) {
        return;
      }

      await Message.updateMany(
        {
          sender: senderId,
          receiver: receiverId,
          isSeen: false,
        },
        {
          $set: {
            isSeen: true,
            seenAt: new Date(),
            isDelivered: true,
          },
        }
      );

      // Tell the sender that their messages were seen
      const senderSocketId =
        onlineUsers.get(senderId);

      if (senderSocketId) {
        io.to(senderSocketId).emit(
          "messagesSeen",
          {
            receiverId,
          }
        );
      }

    } catch (error) {
      console.error(
        "Mark messages seen error:",
        error.message
      );
    }
  }
);
  } catch (error) {
    console.error(
      "Socket authentication failed:",
      error.message
    );

    socket.disconnect();
  }
});

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});