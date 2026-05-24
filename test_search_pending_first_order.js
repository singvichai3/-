const assert = require('assert');
const SearchManager = require('./search');

function createSearchManagerWithRows(rows) {
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return {
        all(...params) {
          if (/COUNT\(\*\)/.test(sql)) return [];
          if (/GROUP BY/.test(sql)) return [];
          return rows;
        },
        get() { return { total: rows.length }; }
      };
    }
  };
  const manager = new SearchManager(db);
  return { manager, statements };
}

function testNoQuerySqlOrdersPendingBeforeReceived() {
  const rows = [
    { id: 'received', plate: 'กข 1111', status: 'received', type: 'รย', importedAt: '2026-05-02' },
    { id: 'pending', plate: 'กข 2222', status: 'pending', type: 'รย', importedAt: '2026-05-03' }
  ];
  const { manager, statements } = createSearchManagerWithRows(rows);
  manager.searchBundle({ page: 1, pageSize: 50, includeInsights: false });
  const selectSql = statements.find(sql => sql.includes('SELECT * FROM records')) || '';
  assert.ok(selectSql.includes("WHEN status = 'pending' THEN 0"), 'base search SQL should sort pending rows first');
  assert.ok(selectSql.includes("WHEN status = 'received' THEN 1"), 'base search SQL should sort received rows below pending rows');
  assert.ok(selectSql.indexOf("WHEN status = 'pending' THEN 0") < selectSql.indexOf('DATE(importedAt) ASC'), 'status priority should happen before date/type ordering');
}

function testRankedSearchStillKeepsPendingAboveReceived() {
  const rows = [
    { id: 'received-exact', plate: 'กข 1234', status: 'received', type: 'รย', importedAt: '2026-05-01' },
    { id: 'pending-partial', plate: 'กข 1234', status: 'pending', type: 'รย', importedAt: '2026-05-02' },
    { id: 'completed-exact', plate: 'กข 1234', status: 'completed', type: 'รย', importedAt: '2026-05-03' },
    { id: 'returned-exact', plate: 'กข 1234', status: 'returned', type: 'รย', importedAt: '2026-05-04' }
  ];
  const { manager } = createSearchManagerWithRows(rows);
  const ranked = manager.rankRows(
    { fetchWhereSql: '', fetchParams: [], total: rows.length, fallbackUsed: false },
    { normQuery: manager.normalizePlate('กข 1234'), rawQuery: 'กข 1234' }
  );
  assert.deepStrictEqual(
    ranked.map(row => row.id),
    ['pending-partial', 'received-exact', 'completed-exact', 'returned-exact'],
    'ranked search should group not-yet-received cars above already received/completed/returned cars'
  );
}

testNoQuerySqlOrdersPendingBeforeReceived();
testRankedSearchStillKeepsPendingAboveReceived();
console.log('✅ search pending-first order tests passed');
