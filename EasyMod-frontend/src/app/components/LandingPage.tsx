import { useRef, useState, useEffect } from "react";
import { motion, useScroll, useMotionValue, useMotionValueEvent, useInView, animate } from "motion/react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LanguageToggle from "./LanguageToggle";
import BrandLogo from "./BrandLogo";
import { subscriptionPlans } from "@/app/lib/subscriptionPlans";

const gradientText: React.CSSProperties = {
  background: "linear-gradient(135deg, #34D399 0%, #00A651 100%)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
};

const heroContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};
const heroItem = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

function useCountUp(target: number, inView: boolean, duration = 1.8) {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState("0");
  useEffect(() => {
    if (!inView) return;
    const ctrl = animate(mv, target, {
      duration,
      ease: [0.22, 1, 0.36, 1] as any,
      onUpdate: (v: number) => setDisplay(Math.round(v).toString()),
    });
    return ctrl.stop;
  }, [inView, target]);
  return display;
}

function StatCounter({ raw }: { raw: string }) {
  const match = raw.match(/^(\d+)(.*)/);
  if (!match) return <>{raw}</>;
  const [, numStr, suffix] = match;
  const target = parseInt(numStr, 10);
  const statsRef = useRef(null);
  const inView = useInView(statsRef, { once: true });
  const count = useCountUp(target, inView);
  return <span ref={statsRef}>{count}{suffix}</span>;
}

export default function LandingPage() {
  const { t } = useTranslation();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 20));

  const featuresRef = useRef<HTMLDivElement>(null);
  const featuresInView = useInView(featuresRef, { once: true, margin: "-100px" });

  const pricingRef = useRef<HTMLDivElement>(null);
  const pricingInView = useInView(pricingRef, { once: true, margin: "-80px" });

  const testimonialsRef = useRef<HTMLDivElement>(null);
  const testimonialsInView = useInView(testimonialsRef, { once: true, margin: "-80px" });

  const features = t("landing.features.items", { returnObjects: true }) as {
    icon: string; title: string; desc: string; colorClass: string;
  }[];

  const testimonials = t("landing.testimonials.items", { returnObjects: true }) as {
    quote: string; name: string; location: string; shop: string; avatar: string; avatarColor: string;
  }[];

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Hind Siliguri', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap');
        .hero-grid {
          background-image: radial-gradient(circle, rgba(0,166,81,0.18) 1px, transparent 1px);
          background-size: 30px 30px;
        }
      `}</style>

      {/* ── Navbar ─────────────────────────────────────────────── */}
      <nav
        className={`sticky top-0 z-50 border-b border-gray-100 backdrop-blur-md transition-shadow duration-300 ${
          scrolled ? "bg-white shadow-sm" : "bg-white/90"
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <BrandLogo size="md" variant="dark" />
          <div className="hidden items-center gap-6 md:flex">
            {[
              { label: t("landing.nav.features"), id: "features" },
              { label: t("landing.nav.pricing"),  id: "pricing"  },
              { label: t("landing.nav.contact"),   id: "contact"  },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className="text-sm font-medium text-gray-600 hover:text-[#00A651] transition-colors"
              >
                {item.label}
              </button>
            ))}
            <LanguageToggle variant="dark" />
          </div>
          <Link
            to="/signup"
            className="rounded-lg bg-[#00A651] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#008040] transition-colors shadow-sm"
          >
            {t("landing.nav.getStarted")}
          </Link>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#0F172A] hero-grid px-6 py-28 md:py-40">
        <motion.div
          className="pointer-events-none absolute -left-40 -top-20 h-[500px] w-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(0,166,81,0.32) 0%, transparent 70%)" }}
          animate={{ opacity: [0.4, 0.7, 0.4], scale: [1, 1.08, 1] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="pointer-events-none absolute -bottom-20 -right-40 h-[500px] w-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(22,163,74,0.28) 0%, transparent 70%)" }}
          animate={{ opacity: [0.4, 0.7, 0.4], scale: [1, 1.08, 1] }}
          transition={{ duration: 5, delay: 2.5, repeat: Infinity, ease: "easeInOut" }}
        />

        <motion.div
          className="relative mx-auto max-w-4xl text-center"
          variants={heroContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={heroItem} className="mb-7 inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-4 py-1.5 text-sm text-green-300">
            <motion.span
              className="h-2 w-2 rounded-full bg-green-400"
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
            {t("landing.hero.badge")}
          </motion.div>

          <motion.h1
            variants={heroItem}
            className="mb-6 text-5xl font-bold leading-tight text-white md:text-6xl lg:text-7xl"
          >
            {t("landing.hero.headline1")}{" "}
            <span style={gradientText}>{t("landing.hero.headline2")}</span>
            <br />
            {t("landing.hero.headline3")}
          </motion.h1>

          <motion.p
            variants={heroItem}
            className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-slate-300 md:text-xl"
          >
            {t("landing.hero.subheadline")}
          </motion.p>

          <motion.div variants={heroItem} className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              to="/signup"
              className="rounded-xl bg-[#00A651] px-9 py-4 text-base font-semibold text-white shadow-lg shadow-[#00A651]/30 hover:bg-[#008040] hover:shadow-[#008040]/40 hover:scale-105 transition-all duration-200"
            >
              {t("landing.hero.ctaStart")}
            </Link>
            <Link
              to="/signin"
              className="rounded-xl border border-white/20 bg-white/5 px-9 py-4 text-base font-semibold text-white hover:bg-white/10 hover:border-white/40 transition-all duration-200"
            >
              {t("landing.hero.ctaDemo")}
            </Link>
          </motion.div>

          <motion.div
            variants={heroItem}
            className="mt-16 flex flex-wrap items-center justify-center gap-12 border-t border-white/10 pt-10"
          >
            {[
              { value: t("landing.hero.stat1Value"), label: t("landing.hero.stat1Label") },
              { value: t("landing.hero.stat2Value"), label: t("landing.hero.stat2Label") },
              { value: t("landing.hero.stat3Value"), label: t("landing.hero.stat3Label") },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-4xl font-bold text-white">
                  <StatCounter raw={stat.value} />
                </div>
                <div className="mt-1 text-sm text-slate-400">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* ── Features ───────────────────────────────────────────── */}
      <section id="features" className="bg-white px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <motion.div
            className="mb-14 text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
          >
            <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#00A651]">
              {t("landing.features.label")}
            </p>
            <h2 className="text-3xl font-bold text-gray-900 md:text-4xl">{t("landing.features.heading")}</h2>
            <p className="mt-3 text-gray-500">{t("landing.features.subheading")}</p>
          </motion.div>

          <div ref={featuresRef} className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
                initial={{ opacity: 0, y: 32 }}
                animate={featuresInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{
                  y: -8,
                  borderColor: "#00A651",
                  boxShadow: "0 12px 32px rgba(0,166,81,0.15)",
                  transition: { duration: 0.2 },
                }}
              >
                <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl text-2xl ${f.colorClass}`}>
                  {f.icon}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">{f.title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────── */}
      <section id="pricing" className="bg-slate-50 px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <motion.div
            className="mb-14 text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
          >
            <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#00A651]">
              {t("landing.pricing.label")}
            </p>
            <h2 className="text-3xl font-bold text-gray-900 md:text-4xl">{t("landing.pricing.heading")}</h2>
            <p className="mt-3 text-gray-500">{t("landing.pricing.subheading")}</p>
          </motion.div>

          <div ref={pricingRef} className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {subscriptionPlans.map((plan, i) => (
              <motion.div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl p-6 ${
                  plan.popular
                    ? "border-2 border-[#00A651] bg-white shadow-2xl shadow-[#00A651]/15"
                    : "border border-gray-200 bg-white shadow-sm"
                }`}
                initial={{ opacity: 0, scale: 0.92, y: 20 }}
                animate={pricingInView ? { opacity: 1, scale: 1, y: 0 } : {}}
                transition={{ delay: i * 0.12, type: "spring", stiffness: 260, damping: 20 }}
                whileHover={{ y: -6, boxShadow: "0 12px 40px rgba(0,166,81,0.12)" }}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-0 right-0 flex justify-center">
                    <span className="rounded-full bg-[#00A651] px-4 py-1.5 text-xs font-semibold text-white shadow-md">
                      {t("landing.pricing.mostPopular")}
                    </span>
                  </div>
                )}

                <div className="mb-5 pt-1">
                  <h3 className="text-xl font-bold text-gray-900">{plan.name}</h3>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="text-4xl font-bold text-gray-900">
                      ৳{plan.monthlyPrice.toLocaleString()}
                    </span>
                    <span className="mb-1 text-sm text-gray-400">{t("landing.pricing.perMonth")}</span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-[#00A651]">{plan.description}</p>
                </div>

                <ul className="mb-6 flex-1 space-y-2.5">
                  {plan.highlights.map((feat) => (
                    <li key={feat} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="mt-0.5 shrink-0 text-green-500">✓</span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  to="/signup"
                  className={`block rounded-xl py-3 text-center text-sm font-semibold transition-all ${
                    plan.popular
                      ? "bg-[#00A651] text-white shadow-lg shadow-[#00A651]/25 hover:bg-[#008040]"
                      : "border border-gray-200 text-gray-700 hover:border-[#00A651] hover:text-[#00A651]"
                  }`}
                >
                  {t("landing.pricing.getStarted")}
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ───────────────────────────────────────── */}
      <section className="bg-white px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <motion.div
            className="mb-14 text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
          >
            <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#00A651]">
              {t("landing.testimonials.label")}
            </p>
            <h2 className="text-3xl font-bold text-gray-900 md:text-4xl">{t("landing.testimonials.heading")}</h2>
          </motion.div>

          <div ref={testimonialsRef} className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {testimonials.map((t_, i) => (
              <motion.div
                key={t_.name}
                className="rounded-2xl border border-gray-100 bg-white p-7 shadow-sm"
                initial={{ opacity: 0, y: 28 }}
                animate={testimonialsInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: i * 0.15, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -2, boxShadow: "0 12px 40px rgba(0,166,81,0.12)" }}
              >
                <p className="mb-1 text-5xl font-bold leading-none text-green-100">"</p>
                <p className="mb-6 text-gray-700 leading-relaxed">{t_.quote}</p>
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${t_.avatarColor}`}>
                    {t_.avatar}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">{t_.name}</div>
                    <div className="text-xs text-gray-400">{t_.shop} · {t_.location}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#0F172A] px-6 py-28">
        <motion.div
          className="pointer-events-none absolute left-1/2 top-0 h-96 w-96 -translate-x-1/2 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(0,166,81,0.25) 0%, transparent 70%)" }}
          animate={{ opacity: [0.5, 0.85, 0.5], scale: [1, 1.06, 1] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <motion.h2
            className="mb-4 text-4xl font-bold text-white md:text-5xl"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55 }}
          >
            {t("landing.cta.heading1")}{" "}
            <span style={gradientText}>{t("landing.cta.heading2")}</span>
          </motion.h2>
          <motion.p
            className="mb-10 text-xl text-slate-300"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            {t("landing.cta.subheading")}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Link
              to="/signup"
              className="inline-block rounded-xl bg-[#00A651] px-12 py-4 text-lg font-semibold text-white shadow-xl shadow-[#00A651]/30 hover:bg-[#008040] transition-all hover:shadow-[#008040]/40"
            >
              {t("landing.cta.button")}
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer id="contact" className="border-t border-slate-800 bg-[#0F172A] px-6 py-12">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div>
              <BrandLogo size="sm" variant="light" />
              <p className="mt-1 text-sm text-slate-400">{t("landing.footer.tagline")}</p>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <LanguageToggle variant="light" />
              <Link to="/privacy-policy" className="text-slate-400 hover:text-white transition-colors">
                {t("common.privacyPolicy")}
              </Link>
              <Link to="/terms" className="text-slate-400 hover:text-white transition-colors">
                {t("common.terms")}
              </Link>
              <Link to="/signin" className="text-slate-400 hover:text-white transition-colors">
                {t("common.signIn")}
              </Link>
            </div>
          </div>
          <div className="mt-8 border-t border-slate-800 pt-6 text-center text-sm text-slate-500">
            {t("common.copyright")}
          </div>
        </div>
      </footer>
    </div>
  );
}
