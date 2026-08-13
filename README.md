# Growth OS — Dedicated Repository

Dedicated private repository for EasyModerator Growth OS frontend.

- Domain: `growth.easymod.tech`
- API namespace: `/api/internal/growth-os/*` (verified server-side authorization)
- Authentication: relies on existing EasyModerator session/auth (cookie-based)
- Authorization: server-side only (`SUPER_ADMIN` / `SUPPORT_ADMIN` via `platform-admin.middleware`)
- Merchant isolation: enforced server-side (403 for non-admin users)
- Independent build: Vite + React
- No merchant frontend dependency
