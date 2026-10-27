import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const SHOP_B_EMAIL = process.env.OPS_E2E_SHOP_B_EMAIL || 'closure.b.owner@ops.easymod.test';
const PASSWORD = process.env.OPS_E2E_PASSWORD;
const RUN_ID = process.env.OPS_E2E_WEBHOOK_RUN_ID;
const SHOP_B_CUSTOMER = 'Ops Closure Buyer B';
const RUN_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,62}[a-zA-Z0-9])?$/;

if (!PASSWORD || PASSWORD.length < 14) {
  throw new Error('Set OPS_E2E_PASSWORD to the synthetic seed password (14+ characters).');
}
if (!RUN_ID || !RUN_ID_PATTERN.test(RUN_ID)) {
  throw new Error('Set OPS_E2E_WEBHOOK_RUN_ID to the run-id used by the signed webhook helper.');
}

const webhookMessage = `Synthetic worker restart rehearsal ${RUN_ID}.`;

type AnyRecord = Record<string, any>;

function baseUrlFor(projectBaseUrl?: string): string {
  const value = projectBaseUrl || process.env.OPS_E2E_BASE_URL || 'https://127.0.0.1:54680';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

async function createLoopbackContext(browser: Browser, baseURL: string): Promise<BrowserContext> {
  const origin = new URL(baseURL).origin;
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    storageState: {
      cookies: [],
      origins: [{ origin, localStorage: [{ name: 'easymod_lang', value: 'en' }] }],
    },
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });
  return context;
}

async function signIn(page: Page, context: BrowserContext, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/signin`);
  await expect(page.locator('#email')).toBeVisible();
  await page.locator('#email').fill(SHOP_B_EMAIL);
  await page.locator('#password').fill(PASSWORD!);

  const signInResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/api/auth/signin')
  ));
  await page.getByRole('button', { name: /sign in/i }).click();
  const signInResponse = await signInResponsePromise;
  expect(signInResponse.status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);

  const cookies = await context.cookies(baseURL);
  expect(cookies.some((cookie) => (
    cookie.name === 'access_token' && cookie.httpOnly && cookie.secure
  ))).toBe(true);
}

test('Shop B sees the signed inbound message after the isolated worker restarts', async ({ browser }, testInfo) => {
  const baseURL = baseUrlFor(testInfo.project.use.baseURL as string | undefined);
  const context = await createLoopbackContext(browser, baseURL);

  try {
    const page = await context.newPage();
    await signIn(page, context, baseURL);
    await page.goto(`${baseURL}/inbox`);

    const buyerRow = page.getByRole('button', { name: new RegExp(SHOP_B_CUSTOMER) });
    await expect(buyerRow).toBeVisible();
    await buyerRow.click();

    // The conversation preview is rendered before the selected transcript;
    // use the later match to assert the actual Inbox message bubble.
    await expect(page.getByText(webhookMessage, { exact: true }).last()).toBeVisible();

    const conversationResponse = await context.request.get(`${baseURL}/api/conversation?limit=100`);
    expect(conversationResponse.status()).toBe(200);
    const conversationBody = await conversationResponse.json() as AnyRecord;
    const conversations = conversationBody.data?.conversations ?? conversationBody.data?.data ?? [];
    const conversation = conversations.find((row: AnyRecord) => row.customer?.name === SHOP_B_CUSTOMER);
    if (!conversation?.id) throw new Error('Signed in as Shop B but did not find its seeded buyer thread');

    const messagesResponse = await context.request.get(
      `${baseURL}/api/conversation/${encodeURIComponent(String(conversation.id))}/messages?limit=100`,
    );
    expect(messagesResponse.status()).toBe(200);
    const messagesBody = await messagesResponse.json() as AnyRecord;
    const data = messagesBody.data as AnyRecord;
    const transcript = Array.isArray(data?.messages) ? data.messages : [];
    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
    const inbound = transcript.find((row: AnyRecord) => (
      row.sender === 'customer' && row.content === webhookMessage
    ));
    if (!inbound) throw new Error('The signed webhook message is missing from the Shop B transcript');

    const inboundAt = Date.parse(inbound.created_at);
    const aiMessagesAfterInbound = [...transcript, ...suggestions].filter((row: AnyRecord) => (
      row.sender === 'ai'
      && Number.isFinite(inboundAt)
      && Number.isFinite(Date.parse(row.created_at))
      && Date.parse(row.created_at) >= inboundAt
    ));
    expect(aiMessagesAfterInbound, 'Shop B remains MANUAL after worker recovery').toHaveLength(0);
    expect(inbound.provider_message_id).toBeFalsy();
  } finally {
    await context.close();
  }
});
