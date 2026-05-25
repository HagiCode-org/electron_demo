#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const requirePackage = process.env.ELECTRON_DEMO_SMOKE_TEST_REQUIRE_PACKAGE === '1';
const allowDirOnly = process.env.ELECTRON_DEMO_SMOKE_TEST_ALLOW_DIR_ONLY === '1';
const expectedPlatform = process.env.ELECTRON_DEMO_SMOKE_TEST_EXPECT_PLATFORM || '';
const expectedTarget = process.env.ELECTRON_DEMO_SMOKE_TEST_EXPECT_TARGET || '';

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

function assertCondition(condition, successMessage, failureMessage) {
  if (condition) {
    pass(successMessage);
    return;
  }

  fail(failureMessage);
}

function expectPackageOutputs() {
  const pkgEntries = listFiles('pkg');
  if (pkgEntries.length === 0) {
    fail('pkg directory is empty');
    return;
  }

  pass('pkg directory contains build outputs');

  if (expectedPlatform && expectedPlatform !== process.platform) {
    fail(`Expected package platform ${expectedPlatform}, current platform is ${process.platform}`);
    return;
  }

  if (process.platform === 'linux') {
    const hasAppImage = pkgEntries.some((entry) => entry.name.endsWith('.AppImage'));
    const hasDeb = pkgEntries.some((entry) => entry.name.endsWith('.deb'));
    const hasRpm = pkgEntries.some((entry) => entry.name.endsWith('.rpm'));
    const hasTarGz = pkgEntries.some((entry) => entry.name.endsWith('.tar.gz'));
    const hasZip = pkgEntries.some((entry) => entry.name.endsWith('.zip'));
    const hasUnpacked = pkgEntries.some((entry) => entry.isDirectory && entry.name === 'linux-unpacked');

    assertCondition(hasUnpacked, 'linux-unpacked output exists', 'linux-unpacked output is missing');

    if (allowDirOnly) {
      return;
    }

    if (expectedTarget === 'appimage') {
      assertCondition(hasAppImage, 'Linux AppImage exists', 'Linux AppImage is missing');
      return;
    }

    if (expectedTarget === 'deb') {
      assertCondition(hasDeb, 'Linux deb exists', 'Linux deb is missing');
      return;
    }

    if (expectedTarget === 'rpm') {
      assertCondition(hasRpm, 'Linux rpm exists', 'Linux rpm is missing');
      return;
    }

    if (expectedTarget === 'tar.gz') {
      assertCondition(hasTarGz, 'Linux tar.gz exists', 'Linux tar.gz is missing');
      return;
    }

    if (expectedTarget === 'zip') {
      assertCondition(hasZip, 'Linux zip exists', 'Linux zip is missing');
      return;
    }

    assertCondition(hasAppImage, 'Linux AppImage exists', 'Linux AppImage is missing');
    assertCondition(hasDeb, 'Linux deb exists', 'Linux deb is missing');
    assertCondition(hasRpm, 'Linux rpm exists', 'Linux rpm is missing');
    assertCondition(hasTarGz, 'Linux tar.gz exists', 'Linux tar.gz is missing');
    assertCondition(hasZip, 'Linux zip exists', 'Linux zip is missing');
    return;
  }

  if (process.platform === 'win32') {
    const hasAppx = pkgEntries.some((entry) => entry.name.endsWith('.appx'));
    const hasPortableExe = pkgEntries.some((entry) => entry.name.endsWith('.exe') && !entry.name.includes('Setup'));
    const hasNsisExe = pkgEntries.some((entry) => entry.name.endsWith('.exe') && entry.name.includes('Setup'));
    const hasMsix = pkgEntries.some((entry) => entry.name.endsWith('.msix'));
    const hasUnpacked = pkgEntries.some((entry) => entry.isDirectory && entry.name === 'win-unpacked');

    assertCondition(hasUnpacked, 'win-unpacked output exists', 'win-unpacked output is missing');

    if (expectedTarget === 'portable') {
      assertCondition(hasPortableExe, 'Windows portable executable exists', 'Windows portable executable is missing');
      return;
    }

    if (expectedTarget === 'appx') {
      assertCondition(hasAppx, 'Windows AppX package exists', 'Windows AppX package is missing');
      return;
    }

    if (expectedTarget === 'nsis') {
      assertCondition(hasNsisExe, 'Windows NSIS installer exists', 'Windows NSIS installer is missing');
      return;
    }

    if (expectedTarget === 'msix') {
      assertCondition(hasMsix, 'Windows MSIX package exists', 'Windows MSIX package is missing');
      return;
    }

    assertCondition(hasPortableExe || hasNsisExe || hasAppx || hasMsix, 'Windows package exists', 'Windows package is missing');
    return;
  }

  if (process.platform === 'darwin') {
    const hasDmg = pkgEntries.some((entry) => entry.name.endsWith('.dmg'));
    const hasZip = pkgEntries.some((entry) => entry.name.endsWith('.zip'));
    const hasAppBundle = pkgEntries.some((entry) => entry.isDirectory && entry.name.startsWith('mac'));

    assertCondition(hasAppBundle, 'macOS app bundle directory exists', 'macOS app bundle directory is missing');

    if (expectedTarget === 'dmg') {
      assertCondition(hasDmg, 'macOS dmg exists', 'macOS dmg is missing');
      return;
    }

    if (expectedTarget === 'zip') {
      assertCondition(hasZip, 'macOS zip exists', 'macOS zip is missing');
      return;
    }

    assertCondition(hasDmg || hasZip, 'macOS archive exists', 'macOS archive is missing');
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
