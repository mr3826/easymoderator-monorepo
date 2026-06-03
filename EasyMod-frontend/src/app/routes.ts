import { lazy, createElement, Suspense, type LazyExoticComponent } from "react";
import { createBrowserRouter, redirect } from "react-router-dom";
import { authService } from "./lib/auth";
import { AdminRoute } from "@/shared/components/guards";
import PageLoader from "./components/PageLoader";

const DashboardLayout = lazy(() => import("./components/DashboardLayout"));
const Dashboard = lazy(() => import("./components/Dashboard"));
const UnifiedInbox = lazy(() => import("./components/UnifiedInbox"));
const OAuthCallbackPage = lazy(() => import("./components/OAuthCallbackPage"));
const Products = lazy(() => import("./components/Products"));
const Orders = lazy(() => import("./components/Orders"));
const Reports = lazy(() => import("./components/Reports"));
const AuditLogs = lazy(() => import("./components/AuditLogs"));
const Knowledge = lazy(() => import("./components/Knowledge"));
const AddProduct = lazy(() => import("./components/AddProduct"));
const ProductDetails = lazy(() => import("./components/ProductDetails"));
const Customers = lazy(() => import("./components/Customers"));
const Categories = lazy(() => import("./components/Categories"));
const CategoryDetails = lazy(() => import("./components/CategoryDetails"));
const SubcategoryDetails = lazy(() => import("./components/SubcategoryDetails"));
const ManageShop = lazy(() => import("./components/ManageShop"));
const SettingsHub = lazy(() => import("./components/SettingsHub"));
const ChatSettings = lazy(() => import("./components/ChatSettings"));
const DeliverySettings = lazy(() => import("./components/DeliverySettings"));
const PaymentSettings = lazy(() => import("./components/PaymentSettings"));
const BusinessInfoSettings = lazy(() => import("./components/BusinessInfoSettings"));
const SignIn = lazy(() => import("./components/SignIn"));
const Signup = lazy(() => import("./components/Signup"));
const ForgotPassword = lazy(() => import("./components/ForgotPassword"));
const ResetPassword = lazy(() => import("./components/ResetPassword"));
const TwoFactorVerify = lazy(() => import("./components/TwoFactorVerify"));
const RouteError = lazy(() => import("./components/RouteError"));
const Subscription = lazy(() => import("./components/Subscription"));
const PrivacyPolicy = lazy(() => import("./components/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./components/TermsOfService"));
const LandingPage = lazy(() => import("./components/LandingPage"));
const Pricing = lazy(() => import("./components/Pricing"));
const UsersPage = lazy(() => import("./features/users/components/UsersPage"));

// Phase 4 — Comment-to-DM page
const CommentToDmPage = lazy(() => import("./components/CommentToDm"));

// BD-Lite specific imports
const BDSellerShell = lazy(() => import("./components/bd-lite/BDSellerShell"));
const TodayQueueDashboard = lazy(() => import("./components/bd-lite/TodayQueueDashboard"));
const BDInbox = lazy(() => import("./components/bd-lite/BDInbox"));
const BDOrders = lazy(() => import("./components/bd-lite/BDOrders"));

const NotFound = lazy(() => import("./components/NotFound"));

// Loader function to check authentication
async function protectedLoader() {
	await authService.ensureInitialized();
	if (!authService.isAuthenticated()) {
		return redirect("/");
	}
	return null;
}

async function publicLoader() {
	await authService.ensureInitialized();
	if (authService.isAuthenticated()) {
		return redirect("/app");
	}
	return null;
}

const withSuspense = (Component: LazyExoticComponent<any>) => (props: any) =>
	createElement(Suspense, { fallback: createElement(PageLoader) },
		createElement(Component, props));

export const router = createBrowserRouter([
	{
		path: "/signin",
		Component: withSuspense(SignIn),
		loader: publicLoader,
		errorElement: createElement(RouteError),
	},
	{
		// No publicLoader guard — the user arrives here mid-login (not yet authenticated).
		// The component itself guards against direct navigation by checking pendingTwoFactor.
		path: "/2fa-verify",
		Component: withSuspense(TwoFactorVerify),
		errorElement: createElement(RouteError),
	},
	{
		path: "/forgot-password",
		Component: withSuspense(ForgotPassword),
		loader: publicLoader,
		errorElement: createElement(RouteError),
	},
	{
		path: "/reset-password",
		Component: withSuspense(ResetPassword),
		loader: publicLoader,
		errorElement: createElement(RouteError),
	},
	{
		path: "/privacy-policy",
		Component: withSuspense(PrivacyPolicy),
		errorElement: createElement(RouteError),
	},
	{
		path: "/terms",
		Component: withSuspense(TermsOfService),
		errorElement: createElement(RouteError),
	},
	{
		path: "/pricing",
		Component: withSuspense(Pricing),
		errorElement: createElement(RouteError),
	},
	{
		path: "/",
		Component: withSuspense(LandingPage),
		errorElement: createElement(RouteError),
	},
	{
		path: "/signup",
		Component: withSuspense(Signup),
		loader: publicLoader,
		errorElement: createElement(RouteError),
	},
	{
		// Standalone — must NOT be inside DashboardLayout so the popup loads only the
		// spinner + postMessage handler, not the full authenticated app shell.
		path: "/app/channels/oauth-callback",
		Component: withSuspense(OAuthCallbackPage),
	},
	{
		path: "/app",
		Component: withSuspense(DashboardLayout),
		loader: protectedLoader,
		errorElement: createElement(RouteError),
		children: [
			{ index: true, Component: withSuspense(Dashboard) },
			{ path: "inbox", Component: withSuspense(UnifiedInbox) },
			{ path: "channels", loader: () => redirect("/app/manage-shop/chat-settings") },
			{ path: "channels/comment-to-dm", Component: withSuspense(CommentToDmPage) },
			{
				path: "manage-shop",
				Component: withSuspense(ManageShop),
				children: [
					{ index: true, Component: withSuspense(SettingsHub) },
					{ path: "business-info", Component: withSuspense(BusinessInfoSettings) },
					{ path: "chat-settings", Component: withSuspense(ChatSettings) },
					{ path: "delivery-settings", Component: withSuspense(DeliverySettings) },
					{ path: "payment-settings", Component: withSuspense(PaymentSettings) },
				],
			},
			{ path: "products", Component: withSuspense(Products) },
			{ path: "products/add", Component: withSuspense(AddProduct) },
			{ path: "products/:productId", Component: withSuspense(ProductDetails) },
			{ path: "products/:productId/edit", Component: withSuspense(AddProduct) },
			{ path: "categories", Component: withSuspense(Categories) },
			{ path: "categories/create", Component: withSuspense(CategoryDetails) },
			{ path: "categories/:categoryId", Component: withSuspense(CategoryDetails) },
			{ path: "categories/:categoryId/edit", Component: withSuspense(CategoryDetails) },
			{ path: "categories/:categoryId/:subcategoryId", Component: withSuspense(SubcategoryDetails) },
			{ path: "orders", Component: withSuspense(Orders) },
			{ path: "customers", Component: withSuspense(Customers) },
			{ path: "knowledge", Component: withSuspense(Knowledge) },
			{ path: "reports", Component: withSuspense(Reports) },
			{ path: "audit-logs", Component: withSuspense(AuditLogs) },
			{ path: "subscription", Component: withSuspense(Subscription) },
			{
				path: "admin/users",
				Component: withSuspense((props: any) =>
					createElement(AdminRoute, {}, createElement(UsersPage, props))
				),
			},
		],
	},
	{
		path: "/bd-lite",
		Component: withSuspense(BDSellerShell),
		loader: protectedLoader,
		errorElement: createElement(RouteError),
		children: [
			{ index: true, Component: withSuspense(TodayQueueDashboard) },
			{ path: "inbox", Component: withSuspense(BDInbox) },
			{ path: "orders", Component: withSuspense(BDOrders) },
			{ path: "settings", Component: withSuspense(BusinessInfoSettings) },
		],
	},
	{
		path: "/settings/channels",
		loader: () => redirect("/app/manage-shop/chat-settings"),
	},
	{
		path: "*",
		Component: withSuspense(NotFound),
	},
]);
