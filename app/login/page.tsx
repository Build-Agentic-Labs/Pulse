import { MobilePhotoRouteShell, PlannerRouteShell } from "@/components/project-route-shells";

function routeShellForReturnTo(returnTo?: string) {
  if (!returnTo) {
    return <PlannerRouteShell />;
  }

  let pathname = returnTo;
  try {
    pathname = new URL(returnTo, "https://pulse.local").pathname;
  } catch {
    pathname = returnTo.split("?")[0] ?? returnTo;
  }

  const projectMobileMatch = pathname.match(/^\/projects\/([^/]+)\/mobile-photos\/?$/);
  if (projectMobileMatch?.[1]) {
    return <MobilePhotoRouteShell projectId={decodeURIComponent(projectMobileMatch[1])} />;
  }

  if (pathname === "/mobile-photos") {
    return <MobilePhotoRouteShell />;
  }

  const projectPlannerMatch = pathname.match(/^\/projects\/([^/]+)\/planner\/?$/);
  if (projectPlannerMatch?.[1]) {
    return <PlannerRouteShell projectId={decodeURIComponent(projectPlannerMatch[1])} />;
  }

  return <PlannerRouteShell />;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string; next?: string; redirectTo?: string }>;
}) {
  const params = await searchParams;
  const returnTo = params?.returnTo ?? params?.next ?? params?.redirectTo;

  return routeShellForReturnTo(returnTo);
}
