/**
 * search.js — Search Logic
 * LRU Cache, Debounce, Prefetch
 */

class SearchManager {
  constructor(db) {
    this.db = db;
    this.cache = new Map();
    this.cacheSize = 100;
    this.prefetchQueue = [];
    this.isPrefetching = false;
    this.maxCandidateRows = 1000;
  }

  /**
   * Search with FTS5 Trigram + LRU Cache
   */
  search(params = {}) {
    const { page = 1, pageSize = 50, __prefetch = false } = params;

    console.log('🔍 search() called with params:', JSON.stringify(params));

    const filters = this.buildFilters(params);
    const { normQuery, cacheFilters } = filters;

    console.log('🔍 Normalized query:', JSON.stringify(normQuery));

    // Generate cache key
    const cacheKey = JSON.stringify({ ...cacheFilters, page, pageSize });
    console.log('🔍 Cache key:', cacheKey);

    // Check cache
    if (this.cache.has(cacheKey)) {
      console.log('💾 Cache hit, returning cached results');
      return this.cache.get(cacheKey);
    }

    console.log('🔍 Cache miss, querying database...');

    const results = this.resolveMatches(params, { page, pageSize });

    console.log('📊 Query returned:', results.length, 'records');
    if (results.length > 0) {
      console.log('📊 First result sample:', JSON.stringify(results[0]));
    }

    // Check total in database
    const totalCount = this.db.prepare('SELECT COUNT(*) as count FROM records').get();
    console.log('📊 Total records in database:', totalCount.count);

    // Store in cache (LRU)
    this.setCache(cacheKey, results);

    // Schedule prefetch
    if (!__prefetch && normQuery.length >= 2) {
      this.schedulePrefetch({ ...params, query: normQuery + 'a' });
      this.schedulePrefetch({ ...params, query: normQuery + 'b' });
    }

    return results;
  }

  /**
   * Get total count with same filters
   */
  count(params = {}) {
    return this.resolveMatches(params, { countOnly: true });
  }

  /**
   * Export/list results using the same filter contract as search/count
   */
  list(params = {}) {
    return this.resolveMatches(params, { listAll: true });
  }

  /**
   * Compute search insights for the current result set
   */
  insights(params = {}) {
    const records = this.resolveMatches(params, { listAll: true, insightLimit: 300 });
    const topBrands = new Map();
    const byType = { 'รย': 0, 'จยย': 0, other: 0 };
    const byStatus = { pending: 0, received: 0 };

    for (const record of records) {
      if (record.type === 'รย') byType['รย']++;
      else if (record.type === 'จยย') byType['จยย']++;
      else byType.other++;

      if (record.status === 'received') byStatus.received++;
      else byStatus.pending++;

      const brand = String(record.brand || '').trim();
      if (brand) {
        topBrands.set(brand, (topBrands.get(brand) || 0) + 1);
      }
    }

    return {
      totalMatched: records.length,
      byType,
      byStatus,
      topBrands: Array.from(topBrands.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([brand, count]) => ({ brand, count }))
    };
  }

  /**
   * Resolve matches for search/count/list using a shared ranking pipeline
   */
  resolveMatches(params = {}, options = {}) {
    const { page = 1, pageSize = 50, countOnly = false, listAll = false, insightLimit = this.maxCandidateRows } = options;
    const filters = this.buildFilters(params);
    const { normQuery, fuzzyQuery, rawQuery, baseWhereSql, baseParams, ftsWhereSql, ftsParams } = filters;

    if (!normQuery) {
      if (countOnly) {
        const sql = `SELECT COUNT(*) as total FROM records WHERE 1=1${baseWhereSql}`;
        return this.db.prepare(sql).get(...baseParams)?.total || 0;
      }

      const limit = listAll ? insightLimit : pageSize;
      const offset = listAll ? 0 : (page - 1) * pageSize;
      const sql = `SELECT * FROM records WHERE 1=1${baseWhereSql} ORDER BY DATE(importedAt) ASC, CASE WHEN type = 'รย' THEN 0 WHEN type = 'จยย' THEN 1 ELSE 2 END ASC, importedAt ASC LIMIT ? OFFSET ?`;
      return this.db.prepare(sql).all(...baseParams, limit, offset);
    }

    const candidateLimit = listAll ? insightLimit : Math.max(pageSize * 4, 200);
    let candidates = this.db.prepare(
      `SELECT * FROM records WHERE 1=1${baseWhereSql}${ftsWhereSql} ORDER BY DATE(importedAt) ASC, CASE WHEN type = 'รย' THEN 0 WHEN type = 'จยย' THEN 1 ELSE 2 END ASC, importedAt ASC LIMIT ?`
    ).all(...baseParams, ...ftsParams, candidateLimit);

    let fallbackUsed = false;

    if (candidates.length === 0) {
      fallbackUsed = true;
      const likeToken = `%${fuzzyQuery || rawQuery.trim()}%`;
      const sql = `
        SELECT * FROM records
        WHERE 1=1${baseWhereSql}
          AND (
            plate_norm LIKE ? OR plate LIKE ? OR brand LIKE ? OR name LIKE ? OR phone LIKE ? OR province LIKE ?
          )
        ORDER BY DATE(importedAt) ASC, CASE WHEN type = 'รย' THEN 0 WHEN type = 'จยย' THEN 1 ELSE 2 END ASC, importedAt ASC
        LIMIT ?
      `;
      candidates = this.db.prepare(sql).all(
        ...baseParams,
        `%${normQuery}%`,
        likeToken,
        likeToken,
        likeToken,
        likeToken,
        likeToken,
        candidateLimit
      );
    }

    const ranked = candidates
      .map(record => ({ ...record, __score: this.scoreRecord(record, normQuery, rawQuery, fallbackUsed) }))
      .sort((left, right) => {
        if (right.__score !== left.__score) return right.__score - left.__score;
        const dateCompare = String(left.importedAt || '').localeCompare(String(right.importedAt || ''));
        if (dateCompare !== 0) return dateCompare;
        const leftTypeOrder = left.type === 'รย' ? 0 : (left.type === 'จยย' ? 1 : 2);
        const rightTypeOrder = right.type === 'รย' ? 0 : (right.type === 'จยย' ? 1 : 2);
        if (leftTypeOrder !== rightTypeOrder) return leftTypeOrder - rightTypeOrder;
        return String(left.plate || '').localeCompare(String(right.plate || ''));
      });

    if (countOnly) return ranked.length;
    if (listAll) return ranked.slice(0, insightLimit).map(({ __score, ...record }) => record);

    const offset = (page - 1) * pageSize;
    return ranked.slice(offset, offset + pageSize).map(({ __score, ...record }) => record);
  }

  /**
   * Build reusable WHERE clauses for advanced search
   */
  buildFilters(params = {}) {
    const {
      query = '',
      type = 'all',
      status = 'all',
      plate = '',
      ownerName = '',
      phone = '',
      brand = '',
      province = '',
      importedFrom = '',
      importedTo = '',
      receivedFrom = '',
      receivedTo = ''
    } = params;

    const normQuery = this.normalizePlate(query);
    const rawQuery = String(query || '').trim();
    const queryParams = [];
    let whereSql = '';

    const normalizedPlate = this.normalizePlate(plate);
    if (normalizedPlate) {
      whereSql += ` AND plate_norm LIKE ?`;
      queryParams.push(`%${normalizedPlate}%`);
    }

    if (ownerName.trim()) {
      whereSql += ` AND name LIKE ?`;
      queryParams.push(`%${ownerName.trim()}%`);
    }

    if (phone.trim()) {
      whereSql += ` AND phone LIKE ?`;
      queryParams.push(`%${phone.trim()}%`);
    }

    if (brand.trim()) {
      whereSql += ` AND brand LIKE ?`;
      queryParams.push(`%${brand.trim()}%`);
    }

    if (province.trim()) {
      whereSql += ` AND province LIKE ?`;
      queryParams.push(`%${province.trim()}%`);
    }

    if (importedFrom) {
      whereSql += ` AND DATE(importedAt) >= DATE(?)`;
      queryParams.push(importedFrom);
    }

    if (importedTo) {
      whereSql += ` AND DATE(importedAt) <= DATE(?)`;
      queryParams.push(importedTo);
    }

    if (receivedFrom) {
      whereSql += ` AND receivedAt IS NOT NULL AND DATE(receivedAt) >= DATE(?)`;
      queryParams.push(receivedFrom);
    }

    if (receivedTo) {
      whereSql += ` AND receivedAt IS NOT NULL AND DATE(receivedAt) <= DATE(?)`;
      queryParams.push(receivedTo);
    }

    if (type !== 'all') {
      whereSql += ` AND type = ?`;
      queryParams.push(type);
    }

    if (status !== 'all') {
      whereSql += ` AND status = ?`;
      queryParams.push(status);
    }

    const sanitizedQuery = normQuery ? this.sanitizeFTSQuery(normQuery) : '';
    const ftsWhereSql = sanitizedQuery ? ` AND rowid IN (
        SELECT rowid FROM records_fts
        WHERE records_fts MATCH ?
      )` : '';

    if (sanitizedQuery) {
      console.log('🔍 FTS5 MATCH query:', JSON.stringify(sanitizedQuery));
    }

    return {
      normQuery,
      rawQuery,
      fuzzyQuery: this.createFuzzyToken(normQuery),
      baseWhereSql: whereSql,
      baseParams: queryParams,
      ftsWhereSql,
      ftsParams: sanitizedQuery ? [sanitizedQuery] : [],
      whereSql: `${whereSql}${ftsWhereSql}`,
      queryParams: sanitizedQuery ? [...queryParams, sanitizedQuery] : [...queryParams],
      cacheFilters: {
        query: normQuery,
        type,
        status,
        plate: normalizedPlate,
        ownerName: ownerName.trim(),
        phone: phone.trim(),
        brand: brand.trim(),
        province: province.trim(),
        importedFrom,
        importedTo,
        receivedFrom,
        receivedTo
      }
    };
  }

  /**
   * Set cache with LRU eviction
   */
  setCache(key, value) {
    // If key exists, delete and re-insert (move to end)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if over limit
    if (this.cache.size >= this.cacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, value);
  }

  /**
   * Invalidate all cache (after INSERT/UPDATE/DELETE)
   */
  invalidate() {
    this.cache.clear();
  }

  /**
   * Normalize plate number for search consistency
   */
  normalizePlate(plate) {
    if (!plate) return '';
    return String(plate)
      .trim()
      .toUpperCase()
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .replace(/ /g, '');
  }

  /**
   * Sanitize FTS5 query string
   */
  sanitizeFTSQuery(query) {
    // Escape FTS5 special characters
    return query.replace(/(["\\:\(\)])/g, '\\$1');
  }

  /**
   * Generate a looser token for fallback LIKE matching
   */
  createFuzzyToken(query) {
    if (!query) return '';
    if (query.length <= 3) return query;
    return query.slice(0, -1);
  }

  /**
   * Score records to prefer exact and near-exact matches
   */
  scoreRecord(record, normalizedQuery, rawQuery, fallbackUsed = false) {
    const plateNorm = this.normalizePlate(record.plate);
    const brand = String(record.brand || '').toUpperCase();
    const name = String(record.name || '').toUpperCase();
    const phone = String(record.phone || '');
    const province = String(record.province || '').toUpperCase();
    const rawUpper = String(rawQuery || '').trim().toUpperCase();
    let score = 0;

    if (plateNorm === normalizedQuery) score += 120;
    else if (plateNorm.startsWith(normalizedQuery)) score += 90;
    else if (plateNorm.includes(normalizedQuery)) score += 75;

    if (brand === rawUpper) score += 55;
    else if (brand.includes(rawUpper) && rawUpper) score += 32;

    if (name === rawUpper) score += 48;
    else if (name.includes(rawUpper) && rawUpper) score += 28;

    if (phone.includes(rawQuery) && rawQuery) score += 26;
    if (province.includes(rawUpper) && rawUpper) score += 18;
    if (fallbackUsed) score -= 10;

    return score;
  }

  /**
   * Schedule prefetch (non-blocking)
   */
  schedulePrefetch(params) {
    this.prefetchQueue.push({ ...params, __prefetch: true });
    
    // Limit queue size
    if (this.prefetchQueue.length > 10) {
      this.prefetchQueue = this.prefetchQueue.slice(-10);
    }

    // Process prefetch on idle
    if (!this.isPrefetching) {
      setTimeout(() => this.processPrefetch(), 100);
    }
  }

  /**
   * Process prefetch queue
   */
  processPrefetch() {
    if (this.prefetchQueue.length === 0) {
      this.isPrefetching = false;
      return;
    }

    this.isPrefetching = true;
    const params = this.prefetchQueue.shift();

    try {
      // Prefetch without returning (just warm cache)
      this.search(params);
    } catch (error) {
      console.warn('⚠️ Prefetch error:', error.message);
    }

    // Continue if queue not empty
    if (this.prefetchQueue.length > 0) {
      setTimeout(() => this.processPrefetch(), 50);
    } else {
      this.isPrefetching = false;
    }
  }
}

module.exports = SearchManager;
