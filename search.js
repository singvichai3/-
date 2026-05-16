/**
 * search.js — Search Logic
 * LRU Cache, Debounce, Prefetch
 */

class SearchManager {
  constructor(db) {
    this.db = db;
    this.cache = new Map();
    this.cacheSize = 100;
    this.maxCandidateRows = 5000;
    // Prepared statement cache — ป้องกัน prepare ซ้ำทุก query
    this._stmtCache = new Map();
  }

  /**
   * Get or create a prepared statement (reuse across calls)
   */
  _stmt(sql) {
    if (!this._stmtCache.has(sql)) {
      this._stmtCache.set(sql, this.db.prepare(sql));
    }
    return this._stmtCache.get(sql);
  }

  /**
   * Search with shared bundle cache
   */
  search(params = {}) {
    return this.searchBundle(params).records;
  }

  /**
   * Resolve records, count, and insights in one pass
   */
  searchBundle(params = {}) {
    const { page = 1, pageSize = 50, includeInsights = true, includeTotal = true } = params;
    const filters = this.buildFilters(params);
    const cacheKey = JSON.stringify({ ...filters.cacheFilters, page, pageSize, includeInsights, includeTotal, mode: 'bundle' });

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const bundle = this.resolveSearchBundle(params, { page, pageSize, includeInsights, includeTotal });
    this.setCache(cacheKey, bundle);
    return bundle;
  }

  /**
   * Get total count with same filters
   */
  count(params = {}) {
    return this.resolveSearchBundle(params, { page: 1, pageSize: 1, includeInsights: false, includeTotal: true }).total;
  }

  /**
   * Export/list results using the same filter contract as search/count
   */
  list(params = {}) {
    const filters = this.buildFilters(params);
    const strategy = this.resolveQueryStrategy(filters, { useCandidateLimit: false });

    if (!filters.normQuery) {
      const sql = `SELECT * FROM records WHERE 1=1${strategy.whereSql} ORDER BY DATE(importedAt) ASC, CASE WHEN type = 'รย' THEN 0 WHEN type = 'จยย' THEN 1 ELSE 2 END ASC, importedAt ASC`;
      return this._stmt(sql).all(...strategy.params);
    }

    return this.rankRows(strategy, filters).map(({ __score, ...record }) => record);
  }

  /**
   * Compute search insights for the current result set
   */
  insights(params = {}) {
    return this.resolveSearchBundle(params, { page: 1, pageSize: 1, includeInsights: true, includeTotal: true }).insights;
  }

  /**
   * Resolve records, count, and insights using a shared query strategy
   */
  resolveSearchBundle(params = {}, options = {}) {
    const { page = 1, pageSize = 50, includeInsights = true, includeTotal = true } = options;
    const filters = this.buildFilters(params);
    const strategy = this.resolveQueryStrategy(filters, { page, pageSize, useCandidateLimit: true, includeTotal });
    const insights = includeInsights ? this.loadInsights(strategy) : null;

    if (!filters.normQuery) {
      const offset = Math.max(0, (page - 1) * pageSize);
      const sql = `SELECT * FROM records WHERE 1=1${strategy.whereSql} ORDER BY DATE(importedAt) ASC, CASE WHEN type = 'รย' THEN 0 WHEN type = 'จยย' THEN 1 ELSE 2 END ASC, importedAt ASC LIMIT ? OFFSET ?`;
      const records = this._stmt(sql).all(...strategy.params, pageSize, offset);
      return {
        records,
        total: strategy.total,
        insights: insights || this.emptyInsights(strategy.total)
      };
    }

    const ranked = this.rankRows(strategy, filters);
    const offset = Math.max(0, (page - 1) * pageSize);

    return {
      records: ranked.slice(offset, offset + pageSize).map(({ __score, ...record }) => record),
      total: strategy.total,
      insights: insights || this.emptyInsights(strategy.total)
    };
  }

  /**
   * Resolve query strategy and compute the exact total once
   */
  resolveQueryStrategy(filters, options = {}) {
    const { page = 1, pageSize = 50, useCandidateLimit = false, includeTotal = true } = options;
    const { normQuery, rawQuery, fuzzyQuery, baseWhereSql, baseParams, ftsWhereSql, ftsParams } = filters;

    if (!normQuery) {
      const total = includeTotal ? this.countRows(baseWhereSql, baseParams) : null;
      return {
        mode: 'base',
        whereSql: baseWhereSql,
        params: baseParams,
        total,
        fallbackUsed: false,
        fetchWhereSql: baseWhereSql,
        fetchParams: baseParams
      };
    }

    const ftsWhere = `${baseWhereSql}${ftsWhereSql}`;
    const ftsParamsAll = [...baseParams, ...ftsParams];
    const ftsTotal = includeTotal ? this.countRows(ftsWhere, ftsParamsAll) : null;
    if ((includeTotal && ftsTotal > 0) || (!includeTotal && ftsParamsAll.length > 0)) {
      const candidateLimit = this.computeCandidateLimit(ftsTotal, page, pageSize, useCandidateLimit, filters.normQuery.length);
      return {
        mode: 'fts',
        whereSql: ftsWhere,
        params: ftsParamsAll,
        total: ftsTotal,
        fallbackUsed: false,
        fetchWhereSql: ftsWhere,
        fetchParams: ftsParamsAll,
        candidateLimit
      };
    }

    const likeToken = `%${fuzzyQuery || rawQuery.trim()}%`;
    const fallbackWhere = `
      ${baseWhereSql}
      AND (
        plate_norm LIKE ? OR plate LIKE ? OR brand LIKE ? OR name LIKE ? OR phone LIKE ? OR province LIKE ?
      )
    `;
    const fallbackParams = [
      ...baseParams,
      `%${normQuery}%`,
      likeToken,
      likeToken,
      likeToken,
      likeToken,
      likeToken
    ];

    const fallbackTotal = includeTotal ? this.countRows(fallbackWhere, fallbackParams) : null;
    const candidateLimit = this.computeCandidateLimit(fallbackTotal, page, pageSize, useCandidateLimit, filters.normQuery.length);

    return {
      mode: 'fallback',
      whereSql: fallbackWhere,
      params: fallbackParams,
      total: fallbackTotal,
      fallbackUsed: true,
      fetchWhereSql: fallbackWhere,
      fetchParams: fallbackParams,
      candidateLimit
    };
  }

  computeCandidateLimit(total, page, pageSize, useCandidateLimit, queryLength = 0) {
    if (!useCandidateLimit) return total;

    const requestedRows = Math.max(page * pageSize, pageSize);
    const shortQueryCap = queryLength > 0 && queryLength <= 2 ? 120 : 250;
    const hardCap = queryLength > 0 && queryLength <= 2 ? Math.min(this.maxCandidateRows, 1200) : this.maxCandidateRows;

    if (typeof total !== 'number' || Number.isNaN(total)) {
      return Math.max(requestedRows * 4, shortQueryCap);
    }

    if (!total) return 0;

    return Math.min(total, Math.max(requestedRows * 4, shortQueryCap), hardCap);
  }

  /**
   * Count rows exactly for the supplied filter clause
   */
  countRows(whereSql, params = []) {
    const sql = `SELECT COUNT(*) as total FROM records WHERE 1=1${whereSql}`;
    return this._stmt(sql).get(...params)?.total || 0;
  }

  emptyInsights(total = 0) {
    return {
      totalMatched: total,
      byType: { 'รย': 0, 'จยย': 0, other: 0 },
      byStatus: { pending: 0, received: 0, completed: 0, returned: 0 },
      topBrands: []
    };
  }

  /**
   * Load insights using SQL aggregates — prepared statements cached per filter shape
   */
  loadInsights(strategy) {
    if (typeof strategy.total !== 'number') {
      return this.emptyInsights(0);
    }

    const byTypeRows = this._stmt(`
      SELECT type, COUNT(*) as count
      FROM records
      WHERE 1=1${strategy.whereSql}
      GROUP BY type
    `).all(...strategy.params);

    const byStatusRows = this._stmt(`
      SELECT status, COUNT(*) as count
      FROM records
      WHERE 1=1${strategy.whereSql}
      GROUP BY status
    `).all(...strategy.params);

    const topBrands = this._stmt(`
      SELECT brand, COUNT(*) as count
      FROM records
      WHERE 1=1${strategy.whereSql}
        AND TRIM(COALESCE(brand, '')) <> ''
      GROUP BY brand
      ORDER BY count DESC, brand ASC
      LIMIT 5
    `).all(...strategy.params);

    const byType = { 'รย': 0, 'จยย': 0, other: 0 };
    for (const row of byTypeRows) {
      if (row.type === 'รย') byType['รย'] = row.count;
      else if (row.type === 'จยย') byType['จยย'] = row.count;
      else byType.other += row.count;
    }

    const byStatus = { pending: 0, received: 0, completed: 0, returned: 0 };
    for (const row of byStatusRows) {
      if (row.status === 'received') byStatus.received = row.count;
      else if (row.status === 'completed') byStatus.completed = row.count;
      else if (row.status === 'returned') byStatus.returned = row.count;
      else if (row.status === 'pending') byStatus.pending = row.count;
    }

    return {
      totalMatched: strategy.total,
      byType,
      byStatus,
      topBrands: topBrands.map(row => ({ brand: row.brand, count: row.count }))
    };
  }

  /**
   * Rank rows for non-empty queries
   */
  rankRows(strategy, filters) {
    const orderBySql = ` ORDER BY DATE(importedAt) ASC, CASE WHEN type = 'รย' THEN 0 WHEN type = 'จยย' THEN 1 ELSE 2 END ASC, importedAt ASC`;
    const hasCandidateLimit = Number.isFinite(strategy.candidateLimit) && strategy.candidateLimit > 0
      && (typeof strategy.total !== 'number' || strategy.candidateLimit < strategy.total);
    const sql = hasCandidateLimit
      ? `SELECT * FROM records WHERE 1=1${strategy.fetchWhereSql}${orderBySql} LIMIT ?`
      : `SELECT * FROM records WHERE 1=1${strategy.fetchWhereSql}${orderBySql}`;
    const rows = hasCandidateLimit
      ? this._stmt(sql).all(...strategy.fetchParams, strategy.candidateLimit)
      : this._stmt(sql).all(...strategy.fetchParams);
    const { normQuery, rawQuery } = filters;
    const fallbackUsed = Boolean(strategy.fallbackUsed);

    return rows
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
    // NOTE: _stmtCache เก็บ compiled statement — ยังใช้ได้หลัง data เปลี่ยน
    // ไม่ต้อง clear เพราะ SQL structure ยังเหมือนเดิม
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
}

module.exports = SearchManager;
