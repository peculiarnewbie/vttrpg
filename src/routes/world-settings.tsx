import { useNavigate, useParams } from "@solidjs/router";
import { For, Show, createSignal, onSettled } from "solid-js";
import { api, ApiError, type WorldBootstrap } from "../client/api";
import { useSession } from "../client/session";
import { BuilderPanel } from "../components/builder";
import { MembersPanel } from "../components/members";
import { styles } from "../components/styles.stylex";
import { Button, ErrorBanner, Spinner, TopBar } from "../components/ui";
import type { SheetTemplate, WorldMember } from "../domain/schemas";
import { sx } from "../theme/sx";

type Section = "members" | "templates";

const sections: { id: Section; label: string }[] = [
  { id: "members", label: "Members" },
  { id: "templates", label: "Sheet templates" },
];

/** DM-only setup that doesn't belong in the in-session tools panel. */
export default function WorldSettings() {
  const params = useParams<{ id: string }>();
  const session = useSession();
  const navigate = useNavigate();
  const [boot, setBoot] = createSignal<WorldBootstrap | null>(null);
  const [members, setMembers] = createSignal<WorldMember[]>([]);
  const [templates, setTemplates] = createSignal<SheetTemplate[]>([]);
  const [section, setSection] = createSignal<Section>("members");
  const [error, setError] = createSignal("");
  const backToTable = () => navigate(`/worlds/${params.id}`);

  onSettled(() => {
    void (async () => {
      const started = Date.now();
      while (session.loading() && Date.now() - started < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      if (!session.user()) {
        navigate("/", { replace: true });
        return;
      }
      try {
        const bootstrap = await api.bootstrapWorld(params.id);
        if (bootstrap.member.role !== "dm") {
          navigate(`/worlds/${params.id}`, { replace: true });
          return;
        }
        setBoot(bootstrap);
        setMembers(bootstrap.members);
        setTemplates(bootstrap.templates);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load world");
      }
    })();
  });

  return (
    <div {...sx(styles.app)}>
      <TopBar>
        <Button variant="ghost" small onClick={backToTable}>
          ← Back to the table
        </Button>
      </TopBar>
      <ErrorBanner message={error()} />
      <Show
        when={boot()}
        fallback={
          <div {...sx(styles.center)}>
            <Spinner label="Loading settings..." />
          </div>
        }
      >
        {(world) => (
          <main {...sx(styles.settingsPage)}>
            <h1 {...sx(styles.h2)}>{world().world.name} settings</h1>
            <div {...sx(styles.tabBar)} role="tablist" aria-label="Settings sections">
              <For each={sections}>
                {(item) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={section() === item.id ? "true" : "false"}
                    {...sx(styles.tab, section() === item.id && styles.tabActive)}
                    onClick={() => setSection(item.id)}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
            <Show when={section() === "members"}>
              <MembersPanel
                worldId={params.id}
                me={world().member}
                members={members()}
                onMembers={setMembers}
              />
            </Show>
            <Show when={section() === "templates"}>
              <BuilderPanel
                worldId={params.id}
                templates={templates()}
                onTemplates={setTemplates}
              />
            </Show>
          </main>
        )}
      </Show>
    </div>
  );
}
