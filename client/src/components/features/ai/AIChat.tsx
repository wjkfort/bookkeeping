import { useState, useEffect, useRef } from "react";
import { Drawer, Button, Input, List, Avatar, Space, Spin, message } from "antd";
import { RobotOutlined, SendOutlined, CloseOutlined, StarOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { chatWithAI, getChatHistory, ChatMessage } from "../../../api";
import { useTranslation } from "react-i18next";
import "./AIChat.css";

const { TextArea } = Input;

interface AIChatProps {
  onTransactionCreated?: () => void;
}

interface ApiErrorResponse {
  response?: {
    data?: {
      error?: string;
    };
  };
}

export default function AIChat({ onTransactionCreated }: AIChatProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const historyLoadedRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (open && !historyLoadedRef.current) {
      loadHistory();
    }
  }, [open]);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const response = await getChatHistory(50);
      if (response.data.success) {
        setMessages(response.data.data);
        historyLoadedRef.current = true;
      }
    } catch (error) {
      console.error("Failed to load chat history:", error);
      // If error loading history, start fresh
      setMessages([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setInputValue("");
    historyLoadedRef.current = false;
  };

  const handleSend = async () => {
    if (!inputValue.trim() || loading) return;

    const userMessage = inputValue.trim();
    setInputValue("");

    // Add user message to UI immediately
    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      message: userMessage,
      role: "user",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    setLoading(true);
    try {
      const response = await chatWithAI(userMessage, true, i18n.language);
      if (response.data.success) {
        const aiMessage: ChatMessage = {
          id: Date.now() + 1,
          message: response.data.data.message,
          role: "assistant",
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, aiMessage]);

        // If transaction was created (message starts with ✅), trigger refresh
        if (response.data.data.message.startsWith("✅") && onTransactionCreated) {
          onTransactionCreated();
        }
      }
    } catch (error: unknown) {
      const apiError = error as ApiErrorResponse;
      message.error(apiError.response?.data?.error || "Failed to send message");
      // Remove the temporary user message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating AI Button - Redesigned */}
      <button className="ai-chat-fab" onClick={() => setOpen(true)} aria-label="Open AI Assistant">
        <ThunderboltOutlined className="ai-chat-fab-icon" />
        <span className="ai-chat-fab-label">AI</span>
      </button>

      {/* Chat Drawer */}
      <Drawer
        title={
          <Space>
            <ThunderboltOutlined style={{ color: "#ff6b3d" }} />
            <span>{t("ai.chatTitle", "AI Assistant")}</span>
          </Space>
        }
        placement="right"
        onClose={() => {
          setOpen(false);
          setInputValue("");
        }}
        open={open}
        size={440}
        closeIcon={<CloseOutlined />}
        extra={
          <Button size="small" onClick={clearChat} style={{ borderRadius: "8px" }}>
            {t("ai.clearChat", "Clear")}
          </Button>
        }
      >
        {/* Messages Area */}
        <div className="ai-chat-messages">
          {loadingHistory ? (
            <div className="ai-chat-loading">
              <Spin />
            </div>
          ) : messages.length === 0 ? (
            <div className="ai-chat-empty">
              <div className="ai-chat-empty-icon">
                <ThunderboltOutlined />
              </div>
              <h3>{t("ai.startConversation", "Start a conversation!")}</h3>
              <p>{t("ai.chatTip", 'Ask questions or add transactions like: "I spent 50 dollars on groceries"')}</p>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div key={msg.id} className={`ai-chat-message ${msg.role}`}>
                  <div className="ai-chat-message-content">
                    <div className={`ai-chat-avatar ${msg.role}`}>{msg.role === "assistant" ? <ThunderboltOutlined /> : "U"}</div>
                    <div className="ai-chat-bubble">{msg.message}</div>
                  </div>
                </div>
              ))}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="ai-chat-input-area">
          <div className="ai-chat-input-wrapper">
            <TextArea value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyPress} placeholder={t("ai.inputPlaceholder", "Ask me anything about your finances...")} autoSize={{ minRows: 1, maxRows: 4 }} disabled={loading} bordered={false} />
            <button className="ai-chat-send-btn" onClick={handleSend} disabled={loading || !inputValue.trim()}>
              {loading ? <Spin /> : <SendOutlined />}
            </button>
          </div>
        </div>
      </Drawer>
    </>
  );
}
