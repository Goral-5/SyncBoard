import express from "express";
import jwt from "jsonwebtoken";
import cors from "cors";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import dotenv from "dotenv";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { middleware } from "./middleware";
import { User } from "../models/User";
import { Room, getRoomUserRole } from "../models/Room";
import { Chat } from "../models/Chat";
import { Message } from "../models/Message";
import nodemailer from "nodemailer";
import { JWT_SECRET, MONGO_URI } from "../config";

import path from "path";

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// ── Cloudinary config ─────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

// multer: store uploads in memory (no disk writes needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

/*
 * ── Google OAuth ──────────────────────────────────────────────────────────────
 *
 * Temporarily disabled because Google OAuth credentials are not configured.
 * SyncBoard currently uses JWT authentication for normal login/signup.
 *
 * We can enable Google OAuth later if required.
 */

// passport.use(
//   new GoogleStrategy(
//     {
//       clientID: process.env.GOOGLE_CLIENT_ID!,
//       clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
//       callbackURL: "/auth/google/callback",
//       proxy: true,
//     },
//     async (_accessToken, _refreshToken, profile, done) => {
//       try {
//         const email = profile.emails?.[0].value;

//         if (!email) {
//           return done(new Error("No email returned from Google"), undefined);
//         }

//         let user = await User.findOne({ email });

//         if (!user) {
//           user = await User.create({
//             email,
//             name: profile.displayName,
//             password: "GOOGLE_OAUTH",
//             googleId: profile.id,
//             authProvider: "google",
//           });
//         } else if (!user.googleId) {
//           user.googleId = profile.id;
//           user.authProvider = "google";
//           await user.save();
//         }

//         return done(null, user);
//       } catch (err) {
//         return done(err as Error, undefined);
//       }
//     }
//   )
// );

export function createExpressApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(express.json());

  app.use(passport.initialize());

  app.use(
    cors({
      origin: ["https://sketchcalibur.vercel.app", "http://localhost:3000"],
      credentials: true,
    }),
  );

  app.get("/", (req, res) => {
    res.send("http server backend running");
  });

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      mongodb: mongoose.connection.readyState === 1,
    });
  });

  // ---------------------- SIGNUP ----------------------

  app.post("/signup", async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        message: "Missing inputs",
      });
    }

    try {
      const existing = await User.findOne({ email });

      if (existing) {
        if (existing.authProvider === "google") {
          return res.status(409).json({
            message: "Account exists. Please sign up using Google",
          });
        }

        return res.status(409).json({
          message: "Email already exists",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await User.create({
        email,
        password: hashedPassword,
        name,
        authProvider: "local",
      });

      console.log("✅ USER SAVED:", user._id, user.email);

      return res.status(201).json({
        userId: user._id,
      });
    } catch (err) {
      console.error("Signup error:", err);

      return res.status(500).json({
        message: "Server error",
      });
    }
  });

  // ---------------------- LOGIN ----------------------

  app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    console.log("Login attempt:", {
      email,
      hasPassword: !!password,
    });

    if (!email || !password) {
      return res.status(400).json({
        message: "Missing inputs",
      });
    }

    try {
      const user = await User.findOne({ email });

      if (!user) {
        console.log("User not found:", email);

        return res.status(403).json({
          message: "Invalid email or password",
        });
      }

      console.log("User found:", {
        email,
        authProvider: user.authProvider,
      });

      if (user.authProvider === "google") {
        return res.status(403).json({
          message: "This account uses Google sign-in",
        });
      }

      if (!user.password) {
        return res.status(403).json({
          message: "Password login unavailable for this account",
        });
      }

      const validPassword = await bcrypt.compare(password, user.password);

      if (!validPassword) {
        console.log("Invalid password for:", email);

        return res.status(403).json({
          message: "Invalid email or password",
        });
      }

      console.log("Login successful:", email);

      const token = jwt.sign(
        {
          userId: user._id,
        },
        JWT_SECRET,
        {
          expiresIn: "7d",
        },
      );

      return res.json({
        token,
      });
    } catch (err) {
      console.error("Login error:", err);

      return res.status(500).json({
        message: "Server error",
      });
    }
  });

  // ---------------------- CREATE ROOM ----------------------

  app.post("/create-room", middleware, async (req: any, res) => {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        message: "Missing room name",
      });
    }

    try {
      const exists = await Room.findOne({
        slug: name,
      });

      if (exists) {
        return res.status(409).json({
          message: "Room already exists",
        });
      }

      const room = await Room.create({
        slug: name,
        adminId: req.userId,
      });

      res.json({
        roomId: room._id,
      });
    } catch (e) {
      console.error(e);

      res.status(500).json({
        message: "Failed to create room",
      });
    }
  });

  // ---------------------- GET ALL ROOMS ----------------------

  app.get("/my-rooms", middleware, async (req: any, res) => {
    try {
      const userId = req.userId;

      const rooms = await Room.find({
        $or: [{ adminId: userId }, { collaborators: userId }],
      })
        .populate("adminId", "name")
        .populate("collaborators", "name")
        .sort({ createdAt: -1 });

      res.json({
        rooms,
      });
    } catch (e) {
      console.error("Failed to fetch rooms:", e);

      res.status(500).json({
        message: "Failed to fetch rooms",
      });
    }
  });

  // ---------------------- GET LOGGED IN USER DATA ----------------------

  app.get("/me", middleware, async (req: any, res) => {
    try {
      const userId = req.userId;

      const user = await User.findById(userId).select("-password");

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      res.json({
        user,
      });
    } catch (e) {
      console.error("Failed to fetch user:", e);

      res.status(500).json({
        message: "Internal server error",
      });
    }
  });

  // ---------------------- UPDATE LOGGED IN USER DATA ----------------------

  app.post("/me", middleware, async (req: any, res) => {
    try {
      const { name, photo } = req.body;

      const userId = req.userId;

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          name,
          photo,
        },
        {
          new: true,
        },
      ).select("-password");

      res.json({
        message: "Profile updated",
        user: updatedUser,
      });
    } catch (e) {
      res.status(500).json({
        message: "Error updating profile",
      });
    }
  });

  // ---------------------- GET CHATS ----------------------

  app.get("/chats/:roomId", async (req, res) => {
    try {
      const roomId = req.params.roomId;

      const messages = await Chat.find({
        roomId,
      })
        .sort({ createdAt: -1 })
        .limit(1000);

      res.json({
        messages,
      });
    } catch (e) {
      console.error(e);

      res.json({
        messages: [],
      });
    }
  });

  // -------------------------------------------------------------
  // 1. GET ROOM SNAPSHOT (/room/:idOrSlug)
  //
  // INTERVIEW POINT:
  // Why accept both ID and Slug?
  // Frontend URLs can use human-friendly slugs (/canvas/sprint-planning)
  // or direct database ObjectIds (/canvas/66d1234...).
  // ── AUTO-JOIN: Authenticated user claims editor role via shared link ──
  app.patch("/room/:roomId/join", middleware, async (req: any, res) => {
    const { roomId } = req.params;
    const userId = req.userId;

    try {
      const isValidObjectId =
        mongoose.Types.ObjectId.isValid(roomId) &&
        /^[0-9a-fA-F]{24}$/.test(roomId);
      const query = isValidObjectId
        ? { $or: [{ _id: roomId }, { slug: roomId }] }
        : { slug: roomId };

      const room = await Room.findOne(query);
      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }

      const role = getRoomUserRole(room, userId);

      if (role) {
        // User already has access (admin or existing collaborator) — no-op
        return res.json({ success: true, role });
      }

      // Add as editor collaborator (idempotent $addToSet)
      await Room.updateOne(query, {
        $addToSet: { collaborators: userId },
      });

      return res.json({ success: true, role: "editor" });
    } catch (e) {
      console.error("[Auto-Join] Failed:", e);
      return res.status(500).json({ message: "Failed to join room" });
    }
  });

  // -------------------------------------------------------------
  // 1. GET ROOM SNAPSHOT (/room/:idOrSlug)
  // -------------------------------------------------------------
  app.get("/room/:idOrSlug", async (req: any, res) => {
    const { idOrSlug } = req.params;

    try {
      const isValidObjectId =
        mongoose.Types.ObjectId.isValid(idOrSlug) &&
        /^[0-9a-fA-F]{24}$/.test(idOrSlug);

      const query = isValidObjectId
        ? { $or: [{ _id: idOrSlug }, { slug: idOrSlug }] }
        : { slug: idOrSlug };

      const room = await Room.findOne(query)
        .populate("adminId", "name email photo")
        .populate("collaborators", "name email photo");

      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }

      // Check user access if an auth token was supplied
      let role: string | null = null;
      let token = req.headers["authorization"];
      if (token) {
        if (token.startsWith("Bearer ")) token = token.slice(7).trim();
        try {
          const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
          role = getRoomUserRole(room, decoded.userId);
        } catch {
          // Token was invalid or expired; role stays null
        }
      }

      // MIGRATION SAFETY NET:
      // Earlier versions saved canvas drawings as JSON strings inside the Chat collection.
      // If this room has no elements yet, we check Chat for the newest snapshot,
      // parse it, and copy it directly into room.elements. Zero data loss for existing users!
      if (!room.elements || room.elements.length === 0) {
        try {
          const legacyChat = await Chat.findOne({ roomId: room._id }).sort({
            createdAt: -1,
          });
          if (legacyChat && legacyChat.message) {
            const parsedElements = JSON.parse(legacyChat.message);
            if (Array.isArray(parsedElements) && parsedElements.length > 0) {
              room.elements = parsedElements;
              room.version = 1;
              await room.save();
              console.log(
                `[Migration] Migrated ${parsedElements.length} elements from Chat into Room ${room._id}`,
              );
            }
          }
        } catch (migErr) {
          console.error(
            "[Migration] Failed to migrate legacy elements from Chat:",
            migErr,
          );
        }
      }

      res.json({
        room,
        role,
      });
    } catch (e) {
      console.error("Error fetching room:", e);
      res.status(500).json({ message: "Failed to fetch room" });
    }
  });

  // ---------------------- DELETE ROOM ----------------------

  app.delete("/room/:roomId", middleware, async (req: any, res) => {
    const { roomId } = req.params;

    try {
      const isValidObjectId =
        mongoose.Types.ObjectId.isValid(roomId) &&
        /^[0-9a-fA-F]{24}$/.test(roomId);
      const query = isValidObjectId
        ? { $or: [{ _id: roomId }, { slug: roomId }] }
        : { slug: roomId };

      const room = await Room.findOne(query);

      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }

      // Only the admin / creator can delete the room
      if (room.adminId.toString() !== req.userId) {
        return res
          .status(403)
          .json({ message: "Only the room creator can delete this room" });
      }

      await Room.findByIdAndDelete(room._id);
      await Chat.deleteMany({ roomId: room._id });
      await Message.deleteMany({ roomId: room._id });

      res.json({ message: "Room deleted successfully" });
    } catch (e) {
      console.error("Failed to delete room:", e);
      res.status(500).json({ message: "Failed to delete room" });
    }
  });

  // ---------------------- SAVE ROOM ELEMENTS (HTTP FALLBACK) ----------------------

  app.put("/room/:roomId/elements", middleware, async (req: any, res) => {
    const { roomId } = req.params;
    const { elements } = req.body;

    try {
      const isValidObjectId =
        mongoose.Types.ObjectId.isValid(roomId) &&
        /^[0-9a-fA-F]{24}$/.test(roomId);
      const query = isValidObjectId
        ? { $or: [{ _id: roomId }, { slug: roomId }] }
        : { slug: roomId };

      const room = await Room.findOne(query);

      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }

      const role = getRoomUserRole(room, req.userId);
      if (!role) {
        return res
          .status(403)
          .json({ message: "You do not have write access to this room" });
      }

      if (Array.isArray(elements)) {
        room.elements = elements;
        room.version = (room.version || 0) + 1;
        await room.save();
      }

      res.json({
        success: true,
        version: room.version,
        updatedAt: room.updatedAt,
      });
    } catch (e) {
      console.error("Failed to save room elements:", e);
      res.status(500).json({ message: "Failed to save room elements" });
    }
  });

  // ---------------------- ADD COLLABORATOR TO ROOM ----------------------

  app.post("/rooms/:roomId/add-collaborator", middleware, async (req, res) => {
    const { roomId } = req.params;

    const { username, useremail } = req.body;

    if (!username || !useremail) {
      return res.status(400).json({
        message: "Username or User email is required",
      });
    }

    try {
      const userToAdd = await User.findOne({
        name: username,
      });

      if (!userToAdd) {
        const room = await Room.findById(roomId);

        if (!room) {
          return res.status(404).json({
            message: "Room not found",
          });
        }

        try {
          const transporter = nodemailer.createTransport({
            host: "smtp.gmail.com",
            port: 465,
            secure: true,
            auth: {
              user: process.env.GMAIL_USER!,
              pass: process.env.GMAIL_PASS!,
            },
          });

          const mailOptions = {
            from: process.env.GMAIL_USER,
            to: useremail,
            subject: `Invitation to join SyncBoard Room`,
            text: `Hello,\n\nYou have been invited to join the room '${room.slug}' on SyncBoard. Please create an account using this email to join the room as a collaborator.\n\nBest regards,\nSyncBoard Team`,
          };

          await transporter.sendMail(mailOptions);

          return res.status(404).json({
            message:
              "No such user found, but an invitation email has been sent to create an account and join the room!",
          });
        } catch (mailErr) {
          console.error("Failed to send invitation email:", mailErr);

          return res.status(404).json({
            message: "No such user found, and failed to send invitation email.",
          });
        }
      }

      const room = await Room.findById(roomId);

      if (!room) {
        return res.status(404).json({
          message: "Room not found",
        });
      }

      if (!Array.isArray(room.collaborators)) {
        room.collaborators = [];
      }

      const isAlreadyCollaborator = room.collaborators.some(
        (id) => id.toString() === userToAdd._id.toString(),
      );

      if (isAlreadyCollaborator) {
        return res.status(400).json({
          message: "User is already a collaborator",
        });
      }

      if (room.adminId.toString() === userToAdd._id.toString()) {
        return res.status(400).json({
          message: "Admin is already in the room",
        });
      }

      room.collaborators.push(userToAdd._id);

      await room.save();

      res.status(200).json({
        message: `${username} added as collaborator`,
        collaboratorId: userToAdd._id,
      });
    } catch (e) {
      console.error("Error adding collaborator:", e);

      res.status(500).json({
        message: "Failed to add collaborator",
      });
    }
  });

  // ---------------------- STORE CHAT ----------------------

  app.post("/chats/:roomId", middleware, async (req: any, res) => {
    try {
      const roomId = req.params.roomId;
      const { message } = req.body;

      await Chat.create({
        roomId,
        userId: req.userId,
        message,
      });

      res.status(200).json({
        message: "Message stored in chat",
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({
        message: "Failed to store message",
      });
    }
  });

  // ---------------------- GET TEXT CHAT ----------------------

  app.get("/rooms/:roomId/messages", middleware, async (req: any, res) => {
    try {
      const { roomId } = req.params;
      const isValidObjectId =
        mongoose.Types.ObjectId.isValid(roomId) &&
        /^[0-9a-fA-F]{24}$/.test(roomId);

      let targetRoomId = roomId;
      if (!isValidObjectId) {
        const roomDoc = (await Room.findOne({ slug: roomId }).select(
          "_id",
        )) as {
          _id: mongoose.Types.ObjectId;
        } | null;

        if (!roomDoc) {
          return res.status(404).json({ message: "Room not found" });
        }

        targetRoomId = roomDoc._id.toString();
      }

      const messages = await Message.find({
        roomId: targetRoomId,
      })
        .populate("userId", "name photo")
        .sort({ createdAt: 1 });

      res.json({
        messages,
      });
    } catch (e) {
      console.error("Error fetching chat history:", e);
      res.status(500).json({
        message: "Error fetching chat history",
      });
    }
  });

  // ---------------------- GOOGLE AUTH ----------------------

  /*
   * Google OAuth is currently disabled because the GoogleStrategy
   * is not configured.
   *
   * Keep these routes commented out until we decide to enable
   * Google authentication.
   */

  // app.get(
  //   "/auth/google",
  //   passport.authenticate("google", {
  //     scope: ["profile", "email"],
  //     session: false,
  //   })
  // );

  // app.get(
  //   "/auth/google/callback",
  //   passport.authenticate("google", {
  //     session: false,
  //     failureRedirect: "https://sketchcalibur.vercel.app/auth",
  //   }),
  //   (req, res) => {
  //     const user = req.user as any;

  //     const token = jwt.sign(
  //       { userId: user._id },
  //       JWT_SECRET,
  //       { expiresIn: "7d" }
  //     );

  //     const frontendUrl =
  //       "https://sketchcalibur.vercel.app/dashboard";

  //     return res.redirect(
  //       `${frontendUrl}?token=${token}`
  //     );
  //   }
  // );

  // ---------------------- UPLOAD IMAGE TO CLOUDINARY ----------------------

  app.post(
    "/upload-image",
    middleware,
    upload.single("image"),
    async (req: any, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            message: "No image file provided",
          });
        }

        const result = await new Promise<any>((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "sketchcalibur",
              resource_type: "image",
              quality: "auto:best",
            },
            (error, result) => {
              if (error) {
                reject(error);
              } else {
                resolve(result);
              }
            },
          );

          stream.end(req.file!.buffer);
        });

        res.json({
          success: true,
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
        });
      } catch (e) {
        console.error("Cloudinary upload error:", e);

        res.status(500).json({
          message: "Image upload failed",
        });
      }
    },
  );

  return app;
}
