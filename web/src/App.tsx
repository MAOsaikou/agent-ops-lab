import { useState } from "react";
import { AgentOpsConsole } from "./components/AgentOpsConsole.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";

export function App(): React.JSX.Element {
  const [resetKey, setResetKey] = useState(0);

  return (
    <ErrorBoundary key={resetKey} onReset={() => setResetKey((k) => k + 1)}>
      <AgentOpsConsole />
    </ErrorBoundary>
  );
}
