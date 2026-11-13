import { Database } from "../src/engine/database";

export const indexedFixture = `
CREATE TABLE t(id INTEGER PRIMARY KEY,n REAL,code TEXT,b BOOLEAN);
INSERT INTO t VALUES(1,1,'A',TRUE),(2,1,'a',1),(3,2,'B',FALSE),(4,NULL,NULL,NULL),(5,0,'1',0),(6,3,'xy',NULL);
CREATE UNIQUE INDEX ix_id ON t(id);
CREATE INDEX ix_n ON t(n);
CREATE INDEX ix_code ON t(code);
CREATE INDEX ix_b ON t(b);
CREATE INDEX ix_pair ON t(n,code);`;

export function indexedPair(setup = indexedFixture) {
  const auto = new Database(),
    scan = new Database({ selectAccess: "table-scan" });
  auto.execute(setup);
  scan.execute(setup);
  return { auto, scan };
}
