const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const createOriginMiddleware = (allowedOrigins) => (req, res, next) => {
  const origin = req.get("origin");

  if (unsafeMethods.has(req.method) && origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({
      message: "Request origin is not allowed",
    });
  }

  next();
};