import { lazy, Suspense } from "react";
import PageLoader from "./components/PageLoader";

const LandingPage = lazy(() => import("./components/LandingPage"));
const Pricing = lazy(() => import("./components/Pricing"));
const PrivacyPolicy = lazy(() => import("./components/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./components/TermsOfService"));
const DataDeletion = lazy(() => import("./components/DataDeletion"));
const NotFound = lazy(() => import("./components/NotFound"));

const publicPages = {
  "/": LandingPage,
  "/pricing": Pricing,
  "/privacy-policy": PrivacyPolicy,
  "/terms": TermsOfService,
  "/data-deletion": DataDeletion,
} as const;

export default function PublicApp() {
  const Page = publicPages[window.location.pathname as keyof typeof publicPages] || NotFound;
  return <Suspense fallback={<PageLoader />}><Page /></Suspense>;
}
