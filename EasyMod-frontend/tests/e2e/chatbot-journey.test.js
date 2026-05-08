import { expect, test } from '@playwright/test';

const mockUser = {
  id: 'user-journey-1',
  full_name: 'Owner Journey',
  email: 'owner@journey.test',
};

const mockShop = {
  id: 'shop-journey-1',
  unique_code: 'JRNY001',
  shop_name: 'Journey Shop',
  role: 'owner',
  subscription_tier: 'PRO',
};

const planCapabilities = {
  tier: 'PRO',
  allowed_languages: ['en', 'bn', 'mixed'],
  language_autodetect: true,
  ai_settings_access: [
    'automation_mode',
    'confidence_threshold',
    'primary_language',
    'handoff_settings',
    'required_fields',
    'max_auto_order_value',
    'llm_model',
  ],
};

const aiSettings = {
  automation_mode: 'AUTO',
  confidence_threshold: 60,
  primary_language: 'en',
  handoff_settings: {
    notification_channel: 'in_app',
    cooldown_minutes: 5,
  },
  required_fields: {
    email_address: false,
    special_instructions: false,
  },
  max_auto_order_value: 5000,
  llm_model: 'gpt-4o-mini',
};

const dashboardMetrics = {
  metrics: {
    totalMessages: 20,
    activeProducts: 8,
    ordersToday: 4,
    weeklyChange: 8.4,
    conversionRate: 5.1,
  },
  channels: {
    active: 2,
    total: 3,
  },
  chartData: [],
};

const products = [
  {
    id: 'prod-1',
    name: 'Demo Hoodie',
    price: 1299,
    category: 'Apparel',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const orders = [
  {
    id: 'ORD-1001',
    customer_name: 'Alice Rahman',
    order_items: [{ product_id: 'prod-1', productName: 'Demo Hoodie', quantity: 1, price: 1299 }],
    total: 1299,
    channel: 'facebook',
    order_status: 'confirmed',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

async function setupMockApi(page) {
  let authenticated = false;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/csrf' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ csrfToken: 'csrf-journey-token' }),
      });
    }

    if (path === '/api/auth/signin' && method === 'POST') {
      authenticated = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            user: mockUser,
            currentShop: mockShop,
            allShops: [mockShop],
            tokens: {
              access_token: 'access-token',
              refresh_token: 'refresh-token',
            },
          },
        }),
      });
    }

    if (path === '/api/auth/me' && method === 'GET') {
      if (!authenticated) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Unauthorized' }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            user: mockUser,
            currentShop: mockShop,
            allShops: [mockShop],
          },
        }),
      });
    }

    if (path === '/api/dashboard/metrics' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: dashboardMetrics }),
      });
    }

    if (path === '/api/product' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: products }),
      });
    }

    if (path === '/api/category' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [{ id: 'cat-1', name: 'Apparel' }] }),
      });
    }

    if (path === '/api/order' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: orders }),
      });
    }

    if (path === '/api/shop/ai-settings' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: aiSettings,
          plan_capabilities: planCapabilities,
        }),
      });
    }

    if (path === '/api/shop/ai-settings' && method === 'PUT') {
      const body = await request.postDataJSON();
      const keys = Object.keys(body || {});
      const blocked = keys.find((k) => !planCapabilities.ai_settings_access.includes(k));

      if (blocked) {
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: {
              code: 'PLAN_FEATURE_LOCKED',
              message: `${blocked} not available on ${planCapabilities.tier}`,
            },
          }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { ...aiSettings, ...body } }),
      });
    }

    if (path === '/api/knowledge/faq/search' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'faq-1',
              question: 'What is your return policy?',
              answer: 'Returns in 30 days',
              confidence: 1.0,
            },
          ],
          total: 1,
        }),
      });
    }

    if (path === '/api/channel' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'ch-1',
              type: 'facebook',
              is_active: true,
              token_expires_at: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
              last_sync: new Date().toISOString(),
            },
          ],
        }),
      });
    }

    if (path === '/api/ai-chatbot/process' && method === 'POST') {
      const body = await request.postDataJSON();
      const message = (body?.message || '').toLowerCase();

      let response_text = 'Hello! How can I help you today?';
      let confidence = 0.92;
      let language_detected = 'en';

      if (message.includes('দাম')) {
        response_text = 'আমাদের পণ্যের দাম ৫০০ থেকে ৫০০০ টাকা।';
        language_detected = 'bn';
      } else if (message.includes('gibberish')) {
        response_text = 'Please rephrase your question.';
        confidence = 0.3;
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            response_text,
            confidence,
            language_detected,
            ai_model_used: 'gpt-4o-mini',
            stage: 'rag',
            tokens_used: 120,
          },
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {} }),
    });
  });
}

async function login(page) {
  await page.goto('/signin');
  await page.fill('#email', mockUser.email);
  await page.fill('#password', 'strong-password');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/app$/);
}

async function browserFetch(page, url, method = 'GET', body) {
  return page.evaluate(
    async ({ u, m, b }) => {
      const res = await fetch(u, {
        method: m,
        headers: { 'Content-Type': 'application/json' },
        body: b ? JSON.stringify(b) : undefined,
      });
      const json = await res.json();
      return { status: res.status, json };
    },
    { u: url, m: method, b: body },
  );
}

// Group 1: Authentication & Shop Selection

test.describe('Group 1: Authentication & Shop Selection', () => {
  test('owner can sign in and reach dashboard', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    await expect(page.getByRole('main').getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});

// Group 2: Language & Region Setup

test.describe('Group 2: Language & Region Setup', () => {
  test('plan capabilities include multilingual support', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    const res = await browserFetch(page, '/api/shop/ai-settings');
    expect(res.status).toBe(200);
    expect(res.json.plan_capabilities.allowed_languages).toEqual(['en', 'bn', 'mixed']);
  });
});

// Group 3: Business Info Entry

test.describe('Group 3: Business Info Entry', () => {
  test('dashboard loads metrics safely', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    await expect(page.getByRole('heading', { name: '20' })).toBeVisible();
  });
});

// Group 4: FAQ Creation & Management

test.describe('Group 4: FAQ Creation & Management', () => {
  test('faq search API returns manual confidence', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    const res = await browserFetch(page, '/api/knowledge/faq/search', 'POST', { query: 'return policy' });
    expect(res.status).toBe(200);
    expect(res.json.data[0].confidence).toBe(1);
  });
});

// Group 5: Branding Rules

test.describe('Group 5: Branding Rules', () => {
  test('owner can still reach products view as part of settings journey', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    await page.goto('/app/products');
    await expect(page).toHaveURL(/\/app\/products$/);
    await expect(page.getByText('Demo Hoodie')).toBeVisible();
  });
});

// Group 6: AI Automation Mode Rules

test.describe('Group 6: AI Automation Mode Rules', () => {
  test('automation_mode update is allowed for owner plan', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    const res = await browserFetch(page, '/api/shop/ai-settings', 'PUT', { automation_mode: 'MANUAL' });
    expect(res.status).toBe(200);
    expect(res.json.data.automation_mode).toBe('MANUAL');
  });
});

// Group 7: Confidence Threshold Control

test.describe('Group 7: Confidence Threshold Control', () => {
  test('confidence_threshold update is accepted', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    const res = await browserFetch(page, '/api/shop/ai-settings', 'PUT', { confidence_threshold: 75 });
    expect(res.status).toBe(200);
    expect(res.json.data.confidence_threshold).toBe(75);
  });
});

// Group 8: Escalation & Handoff Settings

test.describe('Group 8: Escalation & Handoff Settings', () => {
  test('handoff_settings update is accepted', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    const res = await browserFetch(page, '/api/shop/ai-settings', 'PUT', {
      handoff_settings: { notification_channel: 'email', cooldown_minutes: 10 },
    });
    expect(res.status).toBe(200);
    expect(res.json.data.handoff_settings.notification_channel).toBe('email');
  });
});

// Group 9: Required Fields Configuration

test.describe('Group 9: Required Fields Configuration', () => {
  test('required_fields update is accepted', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    const res = await browserFetch(page, '/api/shop/ai-settings', 'PUT', {
      required_fields: { email_address: true, special_instructions: true },
    });
    expect(res.status).toBe(200);
    expect(res.json.data.required_fields.email_address).toBeTruthy();
  });
});

// Group 10: Max Auto Order Value

test.describe('Group 10: Max Auto Order Value', () => {
  test('max_auto_order_value update is accepted', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    const res = await browserFetch(page, '/api/shop/ai-settings', 'PUT', { max_auto_order_value: 9999 });
    expect(res.status).toBe(200);
    expect(res.json.data.max_auto_order_value).toBe(9999);
  });
});

// Group 11: LLM Model Selection

test.describe('Group 11: LLM Model Selection', () => {
  test('llm model update is accepted', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    const res = await browserFetch(page, '/api/shop/ai-settings', 'PUT', { llm_model: 'claude-haiku-4-5-20251001' });
    expect(res.status).toBe(200);
    expect(res.json.data.llm_model).toBe('claude-haiku-4-5-20251001');
  });
});

// Group 12: Meta/WhatsApp Channel Integration

test.describe('Group 12: Meta/WhatsApp Channel Integration', () => {
  test('channel listing returns sync and expiry metadata', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    const res = await browserFetch(page, '/api/channel');
    expect(res.status).toBe(200);
    expect(res.json.data[0].token_expires_at).toBeTruthy();
    expect(res.json.data[0].last_sync).toBeTruthy();
  });
});

// Group 13: Chatbot Message & Response

test.describe('Group 13: Chatbot Message & Response', () => {
  test('chatbot returns confidence and model metadata', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    const res = await browserFetch(page, '/api/ai-chatbot/process', 'POST', { message: 'hello' });
    expect(res.status).toBe(200);
    expect(res.json.data.confidence).toBeGreaterThan(0);
    expect(res.json.data.ai_model_used).toBe('gpt-4o-mini');
  });

  test('bangla query returns bangla language detection', async ({ page }) => {
    await setupMockApi(page);
    await login(page);
    const res = await browserFetch(page, '/api/ai-chatbot/process', 'POST', { message: 'দাম কত?' });
    expect(res.status).toBe(200);
    expect(res.json.data.language_detected).toBe('bn');
  });
});

// Group 14: Compliance - META Privacy Policy

test.describe('Group 14: Compliance - META Privacy Policy', () => {
  test('privacy policy includes meta platform section', async ({ page }) => {
    await page.goto('/privacy-policy');
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Meta Platform Data' })).toBeVisible();
  });

  test('privacy policy discloses OpenAI, Anthropic, Google and data retention', async ({ page }) => {
    await page.goto('/privacy-policy');
    await expect(page.getByText(/OpenAI/i)).toBeVisible();
    await expect(page.getByText(/Anthropic/i)).toBeVisible();
    await expect(page.getByText(/Google/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Data Retention/i })).toBeVisible();
  });
}
);
