import AppRoutes from "./routes/AppRoutes";
import ErrorBoundary from "./components/layout/ErrorBoundary";
import AppShell from "./components/layout/AppShell";
import "./styles/workspace.css";
import "./styles/adminEmployees.css";

function App() {
  return (
    <ErrorBoundary>
      <AppShell><AppRoutes /></AppShell>
    </ErrorBoundary>
  );
}

export default App;
