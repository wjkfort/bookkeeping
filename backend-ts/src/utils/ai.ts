import type { Env } from "../types";

export interface ParsedTransaction {
  amount: number;
  currency: string;
  description: string;
  category_hint?: string;
  item_name?: string;
  date?: string;
}

export interface AnalysisResult {
  summary: string;
  insights: string[];
  recommendations: string[];
}

/**
 * Parse natural language input into transaction data
 */
export async function parseTransactionFromText(
  ai: Env["AI"],
  text: string,
  userLanguage: string = "en"
): Promise<ParsedTransaction | null> {
  const prompt = `You are a financial assistant. Parse the following transaction description into structured data.
Extract: amount, currency (default USD if not specified), description, category hint, item name if mentioned, and date if mentioned.

User input: "${text}"
Language: ${userLanguage}

CRITICAL RULES: 
- For category_hint, suggest the MOST APPROPRIATE category (e.g., "glass" should be "Household" or "Shopping", NOT "Food")
- For item_name, ALWAYS extract the specific item being purchased if ANY item is mentioned (e.g., "glass", "iPhone", "coffee", "groceries")
- If the user mentions buying/purchasing something, there MUST be an item_name
- Think carefully about what category makes sense for the item
- NEVER use null as a string, use actual null value

Respond ONLY with valid JSON in this exact format (no extra text):
{
  "amount": number,
  "currency": "USD" or "CNY",
  "description": "brief description",
  "category_hint": "appropriate category name or null",
  "item_name": "specific item name or null",
  "date": "YYYY-MM-DD or null"
}

Examples:
Input: "I spent $50 on groceries at Walmart"
Output: {"amount": 50, "currency": "USD", "description": "Groceries at Walmart", "category_hint": "Food", "item_name": "Groceries", "date": null}

Input: "Received 2000 yuan salary today"
Output: {"amount": 2000, "currency": "CNY", "description": "Salary", "category_hint": "Salary", "item_name": null, "date": null}

Input: "I spent 150 CNY to buy a glass today"
Output: {"amount": 150, "currency": "CNY", "description": "Glass", "category_hint": "Household", "item_name": "Glass", "date": null}

Input: "Bought an iPhone for $999"
Output: {"amount": 999, "currency": "USD", "description": "iPhone", "category_hint": "Electronics", "item_name": "iPhone", "date": null}

Now parse the user input above and respond with JSON only:`;

  try {
    const response = await ai.run("@cf/meta/llama-2-7b-chat-int8", {
      prompt,
      max_tokens: 256,
    });

    // Extract JSON from response
    const text = response.response || "";
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON found in AI response:", text);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate required fields
    if (typeof parsed.amount !== "number" || parsed.amount <= 0) {
      return null;
    }

    return {
      amount: parsed.amount,
      currency: parsed.currency || "USD",
      description: parsed.description || text,
      category_hint: parsed.category_hint || undefined,
      item_name: parsed.item_name || undefined,
      date: parsed.date || undefined,
    };
  } catch (error) {
    console.error("Error parsing transaction:", error);
    return null;
  }
}

/**
 * Generate chat response based on user query and transaction data
 */
export async function generateChatResponse(
  ai: Env["AI"],
  userMessage: string,
  context: {
    recentTransactions?: any[];
    summary?: any;
    categories?: any[];
  },
  language: string = "en"
): Promise<{ response: string; action?: { type: string; data: any } }> {
  const contextStr = JSON.stringify(context, null, 2);
  
  let prompt: string;
  
  if (language === "zh") {
    prompt = `你是一个记账应用的财务助手。根据用户的财务数据回答问题。
请用中文回答。

用户的财务数据:
${contextStr}

用户问题: "${userMessage}"

重要说明:
1. 如果用户要求添加/创建/记录交易，必须使用下面的操作格式
2. 对于数据查询问题，使用普通格式
3. 必须只返回有效的JSON，不要有额外文字
4. 对于物品类别，要准确判断：手表=Shopping或Accessories，食物=Food，电子产品=Electronics等

操作格式（用户要添加交易时使用）:
{
  "response": "我会为您添加这笔交易。",
  "action": {
    "type": "create_transaction",
    "data": {
      "amount": 1000,
      "currency": "CNY",
      "description": "手表",
      "category_hint": "Shopping",
      "item_name": "手表"
    }
  }
}

普通格式（回答问题时使用）:
{
  "response": "您的简短回答（最多2-3句话）。"
}

示例:
用户: "我今天花1000元买了一块表"
回答: {"response": "我会为您添加这笔交易。", "action": {"type": "create_transaction", "data": {"amount": 1000, "currency": "CNY", "description": "手表", "category_hint": "Shopping", "item_name": "手表"}}}

用户: "我在食物上花了多少钱？"
回答: {"response": "您本月在食物上花了500元。"}

现在用JSON格式回答用户的问题:`;
  } else {
    prompt = `You are a helpful financial assistant for a bookkeeping application. 
Answer the user's question based on their financial data.

User's financial context:
${contextStr}

User question: "${userMessage}"

CRITICAL INSTRUCTIONS:
1. If user asks to ADD/CREATE/RECORD a transaction, you MUST respond with the ACTION FORMAT below
2. For questions about data, use NORMAL FORMAT
3. ALWAYS respond with valid JSON only, no extra text
4. For item categories, be accurate: watch=Shopping or Accessories, food=Food, electronics=Electronics, etc.

ACTION FORMAT (use when user wants to add/create a transaction):
{
  "response": "I'll add that transaction for you.",
  "action": {
    "type": "create_transaction",
    "data": {
      "amount": 1000,
      "currency": "CNY",
      "description": "Watch",
      "category_hint": "Shopping",
      "item_name": "Watch"
    }
  }
}

NORMAL FORMAT (use for questions):
{
  "response": "Your brief answer here (2-3 sentences max)."
}

Examples:
User: "I spent 1000 CNY to buy a watch today"
Response: {"response": "I'll add that transaction for you.", "action": {"type": "create_transaction", "data": {"amount": 1000, "currency": "CNY", "description": "Watch", "category_hint": "Shopping", "item_name": "Watch"}}}

User: "How much did I spend on food?"
Response: {"response": "You spent 500 CNY on food this month."}

Now respond to the user's question with JSON only:`;
  }

  try {
    const response = await ai.run("@cf/meta/llama-2-7b-chat-int8", {
      prompt,
      max_tokens: 300,
    });

    const text = response.response || "";
    console.log("Raw AI response:", text);
    
    // Try to parse as JSON
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log("Parsed AI response:", parsed);
        return {
          response: parsed.response || text,
          action: parsed.action || undefined,
        };
      }
    } catch (e) {
      console.log("Failed to parse as JSON:", e);
      // Not JSON, return as plain text
    }

    return { response: text };
  } catch (error) {
    console.error("Error generating chat response:", error);
    const errorMsg = language === "zh" 
      ? "我现在无法处理您的请求，请稍后再试。" 
      : "I'm having trouble processing your request right now. Please try again.";
    return { response: errorMsg };
  }
}

/**
 * Analyze spending patterns and generate insights
 */
export async function analyzeSpendingPatterns(
  ai: Env["AI"],
  transactions: any[],
  timeframe: string = "month",
  language: string = "en"
): Promise<AnalysisResult> {
  const transactionsStr = JSON.stringify(transactions.slice(0, 50), null, 2); // Limit to recent 50
  
  let prompt: string;
  
  if (language === "zh") {
    prompt = `你是一位财务分析师。分析以下交易记录并提供见解。
请用中文回答。

交易记录 (${timeframe}):
${transactionsStr}

请用以下JSON格式提供分析（必须用中文）:
{
  "summary": "消费模式的简要概述（2-3句话）",
  "insights": ["见解1", "见解2", "见解3", "见解4"],
  "recommendations": ["建议1", "建议2", "建议3"]
}

重点关注:
- 主要消费类别
- 异常模式或异常情况
- 与典型消费的比较
- 可操作的建议

重要提示：用完整的中文句子回答。不要中途截断。至少提供3-4条见解和2-3条建议。`;
  } else {
    prompt = `You are a financial analyst. Analyze the following transactions and provide insights.
Please respond in English.

Transactions (${timeframe}):
${transactionsStr}

Provide analysis in this JSON format:
{
  "summary": "Brief overview of spending patterns (2-3 sentences)",
  "insights": ["insight 1", "insight 2", "insight 3", "insight 4"],
  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]
}

Focus on:
- Top spending categories
- Unusual patterns or anomalies
- Comparison to typical spending
- Actionable recommendations

IMPORTANT: Respond with COMPLETE sentences. Do not cut off mid-sentence. Provide at least 3-4 insights and 2-3 recommendations.`;
  }

  try {
    const response = await ai.run("@cf/meta/llama-2-7b-chat-int8", {
      prompt,
      max_tokens: 800,
    });

    const text = response.response || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || (language === "zh" ? "分析完成" : "Analysis complete"),
        insights: Array.isArray(parsed.insights) ? parsed.insights : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      };
    }

    // Fallback if JSON parsing fails
    return {
      summary: text.substring(0, 300),
      insights: [],
      recommendations: [],
    };
  } catch (error) {
    console.error("Error analyzing spending:", error);
    return {
      summary: language === "zh" ? "目前无法分析消费模式。" : "Unable to analyze spending patterns at this time.",
      insights: [],
      recommendations: [],
    };
  }
}

/**
 * Suggest category based on transaction description
 */
export async function suggestCategory(
  ai: Env["AI"],
  description: string,
  availableCategories: string[]
): Promise<string | null> {
  const categoriesStr = availableCategories.join(", ");
  
  const prompt = `Given a transaction description, suggest the most appropriate category.

Available categories: ${categoriesStr}

Transaction description: "${description}"

Respond with ONLY the category name from the list above, or "Other" if none fit.`;

  try {
    const response = await ai.run("@cf/meta/llama-2-7b-chat-int8", {
      prompt,
      max_tokens: 50,
    });

    const suggested = (response.response || "").trim();
    
    // Check if suggested category exists in available categories
    if (availableCategories.some(cat => 
      cat.toLowerCase() === suggested.toLowerCase()
    )) {
      return suggested;
    }

    return null;
  } catch (error) {
    console.error("Error suggesting category:", error);
    return null;
  }
}
