import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { WorkspaceProvider } from "./lib/WorkspaceContext";
import "./index.css";

class BootstrapErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 32, fontFamily: "monospace", color: "#ff6b6b", background: "#10141b", minHeight: "100vh" }}>
        <h1>Vantage failed to start</h1>
        <pre style={{ whiteSpace: "pre-wrap", color: "#f5f7fa" }}>{this.state.error.stack ?? this.state.error.message}</pre>
      </div>
    );
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("missing root");
createRoot(root).render(
  <React.StrictMode>
    <BootstrapErrorBoundary>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </BootstrapErrorBoundary>
  </React.StrictMode>,
);
