import type { Metadata } from "next";
import Link from "next/link";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site-url";
import "./globals.css";

// Titles, descriptions and share cards (task 4.2). `metadataBase` makes the
// share images' and canonical links' URLs absolute; each page adds its own
// title, description and canonical path.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container site-header-inner">
            <Link href="/" className="brand">
              Top 10 Social Trends
            </Link>
            <nav aria-label="Site">
              <Link href="/archive">Archive</Link>
              <Link href="/status">Status</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="container site-footer">
          <p>A personal, non-commercial project. Lists refresh every hour; each links to its source.</p>
        </footer>
      </body>
    </html>
  );
}
