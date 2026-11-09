import { Component } from "react";

// React error boundaries must be class components — there is no hooks
// equivalent for getDerivedStateFromError/componentDidCatch. This is the
// last line of defense so an uncaught render error shows a small recovery
// screen instead of silently blanking the whole app.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Unhandled UI error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            minHeight: "60vh",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Something went wrong</h1>
          <p style={{ margin: 0, color: "var(--text-secondary)", maxWidth: "32rem" }}>
            An unexpected error occurred while rendering this page. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              marginTop: "0.5rem",
              padding: "0.6rem 1.4rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "var(--primary)",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
