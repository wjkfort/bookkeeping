import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import { ToastProvider } from "./components/ui/Toast";
import App from "./App.tsx";
import { AuthProvider } from "./contexts/AuthContext.tsx";
import "./i18n";
import "@radix-ui/themes/styles.css";
import "./theme/globalStyles.css";

/**
 * Development-only pet preview at `?petdemo=1`.
 *
 * The pet's clips follow the assistant's real state, which is awkward to force
 * on demand, so this renders the same component with the state as a button.
 * It is imported lazily and only when `import.meta.env.DEV` is true, so neither
 * the demo nor its query-string check reaches a production build.
 */
const petDemo = import.meta.env.DEV && new URLSearchParams(window.location.search).get("petdemo") === "1";

const Demo = petDemo ? (await import("./components/features/pet/PetDemo.tsx")).default : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Theme accentColor="orange" grayColor="sand" radius="medium" panelBackground="solid">
      {Demo ? (
        <Demo />
      ) : (
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      )}
    </Theme>
  </StrictMode>,
);
