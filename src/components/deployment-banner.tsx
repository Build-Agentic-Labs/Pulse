import { deploymentBannerText } from "@/domain/deployment/canonical-host";
import "./deployment-banner.css";

/**
 * Server component: on Vercel preview deployments, say plainly that email
 * features are off here. Renders nothing in production and local development.
 */
export function DeploymentBanner() {
  const text = deploymentBannerText(process.env.VERCEL_ENV, process.env.NEXT_PUBLIC_SITE_URL);
  if (!text) return null;
  return (
    <div className="deployment-banner" role="status">
      {text}
    </div>
  );
}
