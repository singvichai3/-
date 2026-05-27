#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { signSecondaryUpdateManifest } = require('../secondary-update-signing');

const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.resolve(process.argv[2] || path.join(repoRoot, 'update-secondary.json'));
const defaultPrivateKeyPath = path.resolve(repoRoot, '..', 'ระบบรับเล่ม-private', 'secondary-update-signing-private-key.pem');
const privateKeyPath = path.resolve(process.env.SECONDARY_UPDATE_PRIVATE_KEY_PATH || defaultPrivateKeyPath);

function ensurePrivateKey(filePath) {
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(filePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(path.join(repoRoot, 'secondary-update-public-key.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  console.log(`สร้าง private key ใหม่ไว้ที่: ${filePath}`);
  console.log('สร้าง public key ใหม่ไว้ที่: secondary-update-public-key.pem');
  return fs.readFileSync(filePath, 'utf8');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const privateKey = ensurePrivateKey(privateKeyPath);
const signed = signSecondaryUpdateManifest(manifest, privateKey);
fs.writeFileSync(manifestPath, JSON.stringify(signed, null, 2) + '\n', 'utf8');
console.log(`signed manifest: ${manifestPath}`);
console.log(`key used: ${privateKeyPath}`);
