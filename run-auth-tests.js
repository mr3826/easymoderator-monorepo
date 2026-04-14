/**
 * Auth Flow Test Runner
 * Runs all auth-related tests with coverage
 */

const { execSync } = require('child_process');
const path = require('path');

const tests = [
    'src/modules/auth/__tests__/auth.test.js',
    'src/modules/auth/__tests__/auth.security.test.js',
    'src/modules/auth/__tests__/totp.service.test.js'
];

console.log('🧪 Running Auth Flow Tests\n');
console.log('=' .repeat(50));

let failed = false;

for (const test of tests) {
    console.log(`\n📁 ${test}`);
    console.log('-'.repeat(50));

    try {
        execSync(
            `npx jest ${test} --verbose --no-coverage`,
            {
                cwd: __dirname,
                stdio: 'inherit',
                env: {
                    ...process.env,
                    NODE_ENV: 'test',
                    JWT_ACCESS_SECRET: 'test-access-secret-32-chars-long!!',
                    JWT_REFRESH_SECRET: 'test-refresh-secret-32-chars-long!',
                    APP_SECRET: 'test-app-secret-32-chars-long!!!!'
                }
            }
        );
        console.log(`✅ ${test} passed`);
    } catch (error) {
        console.log(`❌ ${test} failed`);
        failed = true;
    }
}

console.log('\n' + '='.repeat(50));
if (failed) {
    console.log('❌ Some tests failed');
    process.exit(1);
} else {
    console.log('✅ All auth tests passed!');
    process.exit(0);
}
