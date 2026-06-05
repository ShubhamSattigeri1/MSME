function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    success: false,
    error: err.message || 'Internal server error',
  });
}

module.exports = errorHandler;
