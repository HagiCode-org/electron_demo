#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
};

const config = {
  strictMode: process.env.VERIFY_STRICT === 'true',
};

const SIGNABLE_EXTENSIONS = ['.exe', '.dll', '.msix', '.msi'];

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logCI(message, type = 'info') {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    log(message);
    return;
  }

  switch (type) {
    case 'error':
      log(`::error::${message}`, colors.red);
      break;
    case 'warning':
      log(`::warning::${message}`, colors.yellow);
      break;
    case 'notice':
      log(`::notice::${message}`, colors.blue);
      break;
    default:
      log(message);
      break;
  }
}

function showHelp() {
  console.log(`
Usage: node scripts/verify-signature.js <file-path>
       node scripts/verify-signature.js --all <directory>
       node scripts/verify-signature.js --catalog <file-list>

Arguments:
  file-path              Path to the file to verify
  --all <directory>      Verify all signable files in directory
  --catalog <file-list>  Verify signable files listed in a newline-delimited file

Environment Variables:
  VERIFY_STRICT          Fail on unsigned files (default: false)
`);
}

function isSignableFile(filePath) {
  return SIGNABLE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function findSignableFiles(dir) {
  const files = [];

  function scanDirectory(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.isFile() && isSignableFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  scanDirectory(dir);
  return files;
}

function readCatalogFile(catalogPath) {
  const contents = fs.readFileSync(catalogPath, 'utf8');
  const baseDir = path.dirname(path.resolve(catalogPath));
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (path.isAbsolute(line) ? line : path.join(baseDir, line)));
}

function normalizeCandidateFiles(files) {
  const unique = [];
  const seen = new Set();

  for (const filePath of files) {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      logCI(`Skipping missing file: ${resolvedPath}`, 'warning');
      continue;
    }
    if (!isSignableFile(resolvedPath)) {
      logCI(`Skipping non-signable file: ${resolvedPath}`, 'warning');
      continue;
    }
    if (!seen.has(resolvedPath)) {
      unique.push(resolvedPath);
      seen.add(resolvedPath);
    }
  }

  return unique;
}

function findSignToolInArtifactSigningCache() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return null;
  }

  const buildToolsRoot = path.join(localAppData, 'ArtifactSigning', 'Microsoft.Windows.SDK.BuildTools');
  if (!fs.existsSync(buildToolsRoot)) {
    return null;
  }

  const versionDirectories = fs
    .readdirSync(buildToolsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(buildToolsRoot, entry.name))
    .sort((left, right) => right.localeCompare(left));

  for (const versionDirectory of versionDirectories) {
    const binDirectory = path.join(versionDirectory, 'bin');
    if (!fs.existsSync(binDirectory)) {
      continue;
    }

    const sdkDirectories = fs
      .readdirSync(binDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(binDirectory, entry.name))
      .sort((left, right) => right.localeCompare(left));

    for (const sdkDirectory of sdkDirectories) {
      const candidate = path.join(sdkDirectory, 'x64', 'signtool.exe');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function getSignToolPath() {
  if (process.platform !== 'win32') {
    return null;
  }

  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const possiblePaths = [
    path.join(programFiles, 'Windows Kits', '10', 'bin', '10.0.26100.0', 'x64', 'signtool.exe'),
    path.join(programFiles, 'Windows Kits', '10', 'bin', '10.0.22000.0', 'x64', 'signtool.exe'),
    path.join(programFiles, 'Windows Kits', '10', 'bin', 'x64', 'signtool.exe'),
    path.join(programFilesX86, 'Windows Kits', '10', 'bin', 'x64', 'signtool.exe'),
    path.join(programFiles, 'Windows Kits', '8.1', 'bin', 'x64', 'signtool.exe'),
    findSignToolInArtifactSigningCache(),
  ].filter(Boolean);

  return possiblePaths.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function verifyWithPowerShell(filePath) {
  const escapedPath = filePath.replace(/'/g, "''");
  const result = await execa(
    'pwsh',
    [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'; if ($signature.Status -eq 'Valid') { Write-Output 'Valid'; exit 0 } Write-Output $signature.Status; if ($signature.StatusMessage) { Write-Output $signature.StatusMessage }; exit 1`,
    ],
    {
      reject: false,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      windowsHide: true,
    },
  );

  return {
    signed: result.exitCode === 0,
    method: 'powershell-authenticode',
    code: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function verifySignature(filePath) {
  if (process.platform !== 'win32') {
    return {
      signed: false,
      method: 'unsupported-platform',
      note: 'Full Authenticode verification requires Windows signature tooling.',
    };
  }

  const signToolPath = getSignToolPath();
  if (!signToolPath) {
    return verifyWithPowerShell(filePath);
  }

  const result = await execa(signToolPath, ['verify', '/pa', filePath], {
    reject: false,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true,
  });

  return {
    signed: result.exitCode === 0,
    method: 'signtool',
    code: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function formatResult(filePath, result) {
  const fileName = path.basename(filePath);

  if (result.signed) {
    return `${colors.green}✓ ${fileName}${colors.reset} (signed)`;
  }

  if (result.method === 'unsupported-platform') {
    return `${colors.yellow}⊘ ${fileName}${colors.reset} (${result.note})`;
  }

  if (result.method === 'missing-signtool') {
    return `${colors.red}✗ ${fileName}${colors.reset} (signtool missing)`;
  }

  return `${colors.red}✗ ${fileName}${colors.reset} (unsigned)`;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  let filesToVerify = [];

  if (args.includes('--all')) {
    const index = args.indexOf('--all');
    const dirPath = args[index + 1];
    if (!dirPath || !fs.existsSync(dirPath)) {
      logCI('--all requires an existing directory path', 'error');
      process.exit(2);
    }
    filesToVerify = findSignableFiles(dirPath);
  } else if (args.includes('--catalog')) {
    const index = args.indexOf('--catalog');
    const catalogPath = args[index + 1];
    if (!catalogPath || !fs.existsSync(catalogPath)) {
      logCI('--catalog requires an existing file path', 'error');
      process.exit(2);
    }
    filesToVerify = readCatalogFile(catalogPath);
  } else if (args.length === 1) {
    filesToVerify = [args[0]];
  } else {
    showHelp();
    process.exit(2);
  }

  const normalizedFiles = normalizeCandidateFiles(filesToVerify);
  if (normalizedFiles.length === 0) {
    logCI('No signable files found to verify', 'warning');
    process.exit(0);
  }

  const results = [];
  for (const filePath of normalizedFiles) {
    const result = await verifySignature(filePath);
    results.push({ filePath, result });
    console.log(formatResult(filePath, result));
  }

  const failedResults = results.filter((entry) => !entry.result.signed);
  if (failedResults.length === 0) {
    logCI(`All ${results.length} file(s) passed signature verification`, 'notice');
    process.exit(0);
  }

  logCI(`${failedResults.length} of ${results.length} file(s) did not pass signature verification`, 'warning');
  process.exit(config.strictMode ? 1 : 0);
}

main().catch((error) => {
  logCI(error instanceof Error ? error.message : String(error), 'error');
  process.exit(1);
});
