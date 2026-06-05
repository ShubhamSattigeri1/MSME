INSERT INTO pricing_settings (labour_cost_per_min, overhead_per_unit, default_wastage_pct, default_margin_pct)
VALUES (2.00, 15.00, 0.0700, 0.2500);

WITH inserted_materials AS (
  INSERT INTO materials (name, category, unit, qty_available, unit_cost, supplier_name, reorder_threshold)
  VALUES
    ('Cotton Fabric', 'fabric', 'metres', 1000.00, 120.00, 'Classic Textiles', 150.00),
    ('Polyester Fabric', 'fabric', 'metres', 850.00, 90.00, 'Modern Mills', 120.00),
    ('Buttons', 'button', 'pieces', 5000.00, 2.50, 'Trim House', 750.00),
    ('Thread', 'thread', 'kg', 120.00, 300.00, 'Needle Supply Co', 20.00),
    ('Zipper', 'zipper', 'pieces', 900.00, 12.00, 'FastenPro', 100.00)
  RETURNING id, name
)
INSERT INTO bom (garment_type, material_id, qty_per_unit, notes)
SELECT 'formal shirt', id, qty_per_unit, notes
FROM inserted_materials
JOIN (
  VALUES
    ('Cotton Fabric', 1.8000, 'Main shell fabric'),
    ('Buttons', 7.0000, 'Front placket and cuffs'),
    ('Thread', 0.0300, 'Stitching thread')
) AS bom_data(name, qty_per_unit, notes) USING (name)
UNION ALL
SELECT 't-shirt', id, qty_per_unit, notes
FROM inserted_materials
JOIN (
  VALUES
    ('Polyester Fabric', 1.2000, 'Main knit fabric'),
    ('Thread', 0.0200, 'Stitching thread')
) AS bom_data(name, qty_per_unit, notes) USING (name);
