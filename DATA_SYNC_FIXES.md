# Data Desync & UI Mismatch Fixes

## Overview
This document summarizes all fixes made to resolve data synchronization issues between the UI and database worker.

---

## 1. ✅ Request Tracking with Sequence ID

### Problem
Race conditions occurred when multiple IPC requests were sent simultaneously. Older responses could overwrite newer data.

### Solution
- **Added `sequenceId` counter** in `State` (renderer.js)
- **Each IPC request** now carries a unique sequence ID
- **UI ignores stale responses** where `seqId < State.sequenceId`

### Files Modified
- `renderer.js`: Added `getNextSequenceId()`, `trackRequest()`, `isStaleRequest()`, `completeRequest()`
- `preload.js`: Updated API signatures to accept `sequenceId` parameter
- `main.js`: Updated IPC handlers to pass `sequenceId` through the chain

---

## 2. ✅ Synchronous State Update (Refresh Broadcast)

### Problem
After CUD (Create, Update, Delete) operations, the UI could become out of sync with the database.

### Solution
- **Worker broadcasts `refresh-required` signal** after every successful CUD operation
- **Main process** forwards this signal to all renderer windows via `ipcRenderer.on('refresh-required')`
- **UI clears cache and reloads** data when signal is received

### Files Modified
- `renderer.js`: Added `setupRefreshListener()` function
- `main.js`: Added `broadcastRefresh()` helper, called after all CUD operations
- `preload.js`: Exposed `onRefreshRequired` API

---

## 3. ✅ Error Rollback Logic (Optimistic UI)

### Problem
When an optimistic UI action failed in the database, the UI remained in an incorrect state until manual refresh.

### Solution
- **Push rollback state** before every optimistic update
- **On error, automatically rollback** to previous state
- **Show toast notification** with error message and rollback confirmation
- **Clean old rollbacks** (> 5 minutes) automatically

### Files Modified
- `renderer.js`: 
  - Added `pushRollback()`, `executeRollback()` helpers
  - Updated `updateField()`, `markReceived()`, `undoReceived()`, `deleteRecord()`, `deleteSelected()` with rollback logic

### Rollback Behavior
```javascript
// Before optimistic update:
pushRollback(id, { status: 'pending', receivedAt: null });

// On error:
if (executeRollback(id)) {
  showNotification('❌ Failed: ' + error.message + ' (Restored)', 'error');
  renderVisibleRows(); // Re-render with rolled-back data
}
```

---

## 4. ✅ Date Consistency Check

### Problem
Dates displayed in the UI could differ from the ISO 8601 format stored in SQLite due to timezone or format shifts.

### Solution
- **Consistent `formatDate()` function** using `Intl.DateTimeFormat`
- **Always use `Asia/Bangkok` timezone** for Thai locale
- **Parse dates consistently** from ISO 8601 strings
- **Database stores dates** as ISO 8601 (`YYYY-MM-DD`) via `normalizeDate()`

### Files Modified
- `renderer.js`: Updated `formatDate()` to use `Intl.DateTimeFormat` with consistent options
- `db-worker.js`: Verified `normalizeDate()` already uses ISO 8601 format

### Date Format Flow
```
Excel Input: "7/4/69" or "16/3/2569"
    ↓
renderer.js parseDateString(): Convert to "2026-04-07" or "2026-03-16"
    ↓
db-worker.js normalizeDate(): Store as "2026-04-07" (ISO 8601)
    ↓
renderer.js formatDate(): Display as "7 เม.ย. 2026" (Thai Buddhist Era)
```

---

## Testing Checklist

- [ ] Import 61 records from Excel
- [ ] Verify all 61 records display in list view
- [ ] Scroll through list - no missing records
- [ ] Mark one record as received - verify UI updates immediately
- [ ] Undo received - verify UI rolls back correctly
- [ ] Delete a record - verify it disappears and shows toast
- [ ] Update a field (province, brand, etc.) - verify it persists
- [ ] Switch views and return - data should still be correct
- [ ] Search/filter - results should display correctly
- [ ] Pagination - all pages should load properly
- [ ] Multiple rapid actions - no race conditions or stale data

---

## Architecture Summary

```
┌─────────────────┐
│  Renderer (UI)  │
│                 │
│  - sequenceId   │─── IPC ───┐
│  - rollbackStack│           │
│  - State.records│           ▼
└─────────────────┘    ┌─────────────────┐
                       │   Main Process  │
                       │                 │
                       │  broadcastRefresh()
                       │  - send 'refresh-required'
                       │    to all windows
                       └────────┬────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │  Worker Thread  │
                       │                 │
                       │  - search()     │
                       │  - importBatch()│
                       │  - markReceived()│
                       │  - updateField()│
                       │  - delete()     │
                       └─────────────────┘
```

---

## Future Improvements

1. **WebSocket-style real-time sync** for multi-window scenarios
2. **CRDT (Conflict-free Replicated Data Types)** for offline-first sync
3. **IndexedDB cache layer** for faster load times
4. **Service Worker** for background sync
