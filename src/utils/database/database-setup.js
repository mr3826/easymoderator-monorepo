const { Sequelize } = require('sequelize');
const config = require('src/config/config');

// Configure SSL based on environment
const dialectOptions = config.env === 'production'
    ? {
        ssl: {
            rejectUnauthorized: false
        }
    }
    : {}; // No SSL for local development

const sequelize = new Sequelize(config.databaseUrl, {
    dialect: 'postgres',
    logging: config.env === 'development' ? console.log : false,
    dialectOptions
});

module.exports = { sequelize };
