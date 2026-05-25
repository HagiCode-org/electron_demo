#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const requirePackage = process.env.ELECTRON_DEMO_SMOKE_TEST_REQUIRE_PACKAGE === '1';
const allowDirOnly = process.env.ELECTRON_DEMO_SMOKE_TEST_ALLOW_DIR_ONLY === '1';

const results = {
  passed: 0,
  failed: 0,
};

function pass(message) {
  results.passed += 1;
  console.log(`PASS ${message}`);
}

function fail(message) {
  results.failed += 1;
  console.error(`FAIL ${message}`);
}

function assertExists(relativePath) {
  const absolutePath = path.join(cwd, relativePath);
  if (fs.existsSync(absolutePath)) {
    pass(`${relativePath} exists`);
    return absolutePath;
  }

  fail(`${relativePath} is missing`);
  return null;
}

function listFiles(relativeDir) {
  const absoluteDir = path.join(cwd, relativeDir);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  return fs.readdirSync(absoluteDir, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    absolutePath: path.join(absoluteDir, entry.name),
    isDirectory: entry.isDirectory(),
  }));
}

function expectPackageOutputs() {
  const pkgEntries = listFiles('pkg');
  if (pkgEntries.length === 0) {
    fail('pkg directory is empty');
    return;
  }

  pass('pkg directory contains build outputs');

  if (process.platform === 'linux') {
    const hasAppImage = pkgEntries.some((entry) => entry.name.endsWith('.AppImage'));
    const hasTarGz = pkgEntries.some((entry) => entry.name.endsWith('.tar.gz'));
    const hasZip = pkgEntries.some((entry) => entry.name.endsWith('.zip'));
    const hasUnpacked = pkgEntries.some((entry) => entry.isDirectory && entry.name === 'linux-unpacked');

    if (hasUnpacked) {
      pass('linux-unpacked output exists');
    } else {
      fail('linux-unpacked output is missing');
    }

    if (allowDirOnly) {
      return;
    }

    hasAppImage ? pass('Linux AppImage exists') : fail('Linux AppImage is missing');
    hasTarGz ? pass('Linux tar.gz exists') : fail('Linux tar.gz is missing');
    hasZip ? pass('Linux zip exists') : fail('Linux zip is missing');
    return;
  }

  if (process.platform === 'win32') {
    const hasExe = pkgEntries.some((entry) => entry.name.endsWith('.exe'));
    const hasUnpacked = pkgEntries.some((entry) => entry.isDirectory && entry.name === 'win-unpacked');

    hasExe ? pass('Windows executable exists') : fail('Windows executable is missing');
    hasUnpacked ? pass('win-unpacked output exists') : fail('win-unpacked output is missing');
    return;
  }

  if (process.platform === 'darwin') {
    const hasArchive = pkgEntries.some((entry) => entry.name.endsWith('.dmg') || entry.name.endsWith('.zip'));
    const hasAppBundle = pkgEntries.some((entry) => entry.isDirectory && entry.name.startsWith('mac'));

    hasArchive ? pass('macOS archive exists') : fail('macOS archive is missing');
    hasAppBundle ? pass('macOS app bundle directory exists') : fail('macOS app bundle directory is missing');
  }
}

assertExists('dist/main/bootstrap.js');
assertExists('dist/main/main.js');
assertExists('dist/preload/index.mjs');
assertExists('dist/renderer/index.html');

if (requirePackage) {
  expectPackageOutputs();
}

if (results.failed > 0) {
  console.error(`Smoke test failed: ${results.failed} check(s) failed, ${results.passed} passed.`);
  process.exit(1);
}

console.log(`Smoke test passed: ${results.passed} check(s).`);
