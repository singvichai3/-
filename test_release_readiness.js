const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assertIncludes(value, expected, message) {
  assert.ok(String(value || '').includes(expected), message || `Expected ${value} to include ${expected}`);
}

function findVersionedInstaller(dir, pattern) {
  const fullDir = path.join(root, dir);
  if (!fs.existsSync(fullDir)) return null;
  return fs.readdirSync(fullDir).find((name) => pattern.test(name)) || null;
}

const packageJson = readJson('package.json');
const updateJson = readJson('update.json');
const updateSecondaryJson = readJson('update-secondary.json');
const version = packageJson.version;
const escapedVersion = version.replace(/\./g, '\\.');

assert.strictEqual(updateJson.version, version, 'update.json version must match package.json');
assert.strictEqual(updateSecondaryJson.version, version, 'update-secondary.json version must match package.json');
assertIncludes(updateJson.url, `V${version}/`, 'primary update URL must point to the current GitHub release tag');
assertIncludes(updateJson.url, `-${version}.exe`, 'primary update URL must point to a current-version installer');
assertIncludes(updateSecondaryJson.url, `V${version}/`, 'secondary update URL must point to the current GitHub release tag');
assertIncludes(updateSecondaryJson.url, `-${version}.exe`, 'secondary update URL must point to a current-version installer');

const primaryThaiInstaller = findVersionedInstaller('dist-main-latest', new RegExp(`^รับเล่มรถ ตรอ Setup ${escapedVersion}\\.exe$`));
const secondaryThaiInstaller = findVersionedInstaller('dist-secondary-latest', new RegExp(`^รับเล่มรถ ตรอ เครื่องรอง Setup ${escapedVersion}\\.exe$`));
assert.ok(primaryThaiInstaller, `dist-main-latest must contain the Thai primary installer for ${version}`);
assert.ok(secondaryThaiInstaller, `dist-secondary-latest must contain the Thai secondary installer for ${version}`);

const primarySlug = `release-assets/rab-lem-rot-tro-setup-${version}.exe`;
const secondarySlug = `release-assets/rab-lem-rot-tro-secondary-setup-${version}.exe`;
assert.ok(fileExists(primarySlug), `release-assets must contain ${primarySlug}`);
assert.ok(fileExists(`${primarySlug}.blockmap`), `release-assets must contain ${primarySlug}.blockmap`);
assert.ok(fileExists(secondarySlug), `release-assets must contain ${secondarySlug}`);
assert.ok(fileExists(`${secondarySlug}.blockmap`), `release-assets must contain ${secondarySlug}.blockmap`);
assert.ok(fileExists('release-assets/update.json'), 'release-assets must contain update.json for GitHub raw update');
assert.ok(fileExists('release-assets/update-secondary.json'), 'release-assets must contain update-secondary.json for GitHub raw update');

const primaryLatest = fs.readFileSync(path.join(root, 'dist-main-latest', 'latest.yml'), 'utf8');
const secondaryLatest = fs.readFileSync(path.join(root, 'dist-secondary-latest', 'latest.yml'), 'utf8');
assert.ok(primaryLatest.includes(`version: ${version}`), 'primary latest.yml must match package version');
assert.ok(secondaryLatest.includes(`version: ${version}`), 'secondary latest.yml must match package version');

console.log('✅ release readiness tests passed');