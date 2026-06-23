# Meta Implementation Audit (Generated)

This file is generated from source code by `EasyMod-backend/scripts/meta-implementation-audit.js`. Rerun the script after code changes.

## Source Files Read

- `src/modules/channel-providers/providers/MetaMessengerProvider.js`
- `src/modules/channel-providers/providers/MetaInstagramProvider.js`
- `src/modules/channel-providers/meta-oauth.service.js`
- `src/modules/channel-providers/meta-oauth.controller.js`
- `src/modules/channel-providers/meta-channel.routes.js`
- `src/modules/channel-providers/meta-channel.controller.js`
- `src/modules/channel-providers/meta-channel.service.js`
- `src/modules/channel-providers/provider.registry.js`
- `src/modules/integration/meta-webhook.routes.js`
- `src/modules/integration/meta-webhook-events.handler.js`
- `src/modules/integration/meta-webhook-comments.handler.js`
- `src/modules/integration/meta-webhook-gdpr.handler.js`
- `src/modules/commentToDm/comment-to-dm.webhook-handler.js`
- `src/modules/commentToDm/comment-to-dm.service.js`
- `src/modules/customer/customer-profile.service.js`
- `src/modules/conversation/conversation-state-standalone.service.js`
- `src/modules/conversation/ai-chatbot.controller.js`
- `src/jobs/meta-token-refresh.job.js`
- `src/utils/meta-oauth-exchange.js`

## OAuth Scopes Requested By Code

| Scope | Extracted from |
| --- | --- |
| `instagram_basic` | `DEFAULT_SCOPES` at src/modules/channel-providers/providers/MetaInstagramProvider.js:27<br>`unifiedScopes` at src/modules/channel-providers/meta-oauth.service.js:177 |
| `instagram_manage_comments` | `DEFAULT_SCOPES` at src/modules/channel-providers/providers/MetaInstagramProvider.js:27<br>`unifiedScopes` at src/modules/channel-providers/meta-oauth.service.js:177 |
| `instagram_manage_messages` | `DEFAULT_SCOPES` at src/modules/channel-providers/providers/MetaInstagramProvider.js:27<br>`unifiedScopes` at src/modules/channel-providers/meta-oauth.service.js:177 |
| `pages_manage_engagement` | `DEFAULT_SCOPES` at src/modules/channel-providers/providers/MetaMessengerProvider.js:25<br>`DEFAULT_SCOPES` at src/modules/channel-providers/providers/MetaInstagramProvider.js:27<br>`unifiedScopes` at src/modules/channel-providers/meta-oauth.service.js:177 |
| `pages_manage_metadata` | `DEFAULT_SCOPES` at src/modules/channel-providers/providers/MetaMessengerProvider.js:25<br>`DEFAULT_SCOPES` at src/modules/channel-providers/providers/MetaInstagramProvider.js:27<br>`unifiedScopes` at src/modules/channel-providers/meta-oauth.service.js:177 |
| `pages_messaging` | `DEFAULT_SCOPES` at src/modules/channel-providers/providers/MetaMessengerProvider.js:25<br>`unifiedScopes` at src/modules/channel-providers/meta-oauth.service.js:177 |
| `pages_read_engagement` | `DEFAULT_SCOPES` at src/modules/channel-providers/providers/MetaMessengerProvider.js:25<br>`DEFAULT_SCOPES` at src/modules/channel-providers/providers/MetaInstagramProvider.js:27<br>`unifiedScopes` at src/modules/channel-providers/meta-oauth.service.js:177 |
| `pages_show_list` | `DEFAULT_SCOPES` at src/modules/channel-providers/providers/MetaMessengerProvider.js:25<br>`DEFAULT_SCOPES` at src/modules/channel-providers/providers/MetaInstagramProvider.js:27<br>`unifiedScopes` at src/modules/channel-providers/meta-oauth.service.js:177 |

### Explicit Non-Request Check

- `business_management` requested by OAuth scope arrays: NO.
- Business Portfolio discovery code exists (src/modules/channel-providers/providers/MetaMessengerProvider.js:146, src/modules/channel-providers/providers/MetaMessengerProvider.js:164) but is guarded by `includeBusinessPortfolio` and no current OAuth flow requests the permission.

## Graph API Endpoints Used By Code

| Method | Endpoint | Function | Source | Fields / Params |
| --- | --- | --- | --- | --- |
| OAUTH_REDIRECT | `https://www.facebook.com/{graph-version}/dialog/oauth` | `buildAuthUrl` | src/modules/channel-providers/providers/MetaMessengerProvider.js:63 | `scope=DEFAULT_SCOPES` |
| GET | `/oauth/access_token` | `exchangeCode` | src/modules/channel-providers/providers/MetaMessengerProvider.js:68 |  |
| GET | `/oauth/access_token` | `exchangeCode` | src/modules/channel-providers/providers/MetaMessengerProvider.js:79 |  |
| GET | `/me/accounts` | `listManagedAssets` | src/modules/channel-providers/providers/MetaMessengerProvider.js:117 | `PAGE_FIELDS` |
| GET | `/me/businesses` | `listManagedAssets` | src/modules/channel-providers/providers/MetaMessengerProvider.js:146 | `id,name` |
| GET | `/{business-id}/{owned_pages\|client_pages}` | `listManagedAssets` | src/modules/channel-providers/providers/MetaMessengerProvider.js:164 | `PAGE_FIELDS` |
| GET | `/{asset-id}` | `getAssetAccessToken` | src/modules/channel-providers/providers/MetaMessengerProvider.js:222 | `access_token` |
| GET | `/oauth/access_token` | `refreshAssetToken` | src/modules/channel-providers/providers/MetaMessengerProvider.js:241 |  |
| POST | `/{meta-asset-id}/subscribed_apps` | `subscribeWebhook` | src/modules/channel-providers/providers/MetaMessengerProvider.js:274 | `subscribed_fields=this.webhookFields().join(",")` |
| DELETE | `/{meta-asset-id}/subscribed_apps` | `unsubscribeWebhook` | src/modules/channel-providers/providers/MetaMessengerProvider.js:293 |  |
| GET | `/{target-id}/subscribed_apps` | `verifyWebhookSubscription` | src/modules/channel-providers/providers/MetaMessengerProvider.js:308 |  |
| POST | `/me/messages` | `sendMessage` | src/modules/channel-providers/providers/MetaMessengerProvider.js:411 |  |
| POST | `/{comment-id}/private_replies` | `sendPrivateReplyToComment` | src/modules/channel-providers/providers/MetaMessengerProvider.js:426 |  |
| POST | `/{comment-id}/comments` | `sendPublicCommentReply` | src/modules/channel-providers/providers/MetaMessengerProvider.js:441 |  |
| GET | `/{meta-asset-id}` | `ping` | src/modules/channel-providers/providers/MetaMessengerProvider.js:457 | `id` |
| OAUTH_REDIRECT | `https://www.facebook.com/{graph-version}/dialog/oauth` | `buildAuthUrl` | src/modules/channel-providers/providers/MetaInstagramProvider.js:79 | `scope=DEFAULT_SCOPES` |
| GET | `/oauth/access_token` | `exchangeCode` | src/modules/channel-providers/providers/MetaInstagramProvider.js:84 |  |
| GET | `/oauth/access_token` | `exchangeCode` | src/modules/channel-providers/providers/MetaInstagramProvider.js:94 |  |
| GET | `/me/accounts` | `listManagedAssets` | src/modules/channel-providers/providers/MetaInstagramProvider.js:116 | `id,name,category,picture{url},instagram_business_account{id,name,username,profile_picture_url}` |
| GET | `/me/accounts` | `getAssetAccessToken` | src/modules/channel-providers/providers/MetaInstagramProvider.js:146 | `id,instagram_business_account{id}` |
| GET | `/{parent-page-id}` | `getAssetAccessToken` | src/modules/channel-providers/providers/MetaInstagramProvider.js:159 | `access_token` |
| GET | `/oauth/access_token` | `refreshAssetToken` | src/modules/channel-providers/providers/MetaInstagramProvider.js:182 |  |
| POST | `/{subscribe-target-id}/subscribed_apps` | `subscribeWebhook` | src/modules/channel-providers/providers/MetaInstagramProvider.js:215 | `subscribed_fields=this.webhookFields().join(",")` |
| DELETE | `/{subscribe-target-id}/subscribed_apps` | `unsubscribeWebhook` | src/modules/channel-providers/providers/MetaInstagramProvider.js:235 |  |
| GET | `/{target-id}/subscribed_apps` | `verifyWebhookSubscription` | src/modules/channel-providers/providers/MetaInstagramProvider.js:249 |  |
| POST | `/me/messages` | `sendMessage` | src/modules/channel-providers/providers/MetaInstagramProvider.js:351 |  |
| POST | `/{comment-id}/private_replies` | `sendPrivateReplyToComment` | src/modules/channel-providers/providers/MetaInstagramProvider.js:366 |  |
| POST | `/{comment-id}/replies` | `sendPublicCommentReply` | src/modules/channel-providers/providers/MetaInstagramProvider.js:381 |  |
| GET | `/{meta-asset-id}` | `ping` | src/modules/channel-providers/providers/MetaInstagramProvider.js:397 | `id` |
| GET | `/{psid}` | `enrichCustomerNameFromMeta` | src/modules/customer/customer-profile.service.js:88 |  |
| GET | `/oauth/access_token` | `exchangeForLongLivedToken` | src/utils/meta-oauth-exchange.js:56 |  |

## Webhook Subscriptions Extracted From Providers

| Provider | Subscribed fields | Source |
| --- | --- | --- |
| facebook | `messages`, `feed` | src/modules/channel-providers/providers/MetaMessengerProvider.js:33 |
| instagram | `messages`, `feed` | src/modules/channel-providers/providers/MetaInstagramProvider.js:49 |

## Webhook Handling Observed In Code

| Type | Object / Field | Function | Source |
| --- | --- | --- | --- |
| field | comments | extractCommentEvents | src/modules/commentToDm/comment-to-dm.webhook-handler.js:69 |
| field | comments | parseWebhookEnvelope | src/modules/channel-providers/providers/MetaInstagramProvider.js:312 |
| field | feed | extractCommentEvents | src/modules/commentToDm/comment-to-dm.webhook-handler.js:46 |
| field | feed | parseWebhookEnvelope | src/modules/channel-providers/providers/MetaMessengerProvider.js:372 |
| field | messages | handleInstagramWebhook | src/modules/integration/meta-webhook-events.handler.js:421 |
| field | messages | handleInstagramWebhook | src/modules/integration/meta-webhook-events.handler.js:426 |
| field | messages | handleInstagramWebhook | src/modules/integration/meta-webhook-events.handler.js:427 |
| field | messages | handleInstagramWebhook | src/modules/integration/meta-webhook-events.handler.js:428 |
| field | messages | handlePageWebhook | src/modules/integration/meta-webhook-events.handler.js:310 |
| field | messages | handlePageWebhook | src/modules/integration/meta-webhook-events.handler.js:338 |
| field | messages | handlePageWebhook | src/modules/integration/meta-webhook-events.handler.js:343 |
| field | messages | handlePageWebhook | src/modules/integration/meta-webhook-events.handler.js:347 |
| field | messages | handlePageWebhook | src/modules/integration/meta-webhook-events.handler.js:348 |
| field | messages | parseWebhookEnvelope | src/modules/channel-providers/providers/MetaInstagramProvider.js:286 |
| field | messages | parseWebhookEnvelope | src/modules/channel-providers/providers/MetaMessengerProvider.js:346 |
| field | messaging_optins | handleInstagramWebhook | src/modules/integration/meta-webhook-events.handler.js:422 |
| field | messaging_optins | handleInstagramWebhook | src/modules/integration/meta-webhook-events.handler.js:423 |
| field | messaging_optins | handlePageWebhook | src/modules/integration/meta-webhook-events.handler.js:339 |
| field | messaging_optins | handlePageWebhook | src/modules/integration/meta-webhook-events.handler.js:340 |
| object | instagram | resolveConnectedChannel | src/modules/integration/meta-webhook.routes.js:169 |
| object | page | resolveConnectedChannel | src/modules/integration/meta-webhook.routes.js:167 |

## Subscribed Webhook Fields Without Direct Handler Evidence

All subscribed fields have direct handler evidence.

## Permission Reviewer Script

Use this as the App Review script/checklist. Each permission below is included only because it appears in an extracted OAuth scope array.

| Permission | Code-derived evidence | Reviewer action |
| --- | --- | --- |
| `instagram_basic` | src/modules/channel-providers/providers/MetaInstagramProvider.js:116<br>src/modules/channel-providers/providers/MetaInstagramProvider.js:146<br>src/modules/channel-providers/providers/MetaMessengerProvider.js:117 | Required to discover and display linked Instagram business account details from Page account listing. |
| `instagram_manage_comments` | src/modules/channel-providers/providers/MetaInstagramProvider.js:312<br>src/modules/channel-providers/providers/MetaInstagramProvider.js:366<br>src/modules/channel-providers/providers/MetaInstagramProvider.js:381<br>src/modules/commentToDm/comment-to-dm.webhook-handler.js:69 | Required for Instagram comment webhooks and public replies. |
| `instagram_manage_messages` | src/modules/channel-providers/providers/MetaInstagramProvider.js:286<br>src/modules/channel-providers/providers/MetaInstagramProvider.js:351<br>src/modules/channel-providers/providers/MetaInstagramProvider.js:49<br>src/modules/integration/meta-webhook-events.handler.js:421<br>src/modules/integration/meta-webhook-events.handler.js:426<br>src/modules/integration/meta-webhook-events.handler.js:427<br>src/modules/integration/meta-webhook-events.handler.js:428 | Required for Instagram Direct message send/receive. |
| `pages_manage_engagement` | src/modules/channel-providers/providers/MetaMessengerProvider.js:441 | Required for Facebook public comment replies on Page content. |
| `pages_manage_metadata` | src/modules/channel-providers/providers/MetaInstagramProvider.js:215<br>src/modules/channel-providers/providers/MetaInstagramProvider.js:235<br>src/modules/channel-providers/providers/MetaInstagramProvider.js:249<br>src/modules/channel-providers/providers/MetaInstagramProvider.js:49<br>src/modules/channel-providers/providers/MetaMessengerProvider.js:274<br>src/modules/channel-providers/providers/MetaMessengerProvider.js:293<br>src/modules/channel-providers/providers/MetaMessengerProvider.js:308<br>src/modules/channel-providers/providers/MetaMessengerProvider.js:33 | Required for POST/GET/DELETE on /{page-id}/subscribed_apps. |
| `pages_messaging` | src/modules/channel-providers/providers/MetaMessengerProvider.js:33<br>src/modules/channel-providers/providers/MetaMessengerProvider.js:346<br>src/modules/channel-providers/providers/MetaMessengerProvider.js:411<br>src/modules/channel-providers/providers/MetaMessengerProvider.js:426<br>src/modules/customer/customer-profile.service.js:88<br>src/modules/integration/meta-webhook-events.handler.js:310<br>src/modules/integration/meta-webhook-events.handler.js:338<br>src/modules/integration/meta-webhook-events.handler.js:339<br>src/modules/integration/meta-webhook-events.handler.js:340<br>src/modules/integration/meta-webhook-events.handler.js:343<br>src/modules/integration/meta-webhook-events.handler.js:347<br>src/modules/integration/meta-webhook-events.handler.js:348 | Required for Messenger send/private-reply behavior and Messenger message webhooks. Profile enrichment may also require the Business Asset User Profile Access feature. |
| `pages_read_engagement` | src/modules/channel-providers/providers/MetaMessengerProvider.js:33<br>src/modules/channel-providers/providers/MetaMessengerProvider.js:372<br>src/modules/channel-providers/providers/MetaMessengerProvider.js:457<br>src/modules/commentToDm/comment-to-dm.webhook-handler.js:46 | Used for Page/comment event visibility and Page asset reads. If the app only consumes feed webhooks, keep the reviewer story tied to comment-triggered automation. |
| `pages_show_list` | src/modules/channel-providers/providers/MetaInstagramProvider.js:116<br>src/modules/channel-providers/providers/MetaInstagramProvider.js:146<br>src/modules/channel-providers/providers/MetaMessengerProvider.js:117 | Required by the code path that lists Pages with /me/accounts before the merchant chooses an asset. |

## Audit Findings From Code

- P1: Verify the live token can create a Facebook public comment reply with `pages_manage_engagement` before submission; this is the review-critical Page comment permission.
- P1: Keep Page `subscribed_apps` fields limited to reviewer-visible valid Page fields (`messages`, `feed`). Configure Instagram-object fields (`messages`, `comments`) in the Meta App Dashboard object subscription, not the Page `subscribed_apps` call.
- P2: `business_management` should stay out of App Review unless `includeBusinessPortfolio` is exposed and used. The current unified OAuth flow explicitly avoids it.
- P2: `GET /{psid}` profile enrichment is best-effort. If reviewer materials promise customer names/profile pictures, also request/verify Business Asset User Profile Access; otherwise keep the feature out of the required-permission story.
- P2: `verifyWebhookSubscription()` verifies the provider-required Page fields. Instagram `comments` still require a separate Meta App Dashboard Instagram-object subscription check before final App Review submission.

## Official Meta References Used For Verification

- oauthTokens: https://developers.facebook.com/documentation/facebook-login/guides/access-tokens
- userAccounts: https://developers.facebook.com/docs/graph-api/reference/user/accounts/
- pageSubscribedApps: https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/
- pagesWebhooks: https://developers.facebook.com/docs/graph-api/webhooks/reference/page/
- instagramWebhooks: https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram/
- pagesApiComments: https://developers.facebook.com/docs/pages-api/comments-mentions/
- instagramComments: https://developers.facebook.com/docs/instagram-platform/comment-moderation/
- instagramCommentReplies: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-comment/replies/
- messengerProfile: https://developers.facebook.com/documentation/business-messaging/messenger-platform/identity/user-profile
- businessAssetUserProfile: https://developers.facebook.com/docs/features-reference/business-asset-user-profile-access/
- permissions: https://developers.facebook.com/docs/permissions/
- instagramMessaging: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/
- businessPages: https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/pages/
