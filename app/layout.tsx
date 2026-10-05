import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Top 10 Social Trends", template: "%s · Top 10 Social Trends" },
  description:
    "The top 10 trending topics on each social platform, plus one combined list, refreshed every hour.",
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
