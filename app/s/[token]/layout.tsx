import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { APP_NAME } from "@/lib/app-info";
import { getWorkspace, linkAccess } from "@/lib/workspace";
import { todayInJakarta } from "@/components/shell/programme-calendar";
import { WorkspaceShell, WorkspaceShellLoading } from "@/components/shell/WorkspaceShell";
import { InvalidLinkScreen, WorkspaceUnavailableScreen } from "@/components/shell/AccessScreens";

/*
 * The token in the URL is a bearer credential: proxy.ts sends no-referrer and noindex
 * headers on every /s/* response, and this metadata repeats both as <meta> tags.
 */
export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

export default function WorkspaceLayout({ children, params }: LayoutProps<"/s/[token]">) {
  return (
    <Suspense fallback={<WorkspaceShellLoading />}>
      <WorkspaceGate params={params}>{children}</WorkspaceGate>
    </Suspense>
  );
}

async function WorkspaceGate({
  params,
  children,
}: {
  params: LayoutProps<"/s/[token]">["params"];
  children: ReactNode;
}) {
  const { token } = await params;
  const result = await getWorkspace(token);

  if (!result.ok && result.reason === "invalid-link") return <InvalidLinkScreen />;
  if (!result.ok) return <WorkspaceUnavailableScreen />;

  return (
    <WorkspaceShell access={linkAccess(token)} workspace={result.workspace} today={todayInJakarta()}>
      {children}
    </WorkspaceShell>
  );
}
