require("dotenv").config({ override: true });
const { Pool } = require("pg");
const p = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    // Check pricing_settings
    let r = await p.query(
      "select column_name, is_nullable, column_default from information_schema.columns where table_name = 'pricing_settings' order by ordinal_position"
    );
    console.log("=== pricing_settings ===");
    console.table(r.rows);

    // Check if pricing_settings has factory_id constraint
    let c = await p.query(
      "select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'pricing_settings'::regclass"
    );
    console.log("=== pricing_settings constraints ===");
    console.table(c.rows);

    // Check if there's a unique constraint on pricing_settings
    let u = await p.query(
      "select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'pricing_settings'::regclass and contype = 'u'"
    );
    console.log("=== pricing_settings unique ===");
    console.table(u.rows);

    // Check factories table
    r = await p.query(
      "select column_name, is_nullable, column_default from information_schema.columns where table_name = 'factories' order by ordinal_position"
    );
    console.log("=== factories ===");
    console.table(r.rows);

    // Check garment_pricing_config
    r = await p.query(
      "select column_name, is_nullable, column_default from information_schema.columns where table_name = 'garment_pricing_config' order by ordinal_position"
    );
    console.log("=== garment_pricing_config ===");
    console.table(r.rows);

    // Check bom columns
    r = await p.query(
      "select column_name, is_nullable, column_default from information_schema.columns where table_name = 'bom' order by ordinal_position"
    );
    console.log("=== bom ===");
    console.table(r.rows);

    await p.end();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
