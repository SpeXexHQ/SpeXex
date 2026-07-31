const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, shell } = require('electron');

const walletEntryPath = path.join(__dirname, '..', 'app', 'wallet', 'index.html');
const allowedExternalProtocols = new Set(['https:', 'http:', 'mailto:']);
const smokeTestOutputPath = process.env.ELECTRON_SMOKE_TEST_OUTPUT || '';
const isSmokeTestMode = process.env.ELECTRON_SMOKE_TEST === '1' && smokeTestOutputPath;

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
        appVersion: window.rodDesktop ? window.rodDesktop.appVersion : null
      },
      rendererSecurity: {
        requireDefined: typeof window.require !== 'undefined',
        processDefined: typeof window.process !== 'undefined',
        nodeVersionDefined: typeof window.process !== 'undefined' && !!window.process?.versions?.node,
        moduleDefined: typeof window.module !== 'undefined',
        globalDefined: typeof window.global !== 'undefined'
      }
    }))()`, true);

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

app.whenReady().then(() => {
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
