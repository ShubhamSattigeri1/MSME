const pool = require('../db');
const services = {
  orders: require('../services/orders'),
  materials: require('../services/materials'),
  bom: require('../services/bom'),
  pricing: require('../services/pricing'),
  purchaseOrders: require('../services/purchaseOrders'),
};

function parseArgs(args) {
  return args.reduce((parsed, arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    parsed[key] = value === undefined ? true : value;
    return parsed;
  }, {});
}

function print(data) {
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  const args = parseArgs(rawArgs);

  switch (command) {
    case 'orders:list':
      print(await services.orders.listOrders(args));
      break;
    case 'materials:list':
      print(await services.materials.listMaterials());
      break;
    case 'materials:low-stock':
      print(await services.materials.listMaterials({ low_stock: true }));
      break;
    case 'bom:list':
      print(await services.bom.listBom({ garment_type: args.garment_type }));
      break;
    case 'pricing:settings':
      print(await services.pricing.getPricingSettings());
      break;
    case 'purchase-orders:list':
      print(await services.purchaseOrders.listPurchaseOrders({ status: args.status }));
      break;
    default:
      throw new Error(`Unknown command: ${command || '(empty)'}`);
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
