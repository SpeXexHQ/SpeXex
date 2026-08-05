const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const electronPackageJsonPath = path.join(__dirname, '..', 'package.json');
const electronPackageJson = JSON.parse(fs.readFileSync(electronPackageJsonPath, 'utf8'));
const electronBinaryPath = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const resultsDirectoryPath = path.join(__dirname, '..', 'test-results');
const resultsFilePath = path.join(resultsDirectoryPath, 'electron-smoke-test.json');
const launchTimeoutMs = 45000;

function ensureResultsDirectory() {
  fs.mkdirSync(resultsDirectoryPath, { recursive: true });
}

function removePreviousResultsFile() {
  if (fs.existsSync(resultsFilePath)) {
    fs.unlinkSync(resultsFilePath);
  }
}

function createChildEnvironment() {
  const childEnvironment = { ...process.env };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  childEnvironment.ELECTRON_SMOKE_TEST = '1';
  childEnvironment.ELECTRON_SMOKE_TEST_OUTPUT = resultsFilePath;
  childEnvironment.npm_package_version = electronPackageJson.version;
  return childEnvironment;
}

function createElectronArguments() {
  const electronArguments = ['.'];

  if (process.platform === 'linux' && process.env.CI === 'true') {
    electronArguments.push('--no-sandbox');
  }

  return electronArguments;
}

function fail(message) {
  const error = new Error(message);
  error.isSmokeFailure = true;
  throw error;
}

function validateResults(results) {
  if (!results || typeof results !== 'object') {
    fail('Smoke test did not produce a JSON object result.');
  }

  if (results.status !== 'passed') {
    fail(`Electron smoke test reported status ${String(results.status)}.`);
  }

  if (!results.dom || results.dom.wallet !== true || results.dom.otc !== true) {
    fail('Core wallet DOM markers were not both detected.');
  }

  if (!results.preloadBridge || results.preloadBridge.present !== true) {
    fail('Preload bridge was not exposed in the renderer.');
  }

  if (results.preloadBridge.appVersion !== electronPackageJson.version) {
    fail(`Preload bridge appVersion mismatch: expected ${electronPackageJson.version}, received ${String(results.preloadBridge.appVersion)}.`);
  }

  if (!results.preloadBridge.rpcProxy || results.preloadBridge.rpcProxy.available !== true) {
    fail('Desktop RPC proxy metadata was not exposed as available.');
  }

  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(String(results.preloadBridge.rpcProxy.url || ''))) {
    fail(`Desktop RPC proxy URL is invalid: ${String(results.preloadBridge.rpcProxy.url)}.`);
  }

  if (!results.helperHealth || results.helperHealth.ok !== true) {
    fail(`Desktop RPC proxy health probe failed: ${JSON.stringify(results.helperHealth || null)}.`);
  }

  if (!results.helperHealth.payload || results.helperHealth.payload.ok !== true) {
    fail('Desktop RPC proxy health payload was missing expected ok=true state.');
  }

  if (!results.rendererSecurity) {
    fail('Renderer security checks were missing from smoke-test output.');
  }

  if (results.rendererSecurity.requireDefined !== false) {
    fail('Renderer unexpectedly exposed require().');
  }

  if (results.rendererSecurity.processDefined !== false) {
    fail('Renderer unexpectedly exposed process.');
  }

  if (results.rendererSecurity.nodeVersionDefined !== false) {
    fail('Renderer unexpectedly exposed process.versions.node.');
  }

  if (results.rendererSecurity.moduleDefined !== false) {
    fail('Renderer unexpectedly exposed module.');
  }

  if (results.rendererSecurity.globalDefined !== false) {
    fail('Renderer unexpectedly exposed global.');
  }

  if (results.preloadBridge.keys.length !== 3 || results.preloadBridge.keys.includes('require') || results.preloadBridge.keys.includes('process')) {
    fail('Preload bridge exposed unexpected keys.');
  }
}

async function run() {
  ensureResultsDirectory();
  removePreviousResultsFile();

  const childEnvironment = createChildEnvironment();
  const electronArguments = createElectronArguments();

  await new Promise((resolve, reject) => {
    const childProcess = spawn(electronBinaryPath, electronArguments, {
      cwd: path.join(__dirname, '..'),
      env: childEnvironment,
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32'
    });

    let settled = false;
    const timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      childProcess.kill();
      reject(new Error(`Timed out waiting ${launchTimeoutMs}ms for the Electron smoke test to finish.`));
    }, launchTimeoutMs);

    childProcess.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    });

    childProcess.on('exit', (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Electron smoke test exited with code ${String(code)} and signal ${String(signal)}.`));
    });
  });

  if (!fs.existsSync(resultsFilePath)) {
    fail('Electron smoke test finished without producing the results artifact.');
  }

  const smokeTestResults = JSON.parse(fs.readFileSync(resultsFilePath, 'utf8'));
  validateResults(smokeTestResults);

  console.log(`Electron smoke test passed: ${resultsFilePath}`);
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
