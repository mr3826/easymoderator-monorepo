const express = require('express');

const app = express();

// Only basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug middleware
app.use((req, res, next) => {
    console.log(`🔍 DEBUG: ${req.method} ${req.url}`);
    next();
});

// Health route
app.get('/api/health', (req, res) => {
    console.log('🏥 Health route hit!');
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Test route
app.get('/api/test', (req, res) => {
    console.log('🎯 Test route hit!');
    res.json({ message: 'Test successful!', timestamp: new Date().toISOString() });
});

// Start server
const PORT = 3003;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Debug server running on port ${PORT}`);
});

module.exports = app;
