const { Sequelize } = require('sequelize');
const config = require('src/config/config');

// For testing, use SQLite if DATABASE_URL is not set
const databaseUrl = config.databaseUrl || 'sqlite::memory:';

// Configure SSL based on environment
const dialectOptions = config.env === 'production'
    ? {
        ssl: {
            rejectUnauthorized: false
        }
    }
    : {}; // No SSL for local development

const sequelize = new Sequelize(databaseUrl, {
    dialect: databaseUrl.startsWith('sqlite') ? 'sqlite' : 'postgres',
    logging: config.env === 'development' ? console.log : false,
    dialectOptions: databaseUrl.startsWith('sqlite') ? {} : dialectOptions
});

module.exports = { sequelize };
