import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// robots.txt (task 4.2): everything may be crawled except the API route.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
