import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flex, Card, TextField, Button, Text, Heading, Link as RadixLink } from "@radix-ui/themes";
import { EnvelopeClosedIcon, LockClosedIcon, PersonIcon, BarChartIcon } from "@radix-ui/react-icons";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../contexts/authContext";
import { useToast } from "../ui/toastContext";
import LanguageSwitcher from "../ui/LanguageSwitcher";
import "./Auth.css";

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("register.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flex asChild direction="column" align="center" justify="center" className="auth-page">
      <main>
      {/* Language switcher — page-level, matches app header position */}
      <Flex justify="end" className="auth-language">
        <LanguageSwitcher />
      </Flex>

      {/* Brand */}
      <Flex align="center" gap="3" mb="6" className="auth-brand-row">
        <span className="brand-mark"><BarChartIcon /></span>
        <Text size="5" weight="medium" className="auth-brand-name">
          {t("nav.title")}
        </Text>
      </Flex>

      <Card size="3" className="auth-form-card">
        <Flex direction="column" gap="4" p="4">
          <Flex direction="column" gap="1" align="center" mb="2" className="auth-form-heading">
            <Heading size="5">{t("register.title")}</Heading>
            <Text size="2" color="gray">{t("register.subtitle")}</Text>
          </Flex>

          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            <label className="sr-only" htmlFor="register-username">
              {t("register.usernamePlaceholder")}
            </label>
            <TextField.Root id="register-username" name="username" autoComplete="username" size="3" placeholder={t("register.usernamePlaceholder")} value={username} onChange={(e) => setUsername(e.target.value)}>
              <TextField.Slot><PersonIcon /></TextField.Slot>
            </TextField.Root>

            <label className="sr-only" htmlFor="register-email">
              {t("register.emailPlaceholder")}
            </label>
            <TextField.Root id="register-email" name="email" type="email" autoComplete="email" size="3" placeholder={t("register.emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)}>
              <TextField.Slot><EnvelopeClosedIcon /></TextField.Slot>
            </TextField.Root>

            <label className="sr-only" htmlFor="register-password">
              {t("register.passwordPlaceholder")}
            </label>
            <TextField.Root id="register-password" name="new-password" type="password" autoComplete="new-password" size="3" placeholder={t("register.passwordPlaceholder")} value={password} onChange={(e) => setPassword(e.target.value)}>
              <TextField.Slot><LockClosedIcon /></TextField.Slot>
            </TextField.Root>

            <label className="sr-only" htmlFor="register-confirm">
              {t("register.confirmPasswordPlaceholder")}
            </label>
            <TextField.Root id="register-confirm" name="confirm-password" type="password" autoComplete="new-password" size="3" placeholder={t("register.confirmPasswordPlaceholder")} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}>
              <TextField.Slot><LockClosedIcon /></TextField.Slot>
            </TextField.Root>

            <Button type="submit" size="3" className="auth-primary-button" disabled={loading || !username || !email || !password}>
              {loading ? t("common.loading") : t("register.button")}
            </Button>
          </form>

          <Text size="2" align="center" color="gray">
            {t("register.hasAccount")}{" "}
            <RadixLink asChild className="auth-link">
              <Link to="/login">{t("register.loginLink")}</Link>
            </RadixLink>
          </Text>
        </Flex>
      </Card>
      </main>
    </Flex>
  );
};
