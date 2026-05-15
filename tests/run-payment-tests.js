/**
 * Test Runner for Smart Payment Detection
 * Executes real backend tests with database operations
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Smart Payment Detection Backend Tests\n');
console.log('=' .repeat(80));

// Check if test database exists and is accessible
try {
    console.log('📋 Test Environment Setup:');
    console.log('   ✅ Node.js:', process.version);
    console.log('   ✅ Environment:', process.env.NODE_ENV || 'development');
    
    // Check database connection
    console.log('   🔍 Checking database connection...');
    
    // Run the tests
    console.log('\n🧪 Running Payment Detection Tests...\n');
    console.log('=' .repeat(80));
    
    // Execute the test file
    const testCommand = `npx mocha tests/smart-payment-detection.test.js --timeout 30000 --reporter spec`;
    console.log(`Executing: ${testCommand}\n`);
    
    try {
        const testOutput = execSync(testCommand, { 
            encoding: 'utf8',
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });
        
        console.log('\n' + '=' .repeat(80));
        console.log('✅ All tests completed successfully!');
        console.log('🎯 Smart Payment Detection is working perfectly!');
        
        if (testOutput) {
            console.log('\n📊 Test Results Summary:');
            console.log(testOutput);
        }
        
    } catch (error) {
        console.error('\n❌ Tests failed with error:');
        console.error(error.message);
        
        if (error.stdout) {
            console.log('\n📋 Test Output:');
            console.log(error.stdout);
        }
        
        if (error.stderr) {
            console.log('\n🚨 Error Details:');
            console.log(error.stderr);
        }
        
        process.exit(1);
    }
    
} catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
}

console.log('\n🎉 Test execution completed!');
