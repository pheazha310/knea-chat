import React, { useEffect, useMemo, useState } from "react";
import Icon from "../../../shared/ui/Icon";
import { useToast } from "../../../app/providers/ToastProvider";
import type {
  IntegrationConfig,
  AvailableChannel,
} from "../../../entities/integration";
import { IntegrationModel } from "../../../entities/integration";

interface IntegrationsViewProps {
  userRole: string;
}

type LoadingState = "idle" | "loading" | "saving" | "error";

const BrandMark = ({ icon }: { icon: string }) => {
  const marks: Record<string, React.ReactNode> = {
    email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    telegram: <path d="m3 11 18-7-6.5 16-3.5-6-5-3 12-6-9 8" />,
    website: <><rect x="3" y="4" width="18" height="15" rx="3" /><path d="M3 9h18M8 19l-2 3" /><circle cx="7" cy="6.5" r=".5" fill="currentColor" /><circle cx="10" cy="6.5" r=".5" fill="currentColor" /></>,
    whatsapp: <><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4A8 8 0 1 1 20 11.5Z" /><path d="M9 8.5c.5 2.5 2 4 4.5 5l1-1.2 2 1c-.2 1.5-1.4 2.4-2.8 2.2-3.5-.7-6.5-3.7-7-7.1-.2-1.2.8-2.4 2.1-2.3l1 2Z" /></>,
    facebook: <path d="M14 21v-8h3l.5-3H14V8c0-.9.3-1.5 1.6-1.5H18V3.2c-.8-.1-1.7-.2-2.7-.2-2.8 0-4.7 1.7-4.7 4.9V10H8v3h2.6v8Z" fill="currentColor" stroke="none" />,
    instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.8" r=".8" fill="currentColor" /></>,
    tiktok: <path d="M14 3v11.2a4.2 4.2 0 1 1-3-4V7.1a7 7 0 1 0 6.5 7V9a8 8 0 0 0 3.5 1V6.8A5.5 5.5 0 0 1 16 3Z" fill="currentColor" stroke="none" />,
    line: <><path d="M21 11c0 4.3-4 7.5-9 7.5-.8 0-1.6-.1-2.3-.2L5 21l1-4C4.2 15.7 3 13.5 3 11c0-4.1 4-7.5 9-7.5s9 3.4 9 7.5Z" /><path d="M7 10v4h2m2-4v4m2-4v4m2-4v4" /></>,
    zalo: <><path d="M21 11a8 8 0 0 1-8 8H6l1.5-3A8 8 0 1 1 21 11Z" /><path d="M8 9h4l-4 5h4m2-5v5m2-5v5m0-3h2" /></>,
    vkontakte: <path d="M3 7c.3 5.8 3.2 10 7 10h1v-4c2.1.2 3.1 1.4 4.1 4H19c-.8-2.6-2.1-4.3-4-5.2 1.8-1.1 2.8-2.9 3.2-5.8h-3.4c-.3 2-1.4 3.4-2.8 3.7V7H8.7v6.5C7 12.7 6.2 10.6 6 7Z" fill="currentColor" stroke="none" />,
    youtube: <><rect x="2.5" y="5" width="19" height="14" rx="4" fill="currentColor" stroke="none" /><path d="m10 9 5 3-5 3Z" fill="#2563eb" stroke="none" /></>,
  };
  const mark = marks[icon];
  return mark ? (
    <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{mark}</svg>
  ) : <Icon name="grid" size={21} strokeWidth={1.8} />;
};

const IntegrationsView = ({ userRole }: IntegrationsViewProps) => {
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [available, setAvailable] = useState<AvailableChannel[]>([]);
  const [state, setState] = useState<LoadingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const isAdmin = userRole === "admin" || userRole === "super_admin";

  const load = async () => {
    setState("loading");
    setError(null);
    try {
      const [integrationsRes, availableRes] = await Promise.all([
        IntegrationModel.list(),
        IntegrationModel.listAvailable(),
      ]);
      if (integrationsRes.data.success)
        setIntegrations(integrationsRes.data.data);
      if (availableRes.data.success) setAvailable(availableRes.data.data);
      setState("idle");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const enabledSet = useMemo(
    () => new Set(integrations.filter((i) => i.enabled).map((i) => i.channel)),
    [integrations],
  );

  const handleToggle = async (channel: string, enabled: boolean) => {
    if (!isAdmin) {
      showToast("Only admins can manage integrations", { type: "error" });
      return;
    }

    setState("saving");
    try {
      if (enabled) {
        const res = await IntegrationModel.enable(channel);
        if (res.data.success) {
          showToast(`${channel} enabled`, { type: "success" });
          await load();
        } else {
          showToast(res.data.message || "Failed to enable integration", {
            type: "error",
          });
        }
      } else {
        await IntegrationModel.disable(channel);
        showToast(`${channel} disabled`, { type: "success" });
        await load();
      }
    } catch (e) {
      showToast((e as Error).message, { type: "error" });
    } finally {
      setState("idle");
    }
  };

  const handleHealthCheck = async (channel: string) => {
    try {
      const res = await IntegrationModel.health(channel);
      if (res.data.connected) {
        showToast(`${channel} is connected and healthy`, { type: "success" });
      } else {
        showToast(
          `${channel} connection issue: ${res.data.info ? JSON.stringify(res.data.info) : "not reachable"}`,
          { type: "error" },
        );
      }
    } catch (e) {
      showToast((e as Error).message, { type: "error" });
    }
  };

  const channelsToShow =
    available.length > 0
      ? available
      : IntegrationsView.DEFAULT_CHANNELS.map((ch) => ({
          ...ch,
          // Keep the offline/loading fallback honest: the backend currently
          // registers adapters for these channels only.
          supported: ["email", "telegram", "website"].includes(ch.channel),
          enabled: enabledSet.has(ch.channel),
        }));

  const popularChannels = new Set([
    "whatsapp",
    "telegram",
    "facebook",
    "email",
    "youtube",
    "chat-widget",
  ]);
  // The API may omit icon metadata for some providers. Keep the marketplace
  // visuals complete by using a local icon for every known channel.

  return (
    <div className="view-page integration-marketplace">
      <aside className="integration-sidebar">
        <div className="integration-sidebar-header">Connections</div>
        <nav className="integration-nav">
          <button className="integration-nav-item active" type="button" aria-current="page">
            <Icon name="grid" size={16} />
            Social Media
          </button>
          <button className="integration-nav-item" type="button">
            <Icon name="columns" size={16} />
            Apps
          </button>
        </nav>
      </aside>

      <main className="integration-content">
        <div className="integration-content-header">
          <div className="integration-tab active">Social Media</div>
          {isAdmin && (
            <button
              className="btn-secondary"
              onClick={load}
              disabled={state === "loading" || state === "saving"}
            >
              <Icon name="restore" size={16} /> Refresh
            </button>
          )}
        </div>

        {state === "error" && (
          <div className="error-banner">
            <p>{error}</p>
            <button className="btn-secondary" onClick={load}>
              Retry
            </button>
          </div>
        )}

        <div className="integration-grid">
          {channelsToShow.map((ch) => {
            const integration = integrations.find(
              (i) => i.channel === ch.channel,
            );
            const isEnabled = ch.enabled;
            const isSupported = ch.supported;
            const isSaving = state === "saving";
            const isPopular = popularChannels.has(ch.channel);

            return (
              <div
                key={ch.channel}
                className={`integration-tile ${isEnabled ? "is-active" : ""} ${!isSupported ? "unsupported" : ""}`}
              >
                <div className="integration-card-header">
                  <div className={`integration-logo ${ch.channel}`}>
                    <BrandMark
                      icon={[
                        "email", "telegram", "website", "whatsapp", "facebook",
                        "instagram", "tiktok", "line", "zalo", "vkontakte", "youtube",
                      ].includes(ch.icon) ? ch.icon : ch.channel}
                    />
                  </div>
                  {isPopular && <span className="popular-badge">Popular</span>}
                </div>

                <h3>{ch.label}</h3>
                <p>{ch.description}</p>
                {!isSupported && (
                  <span className="integration-availability">Coming soon</span>
                )}

                <div className="integration-card-actions">
                  {isEnabled && isAdmin && (
                    <button
                      className="integration-mini-button"
                      type="button"
                      onClick={() => handleHealthCheck(ch.channel)}
                      disabled={isSaving}
                    >
                      Check health
                    </button>
                  )}
                  <button
                    className={`integration-action ${isEnabled ? "manage" : ""}`}
                    type="button"
                    onClick={() => {
                      if (!isSupported) return;
                      if (isAdmin) {
                        void handleToggle(ch.channel, !isEnabled);
                      }
                    }}
                    disabled={!isSupported || isSaving}
                  >
                    {isEnabled ? "Manage" : isSupported ? "Add" : "Coming soon"}
                  </button>
                </div>

                {isEnabled && integration?.health?.info && (
                  <details className="integration-details">
                    <summary>Health details</summary>
                    <pre>
                      {JSON.stringify(integration.health.info, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
};

IntegrationsView.DEFAULT_CHANNELS = [
  {
    channel: "email",
    label: "Email",
    description: "Receive and reply to customer emails",
    icon: "email",
  },
  {
    channel: "telegram",
    label: "Telegram",
    description: "Connect a Telegram bot for customer support",
    icon: "telegram",
  },
  {
    channel: "website",
    label: "Website Widget",
    description: "Embed a live chat widget on your website",
    icon: "website",
  },
  {
    channel: "whatsapp",
    label: "WhatsApp",
    description: "Connect WhatsApp Business for messaging",
    icon: "whatsapp",
  },
  {
    channel: "facebook",
    label: "Facebook Messenger",
    description: "Connect Facebook Messenger",
    icon: "facebook",
  },
  {
    channel: "instagram",
    label: "Instagram",
    description: "Connect Instagram DMs",
    icon: "instagram",
  },
  {
    channel: "tiktok",
    label: "TikTok",
    description: "Connect TikTok messages",
    icon: "tiktok",
  },
  {
    channel: "line",
    label: "LINE",
    description: "Connect LINE messaging",
    icon: "line",
  },
  {
    channel: "zalo",
    label: "Zalo",
    description: "Connect Zalo for customer chat",
    icon: "zalo",
  },
  {
    channel: "vkontakte",
    label: "VKontakte",
    description: "Connect VK messaging",
    icon: "vkontakte",
  },
  {
    channel: "youtube",
    label: "YouTube",
    description: "Connect YouTube comments and messages",
    icon: "youtube",
  },
];

export default IntegrationsView;
