function assertRequired(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${fieldName} is required`);
  }
}

function assertPositiveNumber(value, fieldName) {
  assertRequired(value, fieldName);
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${fieldName} must be greater than 0`);
  }
}

function assertNonNegativeNumber(value, fieldName) {
  assertRequired(value, fieldName);
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new Error(`${fieldName} must be 0 or greater`);
  }
}

function assertUuid(value, fieldName) {
  assertRequired(value, fieldName);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(value)) {
    throw new Error(`${fieldName} must be a valid UUID`);
  }
}

function assertOneOf(value, allowedValues, fieldName) {
  assertRequired(value, fieldName);
  if (!allowedValues.includes(value)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(', ')}`);
  }
}

module.exports = {
  assertRequired,
  assertPositiveNumber,
  assertNonNegativeNumber,
  assertUuid,
  assertOneOf,
};
