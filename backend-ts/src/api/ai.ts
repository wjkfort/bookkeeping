import { Hono } from "hono";
import type { Env } from "../types";
import {
  parseTransactionFromText,
  generateChatResponse,
  analyzeSpendingPatterns,
  suggestCategory,
} from "../utils/ai";

const aiRouter = new Hono<{ Bindings: Env }>();

/**
 * POST /api/v1/ai/parse-transaction
 * Parse natural language into transaction data
 */
aiRouter.post("/parse-transaction", async (c) => {
  try {
    const payload = c.get("jwtPayload");
    const userId = payload.sub;
    const { text, language = "en" } = await c.req.json();

    if (!text || typeof text !== "string") {
      return c.json({ error: "Text is required" }, 400);
    }

    const parsed = await parseTransactionFromText(c.env.AI, text, language);

    if (!parsed) {
      return c.json({ error: "Could not parse transaction from text" }, 400);
    }

    // If category hint is provided, try to find matching category
    let suggestedCategoryId = null;
    if (parsed.category_hint) {
      const categories = await c.env.DB.prepare(
        `SELECT id, name FROM categories`
      ).all();

      const matchedCategory = categories.results.find(
        (cat: any) =>
          cat.name.toLowerCase() === parsed.category_hint?.toLowerCase()
      );

      if (matchedCategory) {
        suggestedCategoryId = matchedCategory.id;
      }
    }

    return c.json({
      success: true,
      data: {
        ...parsed,
        suggested_category_id: suggestedCategoryId,
      },
    });
  } catch (error) {
    console.error("Error parsing transaction:", error);
    return c.json({ error: "Failed to parse transaction" }, 500);
  }
});

/**
 * POST /api/v1/ai/chat
 * Chat with AI assistant about finances
 */
aiRouter.post("/chat", async (c) => {
  try {
    const payload = c.get("jwtPayload");
    const userId = payload.sub;
    const { message, include_context = true, language = "en" } = await c.req.json();

    if (!message || typeof message !== "string") {
      return c.json({ error: "Message is required" }, 400);
    }

    // Save user message
    await c.env.DB.prepare(
      `INSERT INTO ai_conversations (user_id, message, role) VALUES (?, ?, ?)`
    )
      .bind(userId, message, "user")
      .run();

    // Gather context if requested
    let context: any = {};
    if (include_context) {
      // Get recent transactions
      const recentTransactions = await c.env.DB.prepare(
        `SELECT t.*, c.name as category_name, c.type as category_type
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         ORDER BY t.date DESC
         LIMIT 20`
      ).all();

      // Get summary for current month
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split("T")[0];

      const summary = await c.env.DB.prepare(
        `SELECT 
          SUM(CASE WHEN c.type = 'income' THEN t.amount ELSE 0 END) as total_income,
          SUM(CASE WHEN c.type = 'expense' THEN t.amount ELSE 0 END) as total_expense
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.date >= ?`
      )
        .bind(startOfMonth)
        .first();

      // Get categories
      const categories = await c.env.DB.prepare(
        `SELECT name, type FROM categories`
      ).all();

      context = {
        recentTransactions: recentTransactions.results,
        summary,
        categories: categories.results,
      };
    }

    // Generate AI response
    const aiResult = await generateChatResponse(c.env.AI, message, context, language);

    console.log("AI Result:", JSON.stringify(aiResult, null, 2));

    // Handle action if present
    if (aiResult.action?.type === "create_transaction") {
      console.log("Creating transaction with data:", aiResult.action.data);
      try {
        const transactionData = aiResult.action.data;
        
        // Find or suggest category
        let categoryId = null;
        if (transactionData.category_hint) {
          const categories = await c.env.DB.prepare(
            `SELECT id, name FROM categories`
          ).all();

          const matchedCategory = categories.results.find(
            (cat: any) =>
              cat.name.toLowerCase() === transactionData.category_hint.toLowerCase()
          );

          if (matchedCategory) {
            categoryId = matchedCategory.id;
            console.log("Found existing category:", matchedCategory);
          } else {
            // Category doesn't exist, create it
            console.log("Creating new category:", transactionData.category_hint);
            const newCategory = await c.env.DB.prepare(
              `INSERT INTO categories (name, type) VALUES (?, 'expense') RETURNING id`
            )
              .bind(transactionData.category_hint)
              .first();
            
            categoryId = newCategory?.id;
            console.log("Created category with ID:", categoryId);
          }
        }

        if (!categoryId) {
          // Default to first expense category
          const defaultCategory = await c.env.DB.prepare(
            `SELECT id FROM categories WHERE type = 'expense' LIMIT 1`
          ).first();
          categoryId = defaultCategory?.id;
        }

        // Find or create item if specified
        let itemId = null;
        if (transactionData.item_name) {
          const existingItem = await c.env.DB.prepare(
            `SELECT id FROM items WHERE name = ?`
          )
            .bind(transactionData.item_name)
            .first();

          if (existingItem) {
            itemId = existingItem.id;
            console.log("Found existing item:", existingItem);
          } else {
            console.log("Creating new item:", transactionData.item_name);
            const newItem = await c.env.DB.prepare(
              `INSERT INTO items (name) VALUES (?) RETURNING id`
            )
              .bind(transactionData.item_name)
              .first();
            itemId = newItem?.id;
            console.log("Created item with ID:", itemId);
          }
        }

        // Create transaction
        const today = new Date().toISOString().split('T')[0];
        await c.env.DB.prepare(
          `INSERT INTO transactions (amount, currency, description, date, category_id, item_id)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
          .bind(
            transactionData.amount,
            transactionData.currency || 'USD',
            transactionData.description,
            today,
            categoryId,
            itemId
          )
          .run();

        aiResult.response = `✅ Transaction created successfully! Added ${transactionData.amount} ${transactionData.currency || 'USD'} for ${transactionData.description}.`;
      } catch (error) {
        console.error("Error creating transaction:", error);
        aiResult.response = "I understood your request but failed to create the transaction. Please try using the manual form.";
      }
    }

    // Save AI response
    await c.env.DB.prepare(
      `INSERT INTO ai_conversations (user_id, message, role) VALUES (?, ?, ?)`
    )
      .bind(userId, aiResult.response, "assistant")
      .run();

    return c.json({
      success: true,
      data: {
        message: aiResult.response,
      },
    });
  } catch (error) {
    console.error("Error in chat:", error);
    return c.json({ error: "Failed to process chat message" }, 500);
  }
});

/**
 * GET /api/v1/ai/chat/history
 * Get chat history
 */
aiRouter.get("/chat/history", async (c) => {
  try {
    const payload = c.get("jwtPayload");
    const userId = payload.sub;
    const limit = parseInt(c.req.query("limit") || "50");

    const conversations = await c.env.DB.prepare(
      `SELECT id, message, role, created_at
       FROM ai_conversations
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
      .bind(userId, limit)
      .all();

    return c.json({
      success: true,
      data: conversations.results.reverse(), // Oldest first
    });
  } catch (error) {
    console.error("Error fetching chat history:", error);
    return c.json({ error: "Failed to fetch chat history" }, 500);
  }
});

/**
 * POST /api/v1/ai/analyze
 * Analyze spending patterns
 */
aiRouter.post("/analyze", async (c) => {
  try {
    const payload = c.get("jwtPayload");
    const userId = payload.sub;
    const { timeframe = "month", limit = 50, language = "en" } = await c.req.json();

    // Calculate date range
    const now = new Date();
    let startDate: Date;

    switch (timeframe) {
      case "week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const startDateStr = startDate.toISOString().split("T")[0];

    // Get transactions for analysis
    const transactions = await c.env.DB.prepare(
      `SELECT t.*, c.name as category_name, c.type as category_type
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.date >= ?
       ORDER BY t.date DESC
       LIMIT ?`
    )
      .bind(startDateStr, limit)
      .all();

    if (!transactions.results || transactions.results.length === 0) {
      return c.json({
        success: true,
        data: {
          summary: language === "zh" ? "所选时间范围内未找到交易记录。" : "No transactions found for the selected timeframe.",
          insights: [],
          recommendations: [],
        },
      });
    }

    // Analyze with AI
    const analysis = await analyzeSpendingPatterns(
      c.env.AI,
      transactions.results,
      timeframe,
      language
    );

    return c.json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    console.error("Error analyzing spending:", error);
    return c.json({ error: "Failed to analyze spending patterns" }, 500);
  }
});

/**
 * POST /api/v1/ai/suggest-category
 * Suggest category for a transaction description
 */
aiRouter.post("/suggest-category", async (c) => {
  try {
    const payload = c.get("jwtPayload");
    const userId = payload.sub;
    const { description } = await c.req.json();

    if (!description || typeof description !== "string") {
      return c.json({ error: "Description is required" }, 400);
    }

    // Get user's categories
    const categories = await c.env.DB.prepare(
      `SELECT id, name FROM categories`
    ).all();

    const categoryNames = categories.results.map((cat: any) => cat.name);

    // Get AI suggestion
    const suggestedName = await suggestCategory(
      c.env.AI,
      description,
      categoryNames
    );

    if (!suggestedName) {
      return c.json({
        success: true,
        data: { suggested_category_id: null },
      });
    }

    // Find category ID
    const matchedCategory = categories.results.find(
      (cat: any) => cat.name.toLowerCase() === suggestedName.toLowerCase()
    );

    return c.json({
      success: true,
      data: {
        suggested_category_id: matchedCategory ? matchedCategory.id : null,
        suggested_category_name: suggestedName,
      },
    });
  } catch (error) {
    console.error("Error suggesting category:", error);
    return c.json({ error: "Failed to suggest category" }, 500);
  }
});

export default aiRouter;
