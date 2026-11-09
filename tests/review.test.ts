import { describe, expect, it } from 'vitest';
import { Database } from '../src/engine/database';
import type { Value } from '../src/engine/types';

function fixture(): Database {
  const db = new Database();
  db.execute(`
    CREATE TABLE t (id INTEGER PRIMARY KEY, x REAL, y INTEGER);
    INSERT INTO t VALUES (1, 5, 1), (2, NULL, 2), (3, 2, 3);
    CREATE TABLE empty (id INTEGER, x INTEGER);
  `);
  return db;
}

// Expected values were independently checked against sql.js on 2026-11-09.
describe('engine review regressions', () => {
  const cases: [string, Value[][]][] = [
    ['SELECT 0 = 1 < 2', [[0]]],
    ['SELECT 5.0 / 2', [[2.5]]],
    ['SELECT x / 2 FROM t ORDER BY id', [[2.5], [null], [1]]],
    [
      'SELECT COALESCE(x, 0) AS z, COUNT(*) FROM t GROUP BY z + 1 ORDER BY z',
      [[0, 1], [2, 1], [5, 1]],
    ],
    [
      'SELECT id, -id AS y FROM t GROUP BY id HAVING y > 0 ORDER BY id',
      [[1, -1], [2, -2], [3, -3]],
    ],
    ["SELECT '😀' LIKE '_'", [[1]]],
    ["SELECT 'æ' LIKE 'Æ'", [[0]]],
    ['SELECT 2 IS TRUE', [[1]]],
    ["SELECT SUBSTR('abc', -5, 3)", [['a']]],
    ['SELECT 1 "in"', [[1]]],
  ];
  it.each(cases)('%s', (sql, expected) => {
    expect(fixture().execute(sql)[0].rows).toEqual(expected);
  });

  const invalid = [
    'SELECT missing.*, 1 FROM t',
    'SELECT 1 + * FROM empty',
    'SELECT 1 FROM empty WHERE *',
    'SELECT COUNT(*) AS n FROM empty GROUP BY n',
    'SELECT id FROM t ORDER BY 99',
    'SELECT id FROM t GROUP BY 0',
    'SELECT id FROM t ORDER BY SUM(x)',
    'SELECT COUNT(t.*) FROM t',
  ];
  it.each(invalid)('rejects invalid SQL before reading rows: %s', (sql) => {
    expect(() => fixture().execute(sql)).toThrow();
  });
});
