import { Toaster } from "sonner";

import { AllyThemeProvider } from "@ally-ui-mono/ui-shared";
import { LogViewer } from "@components/log-viewer";
import { useColorMode } from "@hooks/useColorMode";
import { RouteLayout } from "@routes/RouteLayout";

export function App() {
  const { isDark } = useColorMode();
  const toastOptions = {
    style: {
      transform: "translateZ(0)",
      willChange: "transform",
    },
  };
  return (
    // Single centralised Carbon design-system boundary (serif), shared by every
    // app via @ally-ui-mono/ui-shared. "White" by default; "Gray 100" while the
    // sidebar switch has dark mode on (see hooks/useColorMode).
    <AllyThemeProvider theme={isDark ? "g100" : "white"}>
      <RouteLayout />
      {import.meta.env.VITE_SHOW_LOG_TERMINAL === "true" && <LogViewer />}
      <Toaster
        position="bottom-right"
        theme={isDark ? "dark" : "light"}
        richColors
        toastOptions={toastOptions}
        style={toastOptions.style}
      />
    </AllyThemeProvider>
  );
}

export default App;
