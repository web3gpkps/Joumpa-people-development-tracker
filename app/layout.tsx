import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-info";
import "./globals.css";

// Plus Jakarta Sans (DESIGN.md Typography), weights 400 and 600 only: two weights force
// hierarchy through size and colour, and the face has tabular figures for every number.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  applicationName: APP_NAME,
  description: APP_TAGLINE,
  // Internal tool: nothing here should appear in search results.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#0f6b4a",
  // Lets the phone bottom bar pad itself with env(safe-area-inset-bottom).
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
