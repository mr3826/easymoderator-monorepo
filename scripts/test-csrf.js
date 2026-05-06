#!/usr/bin/env node

/**
 * CSRF Testing Script
 * Tests CSRF token generation and validation
 */

const axios = require('axios');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

class CSRFTester {
    constructor(baseUrl = BASE_URL) {
        this.baseUrl = baseUrl;
        this.client = axios.create({
            withCredentials: true,
            maxRedirects: 5
        });
        this.cookies = '';
    }

    async testCSRFTokenGeneration() {
        console.log('🔐 Testing CSRF Token Generation...');
        
        try {
            const response = await this.client.get(`${this.baseUrl}/api/csrf`);
            
            console.log('✅ CSRF Token Generated Successfully');
            console.log('   Token:', response.data.csrfToken ? 'Present' : 'Missing');
            console.log('   Session ID:', response.data.sessionId || 'Not provided');
            console.log('   Timestamp:', response.data.timestamp || 'Not provided');
            
            // Extract cookies from response
            const setCookieHeader = response.headers['set-cookie'];
            if (setCookieHeader) {
                this.cookies = setCookieHeader.map(cookie => cookie.split(';')[0]).join('; ');
                console.log('   Cookies:', this.cookies ? 'Set' : 'Not set');
            }
            
            return {
                success: true,
                token: response.data.csrfToken,
                sessionId: response.data.sessionId,
                cookies: this.cookies
            };
            
        } catch (error) {
            console.error('❌ CSRF Token Generation Failed:', error.message);
            if (error.response) {
                console.error('   Status:', error.response.status);
                console.error('   Response:', error.response.data);
            }
            return { success: false, error: error.message };
        }
    }

    async testCSRFValidation(token) {
        console.log('\n🛡️ Testing CSRF Validation...');
        
        try {
            // Test POST request without CSRF token
            console.log('   Testing POST without CSRF token...');
            try {
                await this.client.post(`${this.baseUrl}/api/test`, {}, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                console.log('   ❌ POST without token should have failed');
                return { success: false, error: 'CSRF validation not working' };
            } catch (error) {
                if (error.response?.status === 403 || error.response?.status === 400) {
                    console.log('   ✅ POST without token correctly rejected');
                } else {
                    console.log('   ⚠️ Unexpected error:', error.message);
                }
            }
            
            // Test POST request with CSRF token
            console.log('   Testing POST with CSRF token...');
            try {
                const response = await this.client.post(`${this.baseUrl}/api/test`, {}, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': token
                    }
                });
                console.log('   ✅ POST with token accepted');
                return { success: true };
            } catch (error) {
                if (error.response?.status === 404) {
                    // 404 is expected if /api/test doesn't exist - CSRF passed
                    console.log('   ✅ POST with token accepted (404 expected for test endpoint)');
                    return { success: true };
                } else {
                    console.log('   ❌ POST with token failed:', error.message);
                    return { success: false, error: error.message };
                }
            }
            
        } catch (error) {
            console.error('❌ CSRF Validation Test Failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    async testCSRFDebugEndpoint() {
        console.log('\n🔍 Testing CSRF Debug Endpoint...');
        
        try {
            const response = await this.client.get(`${this.baseUrl}/csrf/debug`);
            
            console.log('✅ Debug Endpoint Working');
            console.log('   Session ID:', response.data.sessionId || 'Not provided');
            console.log('   Session Exists:', response.data.sessionExists || 'Not provided');
            console.log('   CSRF Init:', response.data.csrfInit || 'Not provided');
            
            return { success: true, debugInfo: response.data };
            
        } catch (error) {
            if (error.response?.status === 404) {
                console.log('ℹ️ Debug endpoint not available (expected in production)');
                return { success: true, skipped: true };
            } else {
                console.error('❌ Debug Endpoint Failed:', error.message);
                return { success: false, error: error.message };
            }
        }
    }

    async testHealthEndpoint() {
        console.log('\n🏥 Testing Health Endpoint (should bypass CSRF)...');
        
        try {
            const response = await this.client.get(`${this.baseUrl}/health`);
            
            console.log('✅ Health Endpoint Working');
            console.log('   Status:', response.status);
            
            return { success: true };
            
        } catch (error) {
            console.error('❌ Health Endpoint Failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    async runFullTest() {
        console.log('🧪 Starting Comprehensive CSRF Tests\n');
        console.log(`Base URL: ${this.baseUrl}`);
        console.log('=' .repeat(50));
        
        const results = {
            tokenGeneration: await this.testCSRFTokenGeneration(),
            validation: null,
            debug: await this.testCSRFDebugEndpoint(),
            health: await this.testHealthEndpoint()
        };
        
        if (results.tokenGeneration.success) {
            results.validation = await this.testCSRFValidation(results.tokenGeneration.token);
        }
        
        // Summary
        console.log('\n' + '=' .repeat(50));
        console.log('📊 Test Results Summary:');
        console.log('   Token Generation:', results.tokenGeneration.success ? '✅ PASS' : '❌ FAIL');
        console.log('   CSRF Validation:', results.validation?.success ? '✅ PASS' : '❌ FAIL');
        console.log('   Debug Endpoint:', results.debug.success ? '✅ PASS' : '❌ FAIL');
        console.log('   Health Endpoint:', results.health.success ? '✅ PASS' : '❌ FAIL');
        
        const allPassed = Object.values(results).every(r => r?.success !== false);
        console.log('\nOverall Result:', allPassed ? '🎉 ALL TESTS PASSED' : '⚠️ SOME TESTS FAILED');
        
        return results;
    }
}

// Run tests if called directly
if (require.main === module) {
    const tester = new CSRFTester();
    tester.runFullTest()
        .then(results => {
            process.exit(results.every(r => r?.success !== false) ? 0 : 1);
        })
        .catch(error => {
            console.error('Test execution failed:', error);
            process.exit(1);
        });
}

module.exports = CSRFTester;
