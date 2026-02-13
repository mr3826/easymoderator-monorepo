const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const BanglishDictionary = sequelize.define('BanglishDictionary', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    banglish: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true
    },
    bangla: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    confidence: {
        type: DataTypes.INTEGER,
        defaultValue: 100
    }
}, {
    tableName: 'banglish_dictionary',
    underscored: true,
    timestamps: false
});

module.exports = BanglishDictionary;
