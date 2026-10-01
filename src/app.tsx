import { createRouter } from "@solidjs/router";
import { lazy } from "solid-js";
import { Title } from "@solidjs/meta";
import { SessionProvider } from "./client/session";
import Dashboard from "./routes/dashboard";
import SignIn from "./routes/signin";
import WorldPage from "./routes/world";
import WorldSettings from "./routes/world-settings";

// Design lab for comparing art directions; lazy so its fonts stay out of the app bundle.
const SheetLab = lazy(() => import("./routes/sheet-lab"));
const Legal = lazy(() => import("./routes/legal"));
const SystemsLab = lazy(() => import("./routes/systems-lab"));
import { ThemeProvider, useTheme } from "./theme/theme-context";

const Router = createRouter({
  routes: [
    { path: "/", component: SignIn },
    { path: "/dashboard", component: Dashboard },
    { path: "/legal", component: Legal },
    // One route for the table and its compendium page, so switching keeps the connection.
    {
      path: "/worlds/:id/:view?",
      component: WorldPage,
      matchFilters: { view: ["compendium"] },
    },
    { path: "/worlds/:id/settings", component: WorldSettings },
    { path: "/lab/sheets", component: SheetLab },
    { path: "/lab/systems", component: SystemsLab },
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
