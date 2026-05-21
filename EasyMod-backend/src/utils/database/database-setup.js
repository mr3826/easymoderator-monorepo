const { Sequelize } = require('sequelize');
const path = require('path');
const config = require('../../config/config');

// Use SQLite only if DATABASE_URL is not set
const projectRoot = path.resolve(__dirname, '../../..');
const databaseUrl = config.databaseUrl || 'sqlite:./database.sqlite';

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

const isSqlite = normalizedDatabaseUrl.startsWith('sqlite');
const sqlitePath = isSqlite ? normalizedDatabaseUrl.replace('sqlite:', '') : null;

if (config.env === 'production' && isSqlite) {
    throw new Error('SQLite is not allowed in production. Set DATABASE_URL to a Postgres connection string.');
}

const sslOptions = process.env.DB_SSL === 'false'
    ? undefined
    : config.allowSelfSignedTls
        ? { require: true, rejectUnauthorized: false }
        : (config.env === 'production' ? { require: true, rejectUnauthorized: true } : undefined);

let sequelize;
if (isSqlite) {
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: sqlitePath,
        logging: config.env === 'development' ? console.log : false
    });
} else {
    sequelize = new Sequelize(normalizedDatabaseUrl, {
        dialect: 'postgres',
        logging: false,
        dialectOptions: sslOptions ? { ssl: sslOptions } : {}
    });
}

if (isSqlite && config.env === 'development') {
    console.log(`📡 Database: SQLite (${sqlitePath})`);
}

module.exports = { sequelize };
