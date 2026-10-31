import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowRight, Check, CircleHelp, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buildAppUrlWithLocale } from "@/app/lib/config";

export function LandingHero() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;

  return (
    <section className="landing-v6-hero">
      <div className="landing-v6-hero-inner">
        <div className="landing-v6-hero-copy">
          <p className="landing-v6-eyebrow landing-v6-eyebrow-light">{t("publicFunnel.landingV6.heroEyebrow")}</p>
          <h1>{t("publicFunnel.landingV6.heroTitle")}</h1>
          <p className="landing-v6-hero-body">{t("publicFunnel.landingV6.heroBody")}</p>
          <div className="landing-v6-actions">
            <a className="funnel-button funnel-button-primary landing-v6-primary-action" href={buildAppUrlWithLocale("/signup", locale)}>
              {t("publicFunnel.landingV6.primaryCta")} <ArrowRight aria-hidden="true" size={18} />
            </a>
            <a className="landing-v6-secondary-action" href="#workflow">
              {t("publicFunnel.landingV6.secondaryCta")} <ArrowDownRight aria-hidden="true" size={17} />
            </a>
          </div>
          <p className="landing-v6-hero-note">{t("publicFunnel.landing.signupNote")}</p>
        </div>

        <figure className="landing-v6-product-figure" aria-label={t("publicFunnel.landingV6.sampleLabel")}>
          <div className="landing-v6-product-window">
            <div className="landing-v6-product-topbar">
              <div className="landing-v6-window-dots" aria-hidden="true"><span /><span /><span /></div>
              <p>EasyModerator <span>·</span> {t("publicFunnel.landingV6.sampleInbox")}</p>
              <span className="landing-v6-channel-tag">Facebook Messenger</span>
            </div>
            <div className="landing-v6-product-content">
              <div className="landing-v6-conversation">
                <p className="landing-v6-ui-label">{t("publicFunnel.landingV6.sampleConversationTitle")}</p>
                <div className="landing-v6-message landing-v6-message-customer">
                  <span className="landing-v6-message-mark" aria-hidden="true">M</span>
                  <p>{t("publicFunnel.landingV6.sampleCustomerMessage")}</p>
                </div>
                <div className="landing-v6-product-context">
                  <span className="landing-v6-context-icon" aria-hidden="true">E</span>
                  <div><strong>{t("publicFunnel.landingV6.contextLabel")}</strong><span>{t("publicFunnel.landingV6.contextBody")}</span></div>
                  <Check size={17} aria-hidden="true" />
                </div>
                <div className="landing-v6-reply-draft">
                  <div className="landing-v6-draft-heading"><span>{t("publicFunnel.landingV6.replyDraftLabel")}</span><strong>{t("publicFunnel.landingV6.draftStatus")}</strong></div>
                  <p>{t("publicFunnel.landingV6.draftBody")}</p>
                  <div className="landing-v6-draft-actions"><span>{t("publicFunnel.landingV6.reviewAction")}</span><span>{t("publicFunnel.landingV6.notSent")}</span></div>
                </div>
              </div>
              <div className="landing-v6-order-review">
                <p className="landing-v6-ui-label">{t("publicFunnel.landingV6.orderReviewLabel")}</p>
                <div className="landing-v6-order-state"><span className="landing-v6-state-mark"><CircleHelp size={18} aria-hidden="true" /></span><strong>{t("publicFunnel.landingV6.orderReviewStatus")}</strong></div>
                <p>{t("publicFunnel.landingV6.orderReviewBody")}</p>
                <div className="landing-v6-order-rule"><span aria-hidden="true" /><span>{t("publicFunnel.landingV6.orderNotConfirmed")}</span></div>
              </div>
            </div>
          </div>
          <figcaption>{t("publicFunnel.landingV6.illustrationCaption")}</figcaption>
        </figure>
      </div>
      <div className="landing-v6-brand-promise"><span aria-hidden="true" />{t("publicFunnel.landingV6.founderPromise")}</div>
    </section>
  );
}

export function CoreCapabilities() {
  const { t } = useTranslation();
  const capabilities = ["support", "replies", "orders"] as const;

  return (
    <section id="capabilities" aria-labelledby="capabilities-title" className="landing-v6-capabilities">
      <div className="landing-v6-section-heading">
        <p className="landing-v6-eyebrow">{t("publicFunnel.landingV6.capabilityEyebrow")}</p>
        <h2 id="capabilities-title">{t("publicFunnel.landingV6.capabilityTitle")}</h2>
        <p>{t("publicFunnel.landingV6.capabilityBody")}</p>
      </div>
      <div className="landing-v6-capability-grid">
        {capabilities.map((capability, index) => (
          <article key={capability} className="landing-v6-capability">
            <span className="landing-v6-capability-index">0{index + 1}</span>
            <h3>{t(`publicFunnel.landingV6.capabilities.${capability}.title`)}</h3>
            <p>{t(`publicFunnel.landingV6.capabilities.${capability}.body`)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function WorkflowSection() {
  const { t } = useTranslation();
  const steps = ["inquiry", "context", "review"] as const;

  return (
    <section id="workflow" aria-labelledby="workflow-title" className="landing-v6-workflow">
      <div className="landing-v6-workflow-intro">
        <p className="landing-v6-eyebrow landing-v6-eyebrow-light">{t("publicFunnel.landingV6.workflowEyebrow")}</p>
        <h2 id="workflow-title">{t("publicFunnel.landingV6.workflowTitle")}</h2>
        <p>{t("publicFunnel.landingV6.workflowBody")}</p>
      </div>
      <ol className="landing-v6-workflow-steps">
        {steps.map((step, index) => (
          <li key={step}>
            <span className="landing-v6-step-number">0{index + 1}</span>
            <div><h3>{t(`publicFunnel.landingV6.steps.${step}.title`)}</h3><p>{t(`publicFunnel.landingV6.steps.${step}.body`)}</p></div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function StorySection() {
  const { t } = useTranslation();
  const [showVideo, setShowVideo] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduceMotion(preference.matches);
    updatePreference();
    preference.addEventListener?.("change", updatePreference);
    return () => preference.removeEventListener?.("change", updatePreference);
  }, []);

  return (
    <section className="landing-v6-story" aria-labelledby="story-title">
      <div className="landing-v6-story-copy">
        <p className="landing-v6-eyebrow">{t("publicFunnel.landingV6.storyEyebrow")}</p>
        <h2 id="story-title">{t("publicFunnel.landingV6.storyTitle")}</h2>
        <p>{t("publicFunnel.landingV6.storyBody")}</p>
        <details className="landing-v6-transcript">
          <summary>{t("publicFunnel.landingV6.storyTranscript")}</summary>
          <ol>
            <li>{t("publicFunnel.landingV6.steps.inquiry.title")}: {t("publicFunnel.landingV6.steps.inquiry.body")}</li>
            <li>{t("publicFunnel.landingV6.steps.context.title")}: {t("publicFunnel.landingV6.steps.context.body")}</li>
            <li>{t("publicFunnel.landingV6.steps.review.title")}: {t("publicFunnel.landingV6.steps.review.body")}</li>
          </ol>
        </details>
      </div>
      <div className="landing-v6-story-media">
        {showVideo ? (
          <video
            aria-label={t("publicFunnel.landingV6.storyVideoLabel")}
            aria-describedby="landing-v6-story-caption"
            controls
            autoPlay={!reduceMotion}
            muted
            playsInline
            preload="metadata"
            poster="/media/easymoderator-commerce-workflow-v6-poster.png"
          >
            <source src="/media/easymoderator-commerce-workflow-v6.mp4" type="video/mp4" />
          </video>
        ) : (
          <button className="landing-v6-story-poster" type="button" onClick={() => setShowVideo(true)} aria-label={t("publicFunnel.landingV6.storyPlay")}>
            <img src="/media/easymoderator-commerce-workflow-v6-poster.png" alt="" loading="lazy" />
            <span className="landing-v6-play-button"><Play fill="currentColor" size={20} aria-hidden="true" /></span>
            <span className="landing-v6-story-poster-label">{t("publicFunnel.landingV6.storyPlay")}</span>
          </button>
        )}
        <p id="landing-v6-story-caption" className="landing-v6-story-caption">{t("publicFunnel.landingV6.illustrationCaption")}</p>
      </div>
    </section>
  );
}

export function TrustAndFaq() {
  const { t } = useTranslation();
  const faqs = ["channel", "replies", "plans", "separate"] as const;
  return (
    <section className="landing-v6-trust" aria-labelledby="trust-title">
      <div className="landing-v6-trust-intro">
        <p className="landing-v6-eyebrow">{t("publicFunnel.landingV6.trustEyebrow")}</p>
        <h2 id="trust-title">{t("publicFunnel.landingV6.trustTitle")}</h2>
        <p>{t("publicFunnel.landingV6.trustBody")}</p>
        <div className="landing-v6-inclusion-note"><Check size={18} aria-hidden="true" /><span>{t("publicFunnel.landingV6.separateBoundary")}</span></div>
      </div>
      <div className="landing-v6-faq" aria-label={t("publicFunnel.landingV6.faqTitle")}>
        <h3>{t("publicFunnel.landingV6.faqTitle")}</h3>
        {faqs.map((item) => (
          <details key={item}>
            <summary>{t(`publicFunnel.landingV6.faq.${item}.question`)}</summary>
            <p>{t(`publicFunnel.landingV6.faq.${item}.answer`)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function LandingClosing() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  return (
    <section className="landing-v6-closing">
      <p className="landing-v6-eyebrow landing-v6-eyebrow-light">EasyModerator</p>
      <h2>{t("publicFunnel.landingV6.closingTitle")}</h2>
      <p>{t("publicFunnel.landingV6.closingBody")}</p>
      <a className="funnel-button funnel-button-primary landing-v6-primary-action" href={buildAppUrlWithLocale("/signup", locale)}>
        {t("publicFunnel.landingV6.primaryCta")} <ArrowRight aria-hidden="true" size={18} />
      </a>
    </section>
  );
}
