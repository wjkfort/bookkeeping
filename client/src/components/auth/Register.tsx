import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flex, Card, TextField, Button, Text, Heading, Link as RadixLink } from "@radix-ui/themes";
import { EnvelopeClosedIcon, LockClosedIcon, PersonIcon } from "@radix-ui/react-icons";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../ui/Toast";
import LanguageSwitcher from "../ui/LanguageSwitcher";

export const Register: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { register } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!username || !email || !password) return;
    if (password !== confirmPassword) {
      toast.error(t("register.passwordMismatch"));
      return;
    }
    if (password.length < 6) {
      toast.error(t("register.passwordMin"));
      return;
    }
    setLoading(true);
    try {
      await register(email, password, username);
      toast.success(t("register.success"));
      navigate("/");
    } catch (err: any) {
      toast.error(err.message || t("register.error"));
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
            <Heading size="5">{t("register.title")}</Heading>
            <Text size="2" color="gray">{t("register.subtitle")}</Text>
          </Flex>

          <TextField.Root size="3" placeholder={t("register.usernamePlaceholder")} value={username} onChange={(e) => setUsername(e.target.value)}>
            <TextField.Slot><PersonIcon /></TextField.Slot>
          </TextField.Root>

          <TextField.Root size="3" placeholder={t("register.emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)}>
            <TextField.Slot><EnvelopeClosedIcon /></TextField.Slot>
          </TextField.Root>

          <TextField.Root size="3" type="password" placeholder={t("register.passwordPlaceholder")} value={password} onChange={(e) => setPassword(e.target.value)}>
            <TextField.Slot><LockClosedIcon /></TextField.Slot>
          </TextField.Root>

          <TextField.Root size="3" type="password" placeholder={t("register.confirmPasswordPlaceholder")} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}>
            <TextField.Slot><LockClosedIcon /></TextField.Slot>
          </TextField.Root>

          <Button size="3" onClick={handleSubmit} disabled={loading || !username || !email || !password}>
            {loading ? t("common.loading") : t("register.button")}
          </Button>

          <Text size="2" align="center" color="gray">
            {t("register.hasAccount")}{" "}
            <RadixLink asChild>
              <Link to="/login">{t("register.loginLink")}</Link>
            </RadixLink>
          </Text>
        </Flex>
      </Card>
    </Flex>
  );
};
