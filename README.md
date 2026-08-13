# Growth OS

Dedicated private repository for the Growth OS frontend.

- Domain: `growth.easymod.tech`
- API namespace: `https://api.easymod.tech/api/internal/growth-os/*`
- Authentication: uses the existing EasyModerator session on the API origin
- Authorization: enforced server-side in EasyModerator backend middleware
- Merchant isolation: must be denied for non-platform users at the API boundary
- Independent build: Vite + React
- No merchant frontend dependency

## Local build

```sh
npm install
npm run build
```

## Runtime contract

The frontend only consumes the Growth OS API namespace and does not own
business logic. The backend remains the source of truth for authz, isolation,
and domain behavior.
