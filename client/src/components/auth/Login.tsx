import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flex, Card, TextField, Button, Text, Heading, Link as RadixLink } from "@radix-ui/themes";
import { EnvelopeClosedIcon, LockClosedIcon, BarChartIcon } from "@radix-ui/react-icons";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../contexts/authContext";
import { useToast } from "../ui/toastContext";
import LanguageSwitcher from "../ui/LanguageSwitcher";
import "./Auth.css";

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("login.error"));
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
            <Heading size="5">{t("login.title")}</Heading>
            <Text size="2" color="gray">{t("login.subtitle")}</Text>
          </Flex>

          {/* A real form: before this the fields had no name, no type="email", no
              autocomplete and took their accessible name from the placeholder. */}
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            <label className="sr-only" htmlFor="login-email">
              {t("login.emailPlaceholder")}
            </label>
            <TextField.Root
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              size="3"
              placeholder={t("login.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            >
              <TextField.Slot><EnvelopeClosedIcon /></TextField.Slot>
            </TextField.Root>

            <label className="sr-only" htmlFor="login-password">
              {t("login.passwordPlaceholder")}
            </label>
            <TextField.Root
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              size="3"
              placeholder={t("login.passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            >
              <TextField.Slot><LockClosedIcon /></TextField.Slot>
            </TextField.Root>

            <Button type="submit" size="3" className="auth-primary-button" disabled={loading || !email || !password}>
              {loading ? t("common.loading") : t("login.button")}
            </Button>
          </form>

          <Text size="2" align="center" color="gray">
            {t("login.noAccount")}{" "}
            <RadixLink asChild className="auth-link">
              <Link to="/register">{t("login.registerLink")}</Link>
            </RadixLink>
          </Text>
        </Flex>
      </Card>
      </main>
    </Flex>
  );
};
