/**
 * migrate-add-bfs-function.js
 *
 * Installs a PostgreSQL PL/pgSQL function that performs BFS entirely inside
 * the database, including the chronological edge constraint.
 *
 *   find_chess_path(start_id INTEGER, end_id INTEGER, max_depth INTEGER DEFAULT 10)
 *   RETURNS INTEGER[]   -- ordered array of player IDs forming the shortest path,
 *                       -- or NULL if no path exists within max_depth hops
 *
 * Algorithm: iterative BFS with a temp-table visited set (O(1) lookups) and a
 * JSONB parent map for path reconstruction.  Unlike a PostgreSQL recursive CTE
 * (which performs DFS and cannot short-circuit), this function terminates as
 * soon as the target node is reached and never re-expands a visited node.
 *
 * Chronological constraint (identical to lib/bfs.ts):
 *   An edge between player A and player B is skipped when
 *     A.death_year < B.birth_year  OR  B.death_year < A.birth_year
 *   (only when both relevant year values are non-null).
 *
 * Performance note: suitable for paths up to depth ~8 on the current graph
 * (~70 K players, ~939 K opponent pairs) when idx_opponents_a/b are in place.
 * The in-memory bidirectional BFS in lib/bfs.ts remains faster for the hot path
 * because it avoids per-level round-trips; this function is most useful for
 * ad-hoc queries, debugging, and validating specific paths from psql.
 *
 * Safe to re-run (uses CREATE OR REPLACE FUNCTION).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/migrate-add-bfs-function.js
 *
 * Then from psql:
 *   SELECT find_chess_path(1, 12345);
 */

const { neon } = require("@neondatabase/serverless");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
const sql = neon(DB_URL);

async function main() {
  console.log("Installing find_chess_path() function...");

  // Drop old version if it exists with a different signature
  await sql`DROP FUNCTION IF EXISTS find_chess_path(INTEGER, INTEGER, INTEGER)`;

  await sql`
    CREATE OR REPLACE FUNCTION find_chess_path(
      start_id  INTEGER,
      end_id    INTEGER,
      max_depth INTEGER DEFAULT 10
    )
    RETURNS INTEGER[] AS $func$
    DECLARE
      frontier      INTEGER[] := ARRAY[start_id];
      parent        JSONB     := jsonb_build_object(start_id::TEXT, -1);
      next_frontier INTEGER[];
      cur_node      INTEGER;
      neighbor      INTEGER;
      path          INTEGER[] := '{}';
      cur           INTEGER;
    BEGIN
      -- Trivial case
      IF start_id = end_id THEN
        RETURN ARRAY[start_id];
      END IF;

      -- Temp table for O(1) visited lookups; dropped automatically at end of session
      CREATE TEMP TABLE IF NOT EXISTS _chess_visited (id INTEGER PRIMARY KEY);
      TRUNCATE _chess_visited;
      INSERT INTO _chess_visited VALUES (start_id);

      FOR _depth IN 1..max_depth LOOP
        next_frontier := '{}';

        FOREACH cur_node IN ARRAY frontier LOOP
          -- Expand both directions of the undirected edge
          FOR neighbor IN
            SELECT nb FROM (
              -- Forward edge: cur_node is player_a
              SELECT o.player_b_id AS nb
              FROM   opponents o
              JOIN   players pa ON pa.id = o.player_a_id
              JOIN   players pb ON pb.id = o.player_b_id
              WHERE  o.player_a_id = cur_node
                -- Chronological constraint: A died before B was born
                AND NOT (
                      pa.death_year IS NOT NULL
                  AND pb.birth_year IS NOT NULL
                  AND pa.death_year < pb.birth_year
                )
                -- Chronological constraint: B died before A was born
                AND NOT (
                      pb.death_year IS NOT NULL
                  AND pa.birth_year IS NOT NULL
                  AND pb.death_year < pa.birth_year
                )

              UNION ALL

              -- Reverse edge: cur_node is player_b
              SELECT o.player_a_id AS nb
              FROM   opponents o
              JOIN   players pa ON pa.id = o.player_a_id
              JOIN   players pb ON pb.id = o.player_b_id
              WHERE  o.player_b_id = cur_node
                AND NOT (
                      pa.death_year IS NOT NULL
                  AND pb.birth_year IS NOT NULL
                  AND pa.death_year < pb.birth_year
                )
                AND NOT (
                      pb.death_year IS NOT NULL
                  AND pa.birth_year IS NOT NULL
                  AND pb.death_year < pa.birth_year
                )
            ) candidates
            -- Only unvisited neighbours
            WHERE NOT EXISTS (
              SELECT 1 FROM _chess_visited WHERE id = candidates.nb
            )
          LOOP
            INSERT INTO _chess_visited VALUES (neighbor);
            parent := parent || jsonb_build_object(neighbor::TEXT, cur_node);

            -- Found the target — reconstruct path and return immediately
            IF neighbor = end_id THEN
              TRUNCATE _chess_visited;
              path := ARRAY[end_id];
              cur  := cur_node;
              WHILE cur != -1 LOOP
                path := array_prepend(cur, path);
                cur  := (parent ->> cur::TEXT)::INTEGER;
              END LOOP;
              RETURN path;
            END IF;

            next_frontier := array_append(next_frontier, neighbor);
          END LOOP;
        END LOOP;

        EXIT WHEN array_length(next_frontier, 1) IS NULL;
        frontier := next_frontier;
      END LOOP;

      TRUNCATE _chess_visited;
      RETURN NULL;  -- no path found within max_depth
    END;
    $func$ LANGUAGE plpgsql;
  `;

  console.log("  ✓ find_chess_path() installed");
  console.log("\nExample usage from psql:");
  console.log("  SELECT find_chess_path(1, 12345);");
  console.log("  -- Returns {1, 45, 780, ..., 12345} or NULL");
}

main().catch(console.error);
