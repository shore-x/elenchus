import React, { Component } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Diagnostic: check if preload injected electronAPI
console.log("[main.tsx] window.electronAPI available:", !!window.electronAPI);
if (window.electronAPI) {
  console.log("[main.tsx] electronAPI methods:", Object.keys(window.electronAPI));
}

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message + "\n" + error.stack };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, fontFamily: "monospace", whiteSpace: "pre-wrap", color: "red" }}>
          <h2>Renderer Error</h2>
          <div>{this.state.error}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
