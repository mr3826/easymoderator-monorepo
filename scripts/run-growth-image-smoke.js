'use strict';

const { spawnSync } = require('node:child_process');

const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const image = process.env.GROWTH_SMOKE_IMAGE || `easymod-growth-smoke:${process.pid}`;
const buildSha = process.env.GIT_SHA || 'growth-image-smoke';
const port = Number(process.env.GROWTH_SMOKE_PORT || 38080);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
  }
  return result.stdout?.trim() || '';
}

async function request(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
  };
}

async function waitFor(url) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await request(url);
      if (response.status === 200) return response;
      lastError = new Error(`received HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timed out waiting for ${url}: ${lastError?.message || 'unknown error'}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  let containerId = '';
  try {
    run('docker', [
      'build',
      '--build-arg',
      `VITE_BUILD_SHA=${buildSha}`,
      '--tag',
      image,
      '--file',
      'EasyMod-growth/Dockerfile',
      'EasyMod-growth',
    ]);
    containerId = run('docker', ['run', '--detach', '--publish', `${port}:8080`, image], { capture: true });

    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await waitFor(`${baseUrl}/health/ready`);
    assert(JSON.parse(health.body).status === 'ready', 'Growth image readiness payload is invalid');

    const home = await request(`${baseUrl}/`);
    assert(home.status === 200 && /<html/i.test(home.body), 'Growth image did not serve the SPA shell');
    assert(home.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"), 'SPA CSP is missing');
    assert(home.headers.get('x-content-type-options') === 'nosniff', 'SPA security headers are missing');

    const deepLink = await request(`${baseUrl}/prospects`);
    assert(deepLink.status === 200 && /<html/i.test(deepLink.body), 'Growth deep link did not fall back to the SPA');

    for (const apiPath of ['/api', '/api/unsupported']) {
      const unsupportedApi = await request(`${baseUrl}${apiPath}`);
      assert(unsupportedApi.status === 404, `Direct Growth image ${apiPath} fallback must be a 404`);
      assert(!/<html/i.test(unsupportedApi.body), `Direct Growth image ${apiPath} fallback returned the SPA shell`);
    }

    const buildInfo = await request(`${baseUrl}/build-info.json`);
    assert(buildInfo.status === 200, 'Growth build-info.json is not served');
    assert(JSON.parse(buildInfo.body).commit === buildSha, 'Growth image build SHA is not reproducible');

    console.log(`Growth image smoke passed for ${image}`);
  } finally {
    if (containerId) run('docker', ['rm', '--force', containerId]);
  }
}

main().catch((error) => {
  console.error(`Growth image smoke failed: ${error.message}`);
  process.exitCode = 1;
});
