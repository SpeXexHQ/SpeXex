const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, shell } = require('electron');

const walletEntryPath = path.join(__dirname, '..', 'app', 'wallet', 'index.html');
const allowedExternalProtocols = new Set(['https:', 'http:', 'mailto:']);
const smokeTestOutputPath = process.env.ELECTRON_SMOKE_TEST_OUTPUT || '';
const isSmokeTestMode = process.env.ELECTRON_SMOKE_TEST === '1' && smokeTestOutputPath;
const helperStartupTimeoutMs = 10000;
const helperPortCandidates = [18080, 18081, 18082, 18083, 18084, 18085, 18086, 18087, 18088, 18089];
const defaultHelperTarget = process.env.SPEXEX_ELECTRON_RPC_TARGET || 'http://127.0.0.1:11999';
let desktopRpcProxyInfo = {
  available: false,
  url: '',
  port: 0,
  target: defaultHelperTarget,
  pid: 0,
  startupError: ''
};
let desktopRpcProxyChild = null;
let desktopRpcProxyStartPromise = null;

function setDesktopBridgeEnvironment() {
  process.env.SPEXEX_DESKTOP_BRIDGE_JSON = JSON.stringify({
    rpcProxy: {
      available: desktopRpcProxyInfo.available === true,
      url: desktopRpcProxyInfo.url || '',
      port: desktopRpcProxyInfo.port || 0,
      target: desktopRpcProxyInfo.target || defaultHelperTarget
    }
  });
}

function helperScriptPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'rod-rpc-cors-proxy.js')
    : path.join(__dirname, '..', '..', 'tools', 'rod-rpc-cors-proxy.js');
}

function probeDesktopRpcProxy(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${url}/__health`, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Unexpected helper status ${String(response.statusCode)}`));
          return;
        }
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(1500, () => request.destroy(new Error('Helper health probe timed out')));
  });
}

async function waitForDesktopRpcProxy(url, childProcess) {
  const deadline = Date.now() + helperStartupTimeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (childProcess.exitCode !== null) {
      throw new Error(`Desktop RPC proxy exited early with code ${String(childProcess.exitCode)}`);
    }
    try {
      return await probeDesktopRpcProxy(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError || new Error('Timed out waiting for the desktop RPC proxy health endpoint');
}

function stopDesktopRpcProxy() {
  if (!desktopRpcProxyChild) {
    return;
  }
  try {
    desktopRpcProxyChild.removeAllListeners();
    if (desktopRpcProxyChild.exitCode === null) {
      desktopRpcProxyChild.kill();
    }
  } catch (error) {
    // Best-effort cleanup only.
  }
  desktopRpcProxyChild = null;
}

async function startDesktopRpcProxy() {
  if (desktopRpcProxyStartPromise) {
    return desktopRpcProxyStartPromise;
  }

  desktopRpcProxyStartPromise = (async () => {
    if (process.env.SPEXEX_DISABLE_RPC_HELPER === '1') {
      desktopRpcProxyInfo = {
        available: false,
        url: '',
        port: 0,
        target: defaultHelperTarget,
        pid: 0,
        startupError: 'Desktop RPC proxy disabled by environment override'
      };
      setDesktopBridgeEnvironment();
      return desktopRpcProxyInfo;
    }

    const scriptPath = helperScriptPath();
    if (!fs.existsSync(scriptPath)) {
      desktopRpcProxyInfo = {
        available: false,
        url: '',
        port: 0,
        target: defaultHelperTarget,
        pid: 0,
        startupError: `Desktop RPC proxy helper not found at ${scriptPath}`
      };
      setDesktopBridgeEnvironment();
      return desktopRpcProxyInfo;
    }

    let lastError = null;
    for (let index = 0; index < helperPortCandidates.length; index++) {
      const candidatePort = helperPortCandidates[index];
      const candidateUrl = `http://127.0.0.1:${candidatePort}`;
      const childEnvironment = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1'
      };
      const childProcess = spawn(process.execPath, [
        scriptPath,
        '--listen',
        String(candidatePort),
        '--bind',
        '127.0.0.1',
        '--target',
        defaultHelperTarget,
        '--allow-origin',
        'null'
      ], {
        env: childEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      let stderrBuffer = '';
      childProcess.stdout.on('data', () => {});
      childProcess.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString('utf8');
      });

      try {
        await waitForDesktopRpcProxy(candidateUrl, childProcess);
        desktopRpcProxyChild = childProcess;
        desktopRpcProxyInfo = {
          available: true,
          url: candidateUrl,
          port: candidatePort,
          target: defaultHelperTarget,
          pid: childProcess.pid || 0,
          startupError: ''
        };
        childProcess.on('exit', () => {
          if (desktopRpcProxyChild === childProcess) {
            desktopRpcProxyInfo = {
              available: false,
              url: '',
              port: 0,
              target: defaultHelperTarget,
              pid: 0,
              startupError: 'Desktop RPC proxy stopped unexpectedly'
            };
            setDesktopBridgeEnvironment();
            desktopRpcProxyChild = null;
          }
        });
        setDesktopBridgeEnvironment();
        return desktopRpcProxyInfo;
      } catch (error) {
        lastError = error;
        try {
          if (childProcess.exitCode === null) {
            childProcess.kill();
          }
        } catch (killError) {
          // Continue to the next candidate port.
        }
        if (stderrBuffer) {
          lastError = new Error(`${String(error.message || error)} :: ${stderrBuffer.trim()}`);
        }
      }
    }

    desktopRpcProxyInfo = {
      available: false,
      url: '',
      port: 0,
      target: defaultHelperTarget,
      pid: 0,
      startupError: lastError ? String(lastError.message || lastError) : 'Desktop RPC proxy failed to start'
    };
    setDesktopBridgeEnvironment();
    return desktopRpcProxyInfo;
  })();

  return desktopRpcProxyStartPromise;
}

function isSafeExternalUrl(targetUrl) {
  try {
    const parsedUrl = new URL(targetUrl);
    return allowedExternalProtocols.has(parsedUrl.protocol);
  } catch (error) {
    return false;
  }
}

function isAllowedNavigation(targetUrl) {
  try {
    const parsedTargetUrl = new URL(targetUrl);
    const allowedWalletUrl = new URL(`file://${walletEntryPath}`);
    return parsedTargetUrl.protocol === 'file:' && parsedTargetUrl.pathname === allowedWalletUrl.pathname;
  } catch (error) {
    return false;
  }
}

function openExternalIfSafe(targetUrl) {
  if (!isSafeExternalUrl(targetUrl)) {
    return;
  }

  shell.openExternal(targetUrl);
}

function attachSecurityHandlers(mainWindow) {
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url)) {
      return;
    }

    event.preventDefault();
    openExternalIfSafe(url);
  });

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false);
  });

  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
}

function writeSmokeTestResults(payload) {
  if (!isSmokeTestMode) {
    return;
  }

  fs.mkdirSync(path.dirname(smokeTestOutputPath), { recursive: true });
  fs.writeFileSync(smokeTestOutputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function runSmokeTest(mainWindow) {
  if (!isSmokeTestMode) {
    return;
  }

  try {
    const rendererSnapshot = await mainWindow.webContents.executeJavaScript(`(() => ({
      href: window.location.href,
      title: document.title,
      readyState: document.readyState,
      dom: {
        wallet: Boolean(document.querySelector('#wallet')),
        otc: Boolean(document.querySelector('#otc'))
      },
      preloadBridge: {
        present: typeof window.rodDesktop === 'object' && window.rodDesktop !== null,
        keys: window.rodDesktop ? Object.keys(window.rodDesktop).sort() : [],
        platform: window.rodDesktop ? window.rodDesktop.platform : null,
        appVersion: window.rodDesktop ? window.rodDesktop.appVersion : null,
        rpcProxy: window.rodDesktop ? window.rodDesktop.rpcProxy : null
      },
      helperHealth: null,
      rendererSecurity: {
        requireDefined: typeof window.require !== 'undefined',
        processDefined: typeof window.process !== 'undefined',
        nodeVersionDefined: typeof window.process !== 'undefined' && !!window.process?.versions?.node,
        moduleDefined: typeof window.module !== 'undefined',
        globalDefined: typeof window.global !== 'undefined'
      }
    }))()`, true);

    if (rendererSnapshot.preloadBridge && rendererSnapshot.preloadBridge.rpcProxy && rendererSnapshot.preloadBridge.rpcProxy.available) {
      rendererSnapshot.helperHealth = await mainWindow.webContents.executeJavaScript(`(async () => {
        const helper = window.rodDesktop && window.rodDesktop.rpcProxy;
        if (!helper || !helper.available || !helper.url) {
          return { ok: false, reason: 'Helper metadata unavailable' };
        }
        try {
          const response = await fetch(helper.url + '/__health');
          const payload = await response.json();
          return { ok: response.ok === true, status: response.status, payload: payload };
        } catch (error) {
          return { ok: false, reason: String(error && error.message ? error.message : error) };
        }
      })()`, true);
    }

    writeSmokeTestResults({
      status: 'passed',
      generatedAt: new Date().toISOString(),
      walletEntryPath,
      ...rendererSnapshot
    });

    setTimeout(() => app.quit(), 250);
  } catch (error) {
    writeSmokeTestResults({
      status: 'failed',
      generatedAt: new Date().toISOString(),
      walletEntryPath,
      error: error && error.stack ? error.stack : String(error)
    });

    setTimeout(() => app.exit(1), 250);
  }
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#111827',
      title: 'SpeXex',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: true
    }
  });

  attachSecurityHandlers(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    runSmokeTest(mainWindow);
  });

  mainWindow.loadFile(walletEntryPath);

  return mainWindow;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  setDesktopBridgeEnvironment();
  await startDesktopRpcProxy();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('web-contents-created', (_event, webContents) => {
  webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url)) {
      return;
    }

    event.preventDefault();
    openExternalIfSafe(url);
  });

  webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopDesktopRpcProxy();
});
