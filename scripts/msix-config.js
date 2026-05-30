import fs from 'node:fs';
import path from 'node:path';

export const msixExecutableName = 'electron-demo';
export const defaultMsixPackageIdentity = 'HagiCodeOrg.ElectronDemo';
export const defaultMsixPublisher = 'CN=8B6C8A94-AAE5-4C8B-9202-A29EA42B042F';
export const defaultMsixPublisherDisplayName = 'HagiCode';
export const defaultMsixMinOsVersion = '10.0.19041.0';
export const defaultMsixBackgroundColor = 'transparent';

export function normalizeWindowsVersion(version) {
  const normalizedParts = String(version || '0.0.0')
    .trim()
    .replace(/[-+].*$/, '')
    .split('.')
    .filter(Boolean)
    .slice(0, 4)
    .map((part) => {
      const numericPart = part.replace(/[^0-9]/g, '');
      return numericPart || '0';
    });

  while (normalizedParts.length < 4) {
    normalizedParts.push('0');
  }

  return normalizedParts.join('.');
}

export function mapNodeArchToMsixArch(arch) {
  switch (String(arch || '').trim().toLowerCase()) {
    case 'x64':
    case 'arm64':
    case 'x86':
    case 'arm':
      return arch;
    case 'ia32':
      return 'x86';
    default:
      return 'x64';
  }
}

export function getMsixPaths(projectRoot) {
  return {
    manifestTemplatePath: path.join(projectRoot, 'resources', 'msix', 'Package.appxmanifest.template.xml'),
    manifestOutputPath: path.join(projectRoot, '.cache', 'msix', 'Package.appxmanifest'),
    defaultAssetsPath: path.join(projectRoot, 'node_modules', 'electron-windows-msix', 'static', 'assets'),
    customAssetsPath: path.join(projectRoot, 'resources', 'appx'),
    generatedAssetsPath: path.join(projectRoot, '.cache', 'msix-assets'),
  };
}

function resolvePath(projectRoot, candidatePath) {
  if (!candidatePath) {
    return '';
  }

  return path.isAbsolute(candidatePath) ? candidatePath : path.join(projectRoot, candidatePath);
}

export function resolveMsixSigningConfig(projectRoot) {
  const certificatePathFromEnv = String(
    process.env.WINDOWS_CERTIFICATE_FILE || process.env.MSIX_CERTIFICATE_FILE || '',
  ).trim();
  const certificatePassword = String(
    process.env.WINDOWS_CERTIFICATE_PASSWORD || process.env.MSIX_CERTIFICATE_PASSWORD || '',
  ).trim();
  const defaultCertificatePath = path.join(projectRoot, 'devcert.pfx');
  const certificateFile = resolvePath(projectRoot, certificatePathFromEnv) ||
    (fs.existsSync(defaultCertificatePath) ? defaultCertificatePath : '');

  if (!certificateFile || !certificatePassword) {
    return {
      sign: false,
    };
  }

  return {
    sign: true,
    windowsSignOptions: {
      certificateFile,
      certificatePassword,
    },
  };
}

export function resolveMsixManifestConfig({ productName, description, version, arch }) {
  const publisher = String(process.env.WINDOWS_PACKAGE_PUBLISHER || defaultMsixPublisher).trim();
  const packageIdentity = String(process.env.WINDOWS_PACKAGE_IDENTITY || defaultMsixPackageIdentity).trim();
  const packageDisplayName = String(process.env.WINDOWS_PACKAGE_DISPLAY_NAME || productName).trim();
  const publisherDisplayName = String(
    process.env.WINDOWS_PACKAGE_PUBLISHER_DISPLAY_NAME || defaultMsixPublisherDisplayName,
  ).trim();
  const packageDescription = String(process.env.WINDOWS_PACKAGE_DESCRIPTION || description).trim();
  const packageBackgroundColor = String(
    process.env.WINDOWS_PACKAGE_BACKGROUND_COLOR || defaultMsixBackgroundColor,
  ).trim();
  const packageMinOsVersion = String(
    process.env.WINDOWS_PACKAGE_MIN_VERSION || defaultMsixMinOsVersion,
  ).trim();
  const packageMaxOsVersionTested = String(
    process.env.WINDOWS_PACKAGE_MAX_TESTED_VERSION || packageMinOsVersion,
  ).trim();

  return {
    packageIdentity,
    packageDisplayName,
    packageDescription,
    packageVersion: normalizeWindowsVersion(process.env.WINDOWS_PACKAGE_VERSION || version),
    publisher,
    publisherDisplayName,
    packageBackgroundColor,
    packageMinOsVersion,
    packageMaxOsVersionTested,
    processorArchitecture: mapNodeArchToMsixArch(arch),
    appExecutable: `${msixExecutableName}.exe`,
    appDisplayName: packageDisplayName,
  };
}
