import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Top 10 Social Trends",
  description:
    "The top 10 trending topics on each social platform, plus one combined list, refreshed every hour.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
