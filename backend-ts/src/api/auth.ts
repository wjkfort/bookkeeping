import { Hono } from "hono";
import { sign } from "hono/jwt";
import bcrypt from "bcryptjs";
import type { Env } from "../types";

const authRouter = new Hono<{ Bindings: Env }>();

// Register new user
authRouter.post("/register", async (c) => {
  try {
    const { email, password, username } = await c.req.json();

    if (!email || !password || !username) {
      return c.json({ error: "Email, password, and username are required" }, 400);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return c.json({ error: "Invalid email format" }, 400);
    }

    // Validate password length
    if (password.length < 6) {
      return c.json({ error: "Password must be at least 6 characters" }, 400);
    }

    const db = c.env.DB;

    // Check if user already exists
    const existingUser = await db
      .prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first();

    if (existingUser) {
      return c.json({ error: "User already exists" }, 409);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const result = await db
      .prepare(
        "INSERT INTO users (email, password_hash, username) VALUES (?, ?, ?)"
      )
      .bind(email, passwordHash, username)
      .run();

    if (!result.success) {
      return c.json({ error: "Failed to create user" }, 500);
    }

    // Generate JWT token
    const token = await sign(
      {
        sub: result.meta.last_row_id,
        email,
        username,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
      },
      c.env.JWT_SECRET
    );

    return c.json({
      message: "User registered successfully",
      token,
      user: {
        id: result.meta.last_row_id,
        email,
        username,
      },
    }, 201);
  } catch (error) {
    console.error("Registration error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Login user
authRouter.post("/login", async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    const db = c.env.DB;

    // Get user from database
    const user = await db
      .prepare("SELECT id, email, username, password_hash FROM users WHERE email = ?")
      .bind(email)
      .first();

    if (!user) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash as string);

    if (!isValidPassword) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Generate JWT token
    const token = await sign(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
      },
      c.env.JWT_SECRET
    );

    return c.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Get current user (protected route)
authRouter.get("/me", async (c) => {
  try {
    const payload = c.get("jwtPayload");
    
    if (!payload) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const db = c.env.DB;
    const user = await db
      .prepare("SELECT id, email, username, created_at FROM users WHERE id = ?")
      .bind(payload.sub)
      .first();

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json({ user });
  } catch (error) {
    console.error("Get user error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default authRouter;
