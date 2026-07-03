import {
  HomeRouteShell,
  MobilePhotoRouteShell,
  PlannerRouteShell,
  PlanningRouteShell,
  ProductionRouteShell,
} from "@/components/project-route-shells";

function routeShellForReturnTo(returnTo?: string) {
  // No specific destination -> the company dashboard, same as signing in at /.
  if (!returnTo) {
    return <HomeRouteShell />;
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

  if (pathname === "/planning") {
    return <PlanningRouteShell />;
  }

  if (pathname === "/production") {
    return <ProductionRouteShell />;
  }

  return <HomeRouteShell />;
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
