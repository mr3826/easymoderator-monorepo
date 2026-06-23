#!/usr/bin/env node
'use strict';

/**
 * Generate a Meta implementation audit from the code.
 *
 * This intentionally reads source files and extracts:
 *   - OAuth scope arrays
 *   - webhook subscribed_fields arrays
 *   - Graph API calls and nearby params
 *   - webhook objects / fields handled by code
 *
 * Usage:
 *   node scripts/meta-implementation-audit.js
 *   node scripts/meta-implementation-audit.js --write ../docs/meta-implementation-audit.generated.md
 */

const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');

const SOURCE_FILES = [
  'src/modules/channel-providers/providers/MetaMessengerProvider.js',
  'src/modules/channel-providers/providers/MetaInstagramProvider.js',
  'src/modules/channel-providers/meta-oauth.service.js',
  'src/modules/channel-providers/meta-oauth.controller.js',
  'src/modules/channel-providers/meta-channel.routes.js',
  'src/modules/channel-providers/meta-channel.controller.js',
  'src/modules/channel-providers/meta-channel.service.js',
  'src/modules/channel-providers/provider.registry.js',
  'src/modules/integration/meta-webhook.routes.js',
  'src/modules/integration/meta-webhook-events.handler.js',
  'src/modules/integration/meta-webhook-comments.handler.js',
  'src/modules/integration/meta-webhook-gdpr.handler.js',
  'src/modules/commentToDm/comment-to-dm.webhook-handler.js',
  'src/modules/commentToDm/comment-to-dm.service.js',
  'src/modules/customer/customer-profile.service.js',
  'src/modules/conversation/conversation-state-standalone.service.js',
  'src/modules/conversation/ai-chatbot.controller.js',
  'src/jobs/meta-token-refresh.job.js',
  'src/utils/meta-oauth-exchange.js',
];

const OFFICIAL_DOCS = {
  oauthTokens: 'https://developers.facebook.com/documentation/facebook-login/guides/access-tokens',
  userAccounts: 'https://developers.facebook.com/docs/graph-api/reference/user/accounts/',
  pageSubscribedApps: 'https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/',
  pagesWebhooks: 'https://developers.facebook.com/docs/graph-api/webhooks/reference/page/',
  instagramWebhooks: 'https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram/',
  pagesApiComments: 'https://developers.facebook.com/docs/pages-api/comments-mentions/',
  instagramComments: 'https://developers.facebook.com/docs/instagram-platform/comment-moderation/',
  instagramCommentReplies: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-comment/replies/',
  messengerProfile: 'https://developers.facebook.com/documentation/business-messaging/messenger-platform/identity/user-profile',
  businessAssetUserProfile: 'https://developers.facebook.com/docs/features-reference/business-asset-user-profile-access/',
  permissions: 'https://developers.facebook.com/docs/permissions/',
  instagramMessaging: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/',
  businessPages: 'https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/pages/',
};

function readSource(relPath) {
  const abs = path.join(backendRoot, relPath);
  const text = fs.readFileSync(abs, 'utf8');
  return {
    relPath,
    abs,
    text,
    lines: text.split(/\r?\n/),
  };
}

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function parseQuotedList(body) {
  const withoutComments = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const values = [];
  const re = /['"]([^'"]+)['"]/g;
  let match;
  while ((match = re.exec(withoutComments))) {
    values.push(match[1]);
  }
  return values;
}

function extractArrayDeclarations(source) {
  const arrays = [];
  const re = /\b(?:const|let)\s+([A-Za-z0-9_]+)\s*=\s*\[([\s\S]*?)\];/g;
  let match;
  while ((match = re.exec(source.text))) {
    const name = match[1];
    if (!/(SCOPES|WEBHOOK_FIELDS|unifiedScopes)/.test(name)) continue;
    const values = parseQuotedList(match[2]);
    arrays.push({
      name,
      values,
      file: source.relPath,
      line: lineNumberForIndex(source.text, match.index),
    });
  }
  return arrays;
}

function nearestFunctionName(lines, index) {
  for (let i = index; i >= 0; i -= 1) {
    const line = lines[i];
    let m = line.match(/\basync\s+([A-Za-z0-9_]+)\s*\(/);
    if (m) return m[1];
    m = line.match(/\b([A-Za-z0-9_]+)\s*=\s*async\s*\(/);
    if (m) return m[1];
    m = line.match(/\b(static\s+)?([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/);
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'function'].includes(m[2])) return m[2];
  }
  return '(module scope)';
}

function previousAssignment(lines, index, varName) {
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(?:let|const|var)?\\s*${escaped}\\s*=\\s*([^\n;]+)`);
  for (let i = index; i >= 0; i -= 1) {
    const match = lines[i].match(re);
    if (match) return match[1].trim();
  }
  return null;
}

function previousObjectBlock(lines, index, varName) {
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = new RegExp(`\\b(?:let|const|var)\\s+${escaped}\\s*=\\s*\\{`);
  for (let i = index; i >= 0; i -= 1) {
    if (!startRe.test(lines[i])) continue;
    const block = [];
    for (let j = i; j < Math.min(lines.length, i + 40); j += 1) {
      block.push(lines[j]);
      if (/^\s*};?\s*$/.test(lines[j])) break;
    }
    return block.join('\n');
  }
  return '';
}

function collectCallBlock(lines, startIndex) {
  const chunk = [];
  let parens = 0;
  let started = false;
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 28); i += 1) {
    const line = lines[i];
    chunk.push(line);
    for (const char of line) {
      if (char === '(') {
        parens += 1;
        started = true;
      } else if (char === ')') {
        parens -= 1;
      }
    }
    if (started && parens <= 0 && /[);]\s*$/.test(line.trim())) break;
  }
  return chunk.join('\n');
}

function normalizeEndpoint(raw) {
  if (!raw) return '(dynamic)';
  let endpoint = raw.trim();
  endpoint = endpoint.replace(/^`|`$/g, '').replace(/^['"]|['"]$/g, '');
  endpoint = endpoint.replace(/\$\{GRAPH_BASE\}/g, '');
  endpoint = endpoint.replace(/https:\/\/graph\.facebook\.com\/\$\{GRAPH_VERSION\}/g, '');
  endpoint = endpoint.replace(/https:\/\/graph\.facebook\.com\/[A-Za-z0-9_.-]+/g, '');
  endpoint = endpoint.replace(/https:\/\/www\.facebook\.com\/\$\{GRAPH_VERSION\}/g, 'https://www.facebook.com/{graph-version}');
  endpoint = endpoint.replace(/\$\{encodeURIComponent\(psid\)\}/g, '{psid}');
  endpoint = endpoint.replace(/\$\{channel\.meta_asset_id\}/g, '{meta-asset-id}');
  endpoint = endpoint.replace(/\$\{channel\.linked_fb_page_id \|\| channel\.meta_asset_id\}/g, '{page-or-ig-id}');
  endpoint = endpoint.replace(/\$\{assetId\}/g, '{asset-id}');
  endpoint = endpoint.replace(/\$\{parentPage\.id\}/g, '{parent-page-id}');
  endpoint = endpoint.replace(/\$\{commentId\}/g, '{comment-id}');
  endpoint = endpoint.replace(/\$\{targetId\}/g, '{target-id}');
  endpoint = endpoint.replace(/\$\{subscribeTargetId\}/g, '{subscribe-target-id}');
  endpoint = endpoint.replace(/\$\{biz\.id\}/g, '{business-id}');
  endpoint = endpoint.replace(/\$\{edge\}/g, '{owned_pages|client_pages}');
  endpoint = endpoint.replace(/\$\{GRAPH_VERSION\}/g, '{graph-version}');
  endpoint = endpoint.replace(/\?.*$/, '');
  return endpoint || '/';
}

function firstArgVariable(block) {
  const firstArgMatch = block.match(/axios\.(?:get|post|delete|put|patch)\(\s*([A-Za-z0-9_]+)/);
  return firstArgMatch ? firstArgMatch[1] : null;
}

function firstEndpointExpression(block, lines, index) {
  const graphMatch = block.match(/`(\$\{GRAPH_BASE\}[^`]+)`/);
  if (graphMatch) return graphMatch[1];

  const facebookDialogMatch = block.match(/`(https:\/\/www\.facebook\.com\/\$\{GRAPH_VERSION\}\/dialog\/oauth[^`]+)`/);
  if (facebookDialogMatch) return facebookDialogMatch[1];

  const quotedGraphMatch = block.match(/['"](https:\/\/graph\.facebook\.com\/[^'"]+)['"]/);
  if (quotedGraphMatch) return quotedGraphMatch[1];

  const argVariable = firstArgVariable(block);
  if (argVariable) {
    const assignment = previousAssignment(lines, index, argVariable);
    if (assignment) return assignment.replace(/,$/, '');
  }

  return null;
}

function extractNearbyFields(block) {
  const fields = [];
  const fieldRe = /\bfields\s*:\s*('([^']*)'|"([^"]*)"|[A-Za-z0-9_.$]+)/g;
  let match;
  while ((match = fieldRe.exec(block))) {
    fields.push((match[2] || match[3] || match[1]).trim());
  }
  if (/subscribed_fields\s*:\s*this\.webhookFields\(\)\.join/.test(block)) {
    fields.push('subscribed_fields=this.webhookFields().join(",")');
  }
  return fields;
}

function parameterBlocksForCall(block, lines, index) {
  const names = new Set();
  if (/\{\s*params\s*\}/.test(block)) names.add('params');
  const paramsRe = /\bparams\s*:\s*([A-Za-z0-9_]+)/g;
  let match;
  while ((match = paramsRe.exec(block))) names.add(match[1]);
  return [...names]
    .map((name) => previousObjectBlock(lines, index, name))
    .filter(Boolean);
}

function extractGraphCalls(source) {
  const calls = [];
  for (let i = 0; i < source.lines.length; i += 1) {
    const line = source.lines[i];

    const axiosMatch = line.match(/\baxios\.(get|post|delete|put|patch)\s*\(/);
    if (axiosMatch) {
      const block = collectCallBlock(source.lines, i);
      const expr = firstEndpointExpression(block, source.lines, i);
      if (!expr || !/GRAPH_BASE|graph\.facebook\.com|oauth\/access_token|subscribed_apps|me\/accounts|me\/businesses/.test(expr + block)) {
        continue;
      }
      calls.push({
        method: axiosMatch[1].toUpperCase(),
        endpoint: normalizeEndpoint(expr),
        expression: expr || '(dynamic)',
        fields: extractNearbyFields([block, ...parameterBlocksForCall(block, source.lines, i)].join('\n')),
        functionName: nearestFunctionName(source.lines, i),
        file: source.relPath,
        line: i + 1,
      });
      continue;
    }

    if (line.includes('facebook.com/${GRAPH_VERSION}/dialog/oauth')) {
      calls.push({
        method: 'OAUTH_REDIRECT',
        endpoint: 'https://www.facebook.com/{graph-version}/dialog/oauth',
        expression: line.trim(),
        fields: ['scope=' + (nearestFunctionName(source.lines, i) === 'initiateUnifiedOAuth' ? 'unifiedScopes' : 'DEFAULT_SCOPES')],
        functionName: nearestFunctionName(source.lines, i),
        file: source.relPath,
        line: i + 1,
      });
    }
  }
  return dedupeCalls(calls);
}

function dedupeCalls(calls) {
  const seen = new Set();
  const result = [];
  for (const call of calls) {
    const key = [call.method, call.endpoint, call.file, call.line].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(call);
  }
  return result;
}

function extractWebhookHandlers(source) {
  const handlers = [];
  for (let i = 0; i < source.lines.length; i += 1) {
    const line = source.lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    const objectMatches = [...line.matchAll(/payload\.object\s*={2,3}\s*['"]([^'"]+)['"]/g)];
    for (const match of objectMatches) {
      handlers.push({
        type: 'object',
        value: match[1],
        functionName: nearestFunctionName(source.lines, i),
        file: source.relPath,
        line: i + 1,
      });
    }
    const fieldMatches = [...line.matchAll(/(?:change\.field|field)\s*!?={2,3}\s*['"]([^'"]+)['"]/g)];
    for (const match of fieldMatches) {
      handlers.push({
        type: 'field',
        value: match[1],
        functionName: nearestFunctionName(source.lines, i),
        file: source.relPath,
        line: i + 1,
      });
    }
    if (/entry\.messaging|messaging\.message|message\.message/.test(line)) {
      handlers.push({
        type: 'field',
        value: 'messages',
        functionName: nearestFunctionName(source.lines, i),
        file: source.relPath,
        line: i + 1,
      });
    }
    if (/messaging\.optin|message\.optin/.test(line)) {
      handlers.push({
        type: 'field',
        value: 'messaging_optins',
        functionName: nearestFunctionName(source.lines, i),
        file: source.relPath,
        line: i + 1,
      });
    }
  }
  return handlers;
}

function providerNameFromFile(file) {
  if (file.includes('MetaMessengerProvider')) return 'facebook';
  if (file.includes('MetaInstagramProvider')) return 'instagram';
  return 'shared';
}

function sourceLink(item) {
  return `${item.file}:${item.line}`;
}

function mdTable(headers, rows) {
  const escape = (value) => String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
  const lines = [];
  lines.push(`| ${headers.map(escape).join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.map(escape).join(' | ')} |`);
  }
  return lines.join('\n');
}

function groupBy(array, keyFn) {
  const map = new Map();
  for (const item of array) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function unique(values) {
  return [...new Set(values)].sort();
}

function inferUsedEvidence(scope, graphCalls, webhookArrays, handlers) {
  const endpointLines = graphCalls.filter((call) => {
    const ep = call.endpoint;
    const isFbProvider = call.file.includes('MetaMessengerProvider');
    const isIgProvider = call.file.includes('MetaInstagramProvider');
    if (scope === 'pages_show_list') return ep.includes('/me/accounts');
    if (scope === 'pages_messaging') return (isFbProvider && (ep.includes('/me/messages') || ep.includes('/private_replies'))) || ep.includes('/{psid}');
    if (scope === 'pages_read_engagement') return isFbProvider && ep === '/{meta-asset-id}';
    if (scope === 'pages_manage_metadata') return ep.includes('/subscribed_apps');
    if (scope === 'pages_manage_engagement') return ep.includes('/comments');
    if (scope === 'instagram_basic') return ep.includes('/me/accounts');
    if (scope === 'instagram_manage_messages') return isIgProvider && ep.includes('/me/messages');
    if (scope === 'instagram_manage_comments') return isIgProvider && (ep.includes('/replies') || ep.includes('/private_replies'));
    if (scope === 'business_management') return ep.includes('/me/businesses') || ep.includes('/{owned_pages|client_pages}');
    return false;
  });

  const hookLines = [];
  for (const arr of webhookArrays) {
    const provider = providerNameFromFile(arr.file);
    const values = arr.values;
    if (scope === 'pages_messaging' && provider === 'facebook' && values.some((f) => f.startsWith('messag'))) hookLines.push(sourceLink(arr));
    if (scope === 'pages_read_engagement' && provider === 'facebook' && values.includes('feed')) hookLines.push(sourceLink(arr));
    if (scope === 'pages_manage_metadata' && values.length) hookLines.push(sourceLink(arr));
    if (scope === 'instagram_manage_messages' && provider === 'instagram' && values.includes('messages')) hookLines.push(sourceLink(arr));
    if (scope === 'instagram_manage_comments' && provider === 'instagram' && (values.includes('comments') || values.includes('live_comments'))) hookLines.push(sourceLink(arr));
  }

  const handlerLines = handlers.filter((h) => {
    if (scope === 'pages_messaging') return (h.functionName === 'handlePageWebhook' || h.functionName === 'parseWebhookEnvelope') && (h.value === 'messages' || h.value === 'messaging_optins') && !h.file.includes('MetaInstagramProvider');
    if (scope === 'pages_read_engagement') return h.value === 'feed';
    if (scope === 'instagram_manage_messages') return (h.functionName === 'handleInstagramWebhook' || h.file.includes('MetaInstagramProvider')) && h.value === 'messages';
    if (scope === 'instagram_manage_comments') return h.value === 'comments' || h.value === 'live_comments';
    return false;
  }).map(sourceLink);

  return unique([
    ...endpointLines.map(sourceLink),
    ...hookLines,
    ...handlerLines,
  ]);
}

function permissionNotes(scope) {
  const notes = {
    pages_show_list: 'Required by the code path that lists Pages with /me/accounts before the merchant chooses an asset.',
    pages_messaging: 'Required for Messenger send/private-reply behavior and Messenger message webhooks. Profile enrichment may also require the Business Asset User Profile Access feature.',
    pages_read_engagement: 'Used for Page/comment event visibility and Page asset reads. If the app only consumes feed webhooks, keep the reviewer story tied to comment-triggered automation.',
    pages_manage_metadata: 'Required for POST/GET/DELETE on /{page-id}/subscribed_apps.',
    pages_manage_engagement: 'Required for Facebook public comment replies on Page content.',
    instagram_basic: 'Required to discover and display linked Instagram business account details from Page account listing.',
    instagram_manage_messages: 'Required for Instagram Direct message send/receive.',
    instagram_manage_comments: 'Required for Instagram comment webhooks and public replies.',
    business_management: 'Optional code path only. It is not in any extracted OAuth scope list.',
  };
  return notes[scope] || '';
}

function subscribedButUnhandled(webhookArrays, handlers) {
  const handled = new Set(handlers.filter((h) => h.type === 'field').map((h) => h.value));
  const rows = [];
  for (const arr of webhookArrays) {
    const provider = providerNameFromFile(arr.file);
    for (const field of arr.values) {
      if (!handled.has(field)) {
        rows.push([provider, field, sourceLink(arr)]);
      }
    }
  }
  return rows;
}

function generate() {
  const sources = SOURCE_FILES.map(readSource);
  const arrays = sources.flatMap(extractArrayDeclarations);
  const scopeArrays = arrays.filter((arr) => /SCOPES|unifiedScopes/.test(arr.name));
  const webhookArrays = arrays.filter((arr) => arr.name === 'WEBHOOK_FIELDS');
  const graphCalls = sources.flatMap(extractGraphCalls);
  const webhookHandlers = sources.flatMap(extractWebhookHandlers);

  const requestedScopes = unique(scopeArrays.flatMap((arr) => arr.values));
  const scopesByName = groupBy(scopeArrays.flatMap((arr) => arr.values.map((scope) => ({ scope, source: sourceLink(arr), array: arr.name }))), (x) => x.scope);

  const out = [];
  out.push('# Meta Implementation Audit (Generated)');
  out.push('');
  out.push('This file is generated from source code by `EasyMod-backend/scripts/meta-implementation-audit.js`. Rerun the script after code changes.');
  out.push('');
  out.push('## Source Files Read');
  out.push('');
  for (const file of SOURCE_FILES) out.push(`- \`${file}\``);
  out.push('');

  out.push('## OAuth Scopes Requested By Code');
  out.push('');
  out.push(mdTable(
    ['Scope', 'Extracted from'],
    requestedScopes.map((scope) => [
      `\`${scope}\``,
      scopesByName.get(scope).map((x) => `\`${x.array}\` at ${x.source}`).join('<br>'),
    ])
  ));
  out.push('');

  const optionalBusinessCalls = graphCalls.filter((call) => call.endpoint.includes('/me/businesses') || call.endpoint.includes('/{owned_pages|client_pages}'));
  out.push('### Explicit Non-Request Check');
  out.push('');
  out.push(`- \`business_management\` requested by OAuth scope arrays: ${requestedScopes.includes('business_management') ? 'YES' : 'NO'}.`);
  if (optionalBusinessCalls.length) {
    out.push(`- Business Portfolio discovery code exists (${optionalBusinessCalls.map(sourceLink).join(', ')}) but is guarded by \`includeBusinessPortfolio\` and no current OAuth flow requests the permission.`);
  }
  out.push('');

  out.push('## Graph API Endpoints Used By Code');
  out.push('');
  out.push(mdTable(
    ['Method', 'Endpoint', 'Function', 'Source', 'Fields / Params'],
    graphCalls.map((call) => [
      call.method,
      `\`${call.endpoint}\``,
      `\`${call.functionName}\``,
      sourceLink(call),
      call.fields.length ? call.fields.map((f) => `\`${f}\``).join('<br>') : '',
    ])
  ));
  out.push('');

  out.push('## Webhook Subscriptions Extracted From Providers');
  out.push('');
  out.push(mdTable(
    ['Provider', 'Subscribed fields', 'Source'],
    webhookArrays.map((arr) => [
      providerNameFromFile(arr.file),
      arr.values.map((v) => `\`${v}\``).join(', '),
      sourceLink(arr),
    ])
  ));
  out.push('');

  out.push('## Webhook Handling Observed In Code');
  out.push('');
  const handlerRows = unique(webhookHandlers.map((h) => `${h.type}|${h.value}|${h.functionName}|${sourceLink(h)}`))
    .map((row) => row.split('|'));
  out.push(mdTable(['Type', 'Object / Field', 'Function', 'Source'], handlerRows));
  out.push('');

  const unhandled = subscribedButUnhandled(webhookArrays, webhookHandlers);
  out.push('## Subscribed Webhook Fields Without Direct Handler Evidence');
  out.push('');
  out.push(unhandled.length
    ? mdTable(['Provider', 'Field', 'Subscribed at'], unhandled)
    : 'All subscribed fields have direct handler evidence.');
  out.push('');

  out.push('## Permission Reviewer Script');
  out.push('');
  out.push('Use this as the App Review script/checklist. Each permission below is included only because it appears in an extracted OAuth scope array.');
  out.push('');
  out.push(mdTable(
    ['Permission', 'Code-derived evidence', 'Reviewer action'],
    requestedScopes.map((scope) => {
      const evidence = inferUsedEvidence(scope, graphCalls, webhookArrays, webhookHandlers);
      return [
        `\`${scope}\``,
        evidence.length ? evidence.join('<br>') : 'No direct code evidence found',
        permissionNotes(scope),
      ];
    })
  ));
  out.push('');

  out.push('## Audit Findings From Code');
  out.push('');
  out.push('- P1: Verify the live token can create a Facebook public comment reply with `pages_manage_engagement` before submission; this is the review-critical Page comment permission.');
  out.push('- P1: Keep Page `subscribed_apps` fields limited to reviewer-visible valid Page fields (`messages`, `feed`). Configure Instagram-object fields (`messages`, `comments`) in the Meta App Dashboard object subscription, not the Page `subscribed_apps` call.');
  out.push('- P2: `business_management` should stay out of App Review unless `includeBusinessPortfolio` is exposed and used. The current unified OAuth flow explicitly avoids it.');
  out.push('- P2: `GET /{psid}` profile enrichment is best-effort. If reviewer materials promise customer names/profile pictures, also request/verify Business Asset User Profile Access; otherwise keep the feature out of the required-permission story.');
  out.push('- P2: `verifyWebhookSubscription()` verifies the provider-required Page fields. Instagram `comments` still require a separate Meta App Dashboard Instagram-object subscription check before final App Review submission.');
  out.push('');

  out.push('## Official Meta References Used For Verification');
  out.push('');
  for (const [label, url] of Object.entries(OFFICIAL_DOCS)) {
    out.push(`- ${label}: ${url}`);
  }
  out.push('');

  return out.join('\n');
}

function main() {
  const output = generate();
  const writeIndex = process.argv.indexOf('--write');
  if (writeIndex !== -1) {
    const targetArg = process.argv[writeIndex + 1];
    if (!targetArg) {
      throw new Error('--write requires a target path');
    }
    const target = path.resolve(process.cwd(), targetArg);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, 'utf8');
    console.log(`Wrote ${path.relative(repoRoot, target)}`);
    return;
  }
  console.log(output);
}

if (require.main === module) {
  main();
}

module.exports = { generate };
