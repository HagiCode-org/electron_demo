import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getMsixPaths,
  msixExecutableName,
  resolveMsixSigningConfig,
} from './scripts/msix-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const productName = 'HagiCode Electron Demo';
const appId = 'com.hagicode.electrondemo';
const description = 'Minimal Electron demo app for CI packaging validation';
const authorName = 'newbe36524';
const homepage = 'https://github.com/HagiCode-org/electron_demo';
const executableName = msixExecutableName;
const windowsKitVersion = String(process.env.WINDOWS_KIT_VERSION || '').trim();

const iconBasePath = path.join(__dirname, 'resources', 'icon');
const pngIconPath = path.join(__dirname, 'resources', 'icon.png');
const icnsIconPath = path.join(__dirname, 'resources', 'icon.icns');
const { generatedAssetsPath: msixAssetsPath, manifestOutputPath: msixManifestPath } = getMsixPaths(__dirname);
const msixSigningConfig = resolveMsixSigningConfig(__dirname);

function resolveMacSignConfig() {
  if (String(process.env.HAGICODE_ENABLE_MAC_SIGNING || '').trim() !== 'true') {
    return undefined;
  }

  const identity = String(process.env.CSC_NAME || '').trim();

  return {
    hardenedRuntime: true,
    gatekeeperAssess: false,
    ...(identity ? { identity } : {}),
  };
}

function resolveMacNotarizeConfig() {
  if (String(process.env.HAGICODE_ENABLE_MAC_SIGNING || '').trim() !== 'true') {
    return undefined;
  }

  const appleApiKey = String(process.env.APPLE_API_KEY_PATH || process.env.HAGICODE_APPLE_API_KEY_PATH || '').trim();
  const appleApiKeyId = String(process.env.APPLE_API_KEY_ID || '').trim();
  const appleApiIssuer = String(process.env.APPLE_API_ISSUER || '').trim();

  if (appleApiKey && appleApiKeyId && appleApiIssuer) {
    return {
      appleApiKey,
      appleApiKeyId,
      appleApiIssuer,
    };
  }

  const appleId = String(process.env.APPLE_ID || '').trim();
  const appleIdPassword = String(process.env.APPLE_APP_SPECIFIC_PASSWORD || '').trim();
  const teamId = String(process.env.APPLE_TEAM_ID || '').trim();

  if (appleId && appleIdPassword && teamId) {
    return {
      appleId,
      appleIdPassword,
      teamId,
    };
  }

  return undefined;
}

const macSignConfig = resolveMacSignConfig();
const macNotarizeConfig = resolveMacNotarizeConfig();

export default {
  hooks: {
    async prePackage(_forgeConfig, platform, arch) {
      if (platform !== 'win32') {
        return;
      }

      const { prepareMsixArtifacts } = await import('./scripts/prepare-msix.js');
      await prepareMsixArtifacts({ platform, arch });
    },
  },
  packagerConfig: {
    asar: true,
    appBundleId: appId,
    appCategoryType: 'public.app-category.developer-tools',
    executableName,
    icon: iconBasePath,
    extraResource: [pngIconPath],
    ignore: [
      /^\/\.winapp($|\/)/,
      /^\/\.cache\//,
      /^\/out\//,
      /^\/pkg\//,
      /^\/winapp\.yaml$/,
      /^\/unsigned-artifacts\//,
      /\.pfx$/i,
      /\.pdb$/i,
      /^\/obj($|\/)/,
      /^\/bin($|\/)/,
      /\.msix$/i,
      /\.map$/,
    ],
    win32metadata: {
      CompanyName: 'HagiCode',
      FileDescription: productName,
      ProductName: productName,
      InternalName: productName,
      'requested-execution-level': 'asInvoker',
    },
    ...(macSignConfig ? { osxSign: macSignConfig } : {}),
    ...(macNotarizeConfig ? { osxNotarize: macNotarizeConfig } : {}),
  },
  makers: [
    {
      name: '@reforged/maker-appimage',
      platforms: ['linux'],
      config: {
        options: {
          name: 'electron-demo',
          bin: executableName,
          productName,
          categories: ['Development'],
          icon: pngIconPath,
        },
      },
    },
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: {
        options: {
          name: 'electron-demo',
          bin: executableName,
          productName,
          genericName: 'Developer Tools',
          description,
          productDescription: description,
          maintainer: `${authorName} <support@hagicode.com>`,
          homepage,
          section: 'devel',
          priority: 'optional',
          icon: pngIconPath,
          categories: ['Development'],
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      platforms: ['linux'],
      config: {
        options: {
          name: 'electron-demo',
          bin: executableName,
          productName,
          genericName: 'Developer Tools',
          description,
          productDescription: description,
          license: 'AGPL-3.0',
          homepage,
          group: 'Development/Tools',
          icon: pngIconPath,
          categories: ['Development'],
        },
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['linux', 'darwin'],
      config: {},
    },
    {
      name: '@electron-addons/electron-forge-maker-nsis',
      platforms: ['win32'],
      config: {},
    },
    {
      name: '@rabbitholesyndrome/electron-forge-maker-portable',
      platforms: ['win32'],
      config: {
        appId,
      },
    },
    {
      name: '@electron-forge/maker-msix',
      platforms: ['win32'],
      config: {
        appManifest: msixManifestPath,
        packageAssets: msixAssetsPath,
        logLevel: 'warn',
        ...(windowsKitVersion ? { windowsKitVersion } : {}),
        ...msixSigningConfig,
      },
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        icon: icnsIconPath,
      },
    },
  ],
};
