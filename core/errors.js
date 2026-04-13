class RBError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "RBError";
    this.code = options.code || "RB_ERROR";
    this.details = options.details || null;
    this.exitCode = options.exitCode || 1;
  }
}

module.exports = {
  RBError
};
