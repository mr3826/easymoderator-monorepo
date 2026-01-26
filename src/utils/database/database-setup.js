const { Sequelize } = require('sequelize');
const config = require('src/config/config');

// Use SQLite only if DATABASE_URL is not set
const databaseUrl = config.databaseUrl || 'sqlite::memory:';

// Decide dialect
const isSqlite = databaseUrl.startsWith('sqlite');

const sequelize = new Sequelize(databaseUrl, {
    dialect: isSqlite ? 'sqlite' : 'postgres',
    logging: config.env === 'development' ? console.log : false,
    dialectOptions: isSqlite
        ? {}
        : {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        }
});

module.exports = { sequelize };
