// @ts-nocheck
/* eslint @typescript-eslint/no-explicit-any: 0 */
/* eslint @typescript-eslint/no-unused-vars: 0 */
/* eslint @typescript-eslint/ban-types: 0 */
/* eslint max-len: 0 */
/* eslint sonarjs/no-duplicate-string: 0 */
process.setMaxListeners(0);

const sqlite3 = require('sqlite3');
const request = require('@cypress/request-promise');

sqlite3.verbose();

const { open } = require('sqlite');

const fs = require('fs');
const path = require('path');

const hmr = require('node-hmr');

import { getDBPath, createTables, DemoTables } from '../db/tables';
import { createTgBot } from '../components/tgbot/tgbot';
import { TRequests } from './TRequests/TRequests';

let currentVersion;

// let latestVersion;

// this is a top-level await
(async () => {
    try {
        const { version } = JSON.parse(fs.readFileSync(
            path.resolve(__dirname, '../package.json'),
        ).toString()) || {};

        currentVersion = version;
    } catch (e) {
        console.log(e); // eslint-disable-line
    }

    // open the database
    const db = await open({
        filename: getDBPath(),
        driver: sqlite3.Database,
    });

    await createTables(db);

    /**
     * Подключает все папки из текущей директории.
     *
     * При изменении в файлах перезагружает роботов,
     * чтобы не перезапускать сервис при правках.
     */
    // hmr(() => {
    //     console.log('hmr started'); // eslint-disable-line no-console
    const bots = {};

    fs.readdirSync(path.resolve(__dirname)).forEach(file => {
        const p = path.resolve(__dirname, file);

        if (fs.lstatSync(p).isDirectory() &&
            file !== 'Common' &&
            file !== 'Example' &&
            file !== 'Buyer' &&
            file !== 'OpexBot' &&
            file !== 'RandomExample' &&

            file !== 'Scalper' &&
            file !== 'ScalperSeller' &&

            // file !== 'StaticExample' &&
            file !== 'SupportResistance' &&
            file !== 'TRequests'
        ) {
            const module = require(p);

            if (module[file]) {
                bots[file] = module[file];
            }
        }
    });

    const { tradingbotconnector } = require('tinkofftradingbotconnector');

    tradingbotconnector({
        bots,
        robotsStarted: [],
    }, {
        db,
        DemoTables: new DemoTables(db),
        createTgBot,
        TRequests: TRequests,
        currentVersion,

        // latestVersion,
    });

    exports.bots = bots;

    // }, {
    //     watchDir: './',
    //     watchFilePatterns: ['**/*.js'],
    // });
})();

setInterval(() => { }, 3600000);
