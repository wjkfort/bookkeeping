import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flex, Card, TextField, Button, Text, Heading, Link as RadixLink } from "@radix-ui/themes";
import { EnvelopeClosedIcon, LockClosedIcon } from "@radix-ui/react-icons";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../ui/Toast";

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
    <Flex justify="center" align="center" style={{ minHeight: "80vh" }}>
      <Card size="3" style={{ width: 400 }}>
        <Flex direction="column" gap="4" p="4">
          <Flex direction="column" gap="1" align="center" mb="4">
            <Heading size="6">{t("login.title")}</Heading>
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
            {loading ? "..." : t("login.button")}
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
