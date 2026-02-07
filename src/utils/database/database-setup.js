const { Sequelize } = require('sequelize');
const path = require('path');
const config = require('src/config/config');

// Use SQLite only if DATABASE_URL is not set
const projectRoot = path.resolve(__dirname, '../../..');
const databaseUrl = config.databaseUrl || 'sqlite::memory:';

const normalizeSqliteUrl = (url) => {
    if (!url.startsWith('sqlite:') || url === 'sqlite::memory:') {
        return url;
    }

    const sqlitePath = url.replace('sqlite:', '');
    if (!sqlitePath || sqlitePath === ':memory:') {
        return url;
    }

    const normalizedPath = path.isAbsolute(sqlitePath)
        ? sqlitePath
        : path.resolve(projectRoot, sqlitePath);

    return `sqlite:${normalizedPath.replace(/\\/g, '/')}`;
};

const normalizedDatabaseUrl = normalizeSqliteUrl(databaseUrl);

// Decide dialect
const isSqlite = normalizedDatabaseUrl.startsWith('sqlite');

const sequelize = new Sequelize(normalizedDatabaseUrl, {
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
