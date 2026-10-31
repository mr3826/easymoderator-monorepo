import { useEffect } from "react";
import { buildAppUrl, buildMarketingUrl } from "@/app/lib/config";

type CanonicalBase = "app" | "marketing";

type SeoProps = {
  title: string;
  description: string;
  canonicalPath: string;
  canonicalBase?: CanonicalBase;
  noIndex?: boolean;
  structuredData?: Record<string, unknown>;
};

function upsertMeta(selector: string, attributes: Record<string, string>, content: string) {
  const matches = document.head.querySelectorAll<HTMLMetaElement>(selector);
  let element = matches[0];
  matches.forEach((duplicate, index) => {
    if (index > 0) duplicate.remove();
  });
  if (!element) {
    element = document.createElement("meta");
    Object.entries(attributes).forEach(([name, value]) => element!.setAttribute(name, value));
    document.head.appendChild(element);
  }
  element.content = content;
}

export default function Seo({ title, description, canonicalPath, canonicalBase = "marketing", noIndex = false, structuredData }: SeoProps) {
  useEffect(() => {
    const canonical = canonicalBase === "app" ? buildAppUrl(canonicalPath) : buildMarketingUrl(canonicalPath);
    document.title = title;
    upsertMeta('meta[name="description"]', { name: "description" }, description);
    upsertMeta('meta[property="og:title"]', { property: "og:title" }, title);
    upsertMeta('meta[property="og:description"]', { property: "og:description" }, description);
    upsertMeta('meta[property="og:url"]', { property: "og:url" }, canonical);
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title" }, title);
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description" }, description);
    upsertMeta('meta[name="robots"]', { name: "robots" }, noIndex ? "noindex,nofollow" : "index,follow");

    const links = document.head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]');
    let link = links[0];
    links.forEach((duplicate, index) => {
      if (index > 0) duplicate.remove();
    });
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonical;

    const scriptId = "easymod-structured-data";
    document.getElementById(scriptId)?.remove();
    if (structuredData) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.type = "application/ld+json";
      script.text = JSON.stringify(structuredData);
      document.head.appendChild(script);
    }
  }, [canonicalBase, canonicalPath, description, noIndex, structuredData, title]);

  return null;
}
