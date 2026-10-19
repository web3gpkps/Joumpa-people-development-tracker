import { redirect } from "next/navigation";

// "/" has no public page: proxy.ts redirects it to /admin, and this is the fallback.
export default function RootPage() {
  redirect("/admin");
}
