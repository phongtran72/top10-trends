import { ImageResponse } from "next/og";
import { SITE_NAME, siteUrl } from "@/lib/site-url";

// Share images (task 4.2): one layout for the home page and topic pages,
// drawn with next/og. Only flexbox and inline styles work there.

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const COLORS = { background: "#0e0e11", foreground: "#ececf0", muted: "#a0a0ab", accent: "#7ea2ff", border: "#2a2a31" };

export interface OgCard {
  kicker: string; // small line above the title
  title: string;
  lines: { marker?: string; text: string }[]; // up to five rows under the title
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function ogImage(card: OgCard): ImageResponse {
  const title = clip(card.title, 70);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 64px",
          background: COLORS.background,
          color: COLORS.foreground,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: COLORS.accent }}>{card.kicker}</div>
          <div style={{ display: "flex", marginTop: 14, fontSize: title.length > 36 ? 58 : 72, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1.5 }}>
            {title}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
            {card.lines.slice(0, 5).map((line, index) => (
              <div key={index} style={{ display: "flex", alignItems: "baseline", marginTop: 10, fontSize: 34, lineHeight: 1.25 }}>
                {line.marker ? <div style={{ display: "flex", width: 56, color: COLORS.muted }}>{line.marker}</div> : null}
                {/* A numbered row stays on one line; a sentence may wrap onto a second. */}
                <div style={{ display: "flex", flex: 1 }}>{clip(line.text, line.marker ? 52 : 118)}</div>
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            paddingTop: 20,
            borderTop: `2px solid ${COLORS.border}`,
            fontSize: 26,
            color: COLORS.muted,
          }}
        >
          <div style={{ display: "flex", fontWeight: 600, color: COLORS.foreground }}>{SITE_NAME}</div>
          <div style={{ display: "flex" }}>{siteUrl().replace(/^https?:\/\//, "")}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
