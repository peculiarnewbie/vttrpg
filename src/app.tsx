import { createRouter } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import { SessionProvider } from "./client/session";
import Dashboard from "./routes/dashboard";
import SignIn from "./routes/signin";
import WorldPage from "./routes/world";
import { ThemeProvider, useTheme } from "./theme/theme-context";

const Router = createRouter({
  routes: [
    { path: "/", component: SignIn },
    { path: "/dashboard", component: Dashboard },
    { path: "/worlds/:id", component: WorldPage },
  ],
});

function Shell() {
  const { rootStyles } = useTheme();
  return (
    <div {...rootStyles()}>
      <SessionProvider>
        <Router>
          {(props) => (
            <>
              <Title>Tabletop</Title>
              {props.children}
            </>
          )}
        </Router>
      </SessionProvider>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}
