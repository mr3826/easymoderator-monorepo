'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { chromium, firefox, webkit } = require(path.resolve(__dirname, '../../../node_modules/playwright'));

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const FRONTEND_ROOT = path.join(REPO_ROOT, 'EasyMod-frontend');
const SERVER_PATH = path.join(__dirname, 'lab-server.js');
const CONFIG_PATH = path.join(FRONTEND_ROOT, 'playwright.lab.config.ts');
const ARTIFACT_ROOT = path.join(REPO_ROOT, 'docs', 'ai', 'product-experience-v1-2', 'artifacts', 'playwright');
const REPORT_PATH = path.join(ARTIFACT_ROOT, 'execution.json');

const childEnv = () => ({
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
});

const availableBrowsers = () => [
    ['chromium', chromium], ['firefox', firefox], ['webkit', webkit],
].filter(([, browser]) => fs.existsSync(browser.executablePath())).map(([name]) => name);

const removeOwnedTempDir = (directory) => {
    const target = path.resolve(directory);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('easymod-lab-e2e-')) {
        throw new Error('Refusing to remove a path outside the owned E2E temporary directory.');
    }
    fs.rmSync(target, { recursive: true, force: true });
};

const startLab = () => new Promise((resolve, reject) => {
    const env = { ...childEnv(), NODE_ENV: 'test', LAB_PORT: '0' };
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'easymod-lab-e2e-'));
    let workdirCleaned = false;
    const cleanupWorkdir = () => {
        if (workdirCleaned) return;
        removeOwnedTempDir(workdir);
        workdirCleaned = true;
    };
    const child = spawn(process.execPath, [SERVER_PATH], { cwd: workdir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    let settled = false;
    const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        child.once('close', cleanupWorkdir);
        reject(new Error('Local Test Lab did not report its loopback URL within 30 seconds.'));
    }, 30000);
    const onData = chunk => {
        output += chunk.toString('utf8');
        const url = output.match(/EasyModerator Product Engine Lab: (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
        if (url && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ child, url, output, errorOutput, workdir, cleanupWorkdir });
        }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', chunk => { errorOutput += chunk.toString('utf8'); });
    child.once('error', error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanupWorkdir();
        reject(error);
    });
    child.once('close', code => {
        cleanupWorkdir();
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Local Test Lab exited before startup (${code}). ${errorOutput.slice(0, 500)}`));
    });
});

const waitForExit = (child, timeoutMs = 15000) => new Promise(resolve => {
    if (child.exitCode !== null) return resolve({ code: child.exitCode, signal: child.signalCode });
    const timer = setTimeout(() => { child.kill(); resolve({ code: child.exitCode, signal: child.signalCode, timedOut: true }); }, timeoutMs);
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut: false }); });
});

const runPlaywright = (baseURL, browsers, axeReportPath, realRunId) => new Promise((resolve, reject) => {
    const cli = require.resolve('@playwright/test/cli', { paths: [FRONTEND_ROOT] });
    const env = {
        ...childEnv(),
        NODE_ENV: 'test',
        LAB_BASE_URL: baseURL,
        LAB_BROWSER_ENGINES: browsers.join(','),
        LAB_AXE_REPORT_PATH: axeReportPath,
        LAB_PLAYWRIGHT_RUN_ID: process.env.LAB_PLAYWRIGHT_RUN_ID || '',
        ...(realRunId ? { LAB_REAL_GEMINI_RUN_ID: realRunId } : {}),
    };
    const child = spawn(process.execPath, [cli, 'test', '--config', CONFIG_PATH], { cwd: FRONTEND_ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); process.stderr.write(chunk); });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code: code ?? 1, signal: signal || null, stdout, stderr }));
});

const playwrightSummary = (output) => {
    const clean = String(output || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
    const results = clean.split(/\r?\n/).map(line => {
        const match = line.match(/^\s*(ok|x|-|✓|✔|✘|✗)\s+(\d+)\s+\[([^\]]+)\]\s+›\s+(.+?)(?:\s+\(([^)]+)\))?\s*$/);
        if (!match) return null;
        return {
            status: ['ok', '✓', '✔'].includes(match[1]) ? 'passed' : ['x', '✘', '✗'].includes(match[1]) ? 'failed' : 'skipped',
            project: match[3],
            title: match[4],
            duration: match[5] || null,
        };
    }).filter(Boolean);
    return {
        total: results.length,
        passed: results.filter(result => result.status === 'passed').length,
        failed: results.filter(result => result.status === 'failed').length,
        skipped: results.filter(result => result.status === 'skipped').length,
        results,
    };
};

const main = async () => {
    fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
    const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const browsers = availableBrowsers();
    const startedAt = new Date().toISOString();
    const runId = randomUUID();
    process.env.LAB_PLAYWRIGHT_RUN_ID = runId;
    const axeReportPath = path.join(ARTIFACT_ROOT, `axe-accessibility-report-${runId}.json`);
    let lab;
    let execution;
    let failure = null;
    try {
        if (!browsers.includes('chromium')) throw new Error('Chromium is not installed; install it before running the browser gate.');
        lab = await startLab();
        execution = await runPlaywright(lab.url, browsers, axeReportPath, process.env.LAB_REAL_GEMINI_RUN_ID || null);
        if (execution.code !== 0) failure = 'One or more actual Test Lab Playwright journeys failed.';
        if (!failure) {
            const results = playwrightSummary(execution.stdout).results;
            const coverageComplete = browsers.every(browser => {
                const browserTests = results.filter(result => result.project === browser);
                return browserTests.length === 2 && browserTests.every(result => result.status === 'passed');
            });
            if (!coverageComplete) failure = 'Browser result output did not confirm both passing journeys in every installed engine.';
        }
        if (!failure) {
            for (const browser of browsers) {
                for (const suite of [browser, `${browser}-shell`]) {
                    const observationPath = path.join(ARTIFACT_ROOT, `browser-observations-${runId}-${suite}.json`);
                    let observation;
                    try { observation = JSON.parse(fs.readFileSync(observationPath, 'utf8')); }
                    catch (_) { failure = `Missing browser observation receipt for ${suite}.`; break; }
                    if (observation.pageErrors?.length || observation.consoleErrors?.length || observation.failedRequests?.length) {
                        failure = `Browser observation errors were recorded for ${suite}.`;
                        break;
                    }
                }
                if (failure) break;
            }
        }
    } catch (error) {
        failure = error.message;
    } finally {
        if (lab?.child && lab.child.exitCode === null) {
            lab.child.kill('SIGTERM');
            await waitForExit(lab.child);
        }
        if (lab?.cleanupWorkdir) lab.cleanupWorkdir();
    }
    const receipt = {
        schemaVersion: 1,
        runId,
        status: failure ? 'FAIL' : 'PASS',
        startedAt,
        completedAt: new Date().toISOString(),
        sourceRevision,
        localUrl: lab?.url || null,
        browsersAvailable: browsers,
        browserLimitations: ['Firefox or WebKit are included only when their local browser binary is installed.'],
        playwrightExitCode: execution?.code ?? null,
        playwrightSignal: execution?.signal ?? null,
        tests: playwrightSummary(execution?.stdout),
        browserCoverage: Object.fromEntries(browsers.map(browser => {
            const browserTests = (playwrightSummary(execution?.stdout).results || []).filter(result => result.project === browser);
            return [browser, {
                fullWorkflow: browserTests.find(result => result.title.includes('local Test Lab journeys'))?.status || 'NOT_RUN',
                shellSmoke: browserTests.find(result => result.title.includes('loads the real Lab shell'))?.status || 'NOT_RUN',
                realGeminiTraceUi: Boolean(process.env.LAB_REAL_GEMINI_RUN_ID) && browserTests.some(result => result.title.includes('local Test Lab journeys') && result.status === 'passed'),
            }];
        })),
        browserObservations: browsers.flatMap(browser => [browser, `${browser}-shell`].map(suite => {
            const observationPath = path.join(ARTIFACT_ROOT, `browser-observations-${runId}-${suite}.json`);
            try {
                const observation = JSON.parse(fs.readFileSync(observationPath, 'utf8'));
                return {
                    suite,
                    pageErrors: observation.pageErrors?.length || 0,
                    consoleErrors: observation.consoleErrors?.length || 0,
                    failedRequests: observation.failedRequests?.length || 0,
                    artifact: path.relative(ARTIFACT_ROOT, observationPath).replace(/\\/g, '/'),
                };
            } catch (_) { return { suite, status: 'NOT_RECORDED' }; }
        })),
        sourceProvenance: (() => {
            const provenancePath = path.join(REPO_ROOT, 'docs', 'ai', 'product-experience-v1-2', 'artifacts', 'runs', 'local-route-comparison.json');
            try {
                const comparison = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
                return {
                    candidateEngineSourceRevision: comparison.candidate?.engineSourceRevision || null,
                    candidateEngineSourceSha256: comparison.candidate?.engineSourceSha256 || null,
                    candidateRunnerRevision: comparison.candidate?.runnerRevision || null,
                    candidateRunnerSourceSha256: comparison.candidate?.runnerSourceSha256 || null,
                    candidateRunId: comparison.candidate?.runId || null,
                    datasetSha256: comparison.datasetSha256 || null,
                };
            } catch (_) { return null; }
        })(),
        accessibility: (() => {
            const reports = browsers.flatMap(browser => {
                const reportPath = axeReportPath.replace(/\.json$/i, `-${browser}.json`);
                try {
                    const axe = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
                    return [{ browser, status: axe.status, criticalOrSeriousViolationCount: axe.criticalOrSeriousViolationCount, scannedSections: (axe.scannedSections || []).map(section => section.section), report: path.relative(ARTIFACT_ROOT, reportPath).replace(/\\/g, '/') }];
                } catch (_) { return []; }
            });
            return {
                status: reports.length === browsers.length && reports.every(report => report.status === 'PASS_NO_CRITICAL_OR_SERIOUS') ? 'PASS_NO_CRITICAL_OR_SERIOUS' : reports.length ? 'PARTIAL_OR_FAIL' : 'NOT_RUN',
                browsers: reports,
                criticalOrSeriousViolationCount: reports.reduce((sum, report) => sum + report.criticalOrSeriousViolationCount, 0),
            };
        })(),
        htmlReport: path.join(ARTIFACT_ROOT, 'html-report', 'index.html'),
        traceDirectory: path.join(ARTIFACT_ROOT, 'test-results'),
        screenshotsDirectory: path.join(ARTIFACT_ROOT, 'screenshots'),
        failure,
    };
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(`\nPlaywright ${receipt.status} · URL=${receipt.localUrl || 'NOT_STARTED'} · browsers=${browsers.join(',') || 'none'} · report=${receipt.htmlReport}\n`);
    if (failure) process.exitCode = 1;
};

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
