import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import BrandLogo from "./BrandLogo";
import LanguageToggle from "./LanguageToggle";
import { buildAppUrlWithLocale, buildMarketingUrlWithLocale } from "@/app/lib/config";

type PublicPage = "landing" | "pricing";

export function PublicFunnelHeader({ page }: { page: PublicPage }) {
  const { t, i18n } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const locale = i18n.resolvedLanguage || i18n.language;
  const workflowHref = page === "landing"
    ? "#workflow"
    : buildMarketingUrlWithLocale("/#workflow", locale);
  const solutionsHref = page === "landing"
    ? "#capabilities"
    : buildMarketingUrlWithLocale("/#capabilities", locale);
  const plansHref = page === "landing" ? "#plans" : buildMarketingUrlWithLocale("/pricing", locale);

  useEffect(() => {
    if (!menuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuToggleRef.current?.focus();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  return (
    <header className="funnel-header sticky top-0 z-40 border-b border-[#17223B]/10 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <a href={buildMarketingUrlWithLocale("/", locale)} aria-label={t("publicFunnel.nav.backToSite")} className="shrink-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#7460D9]">
          <BrandLogo size="sm" variant="dark" />
        </a>

        <nav aria-label={t("publicFunnel.nav.primary")} className="hidden items-center gap-5 lg:flex">
          <a href={solutionsHref} className="funnel-nav-link">{t("publicFunnel.nav.solutions")}</a>
          <a href={workflowHref} className="funnel-nav-link">{t("publicFunnel.nav.workflow")}</a>
          <a href={plansHref} aria-current={page === "pricing" ? "page" : undefined} className="funnel-nav-link">{t("publicFunnel.nav.plans")}</a>
          <LanguageToggle variant="public" />
          <a href={buildAppUrlWithLocale("/signin", locale)} className="funnel-nav-link">{t("publicFunnel.nav.signIn")}</a>
          <a href={buildAppUrlWithLocale("/signup", locale)} className="funnel-button funnel-button-primary px-4 py-2.5 text-sm">
            {t("publicFunnel.nav.createAccount")}
          </a>
        </nav>

        <button
          ref={menuToggleRef}
          type="button"
          className="funnel-menu-toggle lg:hidden"
          aria-label={t(menuOpen ? "publicFunnel.nav.closeNavigation" : "publicFunnel.nav.openNavigation")}
          aria-controls="public-funnel-navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
        </button>
      </div>

      {menuOpen && (
        <nav id="public-funnel-navigation" aria-label={t("publicFunnel.nav.primary")} className="grid gap-1 border-t border-[#17223B]/10 bg-white px-4 py-3 lg:hidden">
          <a href={solutionsHref} onClick={() => setMenuOpen(false)} className="funnel-mobile-link">{t("publicFunnel.nav.solutions")}</a>
          <a href={workflowHref} onClick={() => setMenuOpen(false)} className="funnel-mobile-link">{t("publicFunnel.nav.workflow")}</a>
          <a href={plansHref} onClick={() => setMenuOpen(false)} className="funnel-mobile-link">{t("publicFunnel.nav.plans")}</a>
          <a href={buildAppUrlWithLocale("/signin", locale)} className="funnel-mobile-link">{t("publicFunnel.nav.signIn")}</a>
          <a href={buildAppUrlWithLocale("/signup", locale)} className="funnel-button funnel-button-primary mt-2 justify-center px-4 py-2.5 text-sm">
            {t("publicFunnel.nav.createAccount")}
          </a>
          <div className="mt-2"><LanguageToggle variant="public" /></div>
        </nav>
      )}
    </header>
  );
}

export function PublicFunnelFooter() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  return (
    <footer className="border-t border-[#17223B]/10 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-sm text-[#17223B]/70 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>{t("publicFunnel.footer.copyright")}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <a href={buildMarketingUrlWithLocale("/privacy-policy", locale)} className="funnel-quiet-link">{t("publicFunnel.footer.privacy")}</a>
          <a href={buildMarketingUrlWithLocale("/terms", locale)} className="funnel-quiet-link">{t("publicFunnel.footer.terms")}</a>
          <a href={buildAppUrlWithLocale("/signin", locale)} className="funnel-quiet-link">{t("publicFunnel.nav.signIn")}</a>
        </div>
      </div>
    </footer>
  );
}
