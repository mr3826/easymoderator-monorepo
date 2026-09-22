import { test as setup } from '@playwright/test';
import { authStatePath, fixtures, signIn } from '../e2e/support';

setup.describe.configure({ mode: 'serial' });

const roles = [
  { role: 'super', user: fixtures.users.super },
  { role: 'growth', user: fixtures.users.growth },
  { role: 'legacyFounder', user: fixtures.users.legacy },
  { role: 'merchant', user: fixtures.users.merchant },
] as const;

for (const { role, user } of roles) {
  setup(`captures signed-in storage state for ${role}`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, user, role === 'merchant' ? { assertAuthorized: false } : {});
    await context.storageState({ path: authStatePath(role) });
    await context.close();
  });
}
