import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import { ToastProvider } from "./components/ui/Toast";
import App from "./App.tsx";
import { AuthProvider } from "./contexts/AuthContext.tsx";
import "./i18n";
import "@radix-ui/themes/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Theme accentColor="indigo" grayColor="auto" radius="full" panelBackground="translucent">
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </Theme>
  </StrictMode>,
);
