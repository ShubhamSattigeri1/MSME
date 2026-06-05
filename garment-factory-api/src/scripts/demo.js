const pool = require('../db');
const services = {
  materials: require('../services/materials'),
  pricing: require('../services/pricing'),
};

async function main() {
  const materials = await services.materials.listMaterials();
  const pricingSettings = await services.pricing.getPricingSettings();
  const formalShirtAvailability = await services.materials.checkAvailability([
    { garment_type: 'formal shirt', quantity: 100 },
  ]);

  console.log(JSON.stringify({
    materials_count: materials.length,
    pricing_settings: pricingSettings,
    formal_shirt_availability: formalShirtAvailability,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
