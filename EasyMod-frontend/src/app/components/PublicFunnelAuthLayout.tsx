import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildMarketingUrlWithLocale } from "@/app/lib/config";
import BrandLogo from "./BrandLogo";
import LanguageToggle from "./LanguageToggle";
import { PublicFunnelFooter } from "./PublicFunnelChrome";

type PublicFunnelAuthLayoutProps = {
  mode: "signin" | "signup";
  title: string;
  description: string;
  panelTitle: string;
  panelBody: string;
  children: ReactNode;
  panelContent?: ReactNode;
};

export function PublicFunnelAuthLayout({
  mode,
  title,
  description,
  panelTitle,
  panelBody,
  children,
  panelContent,
}: PublicFunnelAuthLayoutProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  const onSignIn = mode === "signin";

  return (
    <div className="funnel-page auth-v6-page">
      <header className="auth-v6-header">
        <a href={buildMarketingUrlWithLocale("/", locale)} aria-label={t("publicFunnel.nav.backToSite")} className="auth-v6-logo-link">
          <BrandLogo size="sm" variant="dark" />
        </a>
        <div className="auth-v6-header-actions">
          <LanguageToggle variant="public" />
          <p>{onSignIn ? t("publicFunnel.auth.noAccount") : t("publicFunnel.auth.haveAccount")}</p>
          <Link to={onSignIn ? "/signup" : "/signin"} className="auth-v6-switch-link">
            {onSignIn ? t("publicFunnel.auth.createAccount") : t("publicFunnel.nav.signIn")}
          </Link>
        </div>
      </header>

      <main className={`auth-v6-main auth-v6-main-${mode}`}>
        <div className="auth-v6-shell">
          <aside className="auth-v6-brand-panel" aria-label="EasyModerator">
            <p className="auth-v6-panel-kicker">EasyModerator <span aria-hidden="true">/</span> {t("publicFunnel.auth.panelKicker")}</p>
            <h2>{panelTitle}</h2>
            <p className="auth-v6-panel-copy">{panelBody}</p>
            {panelContent}
            <div className="auth-v6-panel-footer">
              <span aria-hidden="true" />
              <p>{t("publicFunnel.landingV6.founderPromise")}</p>
            </div>
          </aside>

          <section className="auth-v6-form-column" aria-labelledby="public-auth-title">
            <p className="auth-v6-form-kicker">{onSignIn ? t("publicFunnel.auth.signInKicker") : t("publicFunnel.auth.signUpKicker")}</p>
            <h1 id="public-auth-title">{title}</h1>
            <p className="auth-v6-form-description">{description}</p>
            {children}
          </section>
        </div>
      </main>
      <PublicFunnelFooter />
    </div>
  );
}
