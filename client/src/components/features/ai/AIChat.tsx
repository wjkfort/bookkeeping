import { useState, useEffect, useRef } from "react";
import { Drawer, Button, Input, List, Avatar, Space, Spin, message } from "antd";
import { RobotOutlined, SendOutlined, CloseOutlined } from "@ant-design/icons";
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
      {/* Floating AI Button */}
      <Button
        type="primary"
        shape="circle"
        size="large"
        icon={<RobotOutlined />}
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 60,
          height: 60,
          fontSize: 24,
          zIndex: 1000,
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        }}
      />

      {/* Chat Drawer */}
      <Drawer
        title={
          <Space>
            <RobotOutlined />
            <span>{t("ai.chatTitle", "AI Assistant")}</span>
          </Space>
        }
        placement="right"
        onClose={() => {
          setOpen(false);
          setInputValue(""); // Clear input when closing
        }}
        open={open}
        size={400}
        closeIcon={<CloseOutlined />}
        extra={
          <Button size="small" onClick={clearChat}>
            {t("ai.clearChat", "Clear")}
          </Button>
        }
        styles={{
          body: { padding: 0, display: "flex", flexDirection: "column", height: "100%" },
        }}
      >
        {/* Messages Area */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            backgroundColor: "#f5f5f5",
          }}
        >
          {loadingHistory ? (
            <div style={{ textAlign: "center", padding: "20px" }}>
              <Spin />
            </div>
          ) : messages.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px", color: "#999" }}>
              <p>{t("ai.startConversation", "Start a conversation with your AI assistant!")}</p>
              <p style={{ fontSize: "12px", marginTop: "8px" }}>{t("ai.chatTip", 'You can ask questions or tell me to add transactions like: "I spent 50 dollars on groceries"')}</p>
            </div>
          ) : (
            <List
              dataSource={messages}
              renderItem={(msg) => (
                <div
                  key={msg.id}
                  style={{
                    marginBottom: 12,
                    display: "flex",
                    justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "80%",
                      display: "flex",
                      flexDirection: msg.role === "user" ? "row-reverse" : "row",
                      gap: 8,
                    }}
                  >
                    <Avatar
                      icon={msg.role === "assistant" ? <RobotOutlined /> : undefined}
                      style={{
                        backgroundColor: msg.role === "assistant" ? "#1890ff" : "#52c41a",
                        flexShrink: 0,
                      }}
                    >
                      {msg.role === "user" ? "U" : ""}
                    </Avatar>
                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        backgroundColor: msg.role === "user" ? "#1890ff" : "#fff",
                        color: msg.role === "user" ? "#fff" : "#000",
                        wordBreak: "break-word",
                      }}
                    >
                      {msg.message}
                    </div>
                  </div>
                </div>
              )}
            />
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div
          style={{
            padding: "16px",
            borderTop: "1px solid #f0f0f0",
            backgroundColor: "#fff",
          }}
        >
          <Space.Compact style={{ width: "100%" }}>
            <TextArea value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyPress} placeholder={t("ai.inputPlaceholder", "Ask me anything about your finances...")} autoSize={{ minRows: 1, maxRows: 4 }} disabled={loading} />
            <Button type="primary" icon={<SendOutlined />} onClick={handleSend} loading={loading} disabled={!inputValue.trim()} />
          </Space.Compact>
        </div>
      </Drawer>
    </>
  );
}
