import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const SHOP_A_EMAIL = process.env.OPS_E2E_SHOP_A_EMAIL || 'closure.a.owner@ops.easymod.test';
const SHOP_B_EMAIL = process.env.OPS_E2E_SHOP_B_EMAIL || 'closure.b.owner@ops.easymod.test';
const PASSWORD = process.env.OPS_E2E_PASSWORD;

const FIXTURE = {
  currentBuyer: 'Ops Closure Current Buyer A',
  currentFirefoxBuyer: 'Ops Closure Current Buyer Firefox A',
  expiredBuyer: 'Ops Closure Expired Buyer A',
  expiredFirefoxBuyer: 'Ops Closure Expired Buyer Firefox A',
  handoffBuyer: 'Ops Closure Handoff Buyer A',
  handoffFirefoxBuyer: 'Ops Closure Handoff Buyer Firefox A',
  shopBBuyer: 'Ops Closure Buyer B',
  orderNumber: 'OGCE2E-A-1001',
  tagName: 'Priority follow up',
  currentDraft: 'I can check the current catalog details for you.',
  currentFirefoxDraft: 'I can check the current catalog details for you in Firefox.',
  expiredDraft: 'Here are the details from the shop catalog.',
} as const;

type AnyRecord = Record<string, any>;

function baseUrlFor(testProject: string | undefined): string {
  const value = testProject || process.env.OPS_E2E_BASE_URL || 'https://127.0.0.1:54680';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

async function createMerchantContext(browser: Browser, baseURL: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(baseURL).origin,
        localStorage: [{ name: 'easymod_lang', value: 'en' }],
      }],
    },
  });
  const allowedOrigin = new URL(baseURL).origin;
  await context.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === allowedOrigin || requestUrl.protocol === 'data:' || requestUrl.protocol === 'blob:') {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });
  return context;
}

async function signIn(page: Page, context: BrowserContext, baseURL: string, email: string) {
  await page.goto(`${baseURL}/signin`);
  await expect(page.locator('#email')).toBeVisible();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD!);

  const signinResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/api/auth/signin')
  ));
  await page.getByRole('button', { name: /sign in/i }).click();
  const response = await signinResponse;
  expect(response.status(), `sign-in response for ${email}`).toBe(200);
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);

  // Authentication remains in the browser's HttpOnly cookie jar. Never copy
  // the token into test code, logs, local storage, or a fixture file.
  const cookies = await context.cookies(baseURL);
  expect(cookies.some((cookie) => (
    cookie.name === 'access_token' && cookie.httpOnly && cookie.secure
  ))).toBe(true);
}

async function getJson(context: BrowserContext, baseURL: string, path: string) {
  const response = await context.request.get(`${baseURL}${path}`);
  const body = await response.json().catch(() => ({}));
  return { response, body: body as AnyRecord };
}

async function listConversations(context: BrowserContext, baseURL: string): Promise<AnyRecord[]> {
  const { response, body } = await getJson(context, baseURL, '/api/conversation?limit=100');
  expect(response.status(), 'authenticated conversation list').toBe(200);
  const rows = body.data?.conversations ?? body.data?.data ?? [];
  expect(Array.isArray(rows), 'conversation API returns a list').toBe(true);
  return rows;
}

function conversationFor(rows: AnyRecord[], customerName: string): AnyRecord {
  const row = rows.find((conversation) => conversation.customer?.name === customerName);
  if (!row) throw new Error(`Missing synthetic conversation for ${customerName}`);
  return row;
}

async function loadMessages(context: BrowserContext, baseURL: string, conversationId: string): Promise<AnyRecord> {
  const { response, body } = await getJson(
    context,
    baseURL,
    `/api/conversation/${encodeURIComponent(conversationId)}/messages?limit=50`,
  );
  expect(response.status(), `messages for ${conversationId}`).toBe(200);
  return body.data;
}

function draftFor(payload: AnyRecord, content: string): AnyRecord {
  const row = (payload.suggestions || []).find((message: AnyRecord) => (
    message.sender === 'ai' && (message.ai_suggestion === content || message.content === content)
  ));
  if (!row) throw new Error(`Missing reviewable synthetic draft: ${content}`);
  return row;
}

test('authenticated merchant workflow stays shop-scoped and closes the operational gates', async ({ browser }, testInfo) => {
  const baseURL = baseUrlFor(testInfo.project.use.baseURL as string | undefined);
  const contextA = await createMerchantContext(browser, baseURL);
  const contextB = await createMerchantContext(browser, baseURL);

  try {
    const pageA = await contextA.newPage();
    await signIn(pageA, contextA, baseURL, SHOP_A_EMAIL);
    await pageA.goto(`${baseURL}/inbox`);

    await expect(pageA.getByRole('button', { name: new RegExp(FIXTURE.currentBuyer) })).toBeVisible();
    const expiredBuyerName = testInfo.project.name === 'firefox'
      ? FIXTURE.expiredFirefoxBuyer
      : FIXTURE.expiredBuyer;
    const handoffBuyerName = testInfo.project.name === 'firefox'
      ? FIXTURE.handoffFirefoxBuyer
      : FIXTURE.handoffBuyer;
    await expect(pageA.getByRole('button', { name: new RegExp(expiredBuyerName) })).toBeVisible();
    await expect(pageA.getByRole('button', { name: new RegExp(handoffBuyerName) })).toBeVisible();
    await expect(pageA.getByText(FIXTURE.shopBBuyer, { exact: false })).toHaveCount(0);

    const conversationsA = await listConversations(contextA, baseURL);
    const current = conversationFor(conversationsA, FIXTURE.currentBuyer);
    const currentFirefox = conversationFor(conversationsA, FIXTURE.currentFirefoxBuyer);
    const expired = conversationFor(conversationsA, expiredBuyerName);
    const handoff = conversationFor(conversationsA, handoffBuyerName);
    const customerAId = String(current.customer_id || current.customer?.id || '');
    expect(customerAId).not.toBe('');

    const { response: ordersListResponse, body: ordersListBody } = await getJson(
      contextA,
      baseURL,
      `/api/order?customer_id=${encodeURIComponent(customerAId)}&limit=20`,
    );
    expect(ordersListResponse.status()).toBe(200);
    const ordersForCurrent = Array.isArray(ordersListBody.data)
      ? ordersListBody.data
      : ordersListBody.data?.orders || [];
    const orderA = ordersForCurrent.find((order: AnyRecord) => (
      order.order_number === FIXTURE.orderNumber || order.orderNumber === FIXTURE.orderNumber
    ));
    if (!orderA) throw new Error(`Missing Shop A order ${FIXTURE.orderNumber}`);
    const orderAId = String(orderA.id);

    // Inbox → customer context: order, staff-private note, and merchant tag.
    await pageA.getByRole('button', { name: new RegExp(FIXTURE.currentBuyer) }).click();
    await pageA.getByTestId('context-toggle').click();
    const panelA = pageA.getByTestId('customer-context-panel');
    await expect(panelA).toContainText(FIXTURE.currentBuyer);
    const orderLink = panelA.getByTestId('context-order-row');
    await expect(orderLink).toContainText(FIXTURE.orderNumber);

    const privateNote = `Synthetic Gate Closure note: callback after 3 PM. Run ${Date.now()}.`;
    await panelA.getByTestId('note-add-open').click();
    await panelA.getByTestId('note-composer').fill(privateNote);
    const noteCreateResponsePromise = pageA.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.status() === 201
      && new URL(response.url()).pathname === `/api/customer/${customerAId}/notes`
    ));
    await panelA.getByTestId('note-save').click();
    const noteCreateResponse = await noteCreateResponsePromise;
    const noteCreateBody = await noteCreateResponse.json();
    expect(noteCreateResponse.status(), `customer note create (${noteCreateBody.code || noteCreateBody.error?.code || noteCreateBody.message || 'no error details'})`).toBe(201);
    const privateNotesSection = panelA.getByRole('region', { name: 'Private notes' });
    await expect(privateNotesSection.locator('li').filter({ hasText: privateNote })).toHaveCount(1);

    await panelA.getByTestId('tag-edit-open').click();
    const tagChoice = panelA.getByRole('button', { name: new RegExp(FIXTURE.tagName) });
    await expect(tagChoice).toBeVisible();
    if (await tagChoice.getAttribute('aria-pressed') !== 'true') await tagChoice.click();
    const tagAssignmentResponsePromise = pageA.waitForResponse((response) => (
      response.request().method() === 'PUT'
      && response.status() === 200
      && new URL(response.url()).pathname === `/api/customer/${customerAId}/tags`
    ));
    await panelA.getByTestId('tag-apply').click();
    const tagAssignmentResponse = await tagAssignmentResponsePromise;
    const tagAssignmentBody = await tagAssignmentResponse.json();
    expect(tagAssignmentResponse.status(), `customer tag assignment (${tagAssignmentBody.code || tagAssignmentBody.error?.code || tagAssignmentBody.message || 'no error details'})`).toBe(200);
    const tagsSection = panelA.getByRole('region', { name: 'Tags' });
    await expect(tagsSection.getByText(FIXTURE.tagName, { exact: true })).toBeVisible();

    const profileLink = panelA.getByRole('link', { name: /view customer profile/i });
    await profileLink.click();
    await expect(pageA).toHaveURL(new RegExp(`/customers\\?customerId=${encodeURIComponent(customerAId)}(?:&|$)`));
    await expect(pageA.getByRole('heading', { name: /customer/i })).toBeVisible();
    const customerRow = pageA.getByRole('row').filter({ hasText: FIXTURE.currentBuyer });
    await expect(customerRow).toBeVisible();
    await customerRow.getByRole('button', { name: /^view$/i }).click();
    const customerDetailsHeading = pageA.getByRole('heading', { name: /customer details/i });
    await expect(customerDetailsHeading).toBeVisible();
    const customerDrawer = pageA.locator('div.fixed').filter({ has: customerDetailsHeading });
    await expect(customerDrawer.getByRole('heading', { name: FIXTURE.currentBuyer, exact: true })).toBeVisible();

    // Follow the context panel's order deep link through the real Orders UI.
    await pageA.goto(`${baseURL}/inbox?conversation=${encodeURIComponent(current.id)}`);
    await expect(pageA.getByTestId('context-toggle')).toBeVisible();
    await pageA.getByTestId('context-toggle').click();
    const orderRow = pageA.getByTestId('customer-context-panel').getByTestId('context-order-row');
    await expect(orderRow).toContainText(FIXTURE.orderNumber);
    await orderRow.click();
    await expect(pageA).toHaveURL(/\/orders(?:\?|$)/);
    await expect(pageA.getByRole('heading', { name: /order details/i })).toBeVisible();
    const orderHeading = pageA.getByRole('heading', { name: /order details/i });
    const orderDetailId = await orderHeading.locator('..').locator('p').first().textContent();
    expect(orderDetailId?.trim()).toBe(orderAId);

    // Current-window draft approval reaches the backend. The isolated fixture
    // has no MetaChannel, so this must fail before a provider call or ack.
    const approvalConversation = testInfo.project.name === 'firefox' ? currentFirefox : current;
    const approvalDraftText = testInfo.project.name === 'firefox' ? FIXTURE.currentFirefoxDraft : FIXTURE.currentDraft;
    const currentMessages = await loadMessages(contextA, baseURL, String(approvalConversation.id));
    const currentDraft = draftFor(currentMessages, approvalDraftText);
    const approveResponsePromise = pageA.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes(`/api/conversation/${approvalConversation.id}/messages/${currentDraft.id}/approve`)
    ));
    await pageA.goto(`${baseURL}/inbox?conversation=${encodeURIComponent(approvalConversation.id)}`);
    await expect(pageA.getByRole('button', { name: /send this/i })).toBeVisible();
    await pageA.getByRole('button', { name: /send this/i }).click();
    const approvalResponse = await approveResponsePromise;
    expect(approvalResponse.status()).toBe(409);
    const approvalBody = await approvalResponse.json();
    expect(approvalBody.code).toBe('DRAFT_DELIVERY_NOT_CONFIRMED');
    expect(String(approvalBody.message || '')).toMatch(/no active facebook channel/i);

    const currentAfterApproval = draftFor(
      await loadMessages(contextA, baseURL, String(approvalConversation.id)),
      approvalDraftText,
    );
    expect(String(currentAfterApproval.delivery_state || '').toUpperCase()).not.toMatch(/^(SENT|DELIVERED)$/);
    expect(currentAfterApproval.provider_message_id || currentAfterApproval.metadata?.provider_message_id).toBeFalsy();
    expect(currentAfterApproval.metadata?.provider_send_attempted).not.toBe(true);

    // Expired-window approval is blocked in the UI and never reaches /approve;
    // explicit dismissal is still persisted through the authenticated API.
    const expiredMessages = await loadMessages(contextA, baseURL, String(expired.id));
    const expiredDraft = draftFor(expiredMessages, FIXTURE.expiredDraft);
    let approveRequestCount = 0;
    pageA.on('request', (request) => {
      if (request.method() === 'POST' && /\/messages\/[^/]+\/approve(?:\?|$)/.test(request.url())) {
        approveRequestCount += 1;
      }
    });
    const approvesBeforeExpired = approveRequestCount;
    await pageA.goto(`${baseURL}/inbox?conversation=${encodeURIComponent(expired.id)}`);
    await expect(pageA.getByText(/direct messenger replies are blocked until the customer messages again|outside the 24-hour reply window/i)).toBeVisible();
    await pageA.getByRole('button', { name: /send this/i }).click();
    await expect(pageA.getByText(/outside the 24-hour reply window/i)).toBeVisible();
    expect(approveRequestCount).toBe(approvesBeforeExpired);

    const dismissResponsePromise = pageA.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes(`/api/conversation/${expired.id}/messages/${expiredDraft.id}/dismiss`)
    ));
    await pageA.getByRole('button', { name: /^dismiss$/i }).click();
    const dismissResponse = await dismissResponsePromise;
    expect(dismissResponse.status()).toBe(200);
    const dismissedBody = await dismissResponse.json();
    expect(String(dismissedBody.data?.message?.delivery_state || '').toUpperCase()).toBe('DISMISSED');

    // Human handoff: claim from the customer context, resolve with a note, and
    // verify the persisted closed state from the tenant-scoped API.
    await pageA.goto(`${baseURL}/inbox?conversation=${encodeURIComponent(handoff.id)}`);
    await pageA.getByTestId('context-toggle').click();
    const handoffPanel = pageA.getByTestId('customer-context-panel');
    await expect(handoffPanel.getByTestId('context-owner')).toContainText(/no one has taken this yet/i);
    const claimResponsePromise = pageA.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && response.url().endsWith(`/api/conversation/${handoff.id}`)
    ));
    await handoffPanel.getByTestId('context-claim').click();
    expect((await claimResponsePromise).status()).toBe(200);
    await expect(handoffPanel.getByTestId('context-owner')).not.toContainText(/no one has taken this yet/i);

    const resolveResponsePromise = pageA.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && response.url().endsWith(`/api/conversation/${handoff.id}`)
    ));
    await pageA.getByRole('button', { name: /^resolve$/i }).click();
    await expect(pageA.getByRole('heading', { name: /resolve conversation/i })).toBeVisible();
    await pageA.locator('textarea').last().fill('Synthetic Gate Closure handoff resolved by Shop A.');
    await pageA.getByRole('button', { name: /mark resolved/i }).click();
    expect((await resolveResponsePromise).status()).toBe(200);
    const { response: handoffReadResponse, body: handoffReadBody } = await getJson(
      contextA,
      baseURL,
      `/api/conversation/${encodeURIComponent(String(handoff.id))}`,
    );
    expect(handoffReadResponse.status()).toBe(200);
    expect(handoffReadBody.data).toMatchObject({ status: 'closed', hitl: false });
    expect(handoffReadBody.data.resolution_note).toContain('Synthetic Gate Closure handoff resolved');

    // Shop B uses a separate browser cookie jar and can see only its own data.
    const pageB = await contextB.newPage();
    await signIn(pageB, contextB, baseURL, SHOP_B_EMAIL);
    await pageB.goto(`${baseURL}/inbox`);
    await expect(pageB.getByRole('button', { name: new RegExp(FIXTURE.shopBBuyer) })).toBeVisible();
    await expect(pageB.getByText(FIXTURE.currentBuyer, { exact: false })).toHaveCount(0);

    const conversationsB = await listConversations(contextB, baseURL);
    expect(conversationsB.map((row) => row.customer?.name)).toEqual([FIXTURE.shopBBuyer]);

    for (const path of [
      `/api/conversation/${encodeURIComponent(String(current.id))}`,
      `/api/order/${encodeURIComponent(orderAId)}`,
    ]) {
      const { response } = await getJson(contextB, baseURL, path);
      expect(response.status(), `Shop B cannot read Shop A resource ${path}`).toBe(404);
    }

    const { response: crossShopTagsResponse, body: crossShopTagsBody } = await getJson(
      contextB,
      baseURL,
      `/api/customer/${encodeURIComponent(customerAId)}/tags`,
    );
    expect(crossShopTagsResponse.status(), 'Shop B receives an empty scoped customer-tag list').toBe(200);
    expect(crossShopTagsBody.data?.data).toEqual([]);

    const { response: crossShopNotesResponse, body: crossShopNotesBody } = await getJson(
      contextB,
      baseURL,
      `/api/customer/${encodeURIComponent(customerAId)}/notes`,
    );
    expect(crossShopNotesResponse.status(), 'Shop B receives an empty scoped note list').toBe(200);
    expect(crossShopNotesBody.data?.data).toEqual([]);
    expect(crossShopNotesBody.data?.total).toBe(0);

    const { response: vocabularyResponse, body: vocabularyBody } = await getJson(
      contextB,
      baseURL,
      '/api/customer/tags',
    );
    expect(vocabularyResponse.status()).toBe(200);
    const shopBTags = vocabularyBody.data?.data;
    expect(Array.isArray(shopBTags)).toBe(true);
    expect(shopBTags.map((tag: AnyRecord) => tag.name)).not.toContain(FIXTURE.tagName);

    const deniedCancel = await contextB.request.patch(`${baseURL}/api/order/${encodeURIComponent(orderAId)}`, {
      data: { order_status: 'cancelled' },
    });
    expect(deniedCancel.status(), 'Shop B cannot mutate Shop A commerce records').toBe(404);

    const { response: orderStillAResponse, body: orderStillABody } = await getJson(
      contextA,
      baseURL,
      `/api/order/${encodeURIComponent(orderAId)}`,
    );
    expect(orderStillAResponse.status()).toBe(200);
    expect(orderStillABody.data.order_status).toBe('processing');

  } finally {
    await contextA.close();
    await contextB.close();
  }
});
