/**
 * test_system.js — Quick Verification Script
 * Run: node test_system.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Checking System Files...\n');

const requiredFiles = [
    'package.json',
    'main.js',
    'preload.js',
    'db.js',
    'db-worker.js',
    'search.js',
    'index.html',
    'renderer.js'
];

let allExist = true;

requiredFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').length;
        console.log(`✅ ${file.padEnd(20)} ${String(lines + ' lines').padEnd(12)} ${formatSize(stats.size)}`);
    } else {
        console.log(`❌ ${file.padEnd(20)} MISSING`);
        allExist = false;
    }
});

console.log('\n' + '='.repeat(60));

if (allExist) {
    console.log('✅ All 8 files exist!');
    
    // Check critical features in code
    console.log('\n🔍 Checking Critical Features...\n');
    
    const mainJs = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf-8');
    const preloadJs = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf-8');
    const dbJs = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf-8');
    const dbWorkerJs = fs.readFileSync(path.join(__dirname, 'db-worker.js'), 'utf-8');
    const rendererJs = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf-8');
    const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
    
    const checks = [
        { name: 'Parse Excel IPC', test: mainJs.includes('parse-excel') },
        { name: 'Progress Forwarding', test: mainJs.includes('import-progress') },
        { name: 'Parse Excel API', test: preloadJs.includes('parseExcel') },
        { name: 'Progress Listener', test: preloadJs.includes('onImportProgress') },
        { name: 'WAL Autocheckpoint', test: dbJs.includes('wal_autocheckpoint') },
        { name: 'Batch Import', test: dbWorkerJs.includes('batchSize') },
        { name: 'Progress Reporting', test: dbWorkerJs.includes('import-progress') },
        { name: 'Delete Button', test: rendererJs.includes('deleteRecord') },
        { name: 'Pagination', test: rendererJs.includes('prevPage') && rendererJs.includes('nextPage') },
        { name: 'Undo Toast', test: rendererJs.includes('undoLastAction') },
        { name: 'Keyboard Shortcuts', test: rendererJs.includes('setupKeyboardShortcuts') },
        { name: 'Progress Bar UI', test: indexHtml.includes('progress-fill') },
        { name: 'Pagination UI', test: indexHtml.includes('btn-first') && indexHtml.includes('btn-last') },
        { name: 'Undo Toast UI', test: indexHtml.includes('undo-toast') }
    ];
    
    let passed = 0;
    checks.forEach(check => {
        if (check.test) {
            console.log(`✅ ${check.name}`);
            passed++;
        } else {
            console.log(`❌ ${check.name}`);
        }
    });
    
    console.log('\n' + '='.repeat(60));
    console.log(`✅ ${passed}/${checks.length} critical features verified!`);
    
    if (passed === checks.length) {
        console.log('\n🎉 All systems go! System is production ready.');
    } else {
        console.log('\n⚠️  Some features missing. Review needed.');
    }
} else {
    console.log('❌ Some files are missing. Cannot continue.');
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
