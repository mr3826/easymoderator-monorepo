/**
 * Dashboard Test Runner
 * Run all dashboard-related tests with coverage
 */
const { execSync } = require('child_process');
const path = require('path');

const testFiles = [
    'src/modules/dashboard/__tests__/dashboard.service.test.js',
    'src/modules/dashboard/__tests__/dashboard.analytics.test.js',
    'src/modules/dashboard/__tests__/dashboard.controller.test.js'
];

console.log('\n========================================');
console.log('   Dashboard Module Test Suite');
console.log('========================================\n');

let allPassed = true;

testFiles.forEach((file, index) => {
    console.log(`\n${index + 1}. Running ${file}...`);
    console.log('-'.repeat(50));
    
    try {
        execSync(
            `npx jest ${file} --verbose`,
            {
                cwd: __dirname,
                stdio: 'inherit'
            }
        );
        console.log(`✅ ${file} passed`);
    } catch (error) {
        console.log(`❌ ${file} failed`);
        allPassed = false;
    }
});

console.log('\n========================================');
if (allPassed) {
    console.log('   ✅ All tests passed!');
    process.exit(0);
} else {
    console.log('   ❌ Some tests failed');
    process.exit(1);
}
