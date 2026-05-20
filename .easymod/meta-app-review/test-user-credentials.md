# Test User Credentials Spec

**App:** Easy Moderator
**Last updated:** 2026-05-20

This file specifies what test accounts the Meta App Reviewer needs to verify Easy Moderator. It does NOT contain live passwords or tokens. Actual credentials are stored in 1Password under the vault "Easy Moderator — Meta App Review".

---

## Required Accounts

### 1. Test Facebook Page

| Field           | Value / Location                                      |
|-----------------|-------------------------------------------------------|
| Page name       | Easy Moderator Test Shop (to be created)              |
| Page ID         | [stored in 1Password: "Meta Review Test Page ID"]     |
| Page category   | Shopping & Retail                                     |
| Admin account   | See "Test Facebook Admin Account" below               |
| Sample post     | Must have at least one published product post with keyword "interested" configured in Easy Moderator auto-reply settings |

### 2. Test Instagram Business Account

| Field           | Value / Location                                      |
|-----------------|-------------------------------------------------------|
| IG handle       | @easymod_test_shop (to be created)                    |
| Account type    | Instagram Business Account                            |
| Linked to       | Easy Moderator Test Shop (Facebook Page above)        |
| Admin account   | Same Facebook admin account as Page admin             |

### 3. Test Facebook Admin Account (Merchant)

| Field                | Value / Location                                             |
|----------------------|--------------------------------------------------------------|
| Account role         | Admin of the test Facebook Page                              |
| Easy Moderator login | [stored in 1Password: "Meta Review Merchant Account — email"] |
| Easy Moderator URL   | `https://www.easymod.tech/signin`                           |
| Plan                 | Package 1 (active test subscription)                         |
| Shop name            | Easy Moderator Test Shop                                     |

### 4. Test Customer Account (End-User)

| Field       | Value / Location                                              |
|-------------|---------------------------------------------------------------|
| Purpose     | Used to send comments and Messenger DMs as a "customer" during the screencast |
| Account     | Second personal Facebook account (not the page admin)         |
| Credentials | [stored in 1Password: "Meta Review Customer Account"]         |

---

## Setup Checklist (Before Handing to Reviewer)

- [ ] Test Facebook Page is published (not unpublished/draft)
- [ ] Test Facebook Page is connected to Easy Moderator via OAuth
- [ ] Instagram Business Account is linked to the Page and connected in Easy Moderator
- [ ] Comment auto-reply is enabled with keyword "interested" on at least one post
- [ ] Test customer account is NOT a page admin (must be a separate account)
- [ ] Easy Moderator test merchant account has Package 1 subscription active
- [ ] 1Password vault "Easy Moderator — Meta App Review" is shared with reviewer (use 1Password secure share link — set expiry to 30 days)

---

## Signup URL

Reviewers creating a fresh account can use: `https://www.easymod.tech/signup`

The onboarding wizard will guide through:
1. Create account
2. Connect Facebook Page (OAuth)
3. Connect Instagram (optional)
4. Configure first auto-reply keyword

---

## Note on Live Credentials

Do not commit actual passwords, access tokens, or session cookies to this repository. All credentials must be stored in 1Password and shared via secure link. If credentials are rotated (e.g. after a review cycle), update the 1Password entries — do not update this file with the new values.
