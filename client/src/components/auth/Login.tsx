import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flex, Card, TextField, Button, Text, Heading, Link as RadixLink } from "@radix-ui/themes";
import { EnvelopeClosedIcon, LockClosedIcon } from "@radix-ui/react-icons";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../ui/Toast";
import LanguageSwitcher from "../ui/LanguageSwitcher";

export const Login: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) return;
    setLoading(true);
    try {
      await login(email, password);
      toast.success(t("login.success"));
      navigate("/");
    } catch (err: any) {
      toast.error(err.message || t("login.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, var(--indigo-2) 0%, var(--color-background) 40%)",
      }}
    >
      {/* Language switcher — page-level, matches app header position */}
      <Flex
        justify="end"
        style={{
          position: "absolute",
          top: 16,
          right: 24,
        }}
      >
        <LanguageSwitcher />
      </Flex>

      {/* Brand */}
      <Flex align="center" gap="2" mb="6" style={{ cursor: "default" }}>
        <Text size="6">💰</Text>
        <Heading size="5" style={{ letterSpacing: "-0.02em" }}>
          {t("nav.title")}
        </Heading>
      </Flex>

      <Card size="3" style={{ width: 400 }}>
        <Flex direction="column" gap="4" p="4">
          <Flex direction="column" gap="1" align="center" mb="2">
            <Heading size="5">{t("login.title")}</Heading>
            <Text size="2" color="gray">{t("login.subtitle")}</Text>
          </Flex>

          <TextField.Root
            size="3"
            placeholder={t("login.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          >
            <TextField.Slot><EnvelopeClosedIcon /></TextField.Slot>
          </TextField.Root>

          <TextField.Root
            size="3"
            type="password"
            placeholder={t("login.passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          >
            <TextField.Slot><LockClosedIcon /></TextField.Slot>
          </TextField.Root>

          <Button size="3" onClick={handleSubmit} disabled={loading || !email || !password}>
            {loading ? t("common.loading") : t("login.button")}
          </Button>

          <Text size="2" align="center" color="gray">
            {t("login.noAccount")}{" "}
            <RadixLink asChild>
              <Link to="/register">{t("login.registerLink")}</Link>
            </RadixLink>
          </Text>
        </Flex>
      </Card>
    </Flex>
  );
};
