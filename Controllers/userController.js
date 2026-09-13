import User from "../models/User.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

export const getUsers = async (req, res) => {
  try {
    const currentUserId = req.user._id;

    const users = await User.find({
      _id: {
        $ne: currentUserId,
      },
    })
      .select(
        "_id username email profilePicture isOnline lastSeen"
      )
      .lean();

    // Get all conversations involving current user
    const conversations = await Conversation.find({
      participants: currentUserId,
    })
      .populate({
        path: "lastMessage",
        select:
          "sender receiver content messageType createdAt isDelivered isSeen",
      })
      .lean();

    // Create a lookup:
    // otherUserId -> conversation
    const conversationMap = new Map();

    for (const conversation of conversations) {
      const otherUser = conversation.participants.find(
        (id) =>
          id.toString() !== currentUserId.toString()
      );

      if (otherUser) {
        conversationMap.set(
          otherUser.toString(),
          conversation
        );
      }
    }

    // Get unread message counts
    const unreadMessages = await Message.aggregate([
      {
        $match: {
          receiver: currentUserId,
          isSeen: false,
        },
      },
      {
        $group: {
          _id: "$sender",
          count: {
            $sum: 1,
          },
        },
      },
    ]);

    // Create lookup:
    // senderId -> unread count
    const unreadMap = new Map();

    for (const item of unreadMessages) {
      unreadMap.set(
        item._id.toString(),
        item.count
      );
    }

    // Add conversation + unread information
    const usersWithConversation = users.map(
      (user) => {
        const conversation =
          conversationMap.get(
            user._id.toString()
          );

        const lastMessage =
          conversation?.lastMessage || null;

        const unreadCount =
          unreadMap.get(
            user._id.toString()
          ) || 0;

        return {
          ...user,

          lastMessage: lastMessage
            ? {
                _id: lastMessage._id,
                content:
                  lastMessage.content,
                messageType:
                  lastMessage.messageType,
                sender:
                  lastMessage.sender,
                receiver:
                  lastMessage.receiver,
                createdAt:
                  lastMessage.createdAt,
                isDelivered:
                  lastMessage.isDelivered,
                isSeen:
                  lastMessage.isSeen,
              }
            : null,

          lastMessageTime:
            lastMessage?.createdAt || null,

          unreadCount,
        };
      }
    );

    res.status(200).json({
      users: usersWithConversation,
    });
  } catch (error) {
    console.error(
      "Get users error:",
      error.message
    );

    res.status(500).json({
      message: "Server error",
    });
  }
};