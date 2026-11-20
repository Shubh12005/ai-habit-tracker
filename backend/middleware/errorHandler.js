export const notFound = (req, res, next) => {
  res.status(404).json({
    message: `Route not found: ${req.originalUrl}`,
  });
};

export const errorHandler = (err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    console.error("Server Error:", err);
  } else {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.url}: ${err.message}`);
  }

  const status =
    res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;

  res.status(status).json({
    message: err.message || "Internal server error",
    ...(isDev && { stack: err.stack }),
  });
};