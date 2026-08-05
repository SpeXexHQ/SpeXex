const { contextBridge } = require('electron');

function readDesktopBridgeSnapshot() {
  try {
    const rawValue = process.env.SPEXEX_DESKTOP_BRIDGE_JSON || '{}';
    const parsedValue = JSON.parse(rawValue);
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {};
  } catch (error) {
    return {};
  }
}

const desktopBridgeSnapshot = readDesktopBridgeSnapshot();

contextBridge.exposeInMainWorld('rodDesktop', Object.freeze({
  platform: process.platform,
  appVersion: process.env.npm_package_version || '0.1.0',
  rpcProxy: Object.freeze({
    available: desktopBridgeSnapshot.rpcProxy && desktopBridgeSnapshot.rpcProxy.available === true,
    url: desktopBridgeSnapshot.rpcProxy && desktopBridgeSnapshot.rpcProxy.url ? String(desktopBridgeSnapshot.rpcProxy.url) : '',
    port: desktopBridgeSnapshot.rpcProxy && Number.isFinite(desktopBridgeSnapshot.rpcProxy.port) ? desktopBridgeSnapshot.rpcProxy.port : 0,
    target: desktopBridgeSnapshot.rpcProxy && desktopBridgeSnapshot.rpcProxy.target ? String(desktopBridgeSnapshot.rpcProxy.target) : ''
  })
}));
