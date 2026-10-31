import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import SignIn from "@/app/components/SignIn";

vi.mock("@/app/components/ui/input", () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => <input ref={ref} {...props} />),
}));

const mockSignin = vi.fn();
vi.mock("@/features/auth/AuthProvider", () => ({ useAuth: () => ({ signin: mockSignin }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "publicFunnel.nav.backToSite": "Back to EasyModerator",
      "publicFunnel.nav.signIn": "Sign in",
      "publicFunnel.nav.createAccount": "Create account",
      "publicFunnel.auth.signInTitle": "Sign in to EasyModerator",
      "publicFunnel.auth.signInSubtitle": "Use your account email to continue.",
      "publicFunnel.auth.email": "Email",
      "publicFunnel.auth.emailPlaceholder": "you@example.com",
      "publicFunnel.auth.password": "Password",
      "publicFunnel.auth.passwordPlaceholder": "Enter your password",
      "publicFunnel.auth.showPassword": "Show password",
      "publicFunnel.auth.hidePassword": "Hide password",
      "publicFunnel.auth.forgotPassword": "Forgot password?",
      "publicFunnel.auth.signInButton": "Sign in",
      "publicFunnel.auth.signingIn": "Signing in…",
      "publicFunnel.auth.noAccount": "New to EasyModerator?",
      "publicFunnel.auth.createAccount": "Create a Shuru account",
      "common.language.switchToEnglish": "Switch to English",
      "common.language.switchToBengali": "Switch to Bengali",
      "auth.signin.errors.invalidCredentials": "Invalid credentials",
    } as Record<string, string>)[key] ?? key,
    i18n: { language: "en", resolvedLanguage: "en", changeLanguage: vi.fn() },
  }),
}));

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}</output>;
}

function renderSignin() {
  return render(
    <MemoryRouter initialEntries={["/signin"]}>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/dashboard" element={<LocationDisplay />} />
        <Route path="/2fa-verify" element={<LocationDisplay />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SignIn", () => {
  beforeEach(() => {
    mockSignin.mockReset().mockResolvedValue({});
  });

  it("keeps the return flow focused, labeled and linked to recovery and signup", () => {
    renderSignin();

    expect(screen.getByRole("heading", { name: "Sign in to EasyModerator" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getAllByRole("link", { name: "Create a Shuru account" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Create a Shuru account" }).every((link) => link.getAttribute("href") === "/signup")).toBe(true);
    expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles password visibility and submits a normalized account email", async () => {
    const user = userEvent.setup();
    renderSignin();

    const password = screen.getByLabelText("Password");
    await user.type(screen.getByLabelText("Email"), " MERCHANT@EXAMPLE.COM ");
    await user.type(password, "ValidPass123!");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(mockSignin).toHaveBeenCalledWith({ email: "merchant@example.com", password: "ValidPass123!" }));
    await waitFor(() => expect(screen.getByTestId("current-location")).toHaveTextContent("/dashboard"));
  });

  it("shows an actionable authentication error without leaving the form", async () => {
    const user = userEvent.setup();
    mockSignin.mockRejectedValue(new Error("Email or password is incorrect"));
    renderSignin();
    await user.type(screen.getByLabelText("Email"), "merchant@example.com");
    await user.type(screen.getByLabelText("Password"), "incorrect");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect");
    expect(screen.getByRole("heading", { name: "Sign in to EasyModerator" })).toBeInTheDocument();
  });

  it("preserves the existing required two-factor route", async () => {
    const user = userEvent.setup();
    mockSignin.mockRejectedValue({ code: "REQUIRES_2FA" });
    renderSignin();
    await user.type(screen.getByLabelText("Email"), "merchant@example.com");
    await user.type(screen.getByLabelText("Password"), "ValidPass123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByTestId("current-location")).toHaveTextContent("/2fa-verify"));
  });
});
